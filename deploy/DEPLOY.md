# Deploying AirRO Water to a VPS + domain

Your app = **static frontend** (the HTML/JS/CSS in the project root) + **Node API**
(`server/`). On the VPS, **Nginx** serves the frontend and proxies `/api/` to the
backend (run by **pm2**). Same domain, so no CORS issues and `app-config.js`
auto-uses `/api/v1`.

## Quick path (Ubuntu)

1. **DNS** — point your domain's `A` records (`@` and `www`) to the VPS IP.
2. **Upload** the whole project to `/var/www/airro` (WinSCP, `scp`, or `git clone`).
3. **Run the setup script**:
   ```bash
   cd /var/www/airro
   sudo bash deploy/deploy.sh yourdomain.com
   ```
4. **Edit secrets** — `nano server/.env`: set a strong `JWT_SECRET`
   (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`),
   `SEED_OWNER_PASSWORD`, and `CORS_ORIGIN=https://yourdomain.com`.
5. **Seed the admin**:
   ```bash
   cd server && SEED_DEMO_USERS=false SEED_OWNER_PASSWORD='YourStrongPass' node prisma/seed.js && pm2 restart airro-api
   ```
6. **HTTPS**:
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
   ```

Open `https://yourdomain.com` → log in with `owner` / your seeded password.

## Files in this folder
- `nginx-airro.conf` — the **full** production Nginx site: `:80`→`:443` redirect + the
  `:443` server block (TLS, frontend, `/api/` proxy). Apply it **only** with `apply-nginx.sh`.
- `nginx-airro-bootstrap.conf` — HTTP-only config for a **fresh box**, used once by
  `deploy.sh` before certbot exists. Never apply it over a live HTTPS site.
- `apply-nginx.sh` — the safe way to update Nginx: diff → refuse-if-it-drops-TLS → back up
  → `nginx -t` → reload → verify `:443` → restore on any failure.
- `ecosystem.config.js` — pm2 config for the backend (binds `127.0.0.1:4000`).
- `deploy.sh` — first-time installer (refuses to overwrite an existing site config).
- `update.sh` — the gated, self-verifying deploy with auto-rollback.
- `backup-db.sh` / `backup-offsite.sh` / `restore-db.sh` — backups (local + encrypted offsite).

## Updating the site later (your "can I edit while live?" question)

**Yes — you can keep updating without taking the site down.** Three kinds of change:

| What you change | How users get it | Downtime |
|---|---|---|
| **Data** (users, transactions, accounts, settings) | Edit inside the app (e.g. Pengguna). Saves to the DB instantly. | None |
| **Frontend** (HTML/JSX/CSS — look, screens, features) | Edit the source, run **`npm run build`**, bump the `?v=lNN` number in the HTML, commit + push. `bash deploy/update.sh` on the VPS pulls & serves it. Users get it on next refresh (no-cache headers make it immediate). | None |
| **Backend** (API logic) | Edit `server/...`, then `pm2 restart airro-api`. | ~1 second blip |
| **Database shape** (new fields) | `cd server && npx prisma db push` then `pm2 restart airro-api`. | ~1 second blip |

Tips:
- The frontend is now **built once with esbuild** — JSX is no longer compiled in the browser, so
  the login and every page load are much faster. See **[Frontend build](#frontend-build-esbuild)** below.
- Use **git** so you can roll back: commit before changes, `git pull` on the VPS to update.
- Back up the DB regularly: `cp server/prod.db ~/airro-backup-$(date +%F).db` (or `pg_dump` for Postgres).
- For zero-downtime backend reloads: `pm2 reload airro-api` instead of `restart`.

## Frontend build (esbuild)

The web client used to compile JSX **in the browser** via `@babel/standalone` — a ~3 MB download
plus a full compile of ~26 files on *every* page load (slow login, slow first paint). It is now
**built once** with esbuild into a single `dist/app.js`, and the HTML loads that one file with the
**production** React builds. No Babel, no in-browser compile.

**What the build does** (`build.mjs`): for each source file, in the *exact* `<script>` order the HTML
used, it runs esbuild's JSX transform (`loader: jsx`, `target: es2018`) and **concatenates** the
outputs into `dist/app.js` (+ a `dist/app.js.map` sourcemap). It deliberately **does not bundle,
tree-shake, convert to ESM, or rename identifiers** — the app has no modules and shares state through
globals (`window.FS`, `window.API`, bare cross-file names, …), so the single concatenated script keeps
the *identical* global scope and load order. Only whitespace/syntax are minified (never identifiers).

**Deploy flow:**

```bash
# on your machine, after editing any .js/.jsx source:
npm install        # once — installs esbuild (devDependency)
npm run build      # regenerates dist/app.js (+ .map)   ~150 ms
# bump the ?v=lNN number in index.html (the app page)
git add -A && git commit -m "..." && git push
```

Then on the VPS: `cd /var/www/airrooffice && bash deploy/update.sh` — it pulls, rebuilds `dist/app.js`
from source if node is present (otherwise serves the committed `dist/app.js`), and reloads the backend.

- **`npm run build`** — production build (safe minify).
- **`npm run build:dev`** — unminified, easier to debug.
- `dist/` **is committed** so the VPS works even without a Node build step. `node_modules/` is not.
- **If you add/remove/reorder a `<script>`**, update the `FILES` array in `build.mjs` to match.
- **Rollback:** `git revert` the build commit (the old Babel HTML is in history), or restore the
  local `*.babel.html.bak` backup created alongside this change.

## Safe updates (no data loss)

## Safe updates (no data loss)

Future code/feature updates use **migrations** + an automated script so existing
data is never wiped.

**One-time setup on the VPS** (baseline the current database to the migration
history — run once):
```bash
cd /var/www/airrooffice
git fetch origin && git reset --hard origin/master      # get the migrations + update.sh
cd server && unset DATABASE_URL && npx prisma migrate resolve --applied 0_init
```

**Every update after that** — just run:
```bash
cd /var/www/airrooffice && bash deploy/update.sh
```
It is a **gated, self-verifying pipeline**: any failed gate stops the deploy, and a
failure *after* the new code goes live rolls back automatically. It exits non-zero on
failure, so a broken deploy can never look successful. Full details in
[Deploy pipeline](#deploy-pipeline-self-verifying--auto-rollback) below.

**Workflow for a schema change (developer side):**
1. Edit `prisma/schema.prisma` (add a table/column — never remove on prod).
2. `npx prisma migrate dev --name describe_change` → creates a migration file.
3. Commit + push.
4. On the VPS: `bash deploy/update.sh` applies it safely.

**Golden rules:** never run `prisma migrate reset` or `prisma db push --force-reset`
on production (those wipe data). Always let `update.sh` back up first.

## The app URL, vendored libraries, and installing on phones

### Clean URL
The app is served at **`https://airrooffice.com/`**. `index.html` **is** the app — there
is no redirect hop and no long filename in the address bar.

The old URL (`/AirRO%20Water%20-%20Daily%20Finance%20Manager.html`) still works: Nginx
301s it to `/`, and the file itself also JS-redirects as a fallback. Both preserve the
`#hash` — the app's router state — because fragments are never sent to the server and
browsers re-apply them to the redirect target. So an old bookmark to `…Manager.html#payroll`
still lands on Payroll.

`try_files $uri $uri/ /index.html` means refreshing on any `#screen` still works.

### Zero third-party requests (deliberate)
Everything the browser loads comes from our own origin. **No CDNs.** If unpkg,
cdn.sheetjs.com or fonts.googleapis.com is blocked or down, the app still boots.

| Vendored in `vendor/` | Why |
|---|---|
| `react.production.min.js`, `react-dom.production.min.js` (18.3.1) | unpkg outage = app never boots |
| `xlsx.full.min.js` (SheetJS 0.20.3) | this CDN **has already failed once**; still lazy-loaded, only when an `.xlsx` is picked |
| `fonts.css` + `fonts/*.woff2` (Poppins, Inter — latin + latin-ext) | Google Fonts `@import` stalls the whole stylesheet if unreachable, and leaks every staff IP to Google |

`integrity`/`crossorigin` attributes were dropped: they exist for cross-origin CDN
fetches and are meaningless for same-origin files we ship ourselves.

**To verify (the acceptance test):** DevTools → Network → check "Blocked requests" after
setting a request-blocking pattern for `*google*`, `*unpkg*`, `*sheetjs*` → the app must
still load and the Excel import must still work.

### Installing on phones ("Add to Home Screen")
`manifest.webmanifest` makes AirRO installable: **Android** → Chrome ⋮ → *Install app*;
**iOS** → Safari Share → *Add to Home Screen*. Staff get the AirRO droplet icon and a
fullscreen window with **no address bar** (`display: standalone`).
- Icons are generated from `assets/airro-mark.png` into `icons/` — 192/512 in both `any`
  (transparent) and `maskable` (brand-blue, logo inside the 80% safe zone so Android's
  circle mask can't clip it), plus `apple-touch-icon` (opaque — iOS ignores transparency).
- iOS safe areas are respected via `viewport-fit=cover` + `env(safe-area-inset-*)`, so the
  bottom nav sits above the home indicator instead of under it.
> Nginx needs `types { application/manifest+json webmanifest; }` — `.webmanifest` is **not**
> in Nginx's default mime.types, and without it the browser silently refuses to install.

### No service worker — deliberate deferral
There is **no service worker**, and this is a decision, not an oversight. A naive
app-shell SW caches `index.html`/`dist/app.js` and would:
- serve **stale code** to staff after a deploy (the cache wins over the network, so the
  cache-bust `?v=lNN` never gets fetched) — exactly the class of bug the no-cache headers
  on `index.html` exist to prevent; and
- interact badly with **JWT sessions** — cached authenticated responses can leak between
  users on a shared phone, and a rotated `JWT_SECRET` (which logs everyone out) leaves
  cached 200s that make a dead session look alive.

Installability does **not** require a service worker — the manifest alone is enough for
"Add to Home Screen" and standalone display. If offline support is wanted later, it needs
a proper strategy (network-first for HTML/JS, never cache `/api/`, explicit SW versioning
+ `skipWaiting`), not a copy-pasted SW.

## Deploy pipeline (self-verifying + auto-rollback)

```bash
cd /var/www/airrooffice && bash deploy/update.sh
```

### Post-mortem: 16 Jul — stale Docker container held :4000
**Symptom:** every staff login failed for hours; the deploy reported success.
**Root cause:** a leftover Docker container still published `:4000`, so pm2 could not
bind (`EADDRINUSE`) and the API never actually restarted. The old script only *printed*
suggested checks and exited 0.
**Fix:** pre-flight **port guard** — abort if anything other than our own pm2 process
holds `:4000` (it no longer blindly `fuser -k`s the port), plus a post-deploy **smoke
test** that proves the API authenticates.
**Gate that now catches it:** pre-flight port guard → `DEPLOY FAIL`.

### Post-mortem: 17 Jul — applying the Nginx template deleted HTTPS
**Symptom:** the site was unreachable from the internet (`ERR_TIMED_OUT`). Nginx was
listening on **`:80` only**. Meanwhile `bash deploy/update.sh` reported
`frontend: OK` and `DEPLOY PASS`.
**Root cause — two independent failures:**
1. `deploy/nginx-airro.conf` contained only a `listen 80` block with a comment saying
   "certbot adds HTTPS". Copying it over the live config **deleted certbot's entire
   `:443` server block**. Nginx reloaded happily — a config with no HTTPS is perfectly
   valid, just wrong.
2. **The deploy's verification only tested `localhost`.** `curl http://127.0.0.1/` with
   a `Host:` header succeeds whether or not `:443` exists, so the pipeline could not
   see that the public site was gone. It reported PASS on a dead site.
**Fix:**
1. The repo now ships the **full** config including the `:443` block, and
   **`deploy/apply-nginx.sh`** refuses to apply a config that would remove TLS the live
   one has — it backs up, `nginx -t`s, reloads only on success, and restores on failure.
2. The deploy now **leaves the box**: it checks `:80` *and* `:443` are listening, fetches
   `https://airrooffice.com/` for real, and hits the API through the public URL.
**Gate that now catches it:** `PUBLIC SITE VERIFY` → `DEPLOY FAIL` (see the summary's
`public https` line).
**Repair, if it happens again:**
```bash
sudo certbot --nginx -d airrooffice.com -d www.airrooffice.com   # re-issue + re-add :443
sudo nginx -t && sudo systemctl reload nginx
curl -sS -o /dev/null -w '%{http_code}\n' https://airrooffice.com/    # must be 200
```

### Post-mortem: 18 Jul — the whole site downloaded instead of rendering
**Symptom:** opening `https://airrooffice.com/` prompted a **download of `index.html`**
instead of showing the app. HTTP status was `200` and the HTML was correct — only the
`Content-Type` was wrong (`application/octet-stream`).
**Root cause:** the Nginx config had, at server level,
`types { application/manifest+json webmanifest; }` to make the manifest installable. But
**an Nginx `types { }` block REPLACES the entire inherited mime map — it does not extend
it.** That one line wiped every default mapping (`.html→text/html`, `.js`, `.css`, `.png`
…), so every static file was served as octet-stream and the browser downloaded it. A
second `types { }` inside `location /vendor/` had the same defect.
**Why the 17 Jul gate missed it:** that gate fetches `/` and greps the body for
`dist/app.js` — which was still present. A wrong `Content-Type` returns `200` with the
right body, so a status+body check sails through. Only the **header** exposes it.
**Fix:**
1. Removed both `types { }` blocks. The manifest type is now set with `default_type` in an
   **exact location** (`location = /manifest.webmanifest`), which touches only that one URL
   and leaves the inherited mime map intact. `/vendor/` needs no override at all —
   `mime.types` already maps `.js → application/javascript`.
2. New **Content-Type regression gate** in the deploy: it asserts `/` is `text/html`,
   `/vendor/*.js` is a JavaScript type, and the manifest is `application/manifest+json`.
   A wrong type **fails the deploy**.
**Gate that now catches it:** `PUBLIC SITE VERIFY → content-types` → `DEPLOY FAIL`.
**The rule:** `types { }` **replaces, never extends** the mime map. To add ONE type,
use `default_type` in an exact `location =` — never a bare `types { }` block. (If you
ever do need a block, it must start with `include mime.types;` to re-inherit the defaults.)

**The lesson all three share: "exit 0" is not "it works", and localhost is not the internet.**

### The gates
Pre-flight (nothing touched): app dir + git repo · warn on uncommitted changes ·
record rollback SHA · **port guard** · record counts.
Then, aborting on any failure:

| # | Gate | Failure means |
|---|------|---------------|
| 1 | `backup-db.sh` (local **+ offsite**) | no good backup → no deploy |
| 2 | `git fetch` + `reset --hard origin/master` | can't get the code |
| 3 | `npm ci` + **`npm test`** | failing tests → abort, **prod untouched** |
| 4 | `prisma migrate deploy` | migration error, or reports **data loss** → abort |
| 5 | `npm run build` → `dist/app.js` | build broken |
| 6 | `pm2 startOrReload` | process won't start |

Then **post-deploy verify — on localhost** (these roll the code back on failure):
- `:4000` is held by **our** pm2 process (not docker/stray)
- health `200` (5 retries, exponential backoff)
- **smoke test**: `401` without a token, then a real authenticated `GET /auth/me`
  round-trip with a short-lived JWT → catches "server up but auth broken"
- record counts **>= pre-deploy** — a drop means data loss

Then **PUBLIC SITE VERIFY — off the box** (the 17 Jul gate). These **fail the deploy**:
- Nginx listening on **both `:80` and `:443`** — a missing `:443` is 17 Jul
- **`https://airrooffice.com/` → 200**, fetched for real over the internet
- the served HTML **is the app** (`dist/app.js` + manifest present)
- **Content-Type** is right (18 Jul): `/` is `text/html`, `/vendor/*.js` is a JavaScript
  type, the manifest is `application/manifest+json` — a wrong type means the browser
  downloads the page instead of rendering it (status is still `200`, so only the header
  catches it)
- **`https://airrooffice.com/api/v1/health` → 200** — proves Nginx→Node proxying, not
  just Node answering on localhost
- TLS certificate expiry — **warn** if < 21 days

> **Why the public gates fail but do NOT roll back.** A missing `:443`, a dead
> certificate or a closed firewall are *infrastructure*: reverting app code cannot fix
> any of them, and doing so would add a second change during an outage while hiding the
> real cause. So they exit non-zero with the exact repair command instead. The one
> exception is "the public URL isn't serving the app", which *is* code-shaped (bad build
> or wrong root) — that rolls back. Genuine code faults are already caught by the
> localhost gates above, which do roll back.
> The old `frontend:` check was **warn-only and localhost-only** — that is precisely why
> 17 Jul was reported as PASS. It has been replaced by the gates above.

### Rollback rules (deliberate)
- **Code rollback is automatic**: `git reset --hard <previous SHA>` → reinstall → rebuild
  → `pm2 startOrReload` → health-check again.
- **The database is NEVER restored automatically.** Migrations are additive (`migrate
  deploy` refuses data loss), so the previous code almost always runs fine against the
  new schema — and restoring would throw away real writes made since the backup. A DB
  restore happens only when **all three** hold: migrations applied in this run **and**
  verification failed **and** you passed `--restore-db`. Otherwise the script prints the
  exact command for you to run deliberately.

### Flags
| Flag | Use |
|------|-----|
| `--restore-db` | also restore the pre-deploy snapshot if a rollback happens *and* migrations ran (destructive) |
| `--skip-offsite` | emergency: deploy while cloud storage is down (local backup still required) |
| `--skip-tests` | emergency only — you are deploying unverified code |

### Reading `deploy/deploy.log`
Every run appends a timestamped block, ending in a summary:
```
──────────────────────── DEPLOY PASS ────────────────────────
  commit before : ca1014d2
  commit after  : f25afec9
  tests         : 195 passed, 195 total
  migrations    : yes
  health (local): 200
  :443 listening: yes
  public https  : OK (200, api 200)      ← the 17 Jul gate (https://airrooffice.com/)
  cert expires  : 72 days
  counts before : user=7 entry=1284 employee=19 setoran=342
  counts after  : user=7 entry=1284 employee=19 setoran=342
  rollback      : no   db restored: no
```
`public https` is the line that matters: if it is anything other than `OK`, staff cannot
reach the site — no matter how healthy everything else looks.
```bash
tail -40 deploy/deploy.log                    # last run
grep -E 'DEPLOY (PASS|FAIL)' deploy/deploy.log | tail -10   # deploy history
grep -A12 'DEPLOY FAIL' deploy/deploy.log | tail -20        # why the last one failed
```

### If a deploy fails
The script already rolled the code back and re-checked health. To confirm and dig in:
```bash
curl -s -o /dev/null -w 'health %{http_code}\n' http://127.0.0.1:4000/api/v1/health
pm2 logs airro-api --lines 40
git log --oneline -1                 # should be the previous (working) commit
```
**Manual rollback** (if you ever need it yourself):
```bash
cd /var/www/airrooffice
git log --oneline -5                 # pick the last known-good SHA
git reset --hard <SHA>
cd server && npm ci && npx prisma generate && cd ..
npm run build
pm2 startOrReload deploy/ecosystem.config.js --update-env
curl -s -o /dev/null -w 'health %{http_code}\n' http://127.0.0.1:4000/api/v1/health
```
Note the rolled-back commit is still on `origin/master`, so the **next** `update.sh`
will pull it again — push a fix (or `git revert`) rather than redeploying the same break.

### Applying the Nginx config — NEVER `cp` it by hand
```bash
sudo bash deploy/apply-nginx.sh          # the only supported way
```
> ⚠️ **This is what caused the 17 Jul outage.** `sudo cp deploy/nginx-airro.conf
> /etc/nginx/sites-available/airro` replaces the live file wholesale. If the repo copy is
> missing anything the live one has — above all **certbot's `:443` block** — that config
> is *deleted*, `nginx -t` still passes (a site with no HTTPS is valid, just wrong), and
> the site drops off the internet.

`apply-nginx.sh` makes it safe:
1. shows a **diff** (live → repo);
2. **refuses** if the live config has TLS the repo copy lacks (the 17 Jul footgun) —
   override only with `--force` if you truly mean it;
3. checks every `/etc/letsencrypt/...` file the config references **exists**;
4. **backs up** the live file (`airro.bak-<stamp>`);
5. copies, runs **`nginx -t`**, and reloads **only if it passes**;
6. verifies `:80` **and** `:443` are listening afterwards;
7. on *any* failure — bad test, reload error, `:443` not up — **restores the backup**,
   reloads, and exits non-zero.

The repo config now contains the complete production setup (`:80` → `:443` redirect with
an ACME passthrough, and the full `:443` server block). If certbot's paths on your box
differ, **the live file is the source of truth** — check the diff before saying yes.

**If HTTPS is ever gone (the 17 Jul repair):**
```bash
sudo certbot --nginx -d airrooffice.com -d www.airrooffice.com
sudo nginx -t && sudo systemctl reload nginx
curl -sS -o /dev/null -w '%{http_code}\n' https://airrooffice.com/     # must be 200
ss -ltnp | grep -E ':80|:443'                                          # both present
```

### Surviving a reboot (one-time, needs root)
`update.sh` runs `pm2 save`, which persists the process *list* — but nothing replays it at
boot unless pm2's systemd unit is installed. Without this, **a reboot silently takes the
site down** until someone notices. Do it once:
```bash
pm2 startup systemd          # prints a `sudo env PATH=... pm2 startup ...` command
# → copy-paste and run exactly what it printed
pm2 save
systemctl is-enabled pm2-root      # expect: enabled   (pm2-<user> if not running as root)
```
`update.sh` prints a **pre-flight warning** if this isn't enabled. Verify for real with
`sudo reboot`, then check `https://airrooffice.com/` comes back on its own.

### External monitoring (do this — it's the only thing that tells you first)
Every gate here runs **only when you deploy**. On 17 Jul the site was down and nothing
told the owner — he found it by hand. A free uptime monitor closes that gap.

**Setup (~3 minutes, needs a human — no way to automate the signup):**
1. Sign up at **https://uptimerobot.com** (free tier: 50 monitors, 5-minute checks).
2. **+ New Monitor**:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `AirRO API health`
   - URL: `https://airrooffice.com/api/v1/health`
   - Monitoring Interval: **5 minutes**
3. **Alert Contacts** → add your **email**; for WhatsApp/Telegram alerts, add the
   Telegram integration or a webhook (free tier does not do SMS).
4. Add a second monitor for `https://airrooffice.com/` (the app itself, not just the API)
   — 17 Jul killed the site while the API was perfectly healthy, so **monitoring only the
   API would have missed it**.
5. Test it: `pm2 stop airro-api` → wait ~5 min → you should get an alert → `pm2 start airro-api`.

Why `/api/v1/health`: it is unauthenticated, cheap, exempt from rate limiting, and it
proves Nginx→Node end to end. Why also `/`: it proves the static site + TLS are alive.

### Port conflict (the 16 Jul failure) — what you'll see
```
   ❌ port 4000 is held by a process that is NOT our pm2 airro-api:
   ·  pid 12345 → docker-proxy /usr/bin/docker-proxy -proto tcp -host-port 4000 ...
```
Fix it, then re-run the deploy:
```bash
ss -ltnp | grep 4000        # who holds the port
docker ps                   # a container publishing :4000?
docker stop <id>            # stop it (and remove it from the compose/run that starts it)
pm2 describe airro-api      # is pm2 actually managing our API?
```

## Backup & Restore

The database holds salaries, NIK and BPJS data, so backups are **local + offsite
(encrypted)**, scheduled, integrity-checked, and the restore path is tested.

**Where backups live**
- **Local:** `~/airro-backups/airro-YYYYMMDD-HHMMSS.db.gz` — 14-day retention.
- **Offsite:** an encrypted copy on cloud storage (rclone) — 90-day retention.
- **Log:** every run appends a summary to `~/airro-backups/backup.log`.
- **Failure markers:** `LAST_BACKUP_FAILED` / `LAST_OFFSITE_FAILED` appear in
  `~/airro-backups/` only when a run fails (removed on the next success) — a
  dead-simple thing to check or alert on.

### 1. Scheduled local backup
Install sqlite3 once (safe online snapshots + record counts):
```bash
sudo apt-get install -y sqlite3
bash deploy/backup-db.sh            # writes to ~/airro-backups/, verifies, ships offsite
```
`backup-db.sh` snapshots the DB, runs `gzip -t` on the archive, and **fails loudly
(non-zero + marker)** if it's corrupt or smaller than 50 KB. It prunes local backups
older than 14 days, then chains `backup-offsite.sh` (skip with `SKIP_OFFSITE=1`, which
`update.sh` does so a deploy is never blocked by a cloud outage).

Daily at 02:00 via cron (`crontab -e`) — one line runs local **and** offsite and logs both:
```
0 2 * * * /bin/bash /var/www/airrooffice/deploy/backup-db.sh >> $HOME/airro-backups/backup.log 2>&1
```

### 2. Offsite copy (encrypted) — one-time setup
`backup-offsite.sh` uploads each new archive to storage **outside** the VPS with rclone.
`rclone config` needs a **one-time interactive OAuth login by the owner** — it cannot be
automated. Do it once on the VPS:
```bash
sudo apt-get install -y rclone
rclone config
#  n) New remote
#  name> airro-offsite
#  Storage> drive           (Google Drive)   — or  s3  for S3-compatible
#  client_id / client_secret> (blank is fine for a personal test; better: your own)
#  scope> 1                  (full access)
#  Edit advanced config> n
#  Use web browser to authenticate> y  → a browser/URL opens; log in as the OWNER,
#                                        approve, paste the token back if headless
#  Configure as a Shared Drive> n
#  y) Yes this is OK  → q) Quit config
rclone lsd airro-offsite:                       # sanity: lists your Drive folders
```
Then choose an **encryption mode** and set it in `server/.env`:
- **Mode A — gpg (simplest, plain remote):** set `BACKUP_PASSPHRASE` (long/random).
  Each archive is `gpg -c` AES256-encrypted here, and the `.gpg` is uploaded.
  **Keep a copy of the passphrase somewhere offsite too** — lose it and the offsite
  copies are unrecoverable.
- **Mode B — rclone crypt (no passphrase in env):** run `rclone config` again to make a
  `crypt` remote wrapping `airro-offsite:`, point `RCLONE_REMOTE` at it, and leave
  `BACKUP_PASSPHRASE` empty. rclone encrypts names + contents transparently.
```
# server/.env
RCLONE_REMOTE="airro-offsite:airro"
BACKUP_PASSPHRASE="<long random — mode A>"     # empty for mode B
OFFSITE_KEEP_DAYS="90"
```
After uploading, the script **verifies the copy actually landed** (`rclone ls` + size match) —
a transfer that "succeeded" but isn't listable is not a backup. It **fails loudly** (non-zero +
`LAST_OFFSITE_FAILED` + a `FAIL:` line in `backup.log`) if rclone is missing, the remote is
unconfigured, the transfer errors, or the remote size doesn't match. Verify by hand any time:
```bash
rclone ls airro-offsite:airro | tail -5      # newest encrypted archives in Drive
```

### 3. Restore
```bash
bash deploy/restore-db.sh <backup-file.gz>        # a LOCAL archive
bash deploy/restore-db.sh <backup-file.gz.gpg>    # an OFFSITE archive — decrypts automatically
```
It refuses a file that fails `gzip -t` (and a `.gpg` that fails to decrypt), then: stops
the API → **snapshots the current db first** (`.pre-restore-<stamp>`) → gunzips the backup
over the `DATABASE_URL` path (read from `server/.env`) → starts the API → health-checks →
prints record counts (User / Entry / Employee / Setoran) so you can confirm the data is
really there.

**Restoring from Google Drive** — the script handles the decryption for you:
```bash
rclone copy airro-offsite:airro/airro-YYYYMMDD-HHMMSS.db.gz.gpg .   # download
bash deploy/restore-db.sh airro-YYYYMMDD-HHMMSS.db.gz.gpg           # decrypts + restores
```
**Decrypting by hand** (e.g. to inspect an archive on another machine — all you need is
the passphrase and gpg; no AirRO code required):
```bash
gpg --batch --pinentry-mode loopback --passphrase 'YOUR_BACKUP_PASSPHRASE' \
    -o airro-YYYYMMDD-HHMMSS.db.gz -d airro-YYYYMMDD-HHMMSS.db.gz.gpg
gunzip -c airro-YYYYMMDD-HHMMSS.db.gz > airro.db && sqlite3 airro.db '.tables'
```

> ### ⚠️ Store `BACKUP_PASSPHRASE` OUTSIDE the server
> The offsite archives are useless without it. If the VPS is lost, wiped, or
> compromised, `server/.env` goes with it — and every Drive backup becomes
> permanently unrecoverable. Keep a copy in a password manager (or on paper in a
> safe) **off the server**. This is the single point of failure in the whole
> backup design. It is never committed to git.

### 4. Restore drill (prove backups are usable — touches nothing in production)
```bash
bash deploy/restore-db.sh --drill            # newest local backup, into /tmp/restore-test.db
```
Expected output (numbers should roughly match production):
```
==> DRILL — restoring '.../airro-YYYYMMDD-HHMMSS.db.gz' into /tmp/restore-test.db (production is NOT touched)
==> Record counts in the restored copy:
   User       7
   Entry      1284
   Employee   19
   Setoran    342
✅ Drill OK — the backup gunzips cleanly and contains data. Nothing in production changed.
```
Run this monthly. If the counts are 0 or the drill errors, your backups are not usable —
fix it before you need them. (Compare against production:
`sqlite3 server/prisma/prod.db 'SELECT COUNT(*) FROM "User";'`.)

### 5. Monitoring
Each run appends one line to `backup.log`:
```
SUMMARY 2026-07-17 02:00:03 | file=airro-20260717-020001.db.gz size=1.2M | local=OK | offsite=OK | keep_local=14d
```
Quick health check any time:
```bash
tail -n 3 ~/airro-backups/backup.log
ls ~/airro-backups/LAST_*_FAILED 2>/dev/null && echo "⚠️  a backup failed — investigate" || echo "backups OK"
```

## Troubleshooting: "data doesn't persist on the server" (/state)

Symptom: a save returns 200 but disappears, or the push gets 413/404/500. Work
through these on the VPS in order — each command tells you where it breaks.

**1. Is the LATEST backend actually running?** (not an old build without `/state`)
```bash
cd /var/www/airrooffice && bash deploy/update.sh      # git pull + npm i + migrate deploy + restart
pm2 restart airro-api --update-env && pm2 logs airro-api --lines 40
curl -s -o /dev/null -w 'health %{http_code}\n' http://127.0.0.1:4000/api/v1/health
```

**2. Run migrations on the PRODUCTION db and confirm the tables exist:**
```bash
cd /var/www/airrooffice/server
unset DATABASE_URL                 # use .env (never a stray shell var)
npx prisma migrate deploy          # applies pending migrations to prod.db
npx prisma migrate status          # should say "up to date"
# List tables (SQLite). prod.db lives next to the schema: server/prisma/prod.db
sqlite3 prisma/prod.db '.tables'   # expect: Document, Employee, Cashbon, Training, CalendarEvent, EmployeeNip, User, ...
sqlite3 prisma/prod.db 'SELECT COUNT(*) FROM Document;'
```

**3. Is the db file on PERSISTENT storage and writable by Node?**
```bash
cd /var/www/airrooffice/server
grep DATABASE_URL .env                          # e.g. file:./prod.db  (relative → resolves to server/prisma/prod.db)
ls -l prisma/prod.db && df -h .                 # file exists, on the main disk (not /tmp or a tmpfs)
sudo -u $(pm2 jlist | grep -o '"username":"[^"]*"' | head -1 | cut -d'"' -f4) test -w prisma/prod.db && echo writable
```
Make it bullet-proof — **use an absolute path** so the CLI, the pm2 runtime, and
backups can never disagree on which file to use:
```bash
# in server/.env
DATABASE_URL="file:/var/www/airrooffice/server/prisma/prod.db"
# then:
cd /var/www/airrooffice/server && unset DATABASE_URL && npx prisma migrate deploy && pm2 restart airro-api --update-env
```
> `/var/www/...` is normal persistent disk; `git pull` won't touch `*.db`/`.env`
> (both gitignored). Avoid pointing DATABASE_URL at `/tmp` or a container's
> ephemeral layer.

**4. Round-trip test against the live API** (token required — log in first):
```bash
DOMAIN=https://airrooffice.com
TOKEN=$(curl -s -X POST $DOMAIN/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"owner","password":"YOUR_PASSWORD"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
# write
curl -s -X PUT $DOMAIN/api/v1/state/airro_test -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"value":"hi"}' ; echo
# read back → must contain airro_test:"hi"
curl -s $DOMAIN/api/v1/state -H "Authorization: Bearer $TOKEN" | grep -o 'airro_test":"[^"]*"'
# restart, then read again → still there = truly persisted
pm2 restart airro-api && sleep 2
curl -s $DOMAIN/api/v1/state -H "Authorization: Bearer $TOKEN" | grep -o 'airro_test":"[^"]*"'
```

**5. Nginx: correct proxy + big-enough body limit.**
- `/api/` must proxy to `http://127.0.0.1:4000` (no trailing slash, so the full
  `/api/v1/...` path reaches Node). That's what `nginx-airro.conf` does.
- Add **`client_max_body_size 20m;`** (Nginx default is **1MB** → large localStorage
  blobs get a **413** and the save is silently lost). Edit your live site file:
```bash
sudo nano /etc/nginx/sites-available/airro     # add:  client_max_body_size 20m;  in the server { } block
sudo nginx -t && sudo systemctl reload nginx
```
Confirm a big PUT isn't blocked:
```bash
python3 - <<'PY' > /tmp/big.json
print('{"value":"' + 'x'*3000000 + '"}')       # ~3MB
PY
curl -s -o /dev/null -w '%{http_code}\n' -X PUT $DOMAIN/api/v1/state/airro_bigtest \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @/tmp/big.json
# 200 = OK. 413 = Nginx (raise client_max_body_size) or the app 12MB cap.
```

## Notes
- **PostgreSQL** is recommended over SQLite for a real business (safer backups,
  concurrent writes). Switch `provider` in `prisma/schema.prisma` to `postgresql`
  and set a Postgres `DATABASE_URL`. See `server/README.md`.
- `start.bat` / `serve.py` are for **local development only** — production uses
  Nginx + pm2.

## Recovery: locked out of user management

Access to the **Pengguna** screen and all user/role administration is gated on the
`manageUsers` capability — a real per-user toggle, not a role hard-grant (Owner is
configurable like anyone else). A lockout guard **rejects** any change that would leave
zero active users with `manageUsers`, so you normally can't strand yourself. If it ever
happens anyway (e.g. a direct DB edit), re-grant it to the owner **from the server**:

```bash
cd /var/www/airrooffice/server
node -e "
const p = require('./src/lib/prisma');
(async () => {
  const u = await p.user.findFirst({ where: { username: 'owner' } });   // or the account you use
  if (!u) { console.error('no such user'); process.exit(1); }
  const perms = u.permissions ? JSON.parse(u.permissions) : {};
  perms.manageUsers = true;                                             // grant the capability
  await p.user.update({ where: { id: u.id }, data: { permissions: JSON.stringify(perms) } });
  console.log('manageUsers granted to', u.username, '— log out and back in.');
  await p.\$disconnect();
})();
"
pm2 restart airro-api        # only needed if you also changed roles; token refresh happens on next login
```
The change takes effect on that user's **next login** (tokens are stateless). Alternative
with `sqlite3` — reset the account to its ROLE defaults (the `owner` role ships with
`manageUsers: true`), which also restores access:
```bash
sqlite3 prisma/prod.db "UPDATE User SET permissions = NULL WHERE username = 'owner';"
```

## Security hardening (production)

This app is public and holds salaries, NIK and BPJS data. The checklist below is
enforced in code + config; the commands verify it on the live box.

**1. Rate limiting** (express-rate-limit, installed automatically by `update.sh`).
- `POST /api/v1/auth/login` — **10 failed attempts / 15 min / IP** → `429` with
  *"Terlalu banyak percobaan, coba lagi dalam beberapa menit."* Successful logins
  don't count, so real users are never locked out.
- Forgot-password endpoints — **5 / hour / IP**.
- All authenticated API routes — **300 req / min / IP** (generous). The SSE stream
  `/api/v1/events` and `/api/v1/health` are **exempt** so realtime + polling never trip it.
- Nginx is the single proxy, so the app sets **`trust proxy = 1`** and limits on the
  real client IP (from `X-Forwarded-For`). Tune via the `*_RATE_*` vars in `.env`.
```bash
DOMAIN=https://airrooffice.com
# 11 rapid bad logins → first ~10 are 401, then 429:
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code} " -X POST $DOMAIN/api/v1/auth/login \
    -H 'Content-Type: application/json' -d '{"username":"nobody","password":"x"}'
done; echo
```

**2. Login observability.** The client always sees a generic *"Invalid credentials"*
(never "user not found" vs "inactive"), but the server logs the real reason with the
username + IP so you can diagnose lockouts: `pm2 logs airro-api` →
`[auth] login gagal — user tidak ditemukan | akun nonaktif | password salah (username="…", ip="…")`.

**3. Rotate `JWT_SECRET` now.** It was shared during debugging, so generate a fresh one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
nano server/.env        # paste into JWT_SECRET=...
pm2 restart airro-api --update-env
```
> ⚠️ Rotating the secret **invalidates every existing session** — everyone (including
> you) must log in again. That's expected and harmless; do it once, then leave it alone.

**4. CORS locked to the domain.** `CORS_ORIGIN=https://airrooffice.com` in `server/.env`
(never `*`). The server refuses to start in production without a strong `JWT_SECRET`.

**5. Secrets/DB/VCS are not reachable over HTTP.** `nginx-airro.conf` denies
`/server`, `/deploy`, `*.db`, `*.env`, and dotfiles (`/.git`, `/.env`). Verify:
```bash
for p in /server/.env /server/prisma/prod.db /.git/config /.env; do
  echo -n "$p → "; curl -s -o /dev/null -w "%{http_code}\n" $DOMAIN$p
done
# every line must be 403 or 404 — NEVER 200.
```

**6. Password policy (minimal, non-disruptive).** Register / self-change enforce a
**min 8 chars** (server + client). Existing users are **not** force-reset; instead any
short/temporary password (e.g. a 4-digit admin PIN like `1234`) is **flagged "password
lemah"** next to that user in the user list, so you can decide who to upgrade.
