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
READY_URL="http://127.0.0.1:$PORT/api/v1/health/ready"   # DB + schema-behind probe (see routes/index.js)

# GATE 3 tests the fetched code in a throwaway `git worktree`. That worktree MUST live on a directory we
# control and know PERSISTS for the whole test run. NOT /tmp: on this box /tmp is wiped almost immediately
# (systemd-tmpfiles / a cleaner — see DEPLOY.md), so a worktree created there VANISHES before jest starts,
# and GATE 3 mis-reports "tests failed" when the truth is "tests could not run". Default: a sibling of the
# app dir (same disk, persistent). Override with DEPLOY_TEST_DIR=/root (or any writable, persistent path).
DEPLOY_TEST_DIR="${DEPLOY_TEST_DIR:-$(dirname "$APP_DIR")}"

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
SHA_BEFORE=""; SHA_AFTER=""; TARGET_SHA=""; BACKUP_FILE=""; COUNTS_BEFORE=""; COUNTS_AFTER=""
MIGRATIONS_APPLIED="no"; TESTS="skipped"; ROLLED_BACK="no"; DB_RESTORED="no"
HEALTH_CODE="000"; READY_CODE="000"; READY_BODY=""; FAIL_REASON=""
PUBLIC_HTTPS="not checked"; LISTEN_443="?"; CERT_DAYS="?"
TEST_WT=""   # path to the throwaway test worktree (GATE 3), cleaned up on exit
TEST_PEAK_HEAP=""; TEST_WALL=""   # evidence from the jest run (peak V8 heap MB · wall-clock), shown in the summary

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

# Readiness check with backoff — the API must be able to SERVE DATA, not just be alive. Sets
# READY_CODE + READY_BODY. Returns 0 only on a 200 (db:ok, schema:ok). A 503 here is the app-wide
# outage class (DB unreachable, or schema behind the running client) that /health cannot see.
wait_ready() {
  local tries=5 delay=1 i
  for i in $(seq 1 "$tries"); do
    READY_BODY="$(curl -s --max-time 6 "$READY_URL" 2>/dev/null || echo '')"
    READY_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "$READY_URL" 2>/dev/null || echo 000)"
    [ "$READY_CODE" = "200" ] && return 0
    [ "$i" -lt "$tries" ] && { info "ready $READY_CODE — retry $i/$tries in ${delay}s"; sleep "$delay"; delay=$((delay * 2)); }
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

# GATE 3 failure report — the specifics that were asked for repeatedly: jest exit code, the failing
# suite file(s) and test name(s), and the first assertion diff (name + expected/received + code frame),
# capped at ~20 lines, to BOTH stdout and the log. Jest's bare "● Console" output markers are dropped so
# they never appear as content-free noise. $1 = captured jest output, $2 = jest exit code.
report_test_failure() {
  local out="$1" rc="$2" filtered start
  filtered="$(echo "$out" | grep -vE '●[[:space:]]+Console')"   # drop jest's content-free console markers
  {
    echo "── GATE 3: tests FAILED (jest exit code $rc) ─────────────────"
    echo "$out" | grep -E '^FAIL ' | head -8                        # which suites failed
    start="$(echo "$filtered" | grep -nE '●[[:space:]]' | head -1 | cut -d: -f1)"
    if [ -n "$start" ]; then
      echo "── first failing test + assertion ────────────────────────"
      echo "$filtered" | sed -n "${start},$((start + 17))p"         # ● name → expected/received → code frame
    else
      echo "── jest summary lines ────────────────────────────────────"
      echo "$filtered" | grep -E '✕|Tests:|Suites:|Expected:|Received:' | head -18
    fi
    echo "── (full output in deploy/deploy.log) ────────────────────"
  } | sed 's/^/        /' | tee -a "$LOG"
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
  npm install --no-audit --no-fund >>"$LOG" 2>&1 || info "root npm install during rollback failed — continuing"
  npm run build >>"$LOG" 2>&1 || bad "frontend rebuild during rollback FAILED — dist/ is server-built (not committed), so the client bundle may now be stale; rebuild manually: npm run build"
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

# PRE-RELOAD restore. If a gate fails AFTER the live working tree was advanced to the new commit
# (only GATE 4 build / GATE 5 migrate can — GATE 3 advances the tree only once tests pass) but BEFORE
# the GATE 6 pm2 reload, the on-disk source is new while the running pm2 process is still the old code:
# the exact HALF-UPDATED state that made a failed deploy worse than either endpoint. This puts the tree
# back on SHA_BEFORE and rebuilds, so disk matches the still-running old process, then proves health.
# Idempotent: a no-op when the tree was never advanced (every abort before GATE 3's reset).
restore_tree() {
  [ -n "$SHA_BEFORE" ] || return 0
  local now; now="$(git rev-parse HEAD 2>/dev/null)"
  [ "$now" = "$SHA_BEFORE" ] && return 0     # tree never advanced — nothing to undo
  log ""
  log "↩︎  RESTORING working tree ${now:0:8} → ${SHA_BEFORE:0:8} (a gate failed after the tree advanced)"
  ROLLED_BACK="yes"
  if git reset --hard "$SHA_BEFORE" >>"$LOG" 2>&1; then ok "code restored to ${SHA_BEFORE:0:8}"
  else bad "git reset to ${SHA_BEFORE:0:8} FAILED — MANUAL FIX NEEDED: git reset --hard ${SHA_BEFORE:0:8} && npm run build"; return 1; fi
  SHA_AFTER="$SHA_BEFORE"     # report honestly: the server is left on the previous commit
  ( cd server && npm ci ) >>"$LOG" 2>&1 || info "npm ci during restore failed — keeping existing node_modules"
  ( cd server && unset DATABASE_URL && npx prisma generate ) >>"$LOG" 2>&1 || info "prisma generate during restore failed"
  npm install --no-audit --no-fund >>"$LOG" 2>&1 || info "root npm install during restore failed"
  if npm run build >>"$LOG" 2>&1; then ok "frontend rebuilt at ${SHA_BEFORE:0:8}"
  else bad "rebuild during restore FAILED — dist/ may be stale; run: npm run build"; fi
  # The pm2 process was never reloaded (GATE 6 not reached), so it is still serving the old code; after
  # the reset the on-disk code matches it again. Prove the app is actually up before we report FAIL, so
  # a restore that somehow left it broken is never silent.
  if wait_health; then ok "health 200 after restore — production is on ${SHA_BEFORE:0:8} and serving"
  else bad "HEALTH $HEALTH_CODE AFTER RESTORE — MANUAL INTERVENTION NEEDED (pm2 logs $PM2_APP --lines 40)"; fi
}

# Print the summary + exit. $1 = PASS|FAIL
finish() {
  local verdict="$1"
  local ACTUAL; ACTUAL="$(git rev-parse HEAD 2>/dev/null || echo '')"
  log ""
  log "──────────────────────── DEPLOY $verdict ────────────────────────"
  log "  commit before : ${SHA_BEFORE:0:8}"
  log "  commit after  : ${SHA_AFTER:0:8}${SHA_AFTER:+ }$([ "$ROLLED_BACK" = yes ] && echo '(rolled back)')"
  log "  on-disk HEAD  : ${ACTUAL:0:8}   (what the server is ACTUALLY left on)"
  log "  tests         : $TESTS"
  log "  test heap/time: peak ${TEST_PEAK_HEAP:-?}MB (cap ${DEPLOY_TEST_HEAP_MB:-4096}) · ${TEST_WALL:-?}"
  log "  migrations    : $MIGRATIONS_APPLIED"
  log "  health (local): $HEALTH_CODE"
  log "  ready (db+schema): $READY_CODE"
  log "  :443 listening: $LISTEN_443"
  log "  public https  : $PUBLIC_HTTPS      ← the 17 Jul gate (https://$DOMAIN/)"
  log "  cert expires  : ${CERT_DAYS} days"
  log "  counts before : ${COUNTS_BEFORE:-?}"
  log "  counts after  : ${COUNTS_AFTER:-?}"
  log "  rollback      : $ROLLED_BACK   db restored: $DB_RESTORED"
  log "  backup        : ${BACKUP_FILE:-none}"
  [ -n "$FAIL_REASON" ] && log "  reason        : $FAIL_REASON"
  # HONESTY GUARD — a FAILED deploy must leave the tree exactly where it started. If the on-disk HEAD
  # is anything other than SHA_BEFORE, the box is HALF-UPDATED (new source, stale build / unapplied
  # migrations): shout, with the exact hand-fix. This is the state the whole rewrite exists to prevent.
  if [ "$verdict" = "FAIL" ] && [ -n "$SHA_BEFORE" ] && [ -n "$ACTUAL" ] && [ "$ACTUAL" != "$SHA_BEFORE" ]; then
    log ""
    log "  ⚠️  HALF-UPDATED STATE: the tree is on ${ACTUAL:0:8} but the deploy FAILED — it should be on"
    log "      ${SHA_BEFORE:0:8}. Restore it NOW:  git reset --hard ${SHA_BEFORE:0:8} && npm run build && pm2 reload $PM2_APP"
  fi
  log "─────────────────────────────────────────────────────────────────"
  if [ "$verdict" = "PASS" ]; then
    log "✅ Deploy OK — https://airrooffice.com is running ${SHA_AFTER:0:8}"
    exit 0
  fi
  log "❌ Deploy FAILED. Log: deploy/deploy.log    Live process: pm2 logs $PM2_APP --lines 40"
  exit 1
}

# On abort, first put the working tree back if a gate advanced it (GATE 4/5) — production is never
# left half-updated — then print an honest summary and exit non-zero.
abort() { FAIL_REASON="$1"; bad "$1"; restore_tree; finish "FAIL"; }

# Clean up the throwaway test worktree on ANY exit (normal, abort, or Ctrl-C), so a stale linked
# worktree never accumulates under the temp dir or in `git worktree list`.
cleanup() {
  if [ -n "${TEST_WT:-}" ] && [ -d "$TEST_WT" ]; then
    git worktree remove --force "$TEST_WT" >/dev/null 2>&1 || rm -rf "$TEST_WT"
  fi
  git worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

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
log "▸ GATE 2/6  Fetch latest code  (the live working tree is NOT touched here)"
# Fetch only — no reset. The live tree stays on SHA_BEFORE until the tests (GATE 3) pass, so a failing
# test can never leave production on new source. This is the fix for the half-updated-deploy incident.
git fetch origin >>"$LOG" 2>&1 || abort "git fetch failed"
TARGET_SHA="$(git rev-parse origin/master 2>/dev/null)"
[ -n "$TARGET_SHA" ] || abort "cannot resolve origin/master after fetch"
if [ "$TARGET_SHA" = "$SHA_BEFORE" ]; then ok "already at ${TARGET_SHA:0:8} (no new commits) — will re-verify + rebuild"
else ok "target: ${SHA_BEFORE:0:8} → ${TARGET_SHA:0:8}  (fetched, NOT yet applied to the live tree)"; fi

log ""
log "▸ GATE 3/6  Test the FETCHED code in an ISOLATED worktree, THEN advance the live tree"
# THE ORDERING THAT MATTERS: the target commit is tested inside a throwaway `git worktree`, and the
# LIVE tree is advanced (git reset --hard) ONLY after the tests pass. A failed test therefore leaves
# production exactly where it started — the half-updated state (new source + stale build + unapplied
# migrations) is now structurally impossible.
if [ "$SKIP_TESTS" = "1" ]; then
  TESTS="SKIPPED (--skip-tests)"
  log "   ⚠️  test gate SKIPPED by flag — you are deploying unverified code"
else
  mkdir -p "$DEPLOY_TEST_DIR" 2>/dev/null || abort "cannot create DEPLOY_TEST_DIR ($DEPLOY_TEST_DIR) — set DEPLOY_TEST_DIR to a writable, persistent path"
  TEST_WT="$(mktemp -d "$DEPLOY_TEST_DIR/.airro-deploytest.XXXXXX")" || abort "cannot create the test-worktree dir under $DEPLOY_TEST_DIR — set DEPLOY_TEST_DIR to a writable path"
  git worktree add --detach "$TEST_WT" "$TARGET_SHA" >>"$LOG" 2>&1 || abort "git worktree add for the test checkout failed"
  # PROVE the worktree is on disk and populated. If the temp dir is being wiped (the /tmp trap this fix
  # exists for), `git worktree add` can report success yet the tree be GONE before jest runs — blame the
  # ENV, never the tests.
  if [ ! -d "$TEST_WT" ] || [ ! -f "$TEST_WT/server/package.json" ]; then
    TESTS="COULD NOT RUN (worktree vanished)"
    abort "test worktree missing/empty at $TEST_WT (no server/package.json) — the temp dir is being cleaned. Set DEPLOY_TEST_DIR to a persistent path and re-run. This is a SETUP failure, NOT a test failure."
  fi
  ok "isolated test checkout at ${TARGET_SHA:0:8} → $TEST_WT (prod tree untouched)"

  # SETUP (install devDeps: jest/supertest/prisma-CLI) is run and JUDGED SEPARATELY from the suite, so a
  # setup/env failure is never mis-reported as a test failure. Everything stays inside the temp checkout;
  # `npm test` pins NODE_ENV=test + its OWN DATABASE_URL=file:./test.db, so prod.db is never touched.
  SETUP_OUT="$( cd "$TEST_WT/server" && unset DATABASE_URL && npm ci 2>&1 )"; SETUP_RC=$?
  echo "$SETUP_OUT" >> "$LOG"
  if [ "$SETUP_RC" -ne 0 ]; then
    echo "$SETUP_OUT" | tail -15 | sed 's/^/        /' | tee -a "$LOG"
    TESTS="COULD NOT RUN (npm ci rc=$SETUP_RC)"
    abort "tests COULD NOT RUN on ${TARGET_SHA:0:8}: devDeps install (npm ci) failed — a SETUP/ENV failure, NOT an assertion failure. Production untouched."
  fi
  # The cleaner can also strike BETWEEN steps — re-assert the tree before spending time on the suite.
  if [ ! -f "$TEST_WT/server/package.json" ]; then
    TESTS="COULD NOT RUN (worktree vanished mid-setup)"
    abort "test worktree vanished during setup at $TEST_WT — temp dir is being cleaned; set DEPLOY_TEST_DIR. NOT a test failure."
  fi

  # RESOURCE GUARDS so a test run can NEVER starve the live airro-api:
  #   • --max-old-space-size caps V8 old-space. The suite's heap grows monotonically (~7 MB per test
  #     file: each jest file re-requires the whole app graph + its own PrismaClient, and --runInBand keeps
  #     them all in ONE process — measured peak ~0.75-1.0 Gi at 95 files). Node's DEFAULT limit (~2 Gi) is
  #     what the suite blew past → FatalProcessOutOfMemory. 4096 gives generous headroom on this 7.8 Gi
  #     box; override with DEPLOY_TEST_HEAP_MB. NODE_OPTIONS reaches every Node jest spawns.
  #   • ONE worker: the npm test script already pins --runInBand (a single in-process worker, not N) —
  #     which IS the worker cap (jest rejects --runInBand + --maxWorkers together), so nothing to add.
  #   • NICED to the lowest priority when `nice` exists, so the live API keeps the CPU under contention.
  #   • --logHeapUsage so we REPORT the peak heap actually used — an evidence-based cap, not a guess.
  local_nice=""; command -v nice >/dev/null 2>&1 && local_nice="nice -n 19"
  TEST_OUT="$( cd "$TEST_WT/server" && unset DATABASE_URL \
    && NODE_OPTIONS="--max-old-space-size=${DEPLOY_TEST_HEAP_MB:-4096}" $local_nice npm test -- --logHeapUsage 2>&1 )"; TEST_RC=$?
  echo "$TEST_OUT" >> "$LOG"
  git worktree remove --force "$TEST_WT" >>"$LOG" 2>&1 && TEST_WT="" || rm -rf "$TEST_WT"
  # Evidence from the run (reported whether it passed or failed).
  TEST_PEAK_HEAP="$(echo "$TEST_OUT" | grep -oE '[0-9]+ MB heap size' | grep -oE '^[0-9]+' | sort -n | tail -1)"
  TEST_WALL="$(echo "$TEST_OUT" | grep -oE 'Time:[[:space:]]+[0-9.]+ s' | grep -oE '[0-9.]+ s' | head -1)"
  if [ "$TEST_RC" -ne 0 ]; then
    # DISTINGUISH the failure modes. Jest prints a "Tests:" summary line ONLY when it actually ran the
    # suite; its ABSENCE means jest never got there — and OUT OF MEMORY is its own class, not a broken test.
    if echo "$TEST_OUT" | grep -qE '^Tests:[[:space:]]'; then
      report_test_failure "$TEST_OUT" "$TEST_RC"
      TESTS="FAILED ($(echo "$TEST_OUT" | grep -E '^Tests:' | head -1 | sed 's/Tests:[[:space:]]*//'))"
      abort "tests FAILED on ${TARGET_SHA:0:8} — assertions did not pass (the failing test is named above). Production untouched (still on ${SHA_BEFORE:0:8})."
    elif echo "$TEST_OUT" | grep -qiE 'FatalProcessOutOfMemory|JavaScript heap out of memory|Reached heap limit|Allocation failed'; then
      echo "$TEST_OUT" | tail -20 | sed 's/^/        /' | tee -a "$LOG"
      TESTS="COULD NOT RUN (OUT OF MEMORY — jest killed; cap ${DEPLOY_TEST_HEAP_MB:-4096}MB, peak ${TEST_PEAK_HEAP:-?}MB)"
      abort "tests OUT OF MEMORY on ${TARGET_SHA:0:8}: jest was KILLED hitting the V8 heap cap (${DEPLOY_TEST_HEAP_MB:-4096}MB; peak seen ${TEST_PEAK_HEAP:-?}MB) — NOT an assertion failure and NOT machine RAM. Raise DEPLOY_TEST_HEAP_MB, or investigate a suite leak (npm test -- --logHeapUsage). Last 20 lines above; full log in deploy/deploy.log."
    else
      echo "$TEST_OUT" | tail -20 | sed 's/^/        /' | tee -a "$LOG"
      TESTS="COULD NOT RUN (jest did not start, rc=$TEST_RC)"
      abort "tests COULD NOT RUN on ${TARGET_SHA:0:8}: jest produced no summary (rc=$TEST_RC) — a SETUP/ENV failure (missing dep, DB, or the temp dir was cleaned), NOT an assertion failure. Last 20 lines above; full log in deploy/deploy.log."
    fi
  fi
  TESTS="$(echo "$TEST_OUT" | grep -E '^Tests:' | head -1 | sed 's/Tests:[[:space:]]*//')"
  ok "tests passed on ${TARGET_SHA:0:8}: ${TESTS:-all}  ·  peak heap ${TEST_PEAK_HEAP:-?}MB (cap ${DEPLOY_TEST_HEAP_MB:-4096})  ·  ${TEST_WALL:-?}"
fi

# Tests are green (or skipped) → NOW it is safe to advance the LIVE working tree to the target.
git reset --hard "$TARGET_SHA" >>"$LOG" 2>&1 || abort "git reset --hard to ${TARGET_SHA:0:8} failed"
SHA_AFTER="$(git rev-parse HEAD)"
( cd server && npm ci ) >>"$LOG" 2>&1 || abort "npm ci on the live tree failed (see deploy/deploy.log)"
if [ "$SHA_AFTER" = "$SHA_BEFORE" ]; then ok "re-verified ${SHA_AFTER:0:8} + server deps installed"
else ok "live tree advanced ${SHA_BEFORE:0:8} → ${SHA_AFTER:0:8} + server deps installed"; fi

log ""
log "▸ GATE 4/6  Build frontend bundle"
# Built BEFORE migrations so a broken build aborts while the DB is still untouched. dist/ is NOT in git
# any more — the server is the ONLY place the bundle is produced, so it can never drift from source.
npm install --no-audit --no-fund >>"$LOG" 2>&1 || abort "root npm install failed (needed for the build)"
npm run build >>"$LOG" 2>&1 || abort "frontend build failed (its version single-source-of-truth assertion may have tripped — see log)"
[ -f "$APP_DIR/dist/app.js" ] || abort "build reported success but dist/app.js is missing"
# The SERVED html (references the content-hashed bundle) must exist, or nginx would fall back to the
# source index.html which points at a non-hashed path — defeating the cache-bust.
[ -f "$APP_DIR/dist/index.html" ] || abort "build succeeded but dist/index.html (the cache-busted served HTML) is missing"
# HARD GUARD against a silently-skipped build: the freshly-built bundle embeds the commit it was built
# from (build.mjs → version.json.commit). It MUST equal the HEAD we just checked out, or we are about
# to serve a stale client. This is the exact failure that started this: server deploys, client doesn't.
BUILT_COMMIT="$(node -e "process.stdout.write(String((require('./version.json').commit)||''))" 2>/dev/null || echo '')"
HEAD_SHORT="$(git rev-parse --short=12 HEAD 2>/dev/null || echo '')"
if [ -z "$BUILT_COMMIT" ] || [ "$BUILT_COMMIT" != "$HEAD_SHORT" ]; then
  abort "build stamp commit ('$BUILT_COMMIT') != deployed HEAD ('$HEAD_SHORT') — the bundle did NOT rebuild from HEAD. Client would be stale."
fi
# The version the bundle EMBEDS (dist/index.html → app.<hash>.js) must equal what /version will serve
# (version.json.version). If these ever differ the "new version" banner loops forever — assert here.
BUILT_VER="$(node -e "process.stdout.write(String((require('./version.json').version)||''))" 2>/dev/null || echo '')"
grep -q "app\.$BUILT_VER\.js" "$APP_DIR/dist/index.html" 2>/dev/null || abort "version mismatch: dist/index.html does not reference app.$BUILT_VER.js — the freshness banner would loop"
ok "frontend built @ $BUILT_COMMIT · version $BUILT_VER ($(node -e "process.stdout.write(String((require('./version.json').builtAt)||''))" 2>/dev/null))"

log ""
log "▸ GATE 5/6  Apply migrations"
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
# GUARD: prove the DB now matches the code's migrations. `migrate deploy` can exit 0 yet leave the
# schema behind the running client (a prior failed/partial migration recorded in _prisma_migrations,
# drift from a manual SQL edit, or the wrong DATABASE_URL). If so, every query on a new column throws
# and the whole app fails — the outage this guard exists to prevent. Abort BEFORE the pm2 reload so
# production keeps serving the old, working code.
STATUS_OUT="$( cd server && unset DATABASE_URL && npx prisma migrate status 2>&1 )"
echo "$STATUS_OUT" >> "$LOG"
if ! echo "$STATUS_OUT" | grep -qiE 'up to date|database schema is up to date'; then
  echo "$STATUS_OUT" | tail -10 | sed 's/^/        /' | tee -a "$LOG"
  abort "prisma migrate status is NOT clean — DB schema is behind/ahead of the code. Production untouched. Fix forward: cd server && npx prisma migrate status, then resolve/apply."
fi
ok "migrate status clean — DB schema matches the code"

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

# 3b. health (liveness — process is up)
if wait_health; then
  ok "health 200"
else
  rollback "health check failed (last=$HEALTH_CODE)"; FAIL_REASON="health check failed (last=$HEALTH_CODE)"; finish "FAIL"
fi

# 3b-ready. READINESS — the API can actually serve DATA. This is the gate that would have caught the
# app-wide outage: /health returns 200 even when the DB is unreachable or the schema is behind the
# running client, so without this a broken deploy went green. A 503 here → roll back.
if wait_ready; then
  ok "ready 200 — DB reachable + schema matches the running client"
else
  READY_REASON="$(echo "$READY_BODY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log((j.reason||'unknown')+(j.message?': '+j.message:''))}catch(e){console.log('no JSON body')}})" 2>/dev/null)"
  echo "        $READY_BODY" | tee -a "$LOG"
  rollback "readiness check failed (last=$READY_CODE, $READY_REASON) — API is up but cannot serve data"
  FAIL_REASON="readiness failed ($READY_CODE): $READY_REASON"; finish "FAIL"
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

# 3e-3b. Content-Type REGRESSION GATE (the 18 Jul bug). A server-level `types { }` block
# REPLACES the whole inherited mime map, so index.html was served as octet-stream: HTTP 200,
# correct HTML BODY (3e-3 above still passed!), but the browser DOWNLOADS the page instead of
# rendering it. Only the Content-Type HEADER reveals it — so assert it explicitly.
# Infra-shaped (Nginx mime map) → FAIL, no rollback; reverting app code cannot fix it.
content_type() { curl -sS -o /dev/null -D - --max-time 10 "$@" 2>>"$LOG" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print tolower($2)}' | head -1; }
CT_ROOT="$(content_type "$PUB/")"
CT_VENDOR="$(content_type "$PUB/vendor/react.production.min.js")"
CT_MANIFEST="$(content_type "$PUB/manifest.webmanifest")"
CT_ERR=""
case "$CT_ROOT"     in *text/html*)       ;; *) CT_ERR="$CT_ERR /=(${CT_ROOT:-none})" ;; esac
case "$CT_VENDOR"   in *javascript*)      ;; *) CT_ERR="$CT_ERR vendor-js=(${CT_VENDOR:-none})" ;; esac
case "$CT_MANIFEST" in *manifest+json*)   ;; *) CT_ERR="$CT_ERR manifest=(${CT_MANIFEST:-none})" ;; esac
if [ -z "$CT_ERR" ]; then
  ok "content-types OK (/ text/html · vendor javascript · manifest application/manifest+json)"
else
  log "   ❌ wrong Content-Type — the browser will DOWNLOAD the page, not render it:$CT_ERR"
  log "      Cause is almost always a 'types { }' block in the Nginx config, which REPLACES"
  log "      the whole mime map instead of extending it. Use default_type in an exact"
  log "      location (see deploy/nginx-airro.conf), then re-apply:"
  log "           sudo bash deploy/apply-nginx.sh"
  PUBLIC_HTTPS="FAIL (content-type:$CT_ERR)"
  FAIL_REASON="wrong Content-Type served:$CT_ERR — Nginx mime map broken (types{} replaces the map)"
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
