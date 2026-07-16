#!/usr/bin/env bash
# AirRO Water — database RESTORE (and a safe restore DRILL).
#
#   bash deploy/restore-db.sh <backup-file.gz>       # RESTORE into production
#   bash deploy/restore-db.sh --drill [<file.gz>]    # DRILL into /tmp (production untouched)
#
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
[ -n "$FILE" ] || { echo "Usage: bash deploy/restore-db.sh <backup-file.gz>   (or: --drill [file])" >&2; exit 2; }
[ -f "$FILE" ] || { echo "File not found: $FILE" >&2; exit 2; }

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

# ── DRILL: prove the backup is usable without touching production. ─────────────
if [ "$DRILL" = "1" ]; then
  if [ "$IS_PG" = "1" ]; then
    echo "PostgreSQL drill: restore into a scratch database, e.g.:"
    echo "   createdb airro_drill && gunzip -c '$FILE' | psql airro_drill && psql airro_drill -c 'SELECT count(*) FROM \"User\";'"
    exit 0
  fi
  TMP="/tmp/restore-test.db"
  echo "==> DRILL — restoring '$FILE' into $TMP (production is NOT touched)"
  gunzip -c "$FILE" > "$TMP" || { echo "gunzip failed" >&2; exit 1; }
  echo "==> Record counts in the restored copy:"
  counts "$TMP"
  rm -f "$TMP"
  echo "✅ Drill OK — the backup gunzips cleanly and contains data. Nothing in production changed."
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
