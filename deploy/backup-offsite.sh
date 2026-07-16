#!/usr/bin/env bash
# AirRO Water — OFFSITE backup upload (encrypted).
# Ships a local backup archive to storage OUTSIDE the VPS via rclone, encrypted,
# because the database holds salaries, NIK and BPJS (personal) data.
#
#   bash deploy/backup-offsite.sh [<backup-file.gz>]   # default: newest in ~/airro-backups
#
# Encryption — two supported modes (pick one, documented in DEPLOY.md):
#   A) gpg symmetric: set BACKUP_PASSPHRASE in server/.env → archive is gpg-encrypted
#      (AES256) here, then the .gpg is uploaded to a PLAIN rclone remote.
#   B) rclone crypt: leave BACKUP_PASSPHRASE empty and point RCLONE_REMOTE at a
#      `crypt` remote → rclone encrypts names + contents transparently on upload.
#
# Config (env or server/.env):
#   RCLONE_REMOTE       rclone target, e.g. "airro-offsite:airro"  (default)
#   BACKUP_PASSPHRASE   gpg passphrase (mode A). NEVER commit it.
#   OFFSITE_KEEP_DAYS   remote retention in days                    (default: 90)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${AIRRO_BACKUP_DIR:-$HOME/airro-backups}"
mkdir -p "$BACKUP_DIR"
MARKER="$BACKUP_DIR/LAST_OFFSITE_FAILED"
fail() { echo "ERROR (offsite): $*" >&2; echo "$(date '+%F %T') OFFSITE FAILED: $*" > "$MARKER"; exit 1; }

# Read a key from server/.env without sourcing it (values may contain spaces/#).
ENV_FILE="$APP_DIR/server/.env"
getenv() { [ -f "$ENV_FILE" ] && grep -E "^[[:space:]]*$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'' | sed 's/[[:space:]]*$//' || true; }

RCLONE_REMOTE="${RCLONE_REMOTE:-$(getenv RCLONE_REMOTE)}"; RCLONE_REMOTE="${RCLONE_REMOTE:-airro-offsite:airro}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-$(getenv BACKUP_PASSPHRASE)}"
OFFSITE_KEEP_DAYS="${OFFSITE_KEEP_DAYS:-$(getenv OFFSITE_KEEP_DAYS)}"; OFFSITE_KEEP_DAYS="${OFFSITE_KEEP_DAYS:-90}"

# Which file to upload: explicit arg, or the newest local backup.
FILE="${1:-}"
[ -n "$FILE" ] || FILE="$(ls -t "$BACKUP_DIR"/airro-*.gz 2>/dev/null | head -1 || true)"
[ -n "$FILE" ] && [ -f "$FILE" ] || fail "no backup file to upload (pass one, or create one in $BACKUP_DIR first)"
gzip -t "$FILE" 2>/dev/null || fail "refusing to upload a corrupt archive (gzip -t failed): $FILE"

command -v rclone >/dev/null 2>&1 || fail "rclone not installed — see DEPLOY.md → Backup & Restore (one-time 'rclone config')"
REMOTE_NAME="${RCLONE_REMOTE%%:*}"
rclone listremotes 2>/dev/null | grep -qx "$REMOTE_NAME:" \
  || fail "rclone remote '$REMOTE_NAME:' is not configured — run 'rclone config' once (see DEPLOY.md)"

# Encrypt (mode A) if a passphrase is set; otherwise rely on a crypt remote (mode B).
UPLOAD="$FILE"; TMP_ENC=""; MODE="rclone-crypt"
cleanup() { [ -n "$TMP_ENC" ] && rm -f "$TMP_ENC" || true; }
trap cleanup EXIT
if [ -n "$BACKUP_PASSPHRASE" ]; then
  command -v gpg >/dev/null 2>&1 || fail "BACKUP_PASSPHRASE is set but gpg is not installed"
  TMP_ENC="${FILE}.gpg"; MODE="gpg-aes256"
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
      --cipher-algo AES256 -c -o "$TMP_ENC" "$FILE" || fail "gpg encryption failed"
  UPLOAD="$TMP_ENC"
fi

# Upload. copyto keeps the exact filename; --no-traverse is fast for single files.
rclone copyto "$UPLOAD" "$RCLONE_REMOTE/$(basename "$UPLOAD")" --no-traverse \
  || fail "rclone upload failed → $RCLONE_REMOTE"

# Offsite retention (longer than local): drop remote files older than N days.
rclone delete --min-age "${OFFSITE_KEEP_DAYS}d" "$RCLONE_REMOTE" 2>/dev/null || true

rm -f "$MARKER"
echo "OFFSITE OK | $(basename "$UPLOAD") → $RCLONE_REMOTE | enc=$MODE | keep=${OFFSITE_KEEP_DAYS}d"
