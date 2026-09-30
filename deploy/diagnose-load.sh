#!/usr/bin/env bash
# READ-ONLY diagnosis for "dashboard gagal dimuat" (every module, all at once).
#
# It changes nothing. It counts the three ways a dashboard load fails in production, so the fix is
# chosen from evidence rather than guessed:
#   1. 429 — the per-minute API budget was used up;
#   2. 502/504 — the backend was restarting or too slow (pm2 restarts it above max_memory_restart);
#   3. how big the payloads are that every tab polls (inline base64 proof images in old records).
#
# Usage (on the VPS):   cd /var/www/airrooffice && bash deploy/diagnose-load.sh
set -u
APP="${PM2_APP:-airro-api}"
LOG="${NGINX_LOG:-/var/log/nginx/access.log}"
cd "$(dirname "$0")/.." || exit 1

hr() { printf '\n== %s ==\n' "$1"; }

hr "1. Backend restarts (pm2)"
pm2 describe "$APP" 2>/dev/null | grep -E "status|restarts|uptime|max memory|heap size|used heap" || echo "pm2 app $APP not found"
echo "-- memory/restart lines in the recent pm2 log:"
pm2 logs "$APP" --lines 2000 --nostream 2>&1 | grep -iE "memory|restart|heap out|killed|SIGKILL|exited with code" | tail -15

hr "2. API responses by status in $LOG"
if [ -r "$LOG" ]; then
  awk '$7 ~ /^\/api\// { n[$9]++ } END { for (s in n) printf "  %s  %d\n", s, n[s] }' "$LOG" | sort
  echo "-- requests per minute, busiest 5 minutes:"
  awk '$7 ~ /^\/api\// { split($4, t, ":"); m = t[2] ":" t[3]; c[m]++ } END { for (k in c) printf "  %s  %d\n", k, c[k] }' "$LOG" | sort -k2 -n -r | head -5
  echo "-- the IPs that received 429 (an office router shows up as ONE IP):"
  awk '$7 ~ /^\/api\// && $9 == 429 { c[$1]++ } END { for (k in c) printf "  %s  %d\n", k, c[k] }' "$LOG" | sort -k2 -n -r | head -5
  echo "-- paths that failed with 429/5xx most:"
  awk '$7 ~ /^\/api\// && ($9 == 429 || $9 >= 500) { split($7, p, "?"); c[$9 " " p[1]]++ } END { for (k in c) printf "  %s  %d\n", k, c[k] }' "$LOG" | sort -k3 -n -r | head -10
  echo "-- largest API responses (bytes) — a poll that ships MBs is a memory spike:"
  awk '$7 ~ /^\/api\// { split($7, p, "?"); if ($10 > b[p[1]]) b[p[1]] = $10 } END { for (k in b) printf "  %10d  %s\n", b[k], k }' "$LOG" | sort -n -r | head -8
else
  echo "cannot read $LOG (run with sudo, or set NGINX_LOG=...)"
fi

hr "3. Machine memory"
free -m 2>/dev/null
ps -o rss=,etime=,cmd= -C node 2>/dev/null | awk '{ printf "  node RSS %d MB  up %s\n", $1/1024, $2 }'

hr "4. Inline proof images still stored in records (polled with the lists)"
( cd server && node -e "
  require('./src/config/env');
  const prisma = require('./src/lib/prisma');
  (async () => {
    for (const t of ['Entry', 'Setoran']) {
      try {
        const r = await prisma.\$queryRawUnsafe('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(proof)),0) AS bytes FROM \"' + t + '\" WHERE proof LIKE ' + \"'%data:%'\");
        const x = r[0]; console.log('  ' + t + ': ' + Number(x.n) + ' rows with inline image data, ' + Math.round(Number(x.bytes) / 1048576 * 10) / 10 + ' MB');
      } catch (e) { console.log('  ' + t + ': ' + e.message.split('\n')[0]); }
    }
    await prisma.\$disconnect();
  })();
" ) 2>&1

echo
echo "Paste this whole output back — it decides the next step."
