#!/usr/bin/env bash
# AirRO Water — SAFE update. Run on the VPS for every code/feature update:
#   bash deploy/update.sh
#
# It NEVER deletes data:
#   1. backs up the database first
#   2. pulls the latest code (.env & *.db are gitignored, so they're untouched)
#   3. applies only NEW migrations (prisma migrate deploy refuses data loss)
#   4. restarts the backend
#
# One-time setup before the FIRST run (baseline the existing DB):
#   cd server && unset DATABASE_URL && npx prisma migrate resolve --applied 0_init
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "==> 1/6  Backup database..."
bash deploy/backup-db.sh

echo "==> 2/6  Pull latest code..."
git fetch origin
git reset --hard origin/master

echo "==> 3/6  Install dependencies..."
cd server
npm install --omit=dev

echo "==> 4/6  Generate Prisma client..."
unset DATABASE_URL            # use .env (avoid any stray env var)
npx prisma generate

echo "==> 5/6  Apply migrations (safe / non-destructive)..."
npx prisma migrate deploy

echo "==> 6/6  Restart backend (single instance, free port 4000)..."
cd "$APP_DIR"
# Ensure exactly ONE listener on :4000 — a duplicate pm2 app or a stray
# `node src/server.js` left running causes EADDRINUSE and a restart crash-loop.
pm2 delete airro-api >/dev/null 2>&1 || true
if command -v fuser >/dev/null 2>&1; then fuser -k 4000/tcp >/dev/null 2>&1 || true; fi
sleep 1
pm2 start deploy/ecosystem.config.js --update-env
pm2 save >/dev/null 2>&1 || true

echo ""
echo "✅ Update selesai. Verifikasi:"
echo "   pm2 logs airro-api --lines 15    # harus: listening on http://127.0.0.1:4000 (tanpa EADDRINUSE)"
echo "   curl -s -o /dev/null -w 'health: %{http_code}\n' http://127.0.0.1:4000/api/v1/health"
