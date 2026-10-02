#!/usr/bin/env bash
# ONE-TIME: let GitHub Actions deploy this server — and nothing else.
#
#   cd /var/www/airrooffice && bash deploy/setup-github-deploy.sh
#
# Makes an SSH key ON THIS SERVER (the private key never travels through chat or e-mail), allows it in
# ~/.ssh/authorized_keys with a FORCED COMMAND (it can only run deploy/remote-deploy.sh → update.sh: no
# shell, no port/agent forwarding), then prints the two values to paste into GitHub → Settings →
# Secrets and variables → Actions:  VPS_SSH_KEY  and  VPS_HOST_KEY.
# Running it again reuses the same key and does not add it twice.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$HOME/.ssh/airro_github_deploy"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N '' -C 'airro-github-deploy' -f "$KEY" >/dev/null
AUTH="$HOME/.ssh/authorized_keys"
touch "$AUTH" && chmod 600 "$AUTH"
PUB="$(cat "$KEY.pub")"
LINE="command=\"bash $APP_DIR/deploy/remote-deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $PUB"
if grep -qF "$(echo "$PUB" | awk '{print $2}')" "$AUTH"; then
  echo "Kunci deploy sudah terpasang di $AUTH."
else
  echo "$LINE" >> "$AUTH"
  echo "Kunci deploy dipasang di $AUTH (hanya bisa menjalankan deploy)."
fi
echo
echo "=============== GitHub secret: VPS_SSH_KEY ==============="
echo "(salin SEMUA baris di bawah, dari -----BEGIN sampai -----END)"
cat "$KEY"
echo
echo "=============== GitHub secret: VPS_HOST_KEY ==============="
echo "(salin 1 baris di bawah)"
awk '{print $1" "$2}' /etc/ssh/ssh_host_ed25519_key.pub
echo
if [ "$(whoami)" != "root" ]; then
  echo "User SSH = $(whoami). Tambahkan juga GitHub → Variables → VPS_USER = $(whoami)"
fi
echo "Selesai. Setelah 2 secret diisi, setiap push ke master otomatis menjalankan deploy/update.sh di sini."
