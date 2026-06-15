#!/usr/bin/env bash
# AirRO Water — database backup.
# Backs up the database (SQLite or PostgreSQL) to a dated, gzipped file and
# prunes anything older than KEEP days. Safe to run by hand or from cron.
#
#   bash deploy/backup-db.sh
#
# Optional env:
#   AIRRO_BACKUP_DIR   where to store backups   (default: ~/airro-backups)
#   AIRRO_BACKUP_KEEP  days of backups to keep  (default: 14)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${AIRRO_BACKUP_DIR:-$HOME/airro-backups}"
KEEP="${AIRRO_BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Read DATABASE_URL from server/.env
DB_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/server/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'' )"

if [[ "$DB_URL" == postgres* ]]; then
  # PostgreSQL
  OUT="$BACKUP_DIR/airro-$STAMP.sql.gz"
  pg_dump "$DB_URL" | gzip > "$OUT"
else
  # SQLite: file:./prod.db  ->  Prisma stores it next to the schema (server/prisma/)
  REL="${DB_URL#file:}"; REL="${REL#./}"
  SRC="$APP_DIR/server/prisma/$REL"
  [ -f "$SRC" ] || SRC="$APP_DIR/server/$REL"     # fallback location
  if [ ! -f "$SRC" ]; then echo "DB file not found: $SRC"; exit 1; fi
  OUT="$BACKUP_DIR/airro-$STAMP.db"
  if command -v sqlite3 >/dev/null; then
    sqlite3 "$SRC" ".backup '$OUT'"               # consistent online snapshot
  else
    cp "$SRC" "$OUT"                              # fallback (install sqlite3 for safety)
  fi
  gzip -f "$OUT"; OUT="$OUT.gz"
fi

# Prune old backups
find "$BACKUP_DIR" -name 'airro-*' -type f -mtime +"$KEEP" -delete 2>/dev/null || true

echo "Backup written: $OUT"
echo "Keeping last $KEEP days in $BACKUP_DIR"
