#!/usr/bin/env bash
# AirRO Water — apply the repo's Nginx site config SAFELY.
#
#   sudo bash deploy/apply-nginx.sh [--yes] [--force]
#
# WHY THIS EXISTS — 17 Jul outage: the repo config only had a `listen 80` block, so
# `sudo cp deploy/nginx-airro.conf /etc/nginx/sites-available/airro` silently deleted
# certbot's :443 server block. Nginx reloaded fine, came back on :80 only, and the site
# was unreachable from the internet until certbot was re-run. Never cp this by hand.
#
# What this does instead:
#   1. diff live vs repo, and REFUSE if the live config has TLS the repo copy lacks
#      (that is exactly the 17 Jul footgun) unless --force
#   2. check the certificate files the config references actually exist
#   3. back up the live file (timestamped)
#   4. copy, then `nginx -t`
#   5. reload ONLY if the test passes; verify :443 is listening afterwards
#   6. on ANY failure: restore the backup, reload, exit non-zero
#
# Flags:
#   --yes    non-interactive (assume yes at the confirm prompt)
#   --force  apply even if the live config has TLS directives the repo copy lacks
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$APP_DIR/deploy/nginx-airro.conf"
LIVE="${AIRRO_NGINX_SITE:-/etc/nginx/sites-available/airro}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BAK="$LIVE.bak-$STAMP"
DOMAIN="${AIRRO_DOMAIN:-airrooffice.com}"

# Overridable so the test harness can inject mocks.
NGINX_BIN="${NGINX_BIN:-nginx}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-systemctl}"

ok()   { echo "   ✅ $*"; }
bad()  { echo "   ❌ $*" >&2; }
info() { echo "   ·  $*"; }
die()  { bad "$*"; exit 1; }

YES=0; FORCE=0
for a in "$@"; do
  case "$a" in
    --yes|-y) YES=1 ;;
    --force)  FORCE=1 ;;
    *) die "Unknown flag: $a  (usage: sudo bash deploy/apply-nginx.sh [--yes] [--force])" ;;
  esac
done

echo "▸ AirRO — apply Nginx config"
[ -f "$SRC" ]  || die "repo config not found: $SRC"
[ -r "$LIVE" ] || die "live config not found/readable: $LIVE (is Nginx installed? wrong path? set AIRRO_NGINX_SITE=)"
[ "$(id -u)" = "0" ] || die "must run as root: sudo bash deploy/apply-nginx.sh"

# ── 1. diff ───────────────────────────────────────────────────────────────────
if diff -q "$LIVE" "$SRC" >/dev/null 2>&1; then
  ok "live config already identical to the repo copy — nothing to do"
  exit 0
fi
echo ""
echo "── diff: live ($LIVE) → repo (deploy/nginx-airro.conf) ──"
diff -u "$LIVE" "$SRC" | sed 's/^/  /'
echo "────────────────────────────────────────────────────────────"

# ── 2. the 17 Jul guard: never drop TLS that the live config has ──────────────
live_has_tls=0; src_has_tls=0
grep -qE '^\s*(listen\s+443|ssl_certificate\s)' "$LIVE" && live_has_tls=1
grep -qE '^\s*(listen\s+443|ssl_certificate\s)' "$SRC"  && src_has_tls=1
if [ "$live_has_tls" = "1" ] && [ "$src_has_tls" = "0" ]; then
  bad "REFUSING: the LIVE config has TLS (:443 / ssl_certificate) but the repo copy does NOT."
  bad "Applying it would delete your HTTPS server block and take the site off the internet."
  bad "This is exactly what caused the 17 Jul outage."
  info "Fix the repo copy to include the :443 block, or re-issue with:"
  info "    sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
  [ "$FORCE" = "1" ] || exit 1
  bad "--force given — proceeding anyway (you asked for it)"
fi
if [ "$src_has_tls" = "1" ] && [ "$live_has_tls" = "0" ]; then
  info "repo config adds TLS that the live config lacks (this is the 17 Jul repair) — good"
fi

# ── 3. referenced cert files must exist, or nginx -t will fail ────────────────
MISSING=""
while read -r f; do
  [ -n "$f" ] && [ ! -e "$f" ] && MISSING="$MISSING $f"
done < <(grep -oE '/etc/letsencrypt/[^; ]+' "$SRC" | sort -u)
if [ -n "$MISSING" ]; then
  bad "the repo config references certificate files that do NOT exist on this box:$MISSING"
  info "Issue/repair the certificate first, then re-run this script:"
  info "    sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
  exit 1
fi
ok "all referenced certificate files exist"

# ── 4. confirm + back up ──────────────────────────────────────────────────────
if [ "$YES" != "1" ]; then
  printf "   Apply this config and reload Nginx? [y/N] "
  read -r ans </dev/tty || ans=""
  case "$ans" in y|Y|yes|YES) ;; *) echo "   aborted — nothing changed"; exit 1 ;; esac
fi
cp -p "$LIVE" "$BAK" || die "could not back up $LIVE"
ok "backed up live config → $BAK"

restore() {
  cp -p "$BAK" "$LIVE" && info "restored previous config from $BAK"
  if "$NGINX_BIN" -t >/dev/null 2>&1; then
    "$SYSTEMCTL_BIN" reload nginx >/dev/null 2>&1 && info "reloaded Nginx with the previous config"
  else
    bad "the PREVIOUS config also fails nginx -t — Nginx may be down. Investigate now:"
    bad "    sudo nginx -t ; sudo systemctl status nginx"
  fi
}

# ── 5. apply + test ───────────────────────────────────────────────────────────
cp "$SRC" "$LIVE" || { bad "copy failed"; restore; exit 1; }
TEST_OUT="$("$NGINX_BIN" -t 2>&1)"; TEST_RC=$?
if [ "$TEST_RC" -ne 0 ]; then
  bad "nginx -t FAILED — not reloading. Nginx is still running the OLD config."
  echo "$TEST_OUT" | sed 's/^/        /' >&2
  restore
  exit 1
fi
ok "nginx -t passed"

# ── 6. reload + verify :443 really came up ────────────────────────────────────
if ! "$SYSTEMCTL_BIN" reload nginx >/dev/null 2>&1; then
  bad "systemctl reload nginx FAILED"
  restore
  exit 1
fi
ok "Nginx reloaded"

sleep 1
LISTEN="$(ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null)"
for p in 80 443; do
  if echo "$LISTEN" | grep -qE "[:.]$p\b"; then
    ok "listening on :$p"
  else
    bad "NOT listening on :$p after reload — rolling the config back"
    restore
    exit 1
  fi
done

echo ""
ok "Nginx config applied. Previous version kept at: $BAK"
info "Verify from OUTSIDE the server (a localhost check would not have caught 17 Jul):"
info "    curl -sS -o /dev/null -w '%{http_code}\\n' https://$DOMAIN/"
