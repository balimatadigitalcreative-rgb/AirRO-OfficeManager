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
| **Frontend** (HTML/JSX/CSS — look, screens, features) | Edit the file on the VPS (or re-upload), then bump the `?v=l7` number in the HTML. Users get it on next refresh (no-cache headers already make this immediate). | None |
| **Backend** (API logic) | Edit `server/...`, then `pm2 restart airro-api`. | ~1 second blip |
| **Database shape** (new fields) | `cd server && npx prisma db push` then `pm2 restart airro-api`. | ~1 second blip |

Tips:
- The frontend has **no build step** (JSX compiles in the browser), so editing a
  `.jsx` file on the server *is* the deploy — just bump the cache version.
- Use **git** so you can roll back: commit before changes, `git pull` on the VPS to update.
- Back up the DB regularly: `cp server/prod.db ~/airro-backup-$(date +%F).db` (or `pg_dump` for Postgres).
- For zero-downtime backend reloads: `pm2 reload airro-api` instead of `restart`.

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

## Database backups

`deploy/backup-db.sh` makes a dated, gzipped snapshot (SQLite or Postgres) and
keeps the last 14 days. Install sqlite3 once for safe SQLite snapshots:
```bash
sudo apt-get install -y sqlite3
bash deploy/backup-db.sh            # writes to ~/airro-backups/
```
Automate it daily at 2am with cron (`crontab -e`):
```
0 2 * * * cd /var/www/airro && /bin/bash deploy/backup-db.sh >> ~/airro-backups/backup.log 2>&1
```
Restore (SQLite): stop the API, `gunzip` the backup over `server/prisma/prod.db`,
start the API:
```bash
pm2 stop airro-api
gunzip -c ~/airro-backups/airro-YYYYMMDD-HHMMSS.db.gz > /var/www/airro/server/prisma/prod.db
pm2 start airro-api
```
Tip: also copy backups off the VPS periodically (e.g. `scp` to your PC, or rclone to cloud storage).

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
