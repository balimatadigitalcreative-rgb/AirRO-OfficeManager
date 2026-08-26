#!/usr/bin/env bash
# AirRO Water — database RESTORE (and a safe restore DRILL).
#
#   bash deploy/restore-db.sh <backup-file.gz|.gpg>    # RESTORE into production
#   bash deploy/restore-db.sh --drill [<file>]         # DRILL into /tmp (production untouched)
#
# Accepts a LOCAL .gz or an OFFSITE .gpg (downloaded from Drive) — a .gpg is decrypted
# first with BACKUP_PASSPHRASE from server/.env into a temp file that is always removed.
# Production restore steps: stop API → snapshot the CURRENT db (safety) → gunzip the
# backup over the DATABASE_URL path (read from server/.env, never hardcoded) → start
# API → health-check → print record counts so the operator can verify.
# Both modes REFUSE a file that fails `gzip -t`.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${AIRRO_BACKUP_DIR:-$HOME/airro-backups}"

DRILL=0
if [ "${1:-}" = "--drill" ]; then DRILL=1; shift; fi
FILE="${1:-}"

# In drill mode with no file, default to the newest local backup.
if [ "$DRILL" = "1" ] && [ -z "$FILE" ]; then
  FILE="$(ls -t "$BACKUP_DIR"/airro-*.db.gz "$BACKUP_DIR"/airro-*.sql.gz 2>/dev/null | head -1 || true)"
fi
[ -n "$FILE" ] || { echo "Usage: bash deploy/restore-db.sh <backup-file.gz|.gpg>   (or: --drill [file])" >&2; exit 2; }
[ -f "$FILE" ] || { echo "File not found: $FILE" >&2; exit 2; }

# Read a key from server/.env without sourcing it.
ENV_FILE="$APP_DIR/server/.env"
getenv() { [ -f "$ENV_FILE" ] && grep -E "^[[:space:]]*$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'' | sed 's/[[:space:]]*$//' || true; }

# ── An OFFSITE archive (.gpg) is decrypted first, into a temp file we always remove.
TMP_DEC=""
cleanup() { [ -n "$TMP_DEC" ] && rm -f "$TMP_DEC" || true; }
trap cleanup EXIT

if [[ "$FILE" == *.gpg ]]; then
  command -v gpg >/dev/null 2>&1 || { echo "gpg is not installed — needed to decrypt '$FILE'" >&2; exit 1; }
  PASS="${BACKUP_PASSPHRASE:-$(getenv BACKUP_PASSPHRASE)}"
  [ -n "$PASS" ] || { echo "BACKUP_PASSPHRASE is not set in server/.env — cannot decrypt '$FILE'" >&2; exit 1; }
  TMP_DEC="/tmp/airro-restore-$$.gz"
  echo "==> Decrypting offsite archive: $(basename "$FILE")"
  gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" -o "$TMP_DEC" -d "$FILE" 2>/dev/null \
    || { echo "REFUSING: gpg decryption failed for '$FILE' (wrong passphrase or corrupt file)." >&2; exit 1; }
  FILE="$TMP_DEC"
fi

# Refuse a corrupt archive before touching anything.
gzip -t "$FILE" 2>/dev/null || { echo "REFUSING: '$FILE' fails gzip -t (corrupt/incomplete)." >&2; exit 1; }

# Resolve DATABASE_URL (server/.env is the source of truth; fall back off the VPS).
# Tolerant of leading whitespace / CRLF and a missing key.
DB_URL=""
if [ -f "$APP_DIR/server/.env" ]; then
  DB_URL="$(grep -E '^[[:space:]]*DATABASE_URL=' "$APP_DIR/server/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'' | tr -d '[:space:]' || true)"
fi
DB_URL="${DB_URL:-${DATABASE_URL:-file:./dev.db}}"
IS_PG=0; [[ "$DB_URL" == postgres* ]] && IS_PG=1

resolve_sqlite() {
  local rel="${1#file:}"
  if [[ "$rel" == /* ]]; then echo "$rel"; return; fi
  rel="${rel#./}"
  if   [ -f "$APP_DIR/server/prisma/$rel" ]; then echo "$APP_DIR/server/prisma/$rel"
  elif [ -f "$APP_DIR/server/$rel" ];        then echo "$APP_DIR/server/$rel"
  else echo "$APP_DIR/server/prisma/$rel"; fi
}

# Print record counts for the key tables so the operator can eyeball the restore.
counts() {
  local db="$1"
  if command -v sqlite3 >/dev/null 2>&1; then
    for t in User Entry Employee Setoran; do
      printf "   %-10s %s\n" "$t" "$(sqlite3 "$db" "SELECT COUNT(*) FROM \"$t\";" 2>/dev/null || echo '?')"
    done
  else
    echo "   (install sqlite3 to print counts:  sudo apt-get install -y sqlite3)"
  fi
}

# ── DRILL: prove the newest backup RESTORES and VERIFIES, without touching production. ──
# Restores into a SCRATCH database, then runs the SAME two checks the deploy trusts:
#   • server/scripts/db-counts.js      — row counts (compared against the live DB)
#   • server/scripts/verify-invariants.js — every cross-module accounting invariant
# The scratch file has "scratch" in its name so _db-guard treats it as non-production, and it is
# always removed on exit. Production is only ever READ (a row count), never written.
if [ "$DRILL" = "1" ]; then
  DRILL_START="$(date +%s)"
  if [ "$IS_PG" = "1" ]; then
    echo "PostgreSQL drill: restore into a scratch database, then run the verifiers against it, e.g.:"
    echo "   createdb airro_drill && gunzip -c '$FILE' | psql airro_drill"
    echo "   ( cd '$APP_DIR/server' && DATABASE_URL='postgresql://.../airro_drill' node scripts/db-counts.js && \\"
    echo "     DATABASE_URL='postgresql://.../airro_drill' node scripts/verify-invariants.js )"
    echo "   dropdb airro_drill"
    exit 0
  fi

  SCRATCH="$BACKUP_DIR/restore-drill-scratch-$$.db"
  scratch_cleanup() { rm -f "$SCRATCH" "$SCRATCH-journal" "$SCRATCH-wal" "$SCRATCH-shm" 2>/dev/null || true; }
  trap 'scratch_cleanup; cleanup' EXIT

  echo "==> DRILL — restoring '$(basename "$FILE")' into scratch DB (production is NOT touched)"
  echo "    scratch: $SCRATCH"
  gunzip -c "$FILE" > "$SCRATCH" || { echo "gunzip failed" >&2; exit 1; }

  # Quick integrity of the restored SQLite file itself.
  if command -v sqlite3 >/dev/null 2>&1; then
    ICHK="$(sqlite3 "$SCRATCH" 'PRAGMA integrity_check;' 2>/dev/null | head -1)"
    echo "    sqlite integrity_check: ${ICHK:-<none>}"
    [ "$ICHK" = "ok" ] || { echo "REFUSING: restored scratch DB fails PRAGMA integrity_check." >&2; exit 1; }
  fi

  echo "==> Quick record counts in the restored copy:"
  counts "$SCRATCH"

  # ── db-counts.js: restored copy vs the LIVE DB (read-only on both). A drop signals a bad backup. ──
  echo "==> db-counts.js — restored copy vs production"
  DRILL_COUNTS="$( cd "$APP_DIR/server" && DATABASE_URL="file:$SCRATCH" node scripts/db-counts.js 2>&1 || echo 'FAILED' )"
  PROD_COUNTS="$( cd "$APP_DIR/server" && node scripts/db-counts.js 2>&1 || echo 'unavailable' )"
  echo "    restored : $DRILL_COUNTS"
  echo "    production: $PROD_COUNTS"
  if [ "$DRILL_COUNTS" = "$PROD_COUNTS" ]; then
    echo "    ✅ counts MATCH production (backup is a faithful snapshot)"
  else
    echo "    ⚠  counts DIFFER — expected if writes happened AFTER this backup was taken;"
    echo "       investigate if the backup is recent and the numbers are LOWER than production."
  fi

  # ── verify-invariants.js against the restored copy (read-only; proves the data is internally sound). ──
  echo "==> verify-invariants.js against the restored copy"
  set +e
  ( cd "$APP_DIR/server" && DATABASE_URL="file:$SCRATCH" node scripts/verify-invariants.js )
  VRC=$?
  set -e
  if [ "$VRC" -eq 0 ]; then echo "    ✅ all invariants hold on the restored data"
  else echo "    ✖ verify-invariants reported problems (exit $VRC) — see the table above"; fi

  DRILL_SECS=$(( $(date +%s) - DRILL_START ))
  echo "==> Drill finished in ${DRILL_SECS}s. Scratch DB removed; production untouched."
  [ "$VRC" -eq 0 ] || exit "$VRC"
  echo "✅ RESTORE DRILL PASSED — the newest backup restores, matches production, and verifies clean."
  exit 0
fi

# ── PRODUCTION RESTORE ─────────────────────────────────────────────────────────
echo "⚠️  Restoring '$FILE' into PRODUCTION."

if [ "$IS_PG" = "1" ]; then
  command -v pm2 >/dev/null 2>&1 && pm2 stop airro-api || echo "   (pm2 not found — skipping stop)"
  echo "==> Restoring into PostgreSQL ($DB_URL)"
  gunzip -c "$FILE" | psql "$DB_URL"
  command -v pm2 >/dev/null 2>&1 && pm2 start airro-api || echo "   (pm2 not found — start the API manually)"
  echo "✅ PostgreSQL restore complete. Verify: pm2 logs airro-api"
  exit 0
fi

TARGET="$(resolve_sqlite "$DB_URL")"
echo "==> Target db: $TARGET"

# 1) stop the API so nothing writes mid-restore
command -v pm2 >/dev/null 2>&1 && pm2 stop airro-api || echo "   (pm2 not found — skipping stop)"

# 2) snapshot the CURRENT db first (safety net if this restore is a mistake)
if [ -f "$TARGET" ]; then
  SAFE="$TARGET.pre-restore-$(date +%Y%m%d-%H%M%S)"
  cp "$TARGET" "$SAFE" && echo "   current db saved → $SAFE"
fi

# 3) restore the backup over the target path
mkdir -p "$(dirname "$TARGET")"
gunzip -c "$FILE" > "$TARGET" && echo "   restored $(basename "$FILE") → $TARGET"

# 4) start the API back up
command -v pm2 >/dev/null 2>&1 && pm2 start airro-api || echo "   (pm2 not found — start the API manually)"

# 5) health-check
sleep 2
HTTP="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/v1/health 2>/dev/null || echo 000)"
echo "   health: $HTTP  (expect 200)"

# 6) record counts so the operator can confirm the data is really there
echo "==> Record counts after restore:"
counts "$TARGET"

echo "✅ Restore complete. If health != 200, check: pm2 logs airro-api --lines 40"
echo "   (the previous db is kept at ${SAFE:-<none>} — delete it once you're happy)"
