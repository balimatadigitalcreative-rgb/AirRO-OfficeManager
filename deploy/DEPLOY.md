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

## Notes
- **PostgreSQL** is recommended over SQLite for a real business (safer backups,
  concurrent writes). Switch `provider` in `prisma/schema.prisma` to `postgresql`
  and set a Postgres `DATABASE_URL`. See `server/README.md`.
- `start.bat` / `serve.py` are for **local development only** — production uses
  Nginx + pm2.
