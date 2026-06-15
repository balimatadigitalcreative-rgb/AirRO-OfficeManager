# AirRO Finance API

REST backend for the **AirRO Water — Daily Finance Manager**. Persists the data
the frontend currently keeps in the browser: cash-book entries, accounts,
transfers, categories, delivery *setoran*, fleet, users/roles, employees +
payroll, and settings.

**Stack:** Node.js + Express · Prisma ORM (SQLite for local dev, PostgreSQL for
production) · JWT auth with roles · Zod validation · Jest + Supertest.

> **Status:** Complete. All resources — `auth`, `users`, `accounts`,
> `categories`, `entries`, `transfers`, `setoran`, `fleet`, `employees`,
> `payroll`, `settings`, `reports`, `health` — are implemented, tested
> (36 integration tests), and verified live over HTTP.

## Project layout

```
server/
├── prisma/
│   ├── schema.prisma     # data model (all resources)
│   └── seed.js           # seed users, accounts, categories, fleet
├── src/
│   ├── config/env.js     # env-based config (dotenv)
│   ├── lib/prisma.js     # shared Prisma client
│   ├── middleware/       # auth (JWT + roles), validate (Zod), errorHandler
│   ├── routes/           # express routers (thin)
│   ├── controllers/      # request/response + Zod schemas
│   ├── services/         # business logic + DB access
│   ├── utils/            # ApiError, asyncHandler
│   ├── app.js            # express app factory
│   └── server.js         # process entry point
└── tests/                # Jest + Supertest (integration)
```

Each resource is a vertical slice: **route → controller (validation) → service
(logic/DB)**. To add one, copy the `entry.*` trio.

## Setup

Requires Node 18+.

```bash
cd server
npm install
cp .env.example .env          # then edit JWT_SECRET etc.
npx prisma db push            # create the SQLite schema (dev.db)
npm run db:seed               # seed role users + defaults
npm run dev                   # http://localhost:4000
```

### Switching to PostgreSQL (production)

1. In `prisma/schema.prisma`, set `datasource db { provider = "postgresql" }`.
2. Point `DATABASE_URL` at your Postgres instance.
3. `npx prisma migrate deploy` (or `migrate dev` locally).

No application code changes are needed — the schema is written to be portable.

## Run the tests

```bash
npm test
```

Spins up an isolated SQLite `test.db` (auto-reset from the schema), then runs the
auth + entries integration suites (18 tests).

## Config (`.env`)

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `4000` | HTTP port |
| `DATABASE_URL` | `file:./dev.db` | Prisma datasource |
| `JWT_SECRET` | — | JWT signing secret (**set this**) |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `CORS_ORIGIN` | `*` | Allowed frontend origin(s), comma-separated |
| `SEED_OWNER_USERNAME` / `SEED_OWNER_PASSWORD` | `owner` / `owner1234` | First owner account |

## Conventions

- **Base path:** all endpoints under `/api/v1`.
- **Auth:** `Authorization: Bearer <token>`. Roles: `owner` (read-only),
  `gm` (full), `hrd`, `finance`, `adminfin` — mirroring the frontend matrix.
- **Money:** stored as whole-rupiah integers (`Int`). Per-transaction amounts are
  well within int range; aggregate sums are computed in JS (safe to 2^53).
- **Success shapes:** single resource → `{ "data": {...} }`; lists →
  `{ "data": [...], "pagination": {...} }`.
- **Error shape (consistent):**
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
  ```
  Codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
  `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_ERROR` (500).

## Endpoints & curl examples

Seeded logins (from `npm run db:seed`): `owner/owner1234`,
`manager/manager1234`, `hrd/hrd12345`, `finance/finance123`, `admin/admin1234`.

### Health

```bash
curl http://localhost:4000/api/v1/health
# { "status": "ok", "uptime": 12.3, "timestamp": "..." }
```

### Auth

```bash
# Register
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Andi","username":"andi","password":"secret123","role":"finance"}'

# Login → returns { user, token }
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"finance","password":"finance123"}'

# Current user
curl http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

### Entries (cash book) — `requireAuth`; writes need `gm` or `finance`

```bash
# Create
curl -X POST http://localhost:4000/api/v1/entries \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"income","amount":540000,"note":"30 × Galon 19L","method":"QRIS","date":"2026-06-03","time":"16:40","categoryKey":"Refill"}'

# List with pagination + filters
curl "http://localhost:4000/api/v1/entries?type=income&dateFrom=2026-06-01&dateTo=2026-06-30&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
# query params: page, limit, type, category, account, method, status, dateFrom, dateTo, search

# Get one
curl http://localhost:4000/api/v1/entries/$ID -H "Authorization: Bearer $TOKEN"

# Update (partial)
curl -X PATCH http://localhost:4000/api/v1/entries/$ID \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"note":"updated note","status":"Pending"}'

# Delete
curl -X DELETE http://localhost:4000/api/v1/entries/$ID -H "Authorization: Bearer $TOKEN"
```

### Accounts — `seeMoney` to read, `settings` to write

```bash
curl http://localhost:4000/api/v1/accounts -H "Authorization: Bearer $TOKEN"
curl http://localhost:4000/api/v1/accounts/bca/balance -H "Authorization: Bearer $TOKEN"
# balance = opening + Σincome − Σexpense + Σtransfers-in − Σtransfers-out
curl -X POST http://localhost:4000/api/v1/accounts -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"BNI","type":"bank","bank":"BNI","opening":0}'
```

### Categories — `cashflow` to read, `settings` to write

```bash
curl "http://localhost:4000/api/v1/categories?type=expense" -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:4000/api/v1/categories -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"key":"Marketing","label":"Marketing","icon":"IconStore","type":"expense"}'
```

### Transfers — `cashflow` to read, `addEntry`/`delete` to write

```bash
curl -X POST http://localhost:4000/api/v1/transfers -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"fromId":"cash","toId":"bca","amount":400000,"date":"2026-06-12"}'
curl "http://localhost:4000/api/v1/transfers?account=bca" -H "Authorization: Bearer $TOKEN"
```

### Setoran (delivery deposits) — `setoran` capability

```bash
# deposit = cash + bonPay − expense (computed server-side)
curl -X POST http://localhost:4000/api/v1/setoran -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-06-12","fleetId":"<id>","cash":900000,"bonPay":100000,"expense":50000}'
curl "http://localhost:4000/api/v1/setoran?date=2026-06-12" -H "Authorization: Bearer $TOKEN"
```

### Fleet — `setoran` to read, `settings` to write

```bash
curl http://localhost:4000/api/v1/fleet -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:4000/api/v1/fleet -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"plate":"L-999"}'
```

### Employees (HRD roster) — `employees` capability

```bash
curl http://localhost:4000/api/v1/employees -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:4000/api/v1/employees -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Budi","department":"Driver","base":4000000,"allowance":500000,"risk":"Medium","joinedDate":"2024-01-15"}'
```

### Payroll (BPJS/JKK/JP engine) — `payroll` to view, `addEntry` to post

```bash
# Full run: per-employee breakdown + totals (gross, take-home, employer
# contributions, company cost, BPJS Kesehatan/Ketenagakerjaan).
curl http://localhost:4000/api/v1/payroll -H "Authorization: Bearer $TOKEN"

# Post the run as a single Salaries expense in the cash book.
curl -X POST http://localhost:4000/api/v1/payroll/post -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"date":"2026-06-01"}'
```

### Settings — any role reads; `settings` capability writes

```bash
curl http://localhost:4000/api/v1/settings -H "Authorization: Bearer $TOKEN"
curl -X PUT http://localhost:4000/api/v1/settings/alerts -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value":{"lowCash":15000000,"bigExpense":5000000,"costPerGalon":12000}}'
# Known keys: alerts, hrBudget, hrRates (BPJS rate table).
```

### Reports (dashboard aggregations) — `reports` capability

```bash
curl "http://localhost:4000/api/v1/reports/summary?dateFrom=2026-06-01&dateTo=2026-06-30" -H "Authorization: Bearer $TOKEN"
curl http://localhost:4000/api/v1/reports/cashflow -H "Authorization: Bearer $TOKEN"
curl "http://localhost:4000/api/v1/reports/breakdown?type=expense" -H "Authorization: Bearer $TOKEN"
```

### Users (administration) — `gm` role only

```bash
curl http://localhost:4000/api/v1/users -H "Authorization: Bearer $GM_TOKEN"
curl -X POST http://localhost:4000/api/v1/users -H "Authorization: Bearer $GM_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Siti","username":"siti","password":"secret123","role":"adminfin"}'
```

## Role / capability matrix

Enforced server-side, mirroring `finance-store.js`:

| Capability | owner | gm | hrd | finance | adminfin |
|------------|:---:|:---:|:---:|:---:|:---:|
| read cash book (`cashflow`) | ✓ | ✓ |  | ✓ | ✓ |
| add/edit/delete entries | | ✓ | | ✓ | |
| accounts/categories/settings write | | ✓ | | ✓ | |
| setoran | | ✓ | | ✓ | ✓ |
| employees (HRD) | | ✓ | ✓ | | |
| payroll view | | ✓ | ✓ | ✓ | |
| payroll post (cash book) | | ✓ | | ✓ | |
| reports | ✓ | ✓ | | ✓ | |
| user administration | | ✓ | | | |

## Frontend integration (cloud adapter)

The prototype (`../AirRO Water - Daily Finance Manager.html`) is wired to this
backend via two browser scripts loaded before the React code:

- **`api.js`** (`window.API`) — fetch client with JWT persistence + graceful
  offline detection. Base URL defaults to `http://localhost:4000/api/v1`
  (override with `window.AIRRO_API_BASE`).
- **`cloud.js`** (`window.CLOUD`) — swaps the implementation of a few `FS`
  load/save functions so reads come from a backend-hydrated cache and writes go
  to **both** localStorage (offline mirror) and the backend (debounced bulk
  sync). No React components were changed.

**Auth (backend-only):** the login screen authenticates **exclusively** against
`POST /auth/login`; on success it stores the JWT and hydrates. There is **no
local/PIN fallback** and **no demo accounts in the client source** — if the
backend is unreachable, login is blocked with a "can't reach server" message.
Set the API base for your deployment in `app-config.js` (`window.AIRRO_API_BASE`).

**Synced to the backend now:** accounts and transfers (via the `PUT
/:resource/sync` replace-collection endpoints, keyed on client ids) and the
finance UI settings (stored as a single `financeUI` blob in `/settings`).

**Still localStorage-only** (needs the deeper "Everything" pass — schema fields
+ per-resource adapters): cash-book **entries** (carry `proof` blobs, client
tags like `setoranDay`/`payroll`, and many are *derived* client-side),
**setoran** (`galon`/`proof` not modelled), **employees** (payroll-month inputs
+ attendance), **categories** (grouped income/expense shape), and **users**
(PIN-based). These continue to work exactly as before.

To run the integrated app: start this server, then serve the project root over
HTTP (`python -m http.server 8765` from the parent folder) and open it — the two
origins talk via CORS (`CORS_ORIGIN` defaults to `*`).

## Going to production (publishing checklist)

1. **Strong JWT secret.** Set `JWT_SECRET` to a 32+ char random value. The server
   **refuses to boot** in production with a missing/placeholder/short secret.
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **No demo users.** Set `SEED_DEMO_USERS="false"` and a strong
   `SEED_OWNER_PASSWORD`, then seed. Only a single full-access **admin** account
   (role `gm`, username from `SEED_OWNER_USERNAME`) is created; it administers the
   rest via the `/users` API. If you leave `SEED_OWNER_PASSWORD` unset, the seed
   generates a strong password and prints it once.
3. **Lock CORS.** Set `CORS_ORIGIN` to your site origin (e.g.
   `https://app.yourdomain.com`). The server warns if it's `*` in production.
4. **Point the frontend at the API.** Edit `app-config.js` →
   `window.AIRRO_API_BASE = 'https://api.yourdomain.com/api/v1'` (or `'/api/v1'`
   if same-origin behind a proxy). Serve everything over **HTTPS**.
5. **Run as production.** `NODE_ENV=production node src/server.js`. Consider
   switching the datasource to PostgreSQL (see above) and using
   `prisma migrate deploy`.

```bash
# example production seed
SEED_DEMO_USERS=false SEED_OWNER_USERNAME=admin SEED_OWNER_PASSWORD='<strong>' \
  node prisma/seed.js
```

## Tradeoffs

- **SQLite locally, Postgres in prod** — zero-setup dev; one `provider` line to
  switch. Enums are stored as validated strings so the schema stays identical
  across both engines.
- **Integer rupiah** — avoids float rounding on money; fine because IDR has no
  minor unit in practice here.
- **`db push` for dev/test, migrations for prod** — fast iteration now; switch to
  `prisma migrate` once the schema stabilises for a real migration history.
- **JWT (stateless)** — simple and frontend-friendly; no server-side revocation
  yet (add a token denylist or short TTL + refresh if needed).
