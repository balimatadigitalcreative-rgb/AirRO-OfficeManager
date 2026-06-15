#!/usr/bin/env bash
# AirRO Water — one-shot VPS setup (Ubuntu 22.04/24.04).
# Run as a sudo-capable user from the uploaded project root:
#   cd /var/www/airro && sudo bash deploy/deploy.sh yourdomain.com
# It installs Node + Nginx + pm2, sets up the backend, configures the site, and
# prints the remaining manual steps (edit .env, run certbot).
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # project root
[ -z "$DOMAIN" ] && { echo "Usage: sudo bash deploy/deploy.sh <domain>"; exit 1; }

echo "==> AirRO deploy for $DOMAIN  (app dir: $APP_DIR)"

# 1. System packages
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y nginx
command -v pm2 >/dev/null || npm install -g pm2

# 2. Backend dependencies + DB
cd "$APP_DIR/server"
npm install --omit=dev
[ -f .env ] || { cp .env.production.example .env; echo "!! Created server/.env from template — EDIT IT before going live."; }
npx prisma generate
npx prisma db push --skip-generate
echo "   (Seed later with: SEED_DEMO_USERS=false SEED_OWNER_PASSWORD='...' node prisma/seed.js)"

# 3. Start backend with pm2
cd "$APP_DIR"
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup systemd -u "$(logname)" --hp "/home/$(logname)" || true

# 4. Nginx site
SITE=/etc/nginx/sites-available/airro
sed -e "s/yourdomain.com/$DOMAIN/g" -e "s#/var/www/airro#$APP_DIR#g" deploy/nginx-airro.conf > "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/airro
nginx -t && systemctl reload nginx

cat <<EOF

==> Base setup done. Remaining manual steps:
  1) Edit the secrets:        nano $APP_DIR/server/.env   (JWT_SECRET, SEED_OWNER_PASSWORD, CORS_ORIGIN)
  2) Seed the admin account:  cd $APP_DIR/server && SEED_DEMO_USERS=false SEED_OWNER_PASSWORD='YourStrongPass' node prisma/seed.js
  3) Restart backend:         pm2 restart airro-api
  4) Enable HTTPS:            apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN -d www.$DOMAIN
  5) Firewall (optional):     ufw allow 'Nginx Full' && ufw allow OpenSSH && ufw enable

Then open https://$DOMAIN  and log in with owner / <the password you seeded>.
EOF
