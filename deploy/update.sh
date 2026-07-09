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

echo "==> 2b/6  Build frontend bundle (dist/app.js)..."
# The committed dist/app.js is already correct, so this is a belt-and-suspenders rebuild
# from source. Non-fatal: if node/esbuild aren't available we simply serve the committed
# bundle. (Frontend JSX is compiled at build time now — no in-browser Babel.)
if [ -f package.json ] && command -v npm >/dev/null 2>&1; then
  npm install --no-audit --no-fund >/dev/null 2>&1 && npm run build \
    || echo "   (skipped rebuild — serving committed dist/app.js)"
else
  echo "   (no root package.json / npm — serving committed dist/app.js)"
fi

echo "==> 3/6  Install dependencies..."
cd server
npm install --omit=dev

echo "==> 4/6  Generate Prisma client..."
unset DATABASE_URL            # use .env (avoid any stray env var)
npx prisma generate

echo "==> 5/6  Apply migrations (safe / non-destructive)..."
npx prisma migrate deploy

echo "==> 6/6  Restart backend (single instance, zero-downtime)..."
cd "$APP_DIR"
# Only when pm2 is NOT already managing airro-api: if a stray `node src/server.js`
# still holds :4000, free it so the first start doesn't hit EADDRINUSE. When pm2
# already runs it we leave the port alone — startOrReload reloads it gracefully.
if ! pm2 describe airro-api >/dev/null 2>&1; then
  if command -v fuser >/dev/null 2>&1; then fuser -k 4000/tcp >/dev/null 2>&1 || true; sleep 1; fi
fi
# startOrReload: not running → start, already running → reload (no warning, no
# downtime). Replaces the old delete+start, which briefly dropped the API and
# printed "[PM2][WARN] ... not running, starting...".
pm2 startOrReload deploy/ecosystem.config.js --update-env
# Persist the process list so it comes back automatically after a server reboot.
# (Run `pm2 startup` once on the server to install the boot hook.)
pm2 save >/dev/null 2>&1 || true

echo ""
echo "✅ Update selesai. Verifikasi:"
echo "   pm2 logs airro-api --lines 15    # harus: listening on http://127.0.0.1:4000 (tanpa EADDRINUSE)"
echo "   curl -s -o /dev/null -w 'health: %{http_code}\n' http://127.0.0.1:4000/api/v1/health"
