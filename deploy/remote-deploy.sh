#!/usr/bin/env bash
# Run by GitHub Actions over SSH — it is the forced command of the deploy key (deploy/setup-github-deploy.sh),
# so this is the ONLY thing that key can do. An SSH command gets no login shell: load node/pm2 the way an
# interactive login does, then the normal gated deploy (tests, build, migrations, health, rollback).
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
export PATH="$PATH:/usr/local/bin:/usr/bin"
cd "$(dirname "$0")/.." || exit 1
echo "AirRO deploy dari GitHub — $(date '+%Y-%m-%d %H:%M:%S %Z') — $(whoami)@$(hostname)"
exec bash deploy/update.sh
