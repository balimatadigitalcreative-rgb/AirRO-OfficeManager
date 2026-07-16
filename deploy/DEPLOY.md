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
- `nginx-airro.conf` — Nginx site (frontend + `/api/` proxy). deploy.sh fills in your domain/path.
- `ecosystem.config.js` — pm2 config for the backend (binds `127.0.0.1:4000`).
- `deploy.sh` — installs everything and configures the site.

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
# bump the ?v=lNN number in "AirRO Water - Daily Finance Manager.html"
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
It backs up → pulls code → applies only new migrations → restarts. Data is safe
because: `.env`/`*.db` are gitignored (untouched by `git pull`), and
`prisma migrate deploy` only *adds* schema changes and refuses anything that
would lose data.

**Workflow for a schema change (developer side):**
1. Edit `prisma/schema.prisma` (add a table/column — never remove on prod).
2. `npx prisma migrate dev --name describe_change` → creates a migration file.
3. Commit + push.
4. On the VPS: `bash deploy/update.sh` applies it safely.

**Golden rules:** never run `prisma migrate reset` or `prisma db push --force-reset`
on production (those wipe data). Always let `update.sh` back up first.

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
The upload **fails loudly** (non-zero + `LAST_OFFSITE_FAILED`) if rclone is missing, the
remote is unconfigured, or the transfer errors — a silent failed backup is the worst case.

### 3. Restore
```bash
bash deploy/restore-db.sh <backup-file.gz>        # into PRODUCTION
```
It refuses a file that fails `gzip -t`, then: stops the API → **snapshots the current db
first** (`.pre-restore-<stamp>`) → gunzips the backup over the `DATABASE_URL` path (read
from `server/.env`) → starts the API → health-checks → prints record counts
(User / Entry / Employee / Setoran) so you can confirm the data is really there.

**Decrypting an offsite archive** before restoring:
```bash
rclone copy airro-offsite:airro/airro-YYYYMMDD-HHMMSS.db.gz.gpg .   # download (mode A)
gpg --batch --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
    -o airro-YYYYMMDD-HHMMSS.db.gz -d airro-YYYYMMDD-HHMMSS.db.gz.gpg
bash deploy/restore-db.sh airro-YYYYMMDD-HHMMSS.db.gz
# Mode B (crypt remote): `rclone copy` decrypts automatically — no gpg step.
```

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
