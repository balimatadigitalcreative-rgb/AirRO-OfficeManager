#!/usr/bin/env bash
# AirRO Water — database backup (local + optional offsite).
# Snapshots the database (SQLite or PostgreSQL) to a dated, gzipped file, verifies
# the archive is intact, prunes anything older than KEEP days, then (unless skipped)
# ships an encrypted copy offsite via deploy/backup-offsite.sh. Safe by hand or cron.
#
#   bash deploy/backup-db.sh
#
# Optional env:
#   AIRRO_BACKUP_DIR        where to store backups     (default: ~/airro-backups)
#   AIRRO_BACKUP_KEEP       days of local backups      (default: 14)
#   AIRRO_BACKUP_MIN_BYTES  fail if archive smaller    (default: 51200 = 50 KB)
#   SKIP_OFFSITE=1          do the local backup only   (update.sh sets this so a
#                           deploy is never blocked by an offsite outage)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${AIRRO_BACKUP_DIR:-$HOME/airro-backups}"
KEEP="${AIRRO_BACKUP_KEEP:-14}"
MIN_BYTES="${AIRRO_BACKUP_MIN_BYTES:-51200}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

MARKER="$BACKUP_DIR/LAST_BACKUP_FAILED"
# fail loudly: log to stderr, drop a marker the owner (or a monitor) can check, exit non-zero.
fail() { echo "ERROR (backup): $*" >&2; echo "$(date '+%F %T') BACKUP FAILED: $*" > "$MARKER"; exit 1; }
trap 'fail "unexpected error near line $LINENO"' ERR

# ── Resolve DATABASE_URL: server/.env is the source of truth; fall back to the
# environment / a dev default when it's absent, so this script runs off the VPS too.
# Tolerant of leading whitespace and a missing key (grep no-match must not abort).
DB_URL=""
if [ -f "$APP_DIR/server/.env" ]; then
  DB_URL="$(grep -E '^[[:space:]]*DATABASE_URL=' "$APP_DIR/server/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'' | tr -d '[:space:]' || true)"
fi
DB_URL="${DB_URL:-${DATABASE_URL:-file:./dev.db}}"
[ -n "$DB_URL" ] || fail "DATABASE_URL is empty (check server/.env)"

if [[ "$DB_URL" == postgres* ]]; then
  # PostgreSQL
  command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not installed"
  OUT="$BACKUP_DIR/airro-$STAMP.sql.gz"
  pg_dump "$DB_URL" | gzip > "$OUT" || fail "pg_dump failed"
else
  # SQLite: file:./prod.db → Prisma stores it next to the schema (server/prisma/);
  # an absolute file:/... path is used verbatim.
  REL="${DB_URL#file:}"
  if [[ "$REL" == /* ]]; then
    SRC="$REL"
  else
    REL="${REL#./}"
    SRC="$APP_DIR/server/prisma/$REL"
    [ -f "$SRC" ] || SRC="$APP_DIR/server/$REL"   # fallback location
  fi
  [ -f "$SRC" ] || fail "DB file not found: $SRC"
  OUT="$BACKUP_DIR/airro-$STAMP.db"
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$SRC" ".backup '$OUT'" || fail "sqlite3 .backup failed"   # consistent online snapshot
  else
    cp "$SRC" "$OUT" || fail "cp snapshot failed"                       # fallback (install sqlite3 for safety)
  fi
  gzip -f "$OUT" || fail "gzip failed"; OUT="$OUT.gz"
fi

# ── Integrity + sanity: a backup you can't restore is worse than none.
gzip -t "$OUT" || fail "integrity check failed (gzip -t) — archive is corrupt: $OUT"
SIZE="$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT" 2>/dev/null || echo 0)"
[ "$SIZE" -ge "$MIN_BYTES" ] || fail "archive suspiciously small (${SIZE} bytes < ${MIN_BYTES}) — likely truncated: $OUT"
HSIZE="$(du -h "$OUT" | cut -f1)"

# ── Prune old LOCAL backups (offsite keeps its own, longer retention).
find "$BACKUP_DIR" -name 'airro-*' -type f -mtime +"$KEEP" -delete 2>/dev/null || true

# ── Offsite copy (encrypted). Skipped during deploys (SKIP_OFFSITE=1) so a cloud
# outage never blocks an update; cron runs the full chain and fails loudly.
OFFSITE="skipped"
if [ "${SKIP_OFFSITE:-0}" != "1" ] && [ -f "$APP_DIR/deploy/backup-offsite.sh" ]; then
  if bash "$APP_DIR/deploy/backup-offsite.sh" "$OUT"; then OFFSITE="OK"; else OFFSITE="FAILED"; fi
fi

echo "Backup written: $OUT ($HSIZE), integrity OK"
echo "Keeping last $KEEP days in $BACKUP_DIR"
# One-line summary for backup.log monitoring.
echo "SUMMARY $(date '+%F %T') | file=$(basename "$OUT") size=$HSIZE | local=OK | offsite=$OFFSITE | keep_local=${KEEP}d"

[ "$OFFSITE" != "FAILED" ] || fail "offsite upload failed (local backup is OK; fix the offsite target)"
rm -f "$MARKER"   # clear any previous failure flag
trap - ERR
