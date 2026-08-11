#!/usr/bin/env bash
# Verify pending Prisma migrations apply cleanly on a COPY of the PRODUCTION database — never the real
# one. Run on the VPS BEFORE `bash deploy/update.sh` when a deploy ships migrations you want to rehearse.
# Read-only w.r.t. production: it copies the DB to a temp file and migrates the copy, then throws it away.
#
#   Usage:  bash deploy/verify-migrations.sh
#   Exit 0 = safe to deploy · non-zero = DO NOT deploy, fix the migration first.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
cd server || { echo "❌ no server/ dir"; exit 1; }

# Resolve the production DATABASE_URL (SQLite file:) from server/.env.
PROD_URL="$(grep -E '^DATABASE_URL=' .env 2>/dev/null | tail -1 | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')"
[ -n "$PROD_URL" ] || { echo "❌ DATABASE_URL not found in server/.env"; exit 1; }
case "$PROD_URL" in
  file:*) PROD_DB="${PROD_URL#file:}" ;;
  *) echo "❌ verify-migrations supports SQLite file: URLs only (got: $PROD_URL)"; exit 1 ;;
esac
# Prisma resolves a relative url against the schema dir (prisma/). Match that so we copy the real file.
case "$PROD_DB" in /*) : ;; *) PROD_DB="prisma/${PROD_DB#./}" ;; esac
[ -f "$PROD_DB" ] || { echo "❌ production DB not found at: $PROD_DB"; exit 1; }

TMP="$(mktemp -u).db"
cp "$PROD_DB" "$TMP" || { echo "❌ could not copy prod DB"; exit 1; }
trap 'rm -f "$TMP" "$TMP-journal" "$TMP-wal" "$TMP-shm" 2>/dev/null' EXIT
echo "✓ copied production DB ($(du -h "$PROD_DB" | cut -f1)) → temp copy (production untouched)"

echo "── migrate status BEFORE (on the copy) ──"
DATABASE_URL="file:$TMP" npx prisma migrate status 2>&1 | sed 's/^/   /'

echo "── applying migrations to the COPY ──"
if DATABASE_URL="file:$TMP" npx prisma migrate deploy 2>&1 | sed 's/^/   /'; then
  AFTER="$(DATABASE_URL="file:$TMP" npx prisma migrate status 2>&1)"
  echo "── migrate status AFTER (on the copy) ──"; echo "$AFTER" | sed 's/^/   /'
  if echo "$AFTER" | grep -qiE 'up to date|schema is up to date'; then
    echo "✅ migrations apply cleanly on a copy of production data — safe to run deploy/update.sh"
    exit 0
  fi
  echo "❌ status is NOT clean after applying — investigate before deploying"; exit 1
fi
echo "❌ migrate deploy FAILED on the production copy — DO NOT deploy; fix the migration first"; exit 1
