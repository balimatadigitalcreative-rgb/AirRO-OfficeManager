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
# This script is the FIRST-TIME installer. If a site config already exists it may hold
# certbot's :443 block — overwriting it here is exactly what caused the 17 Jul outage
# (site off the internet, Nginx on :80 only). Refuse and hand off to apply-nginx.sh,
# which diffs, backs up, tests and rolls back.
SITE=/etc/nginx/sites-available/airro
if [ -e "$SITE" ]; then
  echo "!! $SITE already exists — NOT overwriting it."
  echo "   This installer is for a fresh box. To update an existing site safely:"
  echo "       sudo bash deploy/apply-nginx.sh"
  echo "   (it backs up, runs nginx -t, reloads only on success, and restores on failure)"
else
  # Bootstrap = HTTP only. The full config (nginx-airro.conf) references certificates
  # that do not exist yet, so nginx -t would fail here. certbot creates them in step 4,
  # then apply-nginx.sh installs the full config (step 5).
  sed -e "s/yourdomain.com/$DOMAIN/g" -e "s#/var/www/airro#$APP_DIR#g" deploy/nginx-airro-bootstrap.conf > "$SITE"
  ln -sf "$SITE" /etc/nginx/sites-enabled/airro
  nginx -t && systemctl reload nginx
fi

cat <<EOF

==> Base setup done. Remaining manual steps:
  1) Edit the secrets:        nano $APP_DIR/server/.env   (JWT_SECRET, SEED_OWNER_PASSWORD, CORS_ORIGIN)
  2) Seed the admin account:  cd $APP_DIR/server && SEED_DEMO_USERS=false SEED_OWNER_PASSWORD='YourStrongPass' node prisma/seed.js
  3) Restart backend:         pm2 restart airro-api
  4) Enable HTTPS:            apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN -d www.$DOMAIN
     (Nginx is HTTP-only until this runs — that's the bootstrap config.)
  4b) Install the full config: sudo bash deploy/apply-nginx.sh
     (adds the canonical :443 block, HTTP→HTTPS redirect, caching, manifest type.
      NEVER cp the config by hand — that wiped HTTPS on 17 Jul. See DEPLOY.md.)
  5) Firewall (optional):     ufw allow 'Nginx Full' && ufw allow OpenSSH && ufw enable

Then open https://$DOMAIN  and log in with owner / <the password you seeded>.
EOF
