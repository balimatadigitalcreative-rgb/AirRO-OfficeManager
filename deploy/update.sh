#!/usr/bin/env bash
# AirRO Water — SELF-VERIFYING deploy with automatic rollback.
#
#   bash deploy/update.sh [--restore-db] [--skip-offsite] [--skip-tests]
#
# Every step is a GATE. A gate that fails stops the deploy; a gate that fails AFTER
# the new code is live triggers an automatic rollback to the previous commit.
# The script exits non-zero on FAIL, so a broken deploy can never look successful.
#
# WHY THIS EXISTS — 16 Jul incident: a stale Docker container held :4000, pm2 could
# not bind (EADDRINUSE), the old deploy script printed "✅ selesai" anyway, and every
# staff login failed for hours. Deploys now refuse a contended port and prove the API
# actually authenticates before declaring success.
#
# ROLLBACK RULES (deliberate — read before changing):
#   • CODE rollback is AUTOMATIC on any post-deploy verification failure.
#   • DATABASE restore is NEVER automatic. Migrations are additive (`migrate deploy`
#     refuses data loss), so the previous code almost always runs fine on the new
#     schema — restoring the DB would throw away real writes made since the backup.
#     It happens only when ALL of these hold: migrations applied in THIS run AND
#     verification failed AND you explicitly passed --restore-db. Otherwise the exact
#     restore command is printed for you to run deliberately.
#
# Flags:
#   --restore-db     also restore the pre-deploy DB snapshot if a rollback happens
#                    AND migrations were applied in this run (destructive — see above)
#   --skip-offsite   emergency escape: allow the deploy when offsite backup is down
#   --skip-tests     emergency escape: skip the test gate (NOT for normal use)

# NOTE: no `set -e` — every gate is checked explicitly so we can roll back instead
# of dying halfway through. `pipefail` still surfaces failures inside pipelines.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR" || { echo "FATAL: cannot cd to $APP_DIR"; exit 1; }

LOG="$APP_DIR/deploy/deploy.log"
PORT="${AIRRO_PORT:-4000}"
PM2_APP="airro-api"
DOMAIN="${AIRRO_DOMAIN:-airrooffice.com}"
HEALTH_URL="http://127.0.0.1:$PORT/api/v1/health"

RESTORE_DB=0; SKIP_OFFSITE=0; SKIP_TESTS=0
for a in "$@"; do
  case "$a" in
    --restore-db)   RESTORE_DB=1 ;;
    --skip-offsite) SKIP_OFFSITE=1 ;;
    --skip-tests)   SKIP_TESTS=1 ;;
    *) echo "Unknown flag: $a"; exit 2 ;;
  esac
done

# ── logging ───────────────────────────────────────────────────────────────────
ts()   { date '+%F %T'; }
log()  { echo "$*" | tee -a "$LOG"; }
ok()   { log "   ✅ $*"; }
bad()  { log "   ❌ $*"; }
info() { log "   ·  $*"; }

# State tracked for the summary + rollback.
SHA_BEFORE=""; SHA_AFTER=""; BACKUP_FILE=""; COUNTS_BEFORE=""; COUNTS_AFTER=""
MIGRATIONS_APPLIED="no"; TESTS="skipped"; ROLLED_BACK="no"; DB_RESTORED="no"
HEALTH_CODE="000"; FAIL_REASON=""
PUBLIC_HTTPS="not checked"; LISTEN_443="?"; CERT_DAYS="?"

log ""
log "════════════════════════════════════════════════════════════════════"
log "$(ts)  AirRO deploy starting  (flags:${*:-none})"
log "════════════════════════════════════════════════════════════════════"

# ── helpers ───────────────────────────────────────────────────────────────────

# PIDs currently listening on $PORT. Tries ss, then netstat, then lsof.
port_pids() {
  local out=""
  if command -v ss >/dev/null 2>&1; then
    out="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2)"
  elif command -v netstat >/dev/null 2>&1; then
    out="$(netstat -ltnp 2>/dev/null | awk -v p=":$PORT\$" '$4 ~ p {print $7}' | cut -d/ -f1 | grep -E '^[0-9]+$')"
  elif command -v lsof >/dev/null 2>&1; then
    out="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)"
  fi
  echo "$out" | grep -E '^[0-9]+$' | sort -u
}

# PID of our pm2-managed app ('' when not running).
pm2_pid() {
  pm2 jlist 2>/dev/null | node -e "
    let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
      try { const a=JSON.parse(s); const p=a.find(x=>x.name==='$PM2_APP');
            console.log(p && p.pid ? p.pid : ''); } catch(e) { console.log(''); }
    });" 2>/dev/null
}

# Health check with backoff. Sets HEALTH_CODE. Returns 0 only on a 200.
wait_health() {
  local tries=5 delay=1 i
  for i in $(seq 1 "$tries"); do
    HEALTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || echo 000)"
    [ "$HEALTH_CODE" = "200" ] && return 0
    [ "$i" -lt "$tries" ] && { info "health $HEALTH_CODE — retry $i/$tries in ${delay}s"; sleep "$delay"; delay=$((delay * 2)); }
  done
  return 1
}

count_of() { echo "$1" | tr ' ' '\n' | grep "^$2=" | cut -d= -f2; }

# Every count after >= before. A drop means we lost data.
counts_not_lower() {
  local before="$1" after="$2" t b a
  for t in user entry employee setoran; do
    b="$(count_of "$before" "$t")"; a="$(count_of "$after" "$t")"
    [ -n "$b" ] && [ -n "$a" ] || { bad "counts unreadable for '$t'"; return 1; }
    if [ "$a" -lt "$b" ]; then bad "$t dropped: $b → $a"; return 1; fi
  done
  return 0
}

# Code-only rollback: previous commit → deps → build → reload → health.
rollback() {
  local reason="$1"
  log ""
  log "🔁 ROLLBACK — $reason"
  ROLLED_BACK="yes"
  git reset --hard "$SHA_BEFORE" >>"$LOG" 2>&1 \
    && ok "code back at ${SHA_BEFORE:0:8}" || { bad "git reset to $SHA_BEFORE FAILED"; return 1; }
  ( cd server && npm ci ) >>"$LOG" 2>&1 || info "npm ci during rollback failed — continuing with existing node_modules"
  ( cd server && npx prisma generate ) >>"$LOG" 2>&1 || info "prisma generate during rollback failed — continuing"
  npm run build >>"$LOG" 2>&1 || info "frontend rebuild during rollback failed — serving committed dist/app.js"
  pm2 startOrReload deploy/ecosystem.config.js --update-env >>"$LOG" 2>&1 || bad "pm2 reload during rollback failed"

  # DB restore: only on the explicit flag AND only if this run applied migrations.
  if [ "$RESTORE_DB" = "1" ] && [ "$MIGRATIONS_APPLIED" = "yes" ] && [ -n "$BACKUP_FILE" ]; then
    log "   --restore-db given and migrations ran → restoring the pre-deploy snapshot"
    if bash deploy/restore-db.sh "$BACKUP_FILE" >>"$LOG" 2>&1; then
      DB_RESTORED="yes"; ok "database restored from $(basename "$BACKUP_FILE")"
    else
      bad "DB restore FAILED — restore by hand: bash deploy/restore-db.sh '$BACKUP_FILE'"
    fi
  elif [ "$MIGRATIONS_APPLIED" = "yes" ]; then
    info "migrations ran this deploy but the DB was NOT restored (code-only rollback)."
    info "if the old code cannot read the new schema, run:"
    info "   bash deploy/restore-db.sh '$BACKUP_FILE'"
  fi

  if wait_health; then ok "rollback verified — health 200"
  else bad "ROLLBACK HEALTH CHECK FAILED (health=$HEALTH_CODE) — MANUAL INTERVENTION NEEDED"; fi
}

# Print the summary + exit. $1 = PASS|FAIL
finish() {
  local verdict="$1"
  log ""
  log "──────────────────────── DEPLOY $verdict ────────────────────────"
  log "  commit before : ${SHA_BEFORE:0:8}"
  log "  commit after  : ${SHA_AFTER:0:8}${SHA_AFTER:+ }$([ "$ROLLED_BACK" = yes ] && echo '(rolled back)')"
  log "  tests         : $TESTS"
  log "  migrations    : $MIGRATIONS_APPLIED"
  log "  health (local): $HEALTH_CODE"
  log "  :443 listening: $LISTEN_443"
  log "  public https  : $PUBLIC_HTTPS      ← the 17 Jul gate (https://$DOMAIN/)"
  log "  cert expires  : ${CERT_DAYS} days"
  log "  counts before : ${COUNTS_BEFORE:-?}"
  log "  counts after  : ${COUNTS_AFTER:-?}"
  log "  rollback      : $ROLLED_BACK   db restored: $DB_RESTORED"
  log "  backup        : ${BACKUP_FILE:-none}"
  [ -n "$FAIL_REASON" ] && log "  reason        : $FAIL_REASON"
  log "─────────────────────────────────────────────────────────────────"
  if [ "$verdict" = "PASS" ]; then
    log "✅ Deploy OK — https://airrooffice.com is running ${SHA_AFTER:0:8}"
    exit 0
  fi
  log "❌ Deploy FAILED. Log: deploy/deploy.log    Live process: pm2 logs $PM2_APP --lines 40"
  exit 1
}

abort() { FAIL_REASON="$1"; bad "$1"; finish "FAIL"; }

# ══════════════════════════════════════════════════════════════════════════════
# 1. PRE-FLIGHT — nothing is touched until all of this passes
# ══════════════════════════════════════════════════════════════════════════════
log ""
log "▸ PRE-FLIGHT"

# Are we really in the app dir?
[ -f "$APP_DIR/server/package.json" ] && [ -d "$APP_DIR/deploy" ] \
  || abort "$APP_DIR is not the AirRO app directory (no server/package.json)"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || abort "$APP_DIR is not a git repository"
ok "app dir: $APP_DIR"

# Local changes will be destroyed by the reset below — say so loudly.
DIRTY="$(git status --porcelain 2>/dev/null)"
if [ -n "$DIRTY" ]; then
  log "   ⚠️  WARNING: uncommitted local changes — these will be DISCARDED by this deploy:"
  echo "$DIRTY" | sed 's/^/        /' | tee -a "$LOG"
  info "Ctrl-C now if you need them (5s)…"; sleep 5
else
  ok "git state clean"
fi

SHA_BEFORE="$(git rev-parse HEAD 2>/dev/null)"
[ -n "$SHA_BEFORE" ] || abort "cannot read current commit SHA"
ok "current commit: ${SHA_BEFORE:0:8}  (rollback target)"

# PORT GUARD — the 16 Jul lesson. Only OUR pm2 process may hold the port.
PIDS="$(port_pids)"; OURS="$(pm2_pid)"
if [ -z "$PIDS" ]; then
  ok "port $PORT free"
elif [ -n "$OURS" ] && [ "$(echo "$PIDS" | tr '\n' ' ' | xargs)" = "$OURS" ]; then
  ok "port $PORT held by our pm2 $PM2_APP (pid $OURS)"
else
  log "   ❌ port $PORT is held by a process that is NOT our pm2 $PM2_APP:"
  for p in $PIDS; do
    info "pid $p → $(ps -p "$p" -o comm=,args= 2>/dev/null | head -1 | cut -c1-100)"
  done
  log ""
  log "   This is exactly the 16 Jul failure (a stale Docker container held :$PORT,"
  log "   pm2 could not bind, and every login broke). Refusing to deploy."
  log "   Inspect and clear it, then re-run:"
  log "       ss -ltnp | grep $PORT        # who holds the port"
  log "       docker ps                    # a container publishing :$PORT?"
  log "       docker stop <id>             # ...stop it"
  log "       pm2 describe $PM2_APP        # is pm2 even managing our API?"
  abort "port $PORT contended — never deploy into a contended port"
fi

# Will the API survive a reboot? `pm2 save` (run later) only persists the process LIST —
# without a systemd unit nothing replays it at boot, so a reboot silently takes the site
# down until someone notices. Warn, don't block: it's a one-time manual root step.
PM2_UNIT="pm2-$(whoami)"
if command -v systemctl >/dev/null 2>&1; then
  if [ "$(systemctl is-enabled "$PM2_UNIT" 2>/dev/null)" = "enabled" ]; then
    ok "pm2 boot persistence enabled ($PM2_UNIT)"
  else
    log "   ⚠️  pm2 startup is NOT enabled — the API will NOT come back after a reboot."
    log "       One-time fix (run the command it prints, then re-run this deploy):"
    log "           pm2 startup systemd"
    log "           pm2 save"
    log "           systemctl is-enabled $PM2_UNIT     # expect: enabled"
  fi
fi

# Pre-deploy record counts (rollback tripwire).
COUNTS_BEFORE="$( cd server && node scripts/db-counts.js 2>>"$LOG" )"
[ -n "$COUNTS_BEFORE" ] || abort "cannot read record counts before deploy (is the DB reachable?)"
ok "counts before: $COUNTS_BEFORE"

# ══════════════════════════════════════════════════════════════════════════════
# 2. GATES — abort on any failure (prod still untouched until the pm2 reload)
# ══════════════════════════════════════════════════════════════════════════════
log ""
log "▸ GATE 1/6  Backup database"
BK_OUT="$(SKIP_OFFSITE=$SKIP_OFFSITE bash deploy/backup-db.sh 2>&1)"; BK_RC=$?
echo "$BK_OUT" >> "$LOG"
BACKUP_FILE="$(echo "$BK_OUT" | sed -n 's/^Backup written: \(.*\) (.*/\1/p' | head -1)"
if [ "$BK_RC" -ne 0 ]; then
  echo "$BK_OUT" | tail -3 | sed 's/^/        /' | tee -a "$LOG"
  [ "$SKIP_OFFSITE" = "1" ] || info "offsite down? emergency escape: bash deploy/update.sh --skip-offsite"
  abort "backup gate failed — refusing to deploy without a good backup"
fi
[ -n "$BACKUP_FILE" ] || abort "backup succeeded but no archive path was reported"
ok "backup: $(basename "$BACKUP_FILE")$([ "$SKIP_OFFSITE" = 1 ] && echo ' (offsite SKIPPED)' || echo ' (local + offsite)')"

log ""
log "▸ GATE 2/6  Pull latest code"
git fetch origin >>"$LOG" 2>&1 || abort "git fetch failed"
git reset --hard origin/master >>"$LOG" 2>&1 || abort "git reset --hard origin/master failed"
SHA_AFTER="$(git rev-parse HEAD)"
if [ "$SHA_AFTER" = "$SHA_BEFORE" ]; then ok "already at ${SHA_AFTER:0:8} (no new commits)"
else ok "${SHA_BEFORE:0:8} → ${SHA_AFTER:0:8}"; fi

log ""
log "▸ GATE 3/6  Install dependencies + run tests"
# NOTE: full install (NOT --omit=dev) on purpose — jest/supertest/prisma-CLI are
# devDependencies, so the test gate and `prisma migrate deploy` need them present.
( cd server && npm ci ) >>"$LOG" 2>&1 || abort "npm ci failed (see deploy/deploy.log)"
ok "server dependencies installed"
if [ "$SKIP_TESTS" = "1" ]; then
  TESTS="SKIPPED (--skip-tests)"
  log "   ⚠️  test gate SKIPPED by flag — you are deploying unverified code"
else
  # `npm test` pins NODE_ENV=test + DATABASE_URL=file:./test.db, so the suite can
  # never touch prod.db. Unset any stray DATABASE_URL first so nothing leaks in.
  TEST_OUT="$( cd server && unset DATABASE_URL && npm test 2>&1 )"; TEST_RC=$?
  echo "$TEST_OUT" >> "$LOG"
  if [ "$TEST_RC" -ne 0 ]; then
    echo "$TEST_OUT" | grep -E '✕|●|Tests:|Suites:|FAIL' | head -20 | sed 's/^/        /' | tee -a "$LOG"
    abort "tests FAILED — deploy aborted, production untouched"
  fi
  TESTS="$(echo "$TEST_OUT" | grep -E '^Tests:' | head -1 | sed 's/Tests:[[:space:]]*//')"
  ok "tests passed: ${TESTS:-all}"
fi

log ""
log "▸ GATE 4/6  Apply migrations"
( cd server && unset DATABASE_URL && npx prisma generate ) >>"$LOG" 2>&1 || abort "prisma generate failed"
MIG_OUT="$( cd server && unset DATABASE_URL && npx prisma migrate deploy 2>&1 )"; MIG_RC=$?
echo "$MIG_OUT" >> "$LOG"
if [ "$MIG_RC" -ne 0 ]; then
  echo "$MIG_OUT" | tail -8 | sed 's/^/        /' | tee -a "$LOG"
  abort "prisma migrate deploy failed — production untouched"
fi
if echo "$MIG_OUT" | grep -qiE 'data loss|would be lost'; then
  abort "migration reports DATA LOSS — refusing. Fix the migration to be additive."
fi
if echo "$MIG_OUT" | grep -q 'Applying migration'; then
  MIGRATIONS_APPLIED="yes"
  ok "migrations applied:"
  echo "$MIG_OUT" | grep 'Applying migration' | sed 's/^/        /' | tee -a "$LOG"
else
  ok "no pending migrations"
fi

log ""
log "▸ GATE 5/6  Build frontend bundle"
npm install --no-audit --no-fund >>"$LOG" 2>&1 || abort "root npm install failed (needed for the build)"
npm run build >>"$LOG" 2>&1 || abort "frontend build failed — dist/app.js not rebuilt"
[ -f "$APP_DIR/dist/app.js" ] || abort "build reported success but dist/app.js is missing"
ok "dist/app.js built"

log ""
log "▸ GATE 6/6  Restart backend"
pm2 startOrReload deploy/ecosystem.config.js --update-env >>"$LOG" 2>&1 || abort "pm2 startOrReload failed"
pm2 save >/dev/null 2>&1 || true
ok "pm2 $PM2_APP reloaded"

# ══════════════════════════════════════════════════════════════════════════════
# 3. POST-DEPLOY VERIFY — the part that was missing. Any failure → rollback.
# ══════════════════════════════════════════════════════════════════════════════
log ""
log "▸ POST-DEPLOY VERIFY"
sleep 2

# 3a. the port must be held by OUR process
PIDS="$(port_pids)"; OURS="$(pm2_pid)"
if [ -z "$OURS" ]; then
  rollback "pm2 $PM2_APP is not running after reload"; FAIL_REASON="pm2 process not running after reload"; finish "FAIL"
fi
if [ -z "$PIDS" ]; then
  rollback "nothing is listening on port $PORT after reload"; FAIL_REASON="port $PORT not bound after reload"; finish "FAIL"
fi
if [ "$(echo "$PIDS" | tr '\n' ' ' | xargs)" != "$OURS" ]; then
  log "   ❌ port $PORT is NOT held by our pm2 process (ours=$OURS, holders=$(echo "$PIDS" | tr '\n' ' '))"
  rollback "port $PORT hijacked by another process"; FAIL_REASON="port $PORT held by a foreign process"; finish "FAIL"
fi
ok "port $PORT held by our pm2 $PM2_APP (pid $OURS)"

# 3b. health
if wait_health; then
  ok "health 200"
else
  rollback "health check failed (last=$HEALTH_CODE)"; FAIL_REASON="health check failed (last=$HEALTH_CODE)"; finish "FAIL"
fi

# 3c. smoke: real authenticated round-trip ("up but auth broken" is still broken)
SMOKE_OUT="$( cd server && unset DATABASE_URL && node scripts/smoke-test.js 2>&1 )"; SMOKE_RC=$?
echo "$SMOKE_OUT" >> "$LOG"
if [ "$SMOKE_RC" -ne 0 ]; then
  echo "$SMOKE_OUT" | tail -3 | sed 's/^/        /' | tee -a "$LOG"
  rollback "smoke test failed — API is up but authentication is broken"
  FAIL_REASON="smoke test failed (auth round-trip)"; finish "FAIL"
fi
ok "${SMOKE_OUT}"

# 3d. no data lost
COUNTS_AFTER="$( cd server && node scripts/db-counts.js 2>>"$LOG" )"
if [ -z "$COUNTS_AFTER" ]; then
  rollback "cannot read record counts after deploy"; FAIL_REASON="counts unreadable after deploy"; finish "FAIL"
fi
if counts_not_lower "$COUNTS_BEFORE" "$COUNTS_AFTER"; then
  ok "counts after:  $COUNTS_AFTER  (no data lost)"
else
  rollback "record counts DROPPED — data loss detected"
  FAIL_REASON="record counts dropped: [$COUNTS_BEFORE] → [$COUNTS_AFTER]"; finish "FAIL"
fi

# ── 3e. THE PUBLIC SITE — the 17 Jul gate ─────────────────────────────────────
# 17 Jul: applying the repo's Nginx template deleted certbot's :443 block. Nginx came
# back on :80 only, the site was unreachable from the internet (ERR_TIMED_OUT), and this
# script still printed "frontend: OK / DEPLOY PASS" — because it only ever tested
# localhost. Everything below deliberately leaves the box.
#
# These gates FAIL the deploy but do NOT roll the code back: a missing :443, a dead cert
# or a closed firewall are INFRASTRUCTURE, and reverting app code cannot fix any of them
# — it would only add a second change during an outage and hide the real cause. The
# localhost gates above already roll back genuine code faults. Each failure prints the
# exact repair instead.
log ""
log "▸ PUBLIC SITE VERIFY (from outside localhost)"
PUB="https://$DOMAIN"

# 3e-1. Nginx must be listening on BOTH :80 and :443.
LISTEN="$(ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null)"
for p in 80 443; do
  if echo "$LISTEN" | grep -qE "[:.]$p\b"; then
    ok "Nginx listening on :$p"
  else
    log "   ❌ nothing is listening on :$p"
    if [ "$p" = "443" ]; then
      log "       This is the 17 Jul failure: the HTTPS server block is gone, so the site"
      log "       is unreachable from the internet. The API itself is fine — the code was"
      log "       NOT rolled back, because that cannot restore an Nginx TLS block. Repair:"
      log "           sudo bash deploy/apply-nginx.sh          # ships the full config incl. :443"
      log "           sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN   # if the cert is gone too"
    fi
    PUBLIC_HTTPS="FAIL (:$p not listening)"; LISTEN_443="no"
    FAIL_REASON="Nginx not listening on :$p — site unreachable from the internet"
    finish "FAIL"
  fi
done
LISTEN_443="yes"

# 3e-2. Public HTTPS must answer 200. If it doesn't, retry pinned to this box so we can
# tell "Nginx is broken" apart from "DNS/firewall/Cloudflare is broken" — very different fixes.
# curl already prints 000 when it cannot connect — never append another one.
http_code() { local c; c="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>>"$LOG")"; echo "${c:-000}"; }
PUB_CODE="$(http_code "$PUB/")"
if [ "$PUB_CODE" = "200" ]; then
  ok "public $PUB/ → 200"
else
  LOCAL_CODE="$(http_code --resolve "$DOMAIN:443:127.0.0.1" "$PUB/")"
  DNS_IP="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1)"
  log "   ❌ public $PUB/ → $PUB_CODE"
  log "      same request pinned to this box (--resolve $DOMAIN:443:127.0.0.1) → $LOCAL_CODE"
  log "      DNS: $DOMAIN → ${DNS_IP:-<does not resolve>}"
  if [ -z "$DNS_IP" ]; then
    log "      → DNS does not resolve at all. Nothing on this server can fix that:"
    log "           check the domain's A record / registrar / nameservers"
  elif [ "$LOCAL_CODE" = "200" ]; then
    log "      → Nginx + the app are HEALTHY on this server, but the site is not reachable"
    log "        at its public address. That points OUTSIDE this box — check in order:"
    log "           dig +short $DOMAIN          # does DNS still point at THIS server's IP?"
    log "           sudo ufw status             # is 443/tcp allowed?"
    log "           (hosting firewall / security group / Cloudflare proxy status)"
  else
    log "      → Nginx itself is not serving this site correctly on :443. Check:"
    log "           sudo nginx -t ; sudo systemctl status nginx"
    log "           sudo bash deploy/apply-nginx.sh"
  fi
  PUBLIC_HTTPS="FAIL ($PUB_CODE, local=$LOCAL_CODE)"
  FAIL_REASON="public site unreachable: $PUB/ → $PUB_CODE (pinned local → $LOCAL_CODE)"
  finish "FAIL"
fi

# 3e-3. What's served must BE the app (catches a bad build / wrong root), and the API must
# work THROUGH the public URL (proves Nginx → Node proxying, not just Node on localhost).
PUB_HTML="$(curl -sS --max-time 10 "$PUB/" 2>>"$LOG")"
if echo "$PUB_HTML" | grep -q 'dist/app.js' && echo "$PUB_HTML" | grep -q 'manifest.webmanifest'; then
  ok "public / serves the app (dist/app.js + manifest present)"
else
  # This one IS code-shaped (bad build/commit or wrong root), so roll back like the others.
  rollback "the public URL is not serving the app (no dist/app.js / manifest in the HTML)"
  PUBLIC_HTTPS="FAIL (not the app)"
  FAIL_REASON="public / does not contain dist/app.js + manifest — bad build or wrong Nginx root"
  finish "FAIL"
fi

PUB_API="$(http_code "$PUB/api/v1/health")"
if [ "$PUB_API" = "200" ]; then
  ok "public $PUB/api/v1/health → 200 (Nginx → Node proxy works end to end)"
else
  log "   ❌ public API health → $PUB_API while localhost health was 200"
  log "      → Nginx is serving the site but NOT proxying /api/ to Node. Check the"
  log "        'location /api/' block, then: sudo bash deploy/apply-nginx.sh"
  PUBLIC_HTTPS="FAIL (api $PUB_API)"
  FAIL_REASON="public API health → $PUB_API (Nginx→Node proxy broken)"
  finish "FAIL"
fi
PUBLIC_HTTPS="OK (200, api 200)"

# 3e-4. Certificate expiry — WARN only (a valid-but-expiring cert is not a reason to fail
# a deploy; it IS a reason to shout). certbot renews automatically; this catches renewal
# having silently stopped working.
CERT_END="$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
if [ -n "$CERT_END" ]; then
  END_S="$(date -d "$CERT_END" +%s 2>/dev/null || echo 0)"
  NOW_S="$(date +%s)"
  if [ "$END_S" -gt 0 ]; then
    DAYS=$(( (END_S - NOW_S) / 86400 ))
    CERT_DAYS="$DAYS"
    if [ "$DAYS" -lt 21 ]; then
      log "   ⚠️  TLS certificate expires in $DAYS days ($CERT_END) — renewal may be broken."
      log "       sudo certbot renew --dry-run       # test it"
      log "       sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN   # re-issue if needed"
    else
      ok "TLS certificate valid for $DAYS more days"
    fi
  fi
else
  info "could not read the TLS certificate expiry (skipped)"
fi

finish "PASS"
