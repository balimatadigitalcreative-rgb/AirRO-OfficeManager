# Satelit, ganti rugi → aset galon, setujui koreksi sendiri — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three owner decisions of 2026-10-02:
1. Atur titik gets a **Peta / Satelit** switch, using Esri World Imagery with the owner's own ArcGIS API key.
2. A **ganti rugi** for a broken or lost gallon **writes those gallons off the gallon asset pool** automatically. The exception is the new payment choice **"Diganti galon baru"**: the customer hands over a new gallon, no money changes hands and the pool stays whole. A void undoes the write-off. Old ganti rugi are written off through an owner-reviewed preview-then-apply.
3. Anyone holding **approval access may approve their own correction, cancellation or customer move**. Holding only correction access means submit only.

**Architecture:**
- **Satellite.**
  - The key is stored in the owner's field rules (`satelliteKey`) and reaches the phone through field-context.
  - Atur titik swaps Leaflet tile layers.
- **Write-off.**
  - Uses one shared write-off/restore core in `depreciation.service.js`.
  - It is recorded per transaction in a new `GallonPoolWriteOff` table, so it is idempotent, auditable and reversible.
  - The pool's accumulated depreciation that was written off is kept in a new `FixedAsset.writtenOffAccum`, so register book values stay true.
  - `distribution.service.js` calls `syncGantiRugiWriteOff(txn)` at every point where a ganti rugi is created, voided or un-voided.
- **Self-approval.** A koreksi-only flag in `actorSnap` / `assertSelfApprovalAllowed`:
  - correction, void and reassign need only `distribusiApprove`;
  - disputes, cost standards and payroll still need `distribusiApproveSelf`;
  - per-user ceilings still apply.
  - It also closes the gap where a GM could grant `distribusiApproveSelf` through a role template.

**Tech Stack:**
- Express + Prisma (SQLite), with a migration;
- zod;
- React 18 UMD in a one-scope bundle;
- Leaflet 1.9.4;
- Jest (server deps only; static tests use plain `fs` reads).

**Spec:** `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md` (§3.6 ganti rugi, §4 Atur titik, self-approval notes). The owner decisions above are added to the spec in Task 7.

## Global Constraints

- **Owner rules stand.**
  - A photo is mandatory on every ganti rugi, including "Diganti galon baru".
  - Ganti rugi needs no approval.
  - Every correction needs approval. The approver may be the requester only when they hold approval access.
- **Money and journals.**
  - All journals go through `acc.postJournal`, which is idempotent by `(sourceType, sourceId)`. A write-off always has its own unique sourceId.
  - Never post into a closed period. If the transaction's period is closed, the write-off is dated today.
  - Journals post only when `config.accountingV2` is on. Pool quantity, cost and salvage changes happen either way, as `gallonPoolLoss` does today.
- **Code conventions.**
  - Field screens: one bundle scope, names `Fld*`/`fld*`/`FLD*`.
  - i18n: every new `fld.*` key goes in EN and ID, inserted after the anchors `'fld.koreksiT': 'Correct transaction',` and `'fld.koreksiT': 'Koreksi transaksi',`.
  - No apostrophes in key text.
- **Tests.**
  - Run from `server/`: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand <files>`.
  - Never run two jest processes at once.
  - Before 08:00 WITA, prove the date-fragile files with `APP_TZ=UTC`.
  - Server tests must not require root `node_modules` (deploy GATE 3).
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push until asked.

## Review Focus

1. **A ganti rugi with no gallon pool registered** (no pooled `galon` FixedAsset, or quantity 0). The sale must still save; the write-off is simply skipped and reported by the backfill preview. It must never be a 500.
2. **Two write-offs on the same day for the same quantity** (old `gallonPoolLoss` bug: sourceId collision). Both must post; nothing is silently skipped.
3. **Void then un-void of a ganti rugi.** The pool goes back and forth exactly; the journals net to zero, then re-post.
4. **Written-off accumulated depreciation.** The register's book value (`cost − (Σ entries − writtenOffAccum)`) equals the 1-1440 − 1-1900 balances after a write-off, and after a later month's depreciation run.
5. **Satellite with an invalid or expired key.** The tiles fail to load, the map stays usable on the Peta layer, and the owner sees why.

---

### Task 1: Self-approval of koreksi by anyone with approval access (+ role-template guard)

**Files:**
- Modify: `server/src/services/distribution.service.js` (`actorSnap`, `assertSelfApprovalAllowed`, the correction/void approve site ~line 2119, the reassign approve site ~line 2344)
- Modify: `server/src/services/role.service.js`, `server/src/controllers/role.controller.js` (owner-only guard)
- Modify: `distribution.jsx` (two own-request blocks), `finance-users.jsx` (cap description)
- Test: `server/tests/self-approval.test.js`, `server/tests/reassign.test.js` (update the superseded assertions), new `server/tests/self-approval-koreksi.test.js`

**Interfaces:**
- Produces:
  - `actorSnap(actor).canApproveOwnKoreksi` (boolean = live `distribusiApprove`);
  - `assertSelfApprovalAllowed(snap, amount, noun, opts)` with `opts.koreksi`.

- [ ] **Step 1: Write the failing tests.** Create `server/tests/self-approval-koreksi.test.js`:

```js
'use strict';
// SELF-APPROVAL OF KOREKSI (owner, 2026-10-02): whoever holds approval access may approve their OWN
// correction / cancellation / customer move (badged selfApproved + audited, per-user ceiling still
// applies). Correction access alone = submit only. Disputes / cost standards / payroll keep the
// separate distribusiApproveSelf waiver, which only the Pemilik may grant — also through a role template.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
let owner, gm, cid;
const reg = (b) => request(app).post('/api/v1/auth/register').send(b).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const mkUser = async (username, perms) => {
  const u = await reg({ name: username, username, password: 'secret123', role: 'finance' });
  await request(app).patch('/api/v1/users/' + u.user.id).set(auth(owner)).send({ permissions: perms });
  return login(username);
};
const mkTxn = async (qty) => (await request(app).post(`${D}/transactions`).set(auth(owner)).send({ customerId: cid, qty, method: 'lunas', txnDate: today, gallonOut: qty, gallonIn: 0 })).body.data.id;
const correct = (tok, id, body) => request(app).post(`${D}/transactions/${id}/corrections`).set(auth(tok)).send(body);
const approve = (tok, id) => request(app).post(`${D}/change-requests/${id}/approve`).set(auth(tok)).send({});

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Pemilik', username: 'sk_owner', password: 'secret123', role: 'owner' })).token;
  gm = (await reg({ name: 'GM', username: 'sk_gm', password: 'secret123', role: 'gm' })).token;
  cid = (await request(app).post(`${D}/customers`).set(auth(owner)).send({ name: 'Toko SK', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

it('approval access (no separate waiver) → may approve their OWN correction; it is badged selfApproved', async () => {
  const tok = await mkUser('sk_appr', { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: true });
  const cr = (await correct(tok, await mkTxn(5), { reason: 'salah jumlah', qty: 3, unitPrice: 6000, gallonOut: 3 })).body.data;
  const r = await approve(tok, cr.id);
  expect(r.status).toBe(200);
  expect(r.body.data.selfApproved).toBe(true);
});

it('correction access only → may submit but NOT approve (route refuses)', async () => {
  const tok = await mkUser('sk_kor', { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: false });
  const cr = (await correct(tok, await mkTxn(4), { reason: 'salah jumlah', qty: 2, unitPrice: 6000, gallonOut: 2 })).body.data;
  expect(cr.status).toBe('pending');
  expect((await approve(tok, cr.id)).status).toBe(403);
});

it('a per-user ceiling still holds for koreksi self-approval', async () => {
  const u = await reg({ name: 'Batas', username: 'sk_lim', password: 'secret123', role: 'finance' });
  await request(app).patch('/api/v1/users/' + u.user.id).set(auth(owner)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: true, maxSelfApproveAmount: 10000 } });
  const tok = await login('sk_lim');
  const cr = (await correct(tok, await mkTxn(5), { reason: 'besar', qty: 4, unitPrice: 6000, gallonOut: 4 })).body.data;   // 24.000 > 10.000
  const r = await approve(tok, cr.id);
  expect(r.status).toBe(403);
  expect(r.body.error.details && r.body.error.details.overSelfApproveLimit).toBe(true);
});

it('a GM cannot slip distribusiApproveSelf into a role template; the Pemilik can', async () => {
  const bad = await request(app).post('/api/v1/roles').set(auth(gm)).send({ name: 'Penyetuju Mandiri', permissions: { distribusiApprove: true, distribusiApproveSelf: true } });
  expect(bad.status).toBe(403);
  const ok = await request(app).post('/api/v1/roles').set(auth(owner)).send({ name: 'Penyetuju Mandiri', permissions: { distribusiApprove: true, distribusiApproveSelf: true } });
  expect(ok.status).toBe(201);
  const up = await request(app).patch('/api/v1/roles/' + ok.body.data.id).set(auth(gm)).send({ permissions: { distribusiApprove: true, distribusiApproveSelf: false } });
  expect(up.status).toBe(403);
});
```

Also add one static assertion for the old UI and the cap text, appended to the same file:

```js
it('the office UI lets an approver decide their own koreksi; the waiver text names what it still covers', () => {
  const fs = require('fs'); const path = require('path'); const root = path.join(__dirname, '..', '..');
  const dist = fs.readFileSync(path.join(root, 'distribution.jsx'), 'utf8');
  expect(dist).toMatch(/const KOREKSI_KINDS = \['correction', 'void', 'reassign'\];/);
  expect(dist).toMatch(/if \(own && !canApproveSelf && !KOREKSI_KINDS\.includes\(r\.kind\)\) \{/);
  expect(dist).not.toMatch(/if \(own && !canApproveSelf\) return <div className="cd-pending-own">/);
  expect(fs.readFileSync(path.join(root, 'finance-users.jsx'), 'utf8')).toMatch(/sengketa, standar biaya dan penggajian/);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/self-approval-koreksi.test.js`
Expected:
- FAIL: the first test gets 403 "…Anda sendiri".
- FAIL: the role test gets 201 for the GM.
- FAIL: the static test fails.
- PASS: the correction-only test already passes, because it guards existing behaviour.

- [ ] **Step 3: Server.** In `actorSnap` add, next to `out.canApproveSelf`:

```js
      // KOREKSI (owner, 2026-10-02): approval access is enough to approve one's OWN correction / void /
      // customer move (still badged + audited, per-user ceiling still applies); the separate waiver below
      // keeps covering disputes, cost standards and payroll.
      out.canApproveOwnKoreksi = !!perms.distribusiApprove;
```

and `canApproveOwnKoreksi: false` in the `out` initialiser. Replace `assertSelfApprovalAllowed` with:

```js
function assertSelfApprovalAllowed(snap, amount, noun, opts) {
  const allowed = opts && opts.koreksi ? !!(snap.canApproveOwnKoreksi || snap.canApproveSelf) : !!snap.canApproveSelf;
  if (!allowed) {
    throw ApiError.forbidden(`Anda tidak boleh menyetujui ${noun} Anda sendiri.`);
  }
  const limit = snap.selfApproveLimit || 0;
  if (limit > 0 && Math.abs(amount || 0) > limit) {
    throw ApiError.forbidden(
      `Nominal (${Math.abs(amount || 0)}) melebihi batas persetujuan mandiri Anda (${limit}) — pengajuan menunggu penyetuju lain.`,
      { selfApproveLimit: limit, amount: Math.abs(amount || 0), overSelfApproveLimit: true },
    );
  }
}
```

(Update the comment block above it: koreksi → approval access; others → the waiver.)

At the correction/void approve site, change `assertSelfApprovalAllowed(snap, txn.amount, 'pengajuan');` to `assertSelfApprovalAllowed(snap, txn.amount, 'pengajuan', { koreksi: true });`. At the reassign approve site (`'pemindahan'`), add the same `{ koreksi: true }`.

- [ ] **Step 4: Role-template guard.**
  - In `role.controller.js`, pass the actor: `service.create(req.body, req.user)` and `service.update(req.params.id, req.body, req.user)`.
  - In `role.service.js`, add the guard below and call `await assertWaiverGrant(null, permissions, actor)` in `create` (before the insert) and `await assertWaiverGrant(existing.permissions, permissions, actor)` in `update`, where `existing` is the role row already loaded; use the existing find, kept in a variable.

```js
// distribusiApproveSelf (+ its ceiling) is a Pemilik-only grant — per user (user.service) AND through a
// role template (else a manageUsers holder, e.g. a GM, could hand it to a whole role).
const WAIVER_KEYS = ['distribusiApproveSelf', 'maxSelfApproveAmount'];
async function assertWaiverGrant(beforeJson, after, actor) {
  if (after == null) return;
  let before = {}; try { before = beforeJson ? JSON.parse(beforeJson) : {}; } catch (e) { before = {}; }
  const changed = WAIVER_KEYS.some((k) => JSON.stringify(before[k] === undefined ? null : before[k]) !== JSON.stringify(after[k] === undefined ? null : after[k]));
  if (!changed) return;
  const u = actor && actor.id ? await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true } }) : null;
  if (!(u && require('../config/permissions').isOwnerRole(u.role))) throw ApiError.forbidden('Hanya Pemilik yang boleh memberi izin menyetujui pengajuan sendiri.');
}
```

- [ ] **Step 5: Office UI + text.**
  - In `distribution.jsx` add near the top-level helpers: `const KOREKSI_KINDS = ['correction', 'void', 'reassign'];   // owner 2026-10-02: approval access is enough for one's own koreksi`.
  - In `DistCustomers`' pending box (correction/void of a transaction), delete the line `if (own && !canApproveSelf) return <div className="cd-pending-own">{trD('cd.pendOwn')}</div>;`. The box is already inside `canApprove &&`.
  - In `DistChangeRequests` change `if (own && !canApproveSelf) {` to `if (own && !canApproveSelf && !KOREKSI_KINDS.includes(r.kind)) {`.
  - In `finance-users.jsx`, change the `distribusiApproveSelf` description to: `'Menyetujui pengajuan sengketa, standar biaya dan penggajian yang Anda ajukan sendiri — pelonggaran pemisahan tugas. (Koreksi/pembatalan/pindah pelanggan milik sendiri cukup dengan akses Setujui Perubahan.) Hanya Pemilik yang boleh memberi; setiap persetujuan mandiri ditandai & dicatat.'`

- [ ] **Step 6: Update the superseded assertions.**
  - `self-approval.test.js`, "WITHOUT distribusiApproveSelf, a requester approving their OWN request is rejected": this now pins the old rule. Change it to a dispute (still waiver-only) **or** flip it to expect 200 with `selfApproved: true`, keeping the "different approver → selfApproved false" half. Rule which one in the ledger, choosing the smallest change that still guards a real rule.
  - `reassign.test.js`, "the requester can NOT approve their own request without distribusiApproveSelf": change it to "a requester with correction access only cannot approve their own move". Give the staff `distribusiApprove: false` and expect 403 from the route.

- [ ] **Step 7: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/self-approval-koreksi.test.js tests/self-approval.test.js tests/reassign.test.js tests/koreksi-final.test.js tests/field-koreksi-final.test.js tests/role*.test.js`
Expected: PASS. If there are no `role*` tests, drop that pattern.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/distribution.service.js server/src/services/role.service.js server/src/controllers/role.controller.js distribution.jsx finance-users.jsx server/tests/self-approval-koreksi.test.js server/tests/self-approval.test.js server/tests/reassign.test.js
git commit -m "feat(distribusi): approval access may approve one's own koreksi (owner 2026-10-02); the self-approve waiver stays Pemilik-only, also via role templates"
```

---

### Task 2: Gallon pool write-off engine (schema + shared core + `gallonPoolLoss` fixes)

**Files:**
- Modify: `server/prisma/schema.prisma` (`FixedAsset.writtenOffAccum`, new `GallonPoolWriteOff`)
- Create: `server/prisma/migrations/20261004100000_gallon_pool_writeoff/migration.sql`
- Modify: `server/src/services/depreciation.service.js`
- Test: new `server/tests/gallon-pool-writeoff.test.js`

**Interfaces:**
- Produces (exported from depreciation.service):
  - `findGallonPool(fleetId, db)` → the pool `FixedAsset` or null;
  - `writeOffPool({ asset, qty, date, kind, sourceType, sourceId, actor, businessUnitId }, tx)` → `{ cost, accum, salvage, journalId }`;
  - `restorePool({ asset, cost, accum, salvage, qty, date, sourceType, sourceId, actor }, tx)`;
  - `accumulatedOf(asset)` now takes the asset row (or id) and returns Σ entries − `writtenOffAccum`.

- [ ] **Step 1: Write the failing test.** Create `server/tests/gallon-pool-writeoff.test.js`:

```js
'use strict';
process.env.ACCOUNTING_V2 = 'true';
// GALLON POOL WRITE-OFF CORE — removing N gallons from the pooled gallon asset takes their share of cost,
// accumulated depreciation AND salvage; the written-off accumulated is remembered so the register's book
// value stays equal to the ledger (1-1440 − 1-1900). Two write-offs of the same size on the same day both post.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const dep = require('../src/services/depreciation.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let owner, poolId;
const bal = async (code) => (await prisma.journalLine.findMany({ where: { chartAccount: { code } } })).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);

beforeAll(async () => {
  await resetDb();
  owner = (await request(app).post('/api/v1/auth/register').send({ name: 'Pemilik', username: 'pw_owner', password: 'secret123', role: 'owner' })).body.token;
  const a = await request(app).post('/api/v1/accounting/assets').set(auth(owner)).send({ code: 'GAL-1', name: 'Galon', category: 'galon', acquisitionDate: '2026-01-15', acquisitionCost: 1000000, salvageValue: 100000, usefulLifeMonths: 20, quantity: 100 });
  poolId = a.body.data.id;
  await request(app).post('/api/v1/accounting/depreciation/run').set(auth(owner)).send({ asOf: '2026-05-31' });   // 5 months posted
});
afterAll(() => prisma.$disconnect());

it('writes off its share of cost, accumulated and salvage; the register book value equals the ledger', async () => {
  const before = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  const accum = await dep.accumulatedOf(before);
  await prisma.$transaction((tx) => dep.writeOffPool({ asset: before, qty: 10, date: '2026-06-02', kind: 'rusak', sourceType: 'gallon_pool_loss', sourceId: 't:1', actor: null }, tx));
  const after = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  expect(after.quantity).toBe(90);
  expect(Number(after.acquisitionCost)).toBe(900000);
  expect(Number(after.salvageValue)).toBe(90000);
  expect(Number(after.writtenOffAccum)).toBe(Math.round(accum / 100) * 10);
  const reg = (await request(app).get('/api/v1/accounting/assets/' + poolId).set(auth(owner))).body.data;
  expect(reg.bookValue).toBe((await bal('1-1440')) + (await bal('1-1900')));
});

it('two write-offs of the same size on the same day both post (no sourceId collision)', async () => {
  const a = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  await request(app).post('/api/v1/accounting/assets/' + poolId + '/pool-loss').set(auth(owner)).send({ qty: 2, kind: 'rusak', date: '2026-06-03' });
  await request(app).post('/api/v1/accounting/assets/' + poolId + '/pool-loss').set(auth(owner)).send({ qty: 2, kind: 'rusak', date: '2026-06-03' });
  expect((await prisma.fixedAsset.findUnique({ where: { id: poolId } })).quantity).toBe(a.quantity - 4);
  expect(await prisma.journalEntry.count({ where: { sourceType: 'gallon_pool_loss', date: '2026-06-03' } })).toBe(2);
});

it('restorePool puts back exactly what was taken', async () => {
  const a = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  const w = await prisma.$transaction((tx) => dep.writeOffPool({ asset: a, qty: 5, date: '2026-06-04', kind: 'rusak', sourceType: 'gallon_pool_loss', sourceId: 't:2', actor: null }, tx));
  const mid = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  await prisma.$transaction((tx) => dep.restorePool({ asset: mid, qty: 5, cost: w.cost, accum: w.accum, salvage: w.salvage, date: '2026-06-04', sourceType: 'gallon_pool_loss', sourceId: 't:2', actor: null }, tx));
  const back = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  expect(back.quantity).toBe(a.quantity);
  expect(Number(back.acquisitionCost)).toBe(Number(a.acquisitionCost));
  expect(Number(back.salvageValue)).toBe(Number(a.salvageValue));
  expect(Number(back.writtenOffAccum)).toBe(Number(a.writtenOffAccum));
});

it('findGallonPool prefers the armada\'s own pool, else any active gallon pool, else null', async () => {
  expect((await dep.findGallonPool('DK 9')).id).toBe(poolId);
  await prisma.fixedAsset.update({ where: { id: poolId }, data: { status: 'dilepas' } });
  expect(await dep.findGallonPool('DK 9')).toBeNull();
  await prisma.fixedAsset.update({ where: { id: poolId }, data: { status: 'aktif' } });
});
```

(Confirm the depreciation-run route path in `server/src/routes/accounting.routes.js` and use the real one. Ledger the ruling if it differs.)

- [ ] **Step 2: Run it to make sure it fails.** Expected FAIL: `dep.writeOffPool is not a function` / `writtenOffAccum` unknown.

- [ ] **Step 3: Schema + migration.** In `FixedAsset` add after `quantity`:

```prisma
  writtenOffAccum      BigInt   @default(0)            // accumulated depreciation removed by partial pool write-offs (register = Σ entries − this)
```

and add the model:

```prisma
// One gallon-pool write-off caused by a ganti rugi transaction (owner 2026-10-02): what was taken from
// the pool, so a void can put back exactly that. UNIQUE transactionId = one live write-off per txn.
model GallonPoolWriteOff {
  id             String    @id @default(cuid())
  assetId        String
  transactionId  String    @unique
  qty            Int
  cost           BigInt
  accum          BigInt
  salvage        BigInt
  date           String
  version        Int       @default(1)
  reversedAt     DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  @@index([assetId])
}
```

`migration.sql`:

```sql
-- Gallon pool write-off (owner 2026-10-02): remembered written-off accumulated + one write-off row per ganti rugi.
ALTER TABLE "FixedAsset" ADD COLUMN "writtenOffAccum" BIGINT NOT NULL DEFAULT 0;
CREATE TABLE "GallonPoolWriteOff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "cost" BIGINT NOT NULL,
    "accum" BIGINT NOT NULL,
    "salvage" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reversedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "GallonPoolWriteOff_transactionId_key" ON "GallonPoolWriteOff"("transactionId");
CREATE INDEX "GallonPoolWriteOff_assetId_idx" ON "GallonPoolWriteOff"("assetId");
```

Run `npx prisma generate` (from `server/`). The test helpers' `resetDb` applies migrations the way the suite already does: check `tests/helpers.js` / globalSetup and follow it.

- [ ] **Step 4: Core in `depreciation.service.js`.**

Replace `accumulatedOf` with:

```js
// Posted accumulated depreciation for an asset: Σ posted DepreciationEntry.amount, minus what partial
// pool write-offs took out (writtenOffAccum). Accepts the asset row or its id.
async function accumulatedOf(assetOrId) {
  const a = typeof assetOrId === 'string' ? await prisma.fixedAsset.findUnique({ where: { id: assetOrId }, select: { id: true, writtenOffAccum: true } }) : assetOrId;
  if (!a) return 0;
  const rows = await prisma.depreciationEntry.findMany({ where: { assetId: a.id }, select: { amount: true } });
  return rows.reduce((s, r) => s + n(r.amount), 0) - n(a.writtenOffAccum);
}
```

(Every existing caller passes an id or the row; check `assetClient`, `disposeAsset` and `gallonPoolLoss` and pass the row where you have it.)

Add, before `module.exports`:

```js
// ── POOL WRITE-OFF CORE (owner 2026-10-02). Takes qty gallons' share of cost, accumulated depreciation and
// salvage out of the pool: Dr Akumulasi (share) + Dr Rugi (book value) / Cr Aset (cost share). The share
// of accumulated is remembered on the asset (writtenOffAccum) so the register keeps matching the ledger.
async function findGallonPool(fleetId, db = prisma) {
  const pools = await db.fixedAsset.findMany({ where: { pooled: true, category: 'galon', status: 'aktif', quantity: { gt: 0 } }, orderBy: [{ createdAt: 'asc' }] });
  return pools.find((p) => fleetId && p.fleetId === fleetId) || pools.find((p) => !p.fleetId) || pools[0] || null;
}
async function poolShares(asset, qty) {
  const q = Math.max(1, asset.quantity);
  const cost = n(asset.acquisitionCost); const salvage = n(asset.salvageValue);
  const accumulated = Math.max(0, await accumulatedOf(asset));
  const take = Math.min(qty, asset.quantity);
  return {
    take,
    cost: take >= asset.quantity ? cost : Math.round(cost / q) * take,
    accum: take >= asset.quantity ? accumulated : Math.min(Math.round(accumulated / q) * take, accumulated),
    salvage: take >= asset.quantity ? salvage : Math.round(salvage / q) * take,
  };
}
async function writeOffPool({ asset, qty, date, kind, sourceType, sourceId, actor, businessUnitId }, tx) {
  const s = await poolShares(asset, int(qty));
  if (!s.take) return { cost: 0, accum: 0, salvage: 0, journalId: null, qty: 0 };
  const codes = await assetCodes(asset);
  let je = null;
  if (config.accountingV2) {
    const f = asset.fleetId || '';
    const lines = [{ code: codes.assetCode, credit: s.cost, fleetId: f }];
    if (s.accum) lines.push({ code: codes.accCode, debit: s.accum, fleetId: f });
    if (s.cost - s.accum) lines.push({ code: LOSS, debit: s.cost - s.accum, fleetId: f });
    je = await acc.postJournal({ sourceType, sourceId, date, description: `Galon ${kind === 'hilang' ? 'hilang' : 'rusak'} dihapus dari aset: ${asset.name} × ${s.take}`, actor, businessUnitId: businessUnitId || asset.businessUnitId, lines }, tx);
  }
  await tx.fixedAsset.update({ where: { id: asset.id }, data: {
    quantity: asset.quantity - s.take,
    acquisitionCost: BigInt(Math.max(0, n(asset.acquisitionCost) - s.cost)),
    salvageValue: BigInt(Math.max(0, n(asset.salvageValue) - s.salvage)),
    writtenOffAccum: BigInt(n(asset.writtenOffAccum) + s.accum),
  } });
  return { cost: s.cost, accum: s.accum, salvage: s.salvage, qty: s.take, journalId: je ? je.id : null };
}
async function restorePool({ asset, qty, cost, accum, salvage, date, sourceType, sourceId, actor }, tx) {
  if (config.accountingV2) {
    await acc.reverseJournal({ sourceType, sourceId, reversalSourceType: sourceType + '_rev', reversalSourceId: sourceId + ':rev', date, description: `Pembatalan hapus galon: ${asset.name} × ${qty}`, actor }, tx);
  }
  await tx.fixedAsset.update({ where: { id: asset.id }, data: {
    quantity: asset.quantity + int(qty),
    acquisitionCost: BigInt(n(asset.acquisitionCost) + n(cost)),
    salvageValue: BigInt(n(asset.salvageValue) + n(salvage)),
    writtenOffAccum: BigInt(Math.max(0, n(asset.writtenOffAccum) - n(accum))),
  } });
}
```

(Check `acc.reverseJournal`'s exact signature at `accounting.service.js:203` and match it. Ledger any adjustment.)

Rewrite `gallonPoolLoss`'s accounting so it uses the core and a unique sourceId:

```js
  const updated = await prisma.$transaction(async (tx) => {
    const n0 = await tx.journalEntry.count({ where: { sourceType: 'gallon_pool_loss', sourceId: { startsWith: `${id}:${date}:` } } });
    await writeOffPool({ asset: a, qty, date, kind, sourceType: 'gallon_pool_loss', sourceId: `${id}:${date}:${qty}:${n0 + 1}`, actor }, tx);
    return tx.fixedAsset.findUnique({ where: { id } });
  });
```

Keep its ledger `reportGallonDamage` call: a manual pool loss is a depot event with no ganti rugi movement. Keep its return shape: compute `loss` from the core's result.

Export `findGallonPool, writeOffPool, restorePool, accumulatedOf`.

- [ ] **Step 5: Run the test + the asset suite**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/gallon-pool-writeoff.test.js tests/fixed-assets.test.js tests/accounting*.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261004100000_gallon_pool_writeoff server/src/services/depreciation.service.js server/tests/gallon-pool-writeoff.test.js
git commit -m "feat(accounting): gallon pool write-off core — cost/accumulated/salvage shares, remembered written-off accumulated, restore, unique pool-loss sources"
```

---

### Task 3: Ganti rugi writes off the pool; "Diganti galon baru" keeps it (server + practice copy)

**Files:**
- Modify: `server/src/controllers/distribution.controller.js` (`gallonDamageSchema` payMethod enum)
- Modify: `server/src/services/distribution.service.js` (`gallonDamageCharge`, new `syncGantiRugiWriteOff`, every void/un-void site of a transaction, ledger `totalEffect` for `replace_customer`)
- Modify: `server/src/services/accounting.service.js` (`distTxnLines`: a no-money ganti rugi posts nothing)
- Modify: `dist-field-sandbox.js` (`gallonDamage`)
- Test: `server/tests/gallon-damage-charge.test.js` (append), `server/tests/field-sandbox.test.js` (append)

**Interfaces:**
- Consumes: `findGallonPool`, `writeOffPool`, `restorePool` (Task 2).
- Produces:
  - `syncGantiRugiWriteOff(txn, actor, tx)`, exported for Task 4;
  - payMethod `'ganti_galon'` (txn: `amount 0`, `method 'lunas'`, `payMethod 'ganti_galon'`);
  - movement type `replace_customer`.

- [ ] **Step 1: Write the failing tests.** Append to `server/tests/gallon-damage-charge.test.js`:

```js
describe('owner 2026-10-02: ganti rugi takes the gallons off the asset pool, unless replaced by a new gallon', () => {
  let poolId, owner;
  beforeAll(async () => {
    owner = (await request(app).post('/api/v1/auth/register').send({ name: 'Pemilik', username: 'gd_owner', password: 'secret123', role: 'owner' })).body.token;
    poolId = (await request(app).post('/api/v1/accounting/assets').set(auth(owner)).send({ code: 'GAL-P', name: 'Galon', category: 'galon', acquisitionDate: '2026-01-01', acquisitionCost: 400000, salvageValue: 0, usefulLifeMonths: 40, quantity: 100 })).body.data.id;
  });
  const pool = () => prisma.fixedAsset.findUnique({ where: { id: poolId } });

  it('a cash ganti rugi writes 1 gallon off the pool (Cr 1-1440, Dr 6-8500) once, idempotently', async () => {
    const r = await charge({ qty: 1, kind: 'retak', payMethod: 'tunai', clientRef: 'gr-pool-0001' });
    expect(r.status).toBe(201);
    expect((await pool()).quantity).toBe(99);
    const w = await prisma.gallonPoolWriteOff.findUnique({ where: { transactionId: r.body.data.transaction.id } });
    expect(w.qty).toBe(1);
    expect(Number(w.cost)).toBe(4000);
    const again = await charge({ qty: 1, kind: 'retak', payMethod: 'tunai', clientRef: 'gr-pool-0001' });   // replay
    expect(again.body.data.replay).toBe(true);
    expect((await pool()).quantity).toBe(99);
  });

  it('"Diganti galon baru": no money, no journal, the pool and the good stock stay whole', async () => {
    const before = await gallon();
    const q0 = (await pool()).quantity;
    const r = await charge({ qty: 1, kind: 'pecah', payMethod: 'ganti_galon' });
    expect(r.status).toBe(201);
    const t = r.body.data.transaction;
    expect(Number(t.amount)).toBe(0);
    expect(t.payMethod).toBe('ganti_galon');
    expect((await pool()).quantity).toBe(q0);
    expect(await prisma.journalEntry.count({ where: { sourceType: 'dist_txn', sourceId: t.id } })).toBe(0);
    const after = await gallon();
    expect(after.stock.totalOwned).toBe(before.stock.totalOwned);
    expect(after.stock.rusakHilang).toBe(before.stock.rusakHilang + 1);
    expect(after.invariant.ok).toBe(true);
  });

  it('voiding a ganti rugi puts the gallons back in the pool; the journals net to zero', async () => {
    const r = await charge({ qty: 1, kind: 'pecah', payMethod: 'transfer' });
    const id = r.body.data.transaction.id;
    const q1 = (await pool()).quantity;
    const v = await request(app).post(`${D}/transactions/${id}/void`).set(auth(gm)).send({ reason: 'salah catat' });
    expect([200, 201]).toContain(v.status);
    expect((await pool()).quantity).toBe(q1 + 1);
    expect((await prisma.gallonPoolWriteOff.findUnique({ where: { transactionId: id } })).reversedAt).not.toBeNull();
  });

  it('with no gallon pool registered the ganti rugi still saves (nothing to write off)', async () => {
    await prisma.fixedAsset.update({ where: { id: poolId }, data: { status: 'dilepas' } });
    const r = await charge({ qty: 1, kind: 'pecah', payMethod: 'tunai' });
    expect(r.status).toBe(201);
    expect(await prisma.gallonPoolWriteOff.findUnique({ where: { transactionId: r.body.data.transaction.id } })).toBeNull();
    await prisma.fixedAsset.update({ where: { id: poolId }, data: { status: 'aktif' } });
  });
});
```

(Use the real direct-void route path. Find it with `grep -n "void" server/src/routes/distribution.routes.js`. A GM may void directly. Ledger the path if it differs, and check the customer still holds enough gallons for these charges; top up with a delivery in `beforeAll` if needed.)

Append to `server/tests/field-sandbox.test.js` (use the file's existing setup helpers for a practice adaptor with a customer holding gallons and a price):

```js
it('practice copy: "Diganti galon baru" costs nothing and needs no price', async () => {
  // using the file's helper that opens a practice adaptor with one customer holding gallons
  const { api, cid } = await practiceWithHeldGallons();
  const r = await api.gallonDamage(cid, { qty: 1, kind: 'pecah', payMethod: 'ganti_galon', photoId: await practicePhoto(api) });
  expect(r.transaction.amount).toBe(0);
  expect(r.transaction.payMethod).toBe('ganti_galon');
});
```

(If the file has no such helpers, build the adaptor the way its existing gallonDamage test does and ledger the shape.)

- [ ] **Step 2: Run them to make sure they fail.** Expected FAIL: no pool write-off; `ganti_galon` rejected by zod (400).

- [ ] **Step 3: Server.**

1. In `gallonDamageSchema`, change payMethod to `z.enum(['tunai', 'bon', 'transfer', 'ganti_galon'])`.

2. In `gallonDamageCharge`:
   - `const pay = ['tunai', 'bon', 'transfer', 'ganti_galon'].includes(body.payMethod) ? body.payMethod : 'tunai';`
   - `const money = pay !== 'ganti_galon';`
   - Require the price only when `money`, and use `const amount = money ? qty * price : 0;`.
   - The txn gets `method: pay === 'bon' ? 'bon' : 'lunas'` and `payMethod: pay === 'bon' ? '' : pay`. That is unchanged and now carries `'ganti_galon'`.
   - The note reads `Ganti rugi ${qty} galon ${kind} (diganti galon baru)` when not `money`.
   - After the damage movement, when `!money`, add:

```js
    if (!money) await tx.gallonMovement.create({ data: { type: 'replace_customer', qty, customerId: null, transactionId: t.id, fleetId, active: true,
      note: `Galon baru dari pelanggan pengganti ${qty} galon ${kind}`, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName } });
```

   - After the journal line, add `await syncGantiRugiWriteOff(t, actor, tx);`.

3. In `totalEffect`, add `if (m.type === 'replace_customer') return Math.abs(m.qty);   // a new gallon handed over in place of a broken one → good stock (depot)`. Check every place that whitelists or labels movement types (`grep -n "damage_customer" *.jsx server/src`) and add `replace_customer` with the label "Galon pengganti dari pelanggan".

4. Add `syncGantiRugiWriteOff`, near `gallonDamageCharge`:

```js
// GANTI RUGI ↔ GALLON POOL (owner 2026-10-02). A live ganti rugi paid in money (tunai/bon/transfer) means the
// broken/lost gallons are gone → written off the pooled gallon asset; "diganti galon baru" (a new gallon
// handed over) keeps the pool whole; a void puts back exactly what was taken. Idempotent: call it after any
// create / void / un-void — it moves the write-off to the state the transaction is in now.
async function syncGantiRugiWriteOff(t, actor, tx) {
  if (!t || t.kind !== 'ganti_rugi') return null;
  const dep = require('./depreciation.service');
  const want = t.status !== 'void' && t.payMethod !== 'ganti_galon' && (t.gallonQty || 0) > 0;
  const row = await tx.gallonPoolWriteOff.findUnique({ where: { transactionId: t.id } });
  const live = row && !row.reversedAt;
  const dateFor = async (d) => ((await require('./period.service').isOpen(d)) ? d : todayISO());
  if (want && !live) {
    const asset = await dep.findGallonPool(t.fleetId || '', tx);
    if (!asset) return null;   // no pool registered → nothing to write off (the backfill preview lists it)
    const version = row ? row.version + 1 : 1;
    const date = await dateFor(t.txnDate);
    const kind = /hilang/.test(String(t.note || '')) ? 'hilang' : 'rusak';
    const w = await dep.writeOffPool({ asset, qty: t.gallonQty, date, kind, sourceType: 'ganti_rugi_writeoff', sourceId: `${t.id}:v${version}`, actor }, tx);
    const data = { assetId: asset.id, qty: w.qty, cost: BigInt(w.cost), accum: BigInt(w.accum), salvage: BigInt(w.salvage), date, version, reversedAt: null };
    return row ? tx.gallonPoolWriteOff.update({ where: { id: row.id }, data }) : tx.gallonPoolWriteOff.create({ data: { transactionId: t.id, ...data } });
  }
  if (!want && live) {
    const asset = await tx.fixedAsset.findUnique({ where: { id: row.assetId } });
    if (asset) await dep.restorePool({ asset, qty: row.qty, cost: row.cost, accum: row.accum, salvage: row.salvage, date: await dateFor(todayISO()), sourceType: 'ganti_rugi_writeoff', sourceId: `${t.id}:v${row.version}`, actor }, tx);
    return tx.gallonPoolWriteOff.update({ where: { id: row.id }, data: { reversedAt: new Date() } });
  }
  return row;
}
```

   Check `period.service` for its "is this date's period open" helper (e.g. `isOpen` / `statusForKey` + `LOCKED`), use the real one, and ledger it.

5. Call `await syncGantiRugiWriteOff(<the updated txn row>, actor, <tx or db>)` right after each place a transaction's status changes to or from `'void'`. At least these: the direct void (~line 1738), the approved void request (~line 2169), the bulk void (~line 2843), the un-void (~line 2902), and the line ~2592 void. Pass the updated row (`{ ...t, status: 'void' }` where that is what the site has). Add it independent of `config.accountingV2`, because the pool row changes either way.

6. In `distTxnLines` (accounting.service.js), right after `if (t.status === 'void') return [];` add: `if (t.kind === 'ganti_rugi' && t.payMethod === 'ganti_galon') return [];   // a new gallon handed over: no money moved`.

7. Practice copy (`dist-field-sandbox.js` `gallonDamage`):
   - accept `'ganti_galon'` in the payMethod list;
   - the price is only required when `pay !== 'ganti_galon'`;
   - the amount is `pay === 'ganti_galon' ? 0 : qty * price`;
   - sisaBon grows only for `'bon'`.

- [ ] **Step 4: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/gallon-damage-charge.test.js tests/field-sandbox.test.js tests/gallon-pool-writeoff.test.js tests/galon-location.test.js tests/fixed-assets.test.js tests/field-api.test.js`
Expected: PASS. The 4-location invariant still holds: `replace_customer` adds good stock and does not touch the rusak bucket.

- [ ] **Step 5: Commit**

```bash
git add server/src/controllers/distribution.controller.js server/src/services/distribution.service.js server/src/services/accounting.service.js dist-field-sandbox.js server/tests/gallon-damage-charge.test.js server/tests/field-sandbox.test.js distribution.jsx
git commit -m "feat(distribusi): ganti rugi writes the gallons off the asset pool (void puts them back); new 'Diganti galon baru' keeps the pool, no money"
```

---

### Task 4: Old ganti rugi — preview, then the owner applies (no VPS needed)

**Files:**
- Modify: `server/src/services/depreciation.service.js` (`gantiRugiBackfill({ apply })`)
- Modify: `server/src/controllers/accounting.controller.js`, `server/src/routes/accounting.routes.js` (`GET` preview + `POST` apply, owner only)
- Modify: `api.js` (`gantiRugiBackfill(apply)`), `finance-accounting.jsx` (`AssetDetail` pool card), `finance-i18n.js` (`as.*` keys EN + ID)
- Test: `server/tests/gallon-pool-writeoff.test.js` (append)

**Interfaces:**
- Consumes: `syncGantiRugiWriteOff` (Task 3).
- Produces:
  - `GET /accounting/gallon-pool/ganti-rugi-backfill` → `{ count, gallons, rows: [{ id, txnDate, customerName, qty }] }`;
  - `POST` the same path → `{ applied, gallons }`.

- [ ] **Step 1: Write the failing test.** Append to `server/tests/gallon-pool-writeoff.test.js`:

```js
describe('old ganti rugi backfill (owner reviews, then applies)', () => {
  it('lists live money ganti rugi with no write-off, applies them once, owner only', async () => {
    // a ganti rugi recorded before the write-off existed: a txn row with no GallonPoolWriteOff
    const c = await prisma.customer.create({ data: { name: 'Lama', type: 'reguler', masterPrice: 18000, armada: '' } });
    const t = await prisma.distTransaction.create({ data: { customerId: c.id, fleetId: '', qty: 0, unitPriceLocked: 45000, amount: 90000, method: 'lunas', payMethod: 'tunai', kind: 'ganti_rugi', gallonQty: 2, note: 'Ganti rugi 2 galon pecah', txnDate: '2026-05-10' } });
    const gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'pw_gm', password: 'secret123', role: 'gm' })).body.token;
    expect((await request(app).post('/api/v1/accounting/gallon-pool/ganti-rugi-backfill').set(auth(gm)).send({})).status).toBe(403);
    const pv = (await request(app).get('/api/v1/accounting/gallon-pool/ganti-rugi-backfill').set(auth(owner))).body.data;
    expect(pv.rows.map((r) => r.id)).toContain(t.id);
    const q0 = (await prisma.fixedAsset.findUnique({ where: { id: poolId } })).quantity;
    const ap = (await request(app).post('/api/v1/accounting/gallon-pool/ganti-rugi-backfill').set(auth(owner)).send({})).body.data;
    expect(ap.applied).toBeGreaterThanOrEqual(1);
    expect((await prisma.fixedAsset.findUnique({ where: { id: poolId } })).quantity).toBe(q0 - ap.gallons);
    expect((await request(app).get('/api/v1/accounting/gallon-pool/ganti-rugi-backfill').set(auth(owner))).body.data.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails** (404 on the route).

- [ ] **Step 3: Implement.** In depreciation.service:

```js
// OLD GANTI RUGI (before 2026-10-02 they never touched the pool): live money ganti rugi without a live
// write-off. Preview first; apply = the same sync a new one runs, one transaction each.
async function gantiRugiBackfill({ apply } = {}, actor) {
  const rows = await prisma.distTransaction.findMany({ where: { kind: 'ganti_rugi', status: { not: 'void' }, payMethod: { not: 'ganti_galon' }, gallonQty: { gt: 0 } }, orderBy: [{ txnDate: 'asc' }], include: { customer: { select: { name: true } } } });
  const done = new Set((await prisma.gallonPoolWriteOff.findMany({ where: { reversedAt: null }, select: { transactionId: true } })).map((w) => w.transactionId));
  const todo = rows.filter((t) => !done.has(t.id));
  if (!apply) return { count: todo.length, gallons: todo.reduce((s, t) => s + (t.gallonQty || 0), 0), rows: todo.map((t) => ({ id: t.id, txnDate: t.txnDate, customerName: t.customer ? t.customer.name : '', qty: t.gallonQty })) };
  let applied = 0, gallons = 0;
  for (const t of todo) {
    const w = await prisma.$transaction((tx) => require('./distribution.service').syncGantiRugiWriteOff(t, actor, tx));
    if (w && !w.reversedAt) { applied++; gallons += w.qty; }
  }
  return { applied, gallons };
}
```

- Export it, and export `syncGantiRugiWriteOff` from distribution.service.
- Controller: `gantiRugiBackfillPreview = asyncHandler(async (req, res) => res.json({ data: await depreciation.gantiRugiBackfill({}, req.user) }))` and `gantiRugiBackfillApply = asyncHandler(async (req, res) => res.json({ data: await depreciation.gantiRugiBackfill({ apply: true }, req.user) }))`.
- Routes: `router.get('/gallon-pool/ganti-rugi-backfill', requireRole('owner'), ctrl.gantiRugiBackfillPreview); router.post('/gallon-pool/ganti-rugi-backfill', requireRole('owner'), ctrl.gantiRugiBackfillApply);` (next to the pool routes).
- `api.js` next to `gallonPoolLoss`: `gantiRugiBackfill: (apply) => req(apply ? 'POST' : 'GET', '/accounting/gallon-pool/ganti-rugi-backfill', apply ? {} : undefined),`.
- `finance-accounting.jsx` `AssetDetail` pool card, owner only:
  - pass `isOwner` through from the screen that already knows the role. Check how `canRun` is computed and follow it.
  - Add a button **"Ganti rugi lama"** that loads the preview and shows `N transaksi · X galon belum dihapus dari aset`, the list (date · customer · qty), and **"Hapus dari aset"**.
  - The apply button opens a confirm, then applies, reloads the asset and shows the result.
- i18n `as.grOld`, `as.grOldNone`, `as.grOldLine`, `as.grApply`, `as.grApplyConfirm`, `as.grApplied` in EN + ID. Find the `as.*` keys' position in `finance-i18n.js` and add next to `as.reconcile`.

- [ ] **Step 4: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/gallon-pool-writeoff.test.js tests/fixed-assets.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/depreciation.service.js server/src/services/distribution.service.js server/src/controllers/accounting.controller.js server/src/routes/accounting.routes.js api.js finance-accounting.jsx finance-i18n.js server/tests/gallon-pool-writeoff.test.js
git commit -m "feat(accounting): old ganti rugi — owner previews then writes them off the gallon pool from the asset screen"
```

---

### Task 5: Field UI — "Diganti galon baru" on Ganti rugi

**Files:**
- Modify: `dist-field-logic.js` (`damagePreview`), `dist-field-cust.jsx` (`FldDamage`), `finance-i18n.js`
- Test: `server/tests/field-logic.test.js` (append), `server/tests/field-3d2-cust.test.js` (append)

- [ ] **Step 1: Write the failing tests.** Append to `field-logic.test.js`:

```js
describe('ganti rugi — diganti galon baru', () => {
  it('damagePreview: no money, never blocked by a missing price, gallons still leave the customer', () => {
    const pv = L.damagePreview({ qty: 2, price: 0, held: 6, payMethod: 'ganti_galon' });
    expect(pv).toMatchObject({ total: 0, heldAfter: 4, blocked: '', totalKey: 'fld.noMoney' });
    expect(L.damagePreview({ qty: 1, price: 0, held: 6, payMethod: 'tunai' }).blocked).toBe('fld.dmgNoPrice');
  });
});
```

Append to `field-3d2-cust.test.js`:

```js
describe('Ganti rugi — Diganti galon baru (owner 2026-10-02)', () => {
  it('a fourth pay choice; with it the card says no money and that the pool stays whole', () => {
    const f = fn(cust, 'FldDamage');
    expect(f).toMatch(/\['ganti_galon', trFl\('fld\.m_gantiGalon'\)\]/);
    expect(f).toMatch(/pay === 'ganti_galon' \? trFl\('fld\.newGalonIn', \{ n: qty \}\) :/);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail.**

- [ ] **Step 3: Implement.**

`damagePreview`:

```js
  function damagePreview(o) {
    var qty = Math.max(0, Math.round(num(o.qty))); var price = Math.max(0, num(o.price)); var held = Math.max(0, Math.round(num(o.held)));
    var replace = o.payMethod === 'ganti_galon';   // a new gallon handed over: no money, no price needed
    var blocked = !replace && !price ? 'fld.dmgNoPrice' : (!held ? 'fld.dmgNoHeld' : '');
    return { total: replace ? 0 : qty * price, heldAfter: Math.max(0, held - qty), blocked: blocked, totalKey: replace ? 'fld.noMoney' : o.payMethod === 'bon' ? 'fld.toBon' : (o.payMethod === 'transfer' ? 'fld.transferred' : 'fld.cashIn') };
  }
```

`FldDamage`:
- The segment options become `[['tunai', trFl('fld.m_tunai')], ['bon', trFl('fld.toBon')], ['transfer', trFl('fld.m_transfer')], ['ganti_galon', trFl('fld.m_gantiGalon')]]`.
- The second effect row's value becomes `{pay === 'ganti_galon' ? trFl('fld.newGalonIn', { n: qty }) : kind === 'hilang' ? trFl('fld.dmgLost') : trFl('fld.nGalon', { n: qty })}`.
- Under the effect card, when `pay === 'ganti_galon'`, show `<div className="mlap-hint">{trFl('fld.poolKept')}</div>`.
- The price box shows `—` when `pay === 'ganti_galon'`.

i18n:
- EN: ` 'fld.m_gantiGalon': 'New gallon', 'fld.noMoney': 'No money (new gallon)', 'fld.newGalonIn': '{n} new gallons in', 'fld.poolKept': 'The customer hands over a new gallon — nothing to pay, the gallon asset stays whole.',`
- ID: ` 'fld.m_gantiGalon': 'Galon baru', 'fld.noMoney': 'Tanpa uang (galon baru)', 'fld.newGalonIn': '{n} galon baru masuk', 'fld.poolKept': 'Pelanggan menyerahkan galon baru — tidak ada yang dibayar, aset galon tetap utuh.',`

- [ ] **Step 4: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-cust.test.js tests/field-cust-static.test.js`
Expected: PASS. The segment now has 4 options; check at 320 px that the labels fit; the short label "Galon baru" is chosen for that.

- [ ] **Step 5: Side-by-side check** — Ganti rugi with "Galon baru" picked (scratch `cdp.js`, step `dmg`).

- [ ] **Step 6: Commit**

```bash
git add dist-field-logic.js dist-field-cust.jsx finance-i18n.js server/tests/field-logic.test.js server/tests/field-3d2-cust.test.js
git commit -m "feat(distribusi): Ganti rugi on the phone — 'Galon baru' choice: no money, the gallon asset stays whole"
```

---

### Task 6: Peta / Satelit on Atur titik (owner's ArcGIS key)

**Files:**
- Modify: `server/src/services/fieldRules.service.js` (`satelliteKey`)
- Modify: `dist-field.jsx` (`FldRules` input; shell passes `rules` to `FldPinMap`)
- Modify: `dist-field-cust.jsx` (`FldPinMap` layer switch), `dist-field.css`, `finance-i18n.js`, `deploy/DEPLOY.md` (third-party tile note)
- Test: `server/tests/field-rules.test.js` (append), `server/tests/field-3d2-cust.test.js` (append)

- [ ] **Step 1: Write the failing tests.** Append to `field-rules.test.js` (use its existing owner token and `PUT /distribusi/field-rules` helper):

```js
it('stores the satellite key (owner/GM rules), trims it, never echoes it into the audit', async () => {
  const r = await request(app).put('/api/v1/distribusi/field-rules').set(auth(ownerTok)).send({ satelliteKey: '  AAPK-test-123  ' });
  expect(r.status).toBe(200);
  expect(r.body.data.satelliteKey).toBe('AAPK-test-123');
  const audit = await prisma.distAuditLog.findFirst({ where: { title: 'Aturan lapangan diubah' }, orderBy: { createdAt: 'desc' } });
  expect(audit.detail).toMatch(/kunci peta satelit diubah/);
  expect(audit.detail).not.toMatch(/AAPK-test-123/);
});
```

(Use the file's real token variable name; ledger it.)

Append to `field-3d2-cust.test.js`:

```js
describe('Atur titik — Peta / Satelit (owner 2026-10-02)', () => {
  const f = () => fn(cust, 'FldPinMap');
  it('with the owner\'s key: a glass Peta/Satelit switch; Esri World Imagery with its attribution', () => {
    expect(f()).toMatch(/function FldPinMap\(\{ api, cust: c, depot, rules, onDone, onBack \}\)/);
    expect(f()).toMatch(/https:\/\/ibasemaps-api\.arcgis\.com\/arcgis\/rest\/services\/World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}\?token=/);
    expect(f()).toMatch(/Esri, Maxar, Earthstar Geographics/);
    expect(f()).toMatch(/satKey \? <div className="mlap-glass mlap-mapseg" role="group"/);
    expect(shell).toMatch(/<FldPinMap api=\{api\} cust=\{view\.cust\} depot=\{ctx\.depot\} rules=\{ctx\.rules \|\| \{\}\}/);
  });
  it('a tile error on Satelit falls back to Peta and says why', () => {
    expect(f()).toMatch(/sat\.on\('tileerror', /);
    expect(f()).toMatch(/trFl\('fld\.satErr'\)/);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail.**

- [ ] **Step 3: Implement.**

`fieldRules.service.js`:
- `DEFAULT_RULES.satelliteKey: ''`.
- In `normalize`: `satelliteKey: typeof s.satelliteKey === 'string' ? s.satelliteKey.trim().slice(0, 400) : ''`.
- In `setRules`: `if (p.satelliteKey !== undefined) next.satelliteKey = String(p.satelliteKey || '').trim().slice(0, 400);`.
- In `describeChanges`: `if (a.satelliteKey !== b.satelliteKey) out.push(b.satelliteKey ? 'kunci peta satelit diubah' : 'kunci peta satelit dihapus');`.
- Check the field-rules zod schema in the controller and allow `satelliteKey: z.string().max(400).optional()`.

`FldRules` (Armada & SOP): in the toggles card, add a row:

```jsx
            <label className="mlap-field"><span className="lb">{trFl('fld.satKeyL')}<span className="ht">{trFl('fld.satKeyH')}</span></span>
              <input className="mlap-input" style={{ width: 160 }} autoComplete="off" spellCheck={false} value={r.satelliteKey || ''} onChange={(e) => set({ satelliteKey: e.target.value.slice(0, 400) })} aria-label={trFl('fld.satKeyL')} /></label>
```

Include `satelliteKey: r.satelliteKey || ''` in the full-save body.

Shell: `<FldPinMap api={api} cust={view.cust} depot={ctx.depot} rules={ctx.rules || {}} …`.

`FldPinMap`:
- Signature `({ api, cust: c, depot, rules, onDone, onBack })`.
- `const satKey = (rules && rules.satelliteKey) || '';`, `const [layer, setLayer] = uSfl('peta');`, `const [satErr, setSatErr] = uSfl(false);`, `const layersRef = uRfl(null);`.
- In the Leaflet effect, build both layers and keep them in `layersRef`:

```jsx
      const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' });
      const sat = satKey ? L.tileLayer('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=' + encodeURIComponent(satKey), { maxZoom: 19, attribution: 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Esri, Maxar, Earthstar Geographics' }) : null;
      if (sat) sat.on('tileerror', () => { setSatErr(true); setLayer('peta'); });
      osm.addTo(map);
      layersRef.current = { osm, sat };
```

  Keep `map.setView` before the gesture handlers, exactly as now.
- An effect on `[layer, mapReady]` swaps: remove the other layer and add the chosen one when it exists.
- Glass bar: when `satKey`, the title pill is replaced by

```jsx
        satKey ? <div className="mlap-glass mlap-mapseg" role="group" aria-label={trFl('fld.mapType')}>{[['peta', trFl('fld.layerMap')], ['sat', trFl('fld.layerSat')]].map(([k, t]) => <button key={k} type="button" aria-pressed={layer === k} className={'mlap-mapseg-b' + (layer === k ? ' on' : '')} onClick={() => { setSatErr(false); setLayer(k); }}>{t}</button>)}</div> : <div className="mlap-glass mlap-mappill">{trFl('fld.pinT')}</div>
```

- When `satErr`, show `<div className="mlap-err" role="alert">{trFl('fld.satErr')}</div>` in the sheet.

CSS (append `/* ── SATELIT ── */`):

```css
.mlap-mapseg { flex: 1; min-width: 0; height: 44px; border-radius: 22px; padding: 3px; box-sizing: border-box; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; }
.mlap-mapseg-b { border: 0; border-radius: 19px; background: transparent; font: inherit; font-size: 14px; font-weight: 600; color: var(--mlap-ink); cursor: pointer; }
.mlap-mapseg-b.on { background: #FFFFFF; box-shadow: 0 1px 3px rgba(14,27,36,.14); }
```

i18n:
- EN: ` 'fld.satKeyL': 'Satellite map key (ArcGIS)', 'fld.satKeyH': 'Empty = no Satellite button on Atur titik', 'fld.mapType': 'Map type', 'fld.layerMap': 'Map', 'fld.layerSat': 'Satellite', 'fld.satErr': 'Satellite map could not load (check the ArcGIS key) — showing the street map.',`
- ID: ` 'fld.satKeyL': 'Kunci peta satelit (ArcGIS)', 'fld.satKeyH': 'Kosong = tombol Satelit tidak muncul di Atur titik', 'fld.mapType': 'Jenis peta', 'fld.layerMap': 'Peta', 'fld.layerSat': 'Satelit', 'fld.satErr': 'Peta satelit tidak bisa dimuat (periksa kunci ArcGIS) — memakai peta jalan.',`

`deploy/DEPLOY.md`: next to the OSM exception, add: "**Satellite tiles (Atur titik, opt-in).** With an ArcGIS Location Platform API key saved in Aturan lapangan & armada, Atur titik offers a Satelit layer from `ibasemaps-api.arcgis.com` (Esri World Imagery). The key is visible to the phones that use it; restrict it in the ArcGIS dashboard to the referrer `https://airrooffice.com/*` and to basemaps only. Without a key the button does not appear."

- [ ] **Step 4: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-rules.test.js tests/field-3d2-cust.test.js tests/field-cust-static.test.js tests/field-shell-static.test.js tests/field-context.test.js`
Expected: PASS. The 3D Atur titik assertions (`setView` before handlers, keydown, locate button) still hold.

- [ ] **Step 5: Side-by-side check** — Atur titik with a dummy key, next to `AturTitik.dc.html`. The switch matches the board's glass segmented control; a bad key falls back to Peta with the message.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/fieldRules.service.js server/src/controllers/distribution.controller.js dist-field.jsx dist-field-cust.jsx dist-field.css finance-i18n.js deploy/DEPLOY.md server/tests/field-rules.test.js server/tests/field-3d2-cust.test.js
git commit -m "feat(distribusi): Atur titik Peta/Satelit — Esri World Imagery with the owner's ArcGIS key, falls back to the street map"
```

---

### Task 7: Spec note + full suite

- [ ] **Step 1:** In the spec, §3.6 (ganti rugi), add:

> **Owner 2026-10-02:**
> - A ganti rugi paid in money (tunai/bon/transfer) writes the gallons off the pooled gallon asset: Dr Akumulasi (share), Dr 6-8500 (book value), Cr 1-1440 (cost share), recorded in `GallonPoolWriteOff` per transaction.
> - "Diganti galon baru" (`payMethod 'ganti_galon'`) means no money, no journal and no write-off. A `replace_customer` movement brings the new gallon into good stock.
> - A void puts back exactly what was written off.
> - Older ganti rugi are written off from the asset screen after the owner reviews the list.

In §4, at Atur titik, add:

> **Satelit (2026-10-02):** Esri World Imagery with the owner's ArcGIS key (Aturan lapangan). There is no button without a key, and it falls back to Peta on a tile error.

In the self-approval notes, add:

> **Owner 2026-10-02:** approval access is enough to approve one's own correction, cancellation or customer move (still badged and logged, per-user ceiling still applies). Correction access only means submit only. The separate waiver now covers disputes, cost standards and payroll, and only the Pemilik may grant it, also through role templates.

- [ ] **Step 2: Full suite + build**

Run (from `server/`): `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand > /tmp/full.txt 2>&1; tail -5 /tmp/full.txt` (with `APP_TZ=UTC` before 08:00 WITA)
Expected: all suites pass.

Run (repo root): `node build.mjs` — Expected: builds without error.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md
git commit -m "docs: spec — ganti rugi writes off the gallon pool, Satelit on Atur titik, koreksi self-approval by approval access"
```
