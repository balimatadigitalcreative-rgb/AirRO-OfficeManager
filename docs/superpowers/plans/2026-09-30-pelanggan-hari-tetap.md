# Pelanggan Hari Tetap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers can carry fixed delivery days (e.g. a hotel on Sen/Rab/Jum) that no zone ever overwrites, and the "Per hari kirim" planner counts those visits against each day's quota so every customer is delivered without any route exceeding its maximum.

**Architecture:** One new column `Customer.fixedDays` (boolean; the days stay in `deliveryDays`). The shared rule module `dist-zones.js` (`planMembership`) stops writing zone days onto fixed customers, and gains a pure `fitFixedLoad` that squeezes regular customers into per-slot quotas. `zone.service.autoDaily` builds territories from regular customers, gives each fixed customer the armada of its nearest route, subtracts its visits from that armada's day quotas, then refits. UI: a switch in the customer form, a badge in the customer detail, and on the map a "3×" marker, a popup editor, a filter chip and quota-aware preview rows.

**Tech Stack:** Node/Express + Prisma (SQLite locally; hand-written migrations), Jest + supertest (`server/tests`), React 18 without a bundler framework (JSX compiled by esbuild via `npm run build`), Leaflet 1.9.4 (vendored).

**Spec:** `docs/superpowers/specs/2026-09-30-pelanggan-hari-tetap-design.md`

## Global Constraints

- One armada serves ALL of a fixed customer's days (the armada of its territory). No per-day armada.
- `fixedDays = true` requires at least 1 day in `deliveryDays` → 400 otherwise.
- For a fixed customer, zones set the **armada only**; nothing in the zone feature ever changes its days.
- If fixed-day visits alone exceed a slot's maximum, or total quota is too small → **refuse (400) with suggestions**; nothing is written.
- Working days for the planner: Sen–Sab. A fixed customer's `Min` day is kept but not counted against any quota.
- Every user-visible string exists in both `DICT.en` and `DICT.id` of `finance-i18n.js`.
- Run server tests from `server/` with: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand <files>`.
- Never run `prisma format` (it rewrites the whole schema). Migrations are hand-written SQL, additive.
- In this environment, bash heredocs mangle quotes/backslashes: write multi-line code with the file editing tool, not heredocs.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A fixed customer whose days include `Min` → kept on Sunday, not counted in any quota, preview says how many Sunday visits were not counted (test in Task 3).
2. A fixed customer WITHOUT coordinates → never enters the planner or a zone; its days are untouched by every zone operation (test in Task 3).
3. Switching `fixedDays` OFF for a customer inside a zone → its days immediately become the zone's day (test in Task 1).
4. No regular located customers at all (everyone fixed) → a clear 400, not a crash (test in Task 3).
5. A fixed customer edited through the full customer form while inside a zone (armada unchanged, days changed) → 200, not 409 (test in Task 1).

---

### Task 1: Data model + the "zone never changes fixed days" rule

**Files:**
- Create: `server/prisma/migrations/20261001100000_customer_fixed_days/migration.sql`
- Modify: `server/prisma/schema.prisma` (model `Customer`)
- Modify: `dist-zones.js` (`planMembership`)
- Modify: `server/src/services/zone.service.js` (`planCust`, `CUST_SELECT`, `listZones` payload, `assertScheduleEditable`)
- Modify: `server/src/services/distribution.service.js` (`createCustomer`, `updateCustomer`)
- Modify: `server/src/controllers/distribution.controller.js` (`customerSchema`, `customerUpdateSchema`)
- Test: `server/tests/dist-zones-geometry.test.js`, `server/tests/customer-fixed-days.test.js` (new)

**Interfaces:**
- Produces: `Customer.fixedDays: boolean`; plan-input customers carry `fixed: boolean`; `/distribusi/zones` customers carry `fixedDays: boolean`; `PATCH/POST /distribusi/customers` accept `fixedDays: boolean`.

- [ ] **Step 1: Write the failing rule test** — append to `server/tests/dist-zones-geometry.test.js`, inside `describe('planMembership — the schedule follows the zone', …)` after its last `it`:

```js
  it('a FIXED-day customer takes the zone armada but keeps its own days', () => {
    const out = DZ.planMembership([cust({ fixed: true, days: ['Sen', 'Rab', 'Jum'] })], [Z1]);
    expect(out[0].to).toEqual({ zoneId: 'z1', armada: 'DK 1', days: ['Sen', 'Rab', 'Jum'] });
  });

  it('a fixed customer already on the zone armada → no change at all', () => {
    expect(DZ.planMembership([cust({ fixed: true, zoneId: 'z1', armada: 'DK 1', days: ['Sen', 'Rab', 'Jum'] })], [Z1])).toEqual([]);
  });
```

- [ ] **Step 2: Run it — expect FAIL** (days become `['Sen','Kam']`)

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/dist-zones-geometry.test.js`

- [ ] **Step 3: Implement the rule** — in `dist-zones.js` `planMembership`, replace the `days` line:

```js
      // A FIXED-day customer (hotel: Sen/Rab/Jum) keeps its own days whatever the zone says; the zone
      // still decides which armada serves it.
      var days = !c.fixed && z && z.days && z.days.length ? z.days.slice() : (c.days || []).slice();
```

and update the rules comment above the function with a line `//   - a fixed-day customer (c.fixed) never takes the zone's days, only its armada;`.

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Schema + migration.** In `server/prisma/schema.prisma`, model `Customer`, directly after the `zoneManual` line add:

```prisma
  // FIXED delivery days (e.g. a hotel on Sen/Rab/Jum): the days in deliveryDays are the customer's
  // own — zones never change them (they still set the armada). At least one day when true.
  fixedDays     Boolean  @default(false)
```

Create `server/prisma/migrations/20261001100000_customer_fixed_days/migration.sql`:

```sql
-- FIXED DELIVERY DAYS — a customer whose days are its own (a hotel on Sen/Rab/Jum). Zones never
-- rewrite those days; they still set the armada. Additive; every existing customer starts as false.
ALTER TABLE "Customer" ADD COLUMN "fixedDays" BOOLEAN NOT NULL DEFAULT false;
```

Run: `cd server && npx prisma validate && npx prisma generate` — expect "valid" and "Generated Prisma Client".

- [ ] **Step 6: Write the failing integration tests** — create `server/tests/customer-fixed-days.test.js`:

```js
'use strict';
/*
 * FIXED DELIVERY DAYS. Some customers (a hotel on Sen/Rab/Jum) have days of their own. Zones own
 * the schedule of everybody else, so these pin that a fixed customer's days survive every zone
 * operation, that the zone still gives it an armada, and that the flag behaves at the edges.
 */
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const Z = '/api/v1/distribusi/zones';
const C = '/api/v1/distribusi/customers';
const SQ = [[-8.60, 115.20], [-8.60, 115.21], [-8.61, 115.21], [-8.61, 115.20]];
const IN = { lat: -8.605, lng: 115.205 };
const days = (c) => JSON.parse(c.deliveryDays);
let gm, zoneId;
const mk = async (name, extra) => (await request(app).post(C).set(auth(gm))
  .send(Object.assign({ name, type: 'reguler', masterPrice: 6000, armada: 'DK 9', deliveryDays: ['Rab'] }, extra || {}))).body;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_fixed', password: 'secret123', role: 'gm' })).token;
});
afterAll(() => prisma.$disconnect());

describe('the flag', () => {
  it('fixedDays without any day is refused', async () => {
    const r = await request(app).post(C).set(auth(gm)).send({ name: 'Kosong', type: 'reguler', masterPrice: 1, deliveryDays: [], fixedDays: true });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/hari/i);
  });

  it('is stored and returned', async () => {
    const r = await mk('Hotel A', Object.assign({ fixedDays: true, deliveryDays: ['Sen', 'Rab', 'Jum'] }, IN));
    expect(r.data.fixedDays).toBe(true);
  });
});

describe('zones never touch fixed days', () => {
  let hotel, warung;
  beforeAll(async () => {
    hotel = (await prisma.customer.findFirst({ where: { name: 'Hotel A' } })).id;
    warung = (await mk('Warung', IN)).data.id;
    const r = await request(app).post(Z).set(auth(gm)).send({ name: 'Utara', polygon: SQ, armada: 'DK 1', deliveryDays: ['Kam'] });
    zoneId = r.body.data.zone.id;
  });

  it('the zone gives the hotel its armada but not its day; the warung gets both', async () => {
    const h = await prisma.customer.findUnique({ where: { id: hotel } });
    expect(h.armada).toBe('DK 1');
    expect(days(h)).toEqual(['Sen', 'Rab', 'Jum']);
    const w = await prisma.customer.findUnique({ where: { id: warung } });
    expect(days(w)).toEqual(['Kam']);
  });

  it('changing the zone days leaves the hotel alone', async () => {
    await request(app).put(`${Z}/${zoneId}`).set(auth(gm)).send({ deliveryDays: ['Sab'] });
    expect(days(await prisma.customer.findUnique({ where: { id: hotel } }))).toEqual(['Sen', 'Rab', 'Jum']);
  });

  it('a new point from the field keeps the hotel days', async () => {
    await request(app).patch(`${C}/${hotel}/location`).set(auth(gm)).send({ lat: IN.lat + 0.001, lng: IN.lng, accuracy: 5 });
    expect(days(await prisma.customer.findUnique({ where: { id: hotel } }))).toEqual(['Sen', 'Rab', 'Jum']);
  });

  it('the full edit form may change a fixed customer days inside a zone (armada unchanged) — 200', async () => {
    const r = await request(app).patch(`${C}/${hotel}`).set(auth(gm)).send({ name: 'Hotel A', armada: 'DK 1', deliveryDays: ['Sen', 'Kam'] });
    expect(r.status).toBe(200);
    expect(days(await prisma.customer.findUnique({ where: { id: hotel } }))).toEqual(['Sen', 'Kam']);
  });

  it('but its armada still belongs to the zone — 409', async () => {
    expect((await request(app).patch(`${C}/${hotel}`).set(auth(gm)).send({ armada: 'DK 5' })).status).toBe(409);
  });

  it('switching the flag OFF hands the days back to the zone at once', async () => {
    const r = await request(app).patch(`${C}/${hotel}`).set(auth(gm)).send({ fixedDays: false });
    expect(r.status).toBe(200);
    expect(r.body.data.deliveryDays).toEqual(['Sab']);
    expect(days(await prisma.customer.findUnique({ where: { id: hotel } }))).toEqual(['Sab']);
  });

  it('switching it ON again keeps whatever days are sent', async () => {
    const r = await request(app).patch(`${C}/${hotel}`).set(auth(gm)).send({ fixedDays: true, deliveryDays: ['Sen', 'Rab', 'Jum'] });
    expect(r.status).toBe(200);
    expect(days(await prisma.customer.findUnique({ where: { id: hotel } }))).toEqual(['Sen', 'Rab', 'Jum']);
  });

  it('the map payload marks the hotel as fixed', async () => {
    const r = await request(app).get(Z).set(auth(gm));
    expect(r.body.data.customers.find((c) => c.id === hotel).fixedDays).toBe(true);
  });

  it('the audit trail says the fixed days changed', async () => {
    const log = await prisma.distAuditLog.findFirst({ where: { title: { contains: 'Hotel A' }, detail: { contains: 'hari tetap' } } });
    expect(log).toBeTruthy();
  });
});

describe('the delivery board shows a fixed customer on each of its days', () => {
  const shift = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dow = (iso) => ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][new Date(iso + 'T00:00:00Z').getUTCDay()];
  it('rows appear exactly on Sen/Rab/Jum, on the zone armada', async () => {
    const hotel = await prisma.customer.findFirst({ where: { name: 'Hotel A' } });
    for (let i = 1; i <= 7; i++) {
      const d = shift(todayISO(), i);
      const r = await request(app).get(`/api/v1/distribusi/deliveries?date=${d}`).set(auth(gm));
      const row = r.body.data.find((x) => x.customerId === hotel.id);
      if (['Sen', 'Rab', 'Jum'].includes(dow(d))) { expect(row).toBeTruthy(); expect(row.fleetId).toBe('DK 1'); }
      else expect(row).toBeUndefined();
    }
  });
});
```

- [ ] **Step 7: Run — expect FAIL** (unknown field / days overwritten).

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/customer-fixed-days.test.js`

- [ ] **Step 8: Accept the field in the API schemas** — in `server/src/controllers/distribution.controller.js`, add to BOTH `customerSchema` and `customerUpdateSchema` objects:

```js
  fixedDays: z.boolean().optional(),   // days are the customer's own; zones set only the armada
```

- [ ] **Step 9: Service — create/update.** In `server/src/services/distribution.service.js`:

In `createCustomer`, right after `cols.armada = resolveWriteFleet(actor, cols.armada);` add:

```js
  // FIXED delivery days: the customer's own days, never rewritten by a zone. They need a day to be fixed to.
  cols.fixedDays = !!body.fixedDays;
  if (cols.fixedDays && !JSON.parse(cols.deliveryDays).length) throw ApiError.badRequest('Hari tetap butuh minimal satu hari kirim.');
```

In `updateCustomer`, after the `if (body.address !== undefined) …` line add:

```js
  if (body.fixedDays !== undefined) data.fixedDays = !!body.fixedDays;
  const willBeFixed = data.fixedDays !== undefined ? data.fixedDays : !!cur.fixedDays;
  const willHaveDays = data.deliveryDays !== undefined ? JSON.parse(data.deliveryDays) : (() => { try { return JSON.parse(cur.deliveryDays || '[]'); } catch (e) { return []; } })();
  if (willBeFixed && !willHaveDays.length) throw ApiError.badRequest('Hari tetap butuh minimal satu hari kirim.');
```

Replace the audit + sync tail of `updateCustomer`:

```js
  let c = await prisma.customer.update({ where: { id }, data });
  const fixedChanged = data.fixedDays !== undefined && data.fixedDays !== !!cur.fixedDays;
  const fixedNote = fixedChanged ? (data.fixedDays ? ` · hari tetap: ${willHaveDays.join(', ')}` : ' · hari tetap dimatikan')
    : (c.fixedDays && data.deliveryDays !== undefined && data.deliveryDays !== cur.deliveryDays ? ` · hari tetap: ${willHaveDays.join(', ')}` : '');
  await logAudit('pelanggan', `Ubah pelanggan: ${c.name}`, `Tipe ${c.type}${fixedNote}`, snap, c.armada);
  // A moved point, or a fixed flag switched either way, changes what the zone decides for this customer.
  if ((data.lat !== undefined || fixedChanged) && (await zoneSvc().syncCustomers([id], actor)).length) c = await prisma.customer.findUnique({ where: { id } });
  return custClient(c);
```

(`custClient` spreads the row, so `fixedDays` is returned without further change.)

- [ ] **Step 10: zone.service — carry the flag and relax the 409 for days.** In `server/src/services/zone.service.js`:

```js
const planCust = (c) => ({ id: c.id, lat: c.lat, lng: c.lng, zoneId: c.zoneId || null, zoneManual: !!c.zoneManual, armada: c.armada || '', days: parseDays(c.deliveryDays), fixed: !!c.fixedDays });
const CUST_SELECT = { id: true, code: true, name: true, lat: true, lng: true, zoneId: true, zoneManual: true, armada: true, deliveryDays: true, fixedDays: true };
```

In `listZones`, in the `customers: located.map((c) => ({ … }))` object add `fixedDays: !!c.fixedDays,`.

In `assertScheduleEditable(cur, data)` replace the `daysLocked` line:

```js
  // A fixed-day customer's days are its own (only its armada is the zone's). data.fixedDays may switch
  // the flag in this same request, so decide on the value the row will HAVE.
  const fixed = data.fixedDays !== undefined ? !!data.fixedDays : !!cur.fixedDays;
  const daysLocked = !fixed && zDays.length && data.deliveryDays !== undefined && parseDays(data.deliveryDays).slice().sort().join() !== zDays.slice().sort().join();
```

- [ ] **Step 11: Run Task 1 tests + the zone suites — expect PASS.**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/customer-fixed-days.test.js tests/dist-zones-geometry.test.js tests/customer-zones.test.js`

- [ ] **Step 12: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261001100000_customer_fixed_days dist-zones.js server/src/services/zone.service.js server/src/services/distribution.service.js server/src/controllers/distribution.controller.js server/tests/dist-zones-geometry.test.js server/tests/customer-fixed-days.test.js
git commit -m "feat(distribusi): customers with fixed delivery days keep them through every zone change"
```

---

### Task 2: Pure `fitFixedLoad` — fit regular customers into per-slot quotas

**Files:**
- Modify: `dist-zones.js` (new function + export)
- Test: `server/tests/dist-zones-geometry.test.js`

**Interfaces:**
- Produces: `DZ.fitFixedLoad(points, slots)` where `points: [{id, lat, lng}]`, `slots: [{key, cap, ids: [id], center: [lat, lng]}]` (every point id appears in exactly one slot's `ids`; `center` is used only while a slot is empty) → `{ ok: true, slots: [{key, ids, center: [lat,lng], polygon: [[lat,lng]] | null}] }` in the input order, or `{ ok: false, needed, available }`.

- [ ] **Step 1: Write the failing tests** — append before `describe('palette', …)`:

```js
describe('fitFixedLoad — regular customers into the room left after fixed-day visits', () => {
  const P = (id, lat, lng) => ({ id, lat, lng });
  // Slot A (west) holds 3 but has room for 2; slot B (east) is empty with room for 5.
  const pts = [P(1, -8.60, 115.200), P(2, -8.60, 115.201), P(3, -8.60, 115.215), P(4, -8.60, 115.230)];
  const slots = () => [
    { key: 'A', cap: 2, ids: [1, 2, 3], center: [-8.60, 115.200] },
    { key: 'B', cap: 5, ids: [4], center: [-8.60, 115.230] },
  ];

  it('no slot ends over its quota and everyone is placed once', () => {
    const r = DZ.fitFixedLoad(pts, slots());
    expect(r.ok).toBe(true);
    const a = r.slots.find((s) => s.key === 'A'), b = r.slots.find((s) => s.key === 'B');
    expect(a.ids.length).toBeLessThanOrEqual(2);
    expect([...a.ids, ...b.ids].sort()).toEqual([1, 2, 3, 4]);
  });

  it('moves the customer that costs the least extra distance (the one nearest the other route)', () => {
    const r = DZ.fitFixedLoad(pts, slots());
    expect(r.slots.find((s) => s.key === 'B').ids).toContain(3);
  });

  it('an empty slot takes customers near its home centre', () => {
    const r = DZ.fitFixedLoad([P(1, -8.60, 115.20), P(2, -8.60, 115.20), P(3, -8.70, 115.30)],
      [{ key: 'A', cap: 2, ids: [1, 2, 3], center: [-8.60, 115.20] }, { key: 'E', cap: 3, ids: [], center: [-8.70, 115.30] }]);
    expect(r.slots.find((s) => s.key === 'E').ids).toEqual([3]);
  });

  it('not enough room anywhere → not ok, with the numbers', () => {
    expect(DZ.fitFixedLoad(pts, [{ key: 'A', cap: 1, ids: [1, 2], center: [-8.6, 115.2] }, { key: 'B', cap: 1, ids: [3, 4], center: [-8.6, 115.23] }]))
      .toEqual({ ok: false, needed: 4, available: 2 });
  });

  it('a slot with quota 0 is emptied', () => {
    const r = DZ.fitFixedLoad(pts, [{ key: 'A', cap: 0, ids: [1, 2], center: [-8.6, 115.2] }, { key: 'B', cap: 9, ids: [3, 4], center: [-8.6, 115.23] }]);
    expect(r.slots.find((s) => s.key === 'A').ids).toEqual([]);
    expect(r.slots.find((s) => s.key === 'A').polygon).toBeNull();
  });

  it('deterministic, valid polygons for non-empty slots', () => {
    expect(DZ.fitFixedLoad(pts, slots())).toEqual(DZ.fitFixedLoad(pts, slots()));
    DZ.fitFixedLoad(pts, slots()).slots.forEach((s) => { if (s.ids.length) expect(DZ.validatePolygon(s.polygon).ok).toBe(true); });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`DZ.fitFixedLoad is not a function`).

- [ ] **Step 3: Implement** — in `dist-zones.js`, insert before `function sameSet(a, b) {`:

```js
  // FIXED-DAY VISITS TAKE ROOM FIRST. Each slot (armada, day) has the quota left after its fixed-day
  // visits; this moves regular customers out of slots that are over it, always choosing the move that
  // adds the least distance (to the target slot's centre — its members' mean, or its home centre while
  // empty), then runs the same move/swap refinement as capacitatedGroups, never breaking a quota.
  // slots: [{ key, cap, ids, center }] — every point in exactly one slot. Deterministic.
  function fitFixedLoad(points, slots) {
    var pts = (points || []).filter(function (p) { return p && hasPoint(p.lat, p.lng); });
    var S = (slots || []).map(function (s) { return { key: s.key, cap: Math.max(0, Math.floor(s.cap) || 0), home: s.center }; });
    var available = S.reduce(function (t, s) { return t + s.cap; }, 0);
    if (pts.length > available) return { ok: false, needed: pts.length, available: available };
    var lat0 = pts.length ? pts.reduce(function (t, p) { return t + p.lat; }, 0) / pts.length : (S[0] && S[0].home ? S[0].home[0] : 0);
    var cosLat = Math.cos((lat0 * Math.PI) / 180);
    var byId = {}; pts.forEach(function (p) { byId[p.id] = p; });
    var xy = function (p) { return [p.lng * cosLat, p.lat]; };
    var d2 = function (a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; };
    var order = pts.map(function (p) { return p.id; });
    var asg = {};
    (slots || []).forEach(function (s, si) { (s.ids || []).forEach(function (id) { if (byId[id] && asg[id] == null) asg[id] = si; }); });
    // Defensive: a point the caller did not place goes to the nearest slot by home centre.
    order.forEach(function (id) {
      if (asg[id] != null) return;
      var best = 0, bd = Infinity;
      S.forEach(function (s, si) { var v = s.home ? d2(xy(byId[id]), [s.home[1] * cosLat, s.home[0]]) : Infinity; if (v < bd) { bd = v; best = si; } });
      asg[id] = best;
    });
    var members = function (si) { return order.filter(function (id) { return asg[id] === si; }); };
    var centerOf = function (si) {
      var m = members(si);
      if (!m.length) return S[si].home ? [S[si].home[1] * cosLat, S[si].home[0]] : [0, 0];
      return [m.reduce(function (t, id) { return t + xy(byId[id])[0]; }, 0) / m.length, m.reduce(function (t, id) { return t + xy(byId[id])[1]; }, 0) / m.length];
    };
    var load = function () { var L = S.map(function () { return 0; }); order.forEach(function (id) { L[asg[id]]++; }); return L; };
    // 1) Clear overloads, cheapest extra distance first.
    for (var guard = 0; guard < 100000; guard++) {
      var L = load(), C = S.map(function (_, si) { return centerOf(si); }), best = null;
      order.forEach(function (id) {
        var s = asg[id];
        if (L[s] <= S[s].cap) return;
        var p = xy(byId[id]), ds = d2(p, C[s]);
        S.forEach(function (t, ti) {
          if (ti === s || L[ti] >= t.cap) return;
          var cost = d2(p, C[ti]) - ds;
          if (!best || cost < best.cost - 1e-15) best = { cost: cost, id: id, to: ti };
        });
      });
      if (!best) break;
      asg[best.id] = best.to;
    }
    // 2) Unstretch within the quotas.
    var EPS = 1e-14;
    for (var pass = 0; pass < 200; pass++) {
      var C2 = S.map(function (_, si) { return centerOf(si); }), L2 = load(), moved = false;
      order.forEach(function (id) {
        var a = asg[id], p = xy(byId[id]);
        for (var b = 0; b < S.length; b++) {
          if (b === a || L2[b] >= S[b].cap) continue;
          if (d2(p, C2[b]) < d2(p, C2[a]) - EPS) { L2[a]--; L2[b]++; asg[id] = b; a = b; moved = true; }
        }
      });
      for (var i = 0; i < order.length; i++) {
        for (var j = i + 1; j < order.length; j++) {
          var A = asg[order[i]], B = asg[order[j]];
          if (A === B) continue;
          var pi = xy(byId[order[i]]), pj = xy(byId[order[j]]);
          if (d2(pi, C2[B]) + d2(pj, C2[A]) < d2(pi, C2[A]) + d2(pj, C2[B]) - EPS) { asg[order[i]] = B; asg[order[j]] = A; moved = true; }
        }
      }
      if (!moved) break;
    }
    return {
      ok: true,
      slots: S.map(function (s, si) {
        var m = members(si), c = centerOf(si);
        return { key: s.key, ids: m, center: [round6(c[1]), round6(c[0] / cosLat)], polygon: m.length ? zonePolygon(m.map(function (id) { return byId[id]; }), cosLat) : null };
      }),
    };
  }
```

and add `fitFixedLoad: fitFixedLoad,` to the returned API object (next to `assignSlots`).

- [ ] **Step 4: Run — expect PASS** (all geometry tests).

- [ ] **Step 5: Commit**

```bash
git add dist-zones.js server/tests/dist-zones-geometry.test.js
git commit -m "feat(distribusi): fitFixedLoad - fit regular customers into the quota left after fixed-day visits"
```

---

### Task 3: The "Per hari kirim" planner counts fixed-day visits

**Files:**
- Modify: `server/src/services/zone.service.js` (`autoDaily`)
- Test: `server/tests/customer-fixed-days.test.js`

**Interfaces:**
- Consumes: `DZ.capacitatedGroups`, `DZ.assignSlots`, `DZ.fitFixedLoad` (Task 2), `planCust().fixed` (Task 1).
- Produces: `POST /distribusi/zones/auto` (mode `daily`) response additions — each `groups[i]` gains `fixed: number` (fixed-day visits in that slot) and may have `polygon: null` for a slot that only has fixed visits; top-level `fixedCustomers: number`, `sundayVisits: number`.

- [ ] **Step 1: Write the failing tests** — append to `server/tests/customer-fixed-days.test.js`:

```js
describe('the daily planner counts fixed-day visits', () => {
  // Fresh world: 10 regular customers in one neighbourhood + 2 hotels there on Sen/Rab/Jum.
  const P = (i) => ({ lat: -8.650 + (i % 5) * 0.001, lng: 115.220 + Math.floor(i / 5) * 0.001 });
  let hotels;
  beforeAll(async () => {
    // Delivery rows from the board test reference customers: start from a clean database.
    await resetDb();
    gm = (await reg({ name: 'Boss', username: 'gm_fixed_plan', password: 'secret123', role: 'gm' })).token;
    for (let i = 0; i < 10; i++) await mk('Biasa ' + i, P(i));
    hotels = [(await mk('Hotel X', Object.assign({ fixedDays: true, deliveryDays: ['Sen', 'Rab', 'Jum'] }, P(2)))).data.id,
      (await mk('Hotel Y', Object.assign({ fixedDays: true, deliveryDays: ['Sen', 'Min'] }, P(3)))).data.id];
    await mk('Hotel Tanpa Titik', { fixedDays: true, deliveryDays: ['Sel', 'Kam'] });
  });
  const auto = (body) => request(app).post(`${Z}/auto`).set(auth(gm)).send(Object.assign({ mode: 'daily', armadas: ['DK 1'] }, body));

  it('a slot counts regular + fixed and never exceeds the maximum', async () => {
    const r = await auto({ maxPerDay: 4, dryRun: true });
    expect(r.status).toBe(200);
    r.body.data.groups.forEach((g) => expect(g.count + g.fixed).toBeLessThanOrEqual(4));
    const sen = r.body.data.groups.find((g) => g.day === 'Sen');
    expect(sen.fixed).toBe(2);                                  // Hotel X + Hotel Y
    expect(r.body.data.groups.reduce((s, g) => s + g.count, 0)).toBe(10);   // every regular placed
    expect(r.body.data.fixedCustomers).toBe(2);
    expect(r.body.data.sundayVisits).toBe(1);                   // Hotel Y's Minggu: kept, not counted
  });

  it('fixed visits alone over the maximum → 400 naming the day and the customers', async () => {
    // Two armadas so 10 one-customer routes fit (12 slots) and the FIXED check is what refuses.
    const r = await auto({ maxPerDay: 1, armadas: ['DK 1', 'DK 2'], dryRun: true });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Senin/);
    expect(r.body.error.message).toMatch(/Hotel X/);
  });

  it('not enough room once fixed visits are counted → 400 Kapasitas kurang', async () => {
    const r = await auto({ maxPerDay: 2, dryRun: true });     // 6 slots × 2 = 12 − 4 fixed visits = 8 < 10
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Kapasitas kurang/);
  });

  it('applying keeps every fixed day, gives hotels the armada, and a hotel without a point is untouched', async () => {
    const r = await auto({ maxPerDay: 4 });
    expect(r.status).toBe(200);
    const x = await prisma.customer.findUnique({ where: { id: hotels[0] } });
    expect(JSON.parse(x.deliveryDays)).toEqual(['Sen', 'Rab', 'Jum']);
    expect(x.armada).toBe('DK 1');
    expect(x.zoneId).not.toBeNull();
    const nop = await prisma.customer.findFirst({ where: { name: 'Hotel Tanpa Titik' } });
    expect(JSON.parse(nop.deliveryDays)).toEqual(['Sel', 'Kam']);
    expect(nop.zoneId).toBeNull();
  });

  it('with no regular customers at all → a clear 400', async () => {
    await prisma.customer.updateMany({ where: { fixedDays: false }, data: { lat: null, lng: null } });
    const r = await auto({ maxPerDay: 4, dryRun: true });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/pelanggan biasa/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`g.fixed` undefined, no refusals).

- [ ] **Step 3: Implement** — in `server/src/services/zone.service.js`, replace the body of `autoDaily` from the `const pool = …` line through the `const summary = { … };` block with:

```js
  const pool = custs.filter(hasCoords).filter((c) => !keptOut(c));
  const regular = pool.filter((c) => !c.fixedDays);
  const fixed = pool.filter((c) => c.fixedDays);
  if (!regular.length) throw ApiError.badRequest('Belum ada pelanggan biasa bertitik untuk dibagi ke rute harian.');
  const pt = (c) => ({ id: c.id, lat: c.lat, lng: c.lng });
  // 1. Territories from regular customers (as before).
  const groups = DZ.capacitatedGroups(regular.map(pt), max);
  const fit = DZ.assignSlots(groups, armadas, DAILY_DAYS);
  if (!fit.ok) {
    throw ApiError.badRequest(`Kapasitas kurang: ${regular.length} pelanggan biasa butuh ${fit.needed} rute harian (maks ${max} per hari), `
      + `tapi ${armadas.length} armada × ${DAILY_DAYS.length} hari = ${fit.available} rute. Naikkan maksimal per hari atau tambah armada.`);
  }
  const keyOf = (a, d) => a + '|' + d;
  const routeCenters = groups.map((g, i) => ({ armada: fit.slots[i].armada, center: g.center }));
  const near = (c, list) => list.reduce((b, r) => { const dd = (r.center[0] - c.lat) ** 2 + (r.center[1] - c.lng) ** 2; return !b || dd < b.dd ? { r, dd } : b; }, null).r;
  // 2. Each fixed customer: the armada of its nearest route. 3. Its visits per (armada, day).
  const fixedArmada = new Map(fixed.map((c) => [c.id, near(c, routeCenters).armada]));
  const visits = {}, visitNames = {};
  let sundayVisits = 0;
  fixed.forEach((c) => parseDays(c.deliveryDays).forEach((d) => {
    if (!DAILY_DAYS.includes(d)) { if (d === 'Min') sundayVisits++; return; }
    const k = keyOf(fixedArmada.get(c.id), d);
    visits[k] = (visits[k] || 0) + 1;
    (visitNames[k] = visitNames[k] || []).push(c.name);
  }));
  // 4. Quota left per slot; fixed visits alone over the maximum → refuse, naming who.
  const over = Object.keys(visits).filter((k) => visits[k] > max);
  if (over.length) {
    const lines = over.map((k) => { const [a, d] = k.split('|'); return `${DAY_NAME[d]} · ${a}: ${visits[k]} kunjungan hari tetap (${visitNames[k].slice(0, 5).join(', ')}${visitNames[k].length > 5 ? ', …' : ''})`; });
    throw ApiError.badRequest(`Hari penuh oleh pelanggan hari tetap (maks ${max} per hari): ${lines.join('; ')}. Naikkan maksimal per hari, tambah armada, atau ubah hari tetap pelanggan tersebut.`);
  }
  // 5-6. Fit regular customers into what is left.
  const armadaCentre = (a) => {
    const mine = routeCenters.filter((r) => r.armada === a);
    const list = mine.length ? mine : routeCenters;
    return [list.reduce((s, r) => s + r.center[0], 0) / list.length, list.reduce((s, r) => s + r.center[1], 0) / list.length];
  };
  const slotList = [];
  armadas.forEach((a) => DAILY_DAYS.forEach((d) => {
    const gi = fit.slots.findIndex((s) => s.armada === a && s.day === d);
    slotList.push({ key: keyOf(a, d), armada: a, day: d, cap: max - (visits[keyOf(a, d)] || 0), ids: gi >= 0 ? groups[gi].ids.slice() : [], center: gi >= 0 ? groups[gi].center : armadaCentre(a) });
  }));
  const fitted = DZ.fitFixedLoad(regular.map(pt), slotList);
  if (!fitted.ok) {
    const totalVisits = Object.values(visits).reduce((s, v) => s + v, 0);
    throw ApiError.badRequest(`Kapasitas kurang: ${regular.length} pelanggan biasa, tapi setelah ${totalVisits} kunjungan hari tetap hanya tersisa ${fitted.available} tempat `
      + `(${armadas.length} armada × ${DAILY_DAYS.length} hari × maks ${max}). Naikkan maksimal per hari atau tambah armada.`);
  }
  const bySlot = new Map(fitted.slots.map((s) => [s.key, s]));
  // 7. A zone per slot that has regular members.
  let drafts = slotList.filter((s) => bySlot.get(s.key).ids.length).map((s, i) => {
    const f = bySlot.get(s.key);
    return {
      id: '__day_' + i, key: s.key, name: `${DAY_NAME[s.day]} · ${s.armada}`, color: DZ.colorAt(i), polygon: f.polygon,
      armada: s.armada, deliveryDays: [s.day], day: s.day, ids: f.ids, fixed: visits[s.key] || 0,
      sortOrder: armadas.indexOf(s.armada) * 7 + DAILY_DAYS.indexOf(s.day) + 1,
    };
  });
  // An armada that serves fixed customers but ended with no zone gets one from those customers'
  // points, on its slot with the most room — otherwise nothing would give them that armada.
  armadas.forEach((a) => {
    if (drafts.some((d) => d.armada === a)) return;
    const mine = fixed.filter((c) => fixedArmada.get(c.id) === a);
    if (!mine.length) return;
    const s = slotList.filter((x) => x.armada === a).sort((p, q) => q.cap - p.cap)[0];
    const g = DZ.autoZones(mine.map(pt), 1)[0];
    drafts.push({ id: '__day_fx_' + a, key: s.key, name: `${DAY_NAME[s.day]} · ${a}`, color: DZ.colorAt(drafts.length), polygon: g.polygon, armada: a, deliveryDays: [s.day], day: s.day, ids: [], fixed: visits[s.key] || 0, sortOrder: armadas.indexOf(a) * 7 + DAILY_DAYS.indexOf(s.day) + 1 });
  });
  drafts = drafts.sort((a, b) => a.sortOrder - b.sortOrder);
  // Membership: regular customers locked where their outline disagrees with their route (as before);
  // 8. every fixed customer locked to a zone of ITS armada (the one containing it, else the nearest).
  const planZones = drafts.map(planZone);
  const assigned = new Map();
  drafts.forEach((d) => d.ids.forEach((id) => assigned.set(id, d.id)));
  const locked = new Set(regular.filter((c) => DZ.zoneFor(c.lat, c.lng, planZones) !== assigned.get(c.id)).map((c) => c.id));
  fixed.forEach((c) => {
    const own = drafts.filter((d) => d.armada === fixedArmada.get(c.id));
    const inside = DZ.zoneFor(c.lat, c.lng, own.map(planZone));
    const home = inside || near(c, own.map((d) => ({ id: d.id, center: [d.polygon.reduce((s, p) => s + p[0], 0) / d.polygon.length, d.polygon.reduce((s, p) => s + p[1], 0) / d.polygon.length] }))).id;
    assigned.set(c.id, home);
    locked.add(c.id);
  });
  const existing = await loadZones();
  const gone = new Set(existing.map((z) => z.id));
  const override = (c) => {
    if (assigned.has(c.id)) return Object.assign({}, c, locked.has(c.id) ? { zoneManual: true, zoneId: assigned.get(c.id) } : { zoneManual: false });
    if (c.zoneManual && !keptOut(c) && (!keepManual || (c.zoneId && gone.has(c.zoneId)))) return Object.assign({}, c, { zoneManual: false });
    return c;
  };
  const summary = {
    mode: 'daily', replaces: existing.length, withoutCoords: custs.filter((c) => !hasCoords(c)).length,
    capacity: { max, needed: drafts.length, available: armadas.length * DAILY_DAYS.length }, locked: locked.size - fixed.length,
    fixedCustomers: fixed.length, sundayVisits,
  };
  // Preview rows: every zone, plus any slot that only has fixed-day visits.
  const previewGroups = () => drafts.map((d) => ({ name: d.name, color: d.color, polygon: d.polygon, armada: d.armada, day: d.day, count: d.ids.length, fixed: d.fixed, max }))
    .concat(slotList.filter((s) => visits[s.key] && !drafts.some((d) => d.key === s.key))
      .map((s) => ({ name: `${DAY_NAME[s.day]} · ${s.armada}`, color: '#93A6AE', polygon: null, armada: s.armada, day: s.day, count: 0, fixed: visits[s.key], max })));
```

Then, in the same function:
- in the `if (body.dryRun)` branch replace the `groups: drafts.map(…)` line with `groups: previewGroups(),`;
- in the transaction loop, `d.ids.filter(...)` for `lock`/`free` must also cover fixed customers — replace the loop body after `const z = await tx.distZone.create(…)` with:

```js
      const mineAll = [...assigned.entries()].filter(([, zid]) => zid === d.id).map(([cid]) => cid);
      const lock = mineAll.filter((id) => locked.has(id));
      const free = mineAll.filter((id) => !locked.has(id));
      if (lock.length) await tx.customer.updateMany({ where: { id: { in: lock } }, data: { zoneManual: true, zoneId: z.id } });
      if (free.length) await tx.customer.updateMany({ where: { id: { in: free } }, data: { zoneManual: false } });
```

- and in the final `return Object.assign(summary, { zones: …` add `groups: previewGroups(),`.

- [ ] **Step 4: Run — expect PASS**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/customer-fixed-days.test.js tests/customer-zones.test.js tests/dist-zones-geometry.test.js`

- [ ] **Step 5: Commit**

```bash
git add server/src/services/zone.service.js server/tests/customer-fixed-days.test.js
git commit -m "feat(distribusi): daily-route planner counts fixed-day visits against each day's quota"
```

---

### Task 4: Customer form switch + detail badge

**Files:**
- Modify: `distribution.jsx` (`DistCustomers`: `openAdd`, `openEdit`, `commitForm`, form markup near the day chips, detail "Hari kirim" row)
- Modify: `finance-i18n.js` (EN + ID keys)
- Modify: `finance.css`
- Test: `server/tests/customer-fixed-days.test.js` (static wiring block)

**Interfaces:**
- Consumes: `fixedDays` accepted by `POST/PATCH /distribusi/customers` (Task 1).

- [ ] **Step 1: Write the failing wiring test** — append:

```js
describe('the customer form offers the switch', () => {
  const fs = require('fs'); const path = require('path');
  const jsx = fs.readFileSync(path.join(__dirname, '..', '..', 'distribution.jsx'), 'utf8');
  it('form state, both saves, and the detail badge carry fixedDays', () => {
    expect(jsx).toMatch(/fixedDays: !!d\.fixedDays/);                            // openEdit
    expect((jsx.match(/fixedDays: !!form\.fixedDays/g) || []).length).toBe(2);   // create + update payloads
    expect(jsx).toMatch(/trD\('cust\.fixedDays'\)/);
    expect(jsx).toMatch(/trD\('cust\.fixedBadge'\)/);
  });
  it('a fixed customer with no day is caught before saving', () => {
    expect(jsx).toMatch(/form\.fixedDays && !form\.deliveryDays\.length\) \{ setFormErr\(trD\('cust\.fixedNeedDay'\)\)/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement in `distribution.jsx`:**
  - `openAdd`: add `fixedDays: false` to the object.
  - `openEdit`: add `fixedDays: !!d.fixedDays` to the object.
  - `commitForm`: right after the `mapsUrlInvalid` check add
    ```js
    if (form.fixedDays && !form.deliveryDays.length) { setFormErr(trD('cust.fixedNeedDay')); return; }
    ```
    and add `fixedDays: !!form.fixedDays` to BOTH the `customers.create({ … })` and `customers.update(form.id, { … })` payloads.
  - Markup: directly after the day-chips `<div className="dist-typechips">…DAY_CODES…</div>` line insert
    ```jsx
    <label className="dist-check cust-fixed"><input type="checkbox" checked={!!form.fixedDays} onChange={(e) => setForm({ ...form, fixedDays: e.target.checked })} /><span>{trD('cust.fixedDays')}</span></label>
    {form.fixedDays && <div className="cust-fixed-hint">{trD('cust.fixedHint')}</div>}
    ```
  - Detail row (`cd.hariKirim`): after the `</span>` that closes `cd-daychips` add `{d.fixedDays ? <span className="cust-fixed-badge">{trD('cust.fixedBadge')}</span> : null}`.

- [ ] **Step 4: i18n + CSS.** Add to `finance-i18n.js` next to `'dist.cfDays'` in BOTH dictionaries (use the file tool; typographic apostrophes only):

EN: `'cust.fixedDays': 'Fixed delivery days', 'cust.fixedHint': 'Zones will never change this customer’s days; the armada still follows the zone.', 'cust.fixedNeedDay': 'Pick at least one day for fixed delivery days.', 'cust.fixedBadge': 'Fixed days',`

ID: `'cust.fixedDays': 'Hari tetap', 'cust.fixedHint': 'Zona tidak akan mengubah hari kirim pelanggan ini; armada tetap mengikuti zona.', 'cust.fixedNeedDay': 'Pilih minimal satu hari untuk hari tetap.', 'cust.fixedBadge': 'Hari tetap',`

Append to `finance.css`:

```css
/* Fixed delivery days (hari tetap) — customer form + detail. */
.cust-fixed { margin-top: 8px; }
.cust-fixed-hint { font-size: 12px; color: var(--text-mut); margin-top: 2px; line-height: 1.45; }
.cust-fixed-badge { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 99px; background: var(--sand-soft); color: #6B4A08; font-size: 11px; font-weight: 800; vertical-align: middle; }
```

- [ ] **Step 5: Run the wiring test + build — expect PASS / "built dist/…".**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/customer-fixed-days.test.js` then (repo root) `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add distribution.jsx finance-i18n.js finance.css server/tests/customer-fixed-days.test.js
git commit -m "feat(distribusi): fixed-days switch in the customer form and a badge in the detail"
```

---

### Task 5: Map — "3×" marker, popup editor, filter chip, quota-aware preview

**Files:**
- Modify: `dist-zones.jsx` (`DistZones` layer effect, filters, popup; `ZnAuto` preview rows + map)
- Modify: `finance-shell.jsx` (`<DIST.Zones … canCustomers={!!p.distribusiCustomers}`)
- Modify: `finance-i18n.js`, `finance.css`
- Test: `server/tests/customer-fixed-days.test.js` (static wiring block); visual check in the headless harness

**Interfaces:**
- Consumes: `customers[i].fixedDays` from `GET /distribusi/zones` (Task 1); `groups[i].fixed`, `polygon: null`, `sundayVisits`, `fixedCustomers` from the daily auto preview (Task 3); `API.distribusi.customers.update(id, { fixedDays, deliveryDays })`.

- [ ] **Step 1: Write the failing wiring test** — append:

```js
describe('the zone map shows and edits fixed days', () => {
  const fs = require('fs'); const path = require('path');
  const jsx = fs.readFileSync(path.join(__dirname, '..', '..', 'dist-zones.jsx'), 'utf8');
  const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'finance-shell.jsx'), 'utf8');
  it('fixed customers get their own marker and filter', () => {
    expect(jsx).toMatch(/c\.fixedDays[\s\S]{0,400}zn-fx/);
    expect(jsx).toMatch(/\['fixed', trD\('zn\.fFixed'/);
  });
  it('the popup edits fixed days through the customer API, only with the customer capability', () => {
    expect(jsx).toMatch(/customers\.update\(picked\.id, \{ fixedDays: fx\.on, deliveryDays: fx\.days \}\)/);
    expect(shell).toMatch(/<DIST\.Zones[^>]*canCustomers=\{!!p\.distribusiCustomers\}/);
  });
  it('the daily preview shows regular + fixed against the maximum and skips polygon-less rows on the map', () => {
    expect(jsx).toMatch(/trD\('zn\.nPlusFixed'/);
    expect(jsx).toMatch(/if \(!z\.polygon\) return;/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement in `dist-zones.jsx`:**
  - Signature: `function DistZones({ refreshKey, canManage: capManage, canCustomers, fleet, onChanged, onOpenCustomer })`; add state `const [fx, setFx] = uSz(null);   // { on, days } while editing a picked customer's fixed days`.
  - Counts: `const fixedN = custs.filter((c) => c.fixedDays).length;`
  - Filters array: add `['fixed', trD('zn.fFixed', { n: fixedN })]` after the `bon` entry; in the layer effect change `shown` to `const shown = filter === 'all' || (filter === 'bon' && c.sisaBon > 0) || (filter === 'none' && !c.zoneId) || (filter === 'fixed' && c.fixedDays);`.
  - In the layer effect, replace `const m = L.circleMarker(…); … m.addTo(cg);` for customers with:
    ```js
      let m;
      if (c.fixedDays) {
        // Fixed-day customers: a labelled marker ("3×") so they stand out from once-a-week customers.
        m = L.marker([c.lat, c.lng], { interactive, keyboard: false, opacity: dim, icon: L.divIcon({ className: 'zn-fx-wrap', iconSize: [30, 20], html: '<span class="zn-fx' + (isPick ? ' on' : '') + '" style="--zc:' + znEsc(z ? z.color : '#5E7480') + '">' + (c.deliveryDays || []).length + '×</span>' }) });
      } else {
        m = L.circleMarker([c.lat, c.lng], z
          ? { radius: isPick ? 8 : 6, color: isPick ? '#06334F' : '#fff', weight: isPick ? 3 : 2, fillColor: z.color, fillOpacity: dim, opacity: dim, interactive }
          : { radius: isPick ? 8 : 6, color: isPick ? '#06334F' : '#5E7480', weight: isPick ? 3 : 2, dashArray: isPick ? null : '2 2', fillColor: '#fff', fillOpacity: dim, opacity: dim, interactive });
      }
      if (interactive) m.on('click', (e) => { L.DomEvent.stopPropagation(e); setPick(c.id); setMoveOpen(false); setFx(null); });
      m.addTo(cg);
    ```
  - Popup: after the `zn-pop-bon` line insert
    ```jsx
    {picked.fixedDays && !fx && <div className="zn-pop-fx"><span className="cust-fixed-badge">{trD('cust.fixedBadge')}</span> {picked.deliveryDays.join(', ')}</div>}
    {fx && (
      <div className="zn-fx-edit">
        <label className="dist-check"><input type="checkbox" checked={fx.on} onChange={(e) => setFx((f) => ({ ...f, on: e.target.checked }))} /><span>{trD('cust.fixedDays')}</span></label>
        <div className="zn-days">{ZN_DAYS.map((d) => { const on = fx.days.includes(d); return <button key={d} type="button" className={'zn-day' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setFx((f) => ({ ...f, days: on ? f.days.filter((x) => x !== d) : ZN_DAYS.filter((x) => x === d || f.days.includes(x)) }))}>{d}</button>; })}</div>
        <div className="zn-pop-act">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFx(null)}>{trD('dist.cancel')}</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || (fx.on && !fx.days.length)} onClick={() => { setBusy(true); window.API.distribusi.customers.update(picked.id, { fixedDays: fx.on, deliveryDays: fx.days }).then(() => { setBusy(false); setFx(null); return done(trD('zn.fxSaved')); }).catch((e) => { setBusy(false); flash(errMsg(e)); }); }}>{trD('zn.save')}</button>
        </div>
      </div>
    )}
    ```
    and in `zn-pop-act` add, before the directions link: `{canCustomers && !fx && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFx({ on: !!picked.fixedDays, days: picked.deliveryDays.slice() })}>{trD('zn.fxEdit')}</button>}`.
  - `ZnAuto` map effect: in `prev.groups.forEach((z) => { … })` start the callback with `if (!z.polygon) return;`.
  - `ZnAuto` preview row count cell: replace the `g.max ? trD('zn.nOfMax', …) : …` expression with
    ```jsx
    {g.max ? (g.fixed ? trD('zn.nPlusFixed', { n: g.count, f: g.fixed, t: g.count + g.fixed, m: g.max }) : trD('zn.nOfMax', { n: g.count, m: g.max })) : trD('zn.nCust', { n: g.count })}
    ```
    and make its class `g.max && g.count + (g.fixed || 0) >= g.max ? 'zn-full' : ''`.
  - After the `locked` impact line add `{prev.fixedCustomers > 0 && <div className="zn-impact"><IconCalendar s={15} /><span>{trD('zn.dailyFixed', { n: prev.fixedCustomers })}</span></div>}` and `{prev.sundayVisits > 0 && <div className="zn-impact"><IconWarn s={15} /><span>{trD('zn.dailySunday', { n: prev.sundayVisits })}</span></div>}`.

In `finance-shell.jsx`, add `canCustomers={!!p.distribusiCustomers}` to the `<DIST.Zones` element.

- [ ] **Step 4: i18n + CSS.** Add next to `'zn.dailyApply'` in BOTH dictionaries:

EN: `'zn.fFixed': 'Fixed days · {n}', 'zn.fxEdit': 'Fixed days', 'zn.fxSaved': 'Fixed days saved', 'zn.nPlusFixed': '{n} regular + {f} fixed = {t} / {m}', 'zn.dailyFixed': '{n} fixed-day customers keep their days; their visits are counted in each day’s maximum.', 'zn.dailySunday': '{n} Sunday visits by fixed-day customers are kept but not counted (routes run Monday–Saturday).',`

ID: `'zn.fFixed': 'Hari tetap · {n}', 'zn.fxEdit': 'Hari tetap', 'zn.fxSaved': 'Hari tetap disimpan', 'zn.nPlusFixed': '{n} biasa + {f} hari tetap = {t} / {m}', 'zn.dailyFixed': '{n} pelanggan hari tetap tetap memakai harinya; kunjungannya dihitung dalam maksimal tiap hari.', 'zn.dailySunday': '{n} kunjungan hari Minggu dari pelanggan hari tetap tetap berjalan tapi tidak dihitung (rute berjalan Senin–Sabtu).',`

Append to `finance.css`:

```css
/* Fixed-day customers on the zone map. */
.zn-fx-wrap { background: none; border: 0; }
.zn-fx { display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 18px; padding: 0 4px; border-radius: 6px; background: var(--zc); color: #fff; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(6,51,79,.4); font: 800 10.5px/1 'Inter', system-ui, sans-serif; box-sizing: border-box; }
.zn-fx.on { box-shadow: 0 0 0 3px #06334F; }
.zn-pop-fx { font-size: 12.5px; }
.zn-fx-edit { display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid var(--border-soft); border-radius: 10px; }
```

- [ ] **Step 5: Run tests + build.** `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/customer-fixed-days.test.js` → PASS; `npm run build` → built.

- [ ] **Step 6: Visual check (headless harness in the session scratchpad `zn-harness/`).** In `mock.js` give 3 customers `fixedDays: true, deliveryDays: ['Sen','Rab','Jum']`; in the daily mock, add `fixed: i === 0 ? 3 : 0` to each group and `fixedCustomers: 3, sundayVisits: 1`. Start `python serve.py 8765` in the background (do NOT pipe it into the same shell command as Chrome — it holds the shell open), capture `?s=view` and `?s=auto`, and confirm: "3×" markers visible, filter chip "Hari tetap · 3", preview row "… biasa + 3 hari tetap = … / …", no errors in the page title JSON. Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add dist-zones.jsx finance-shell.jsx finance-i18n.js finance.css server/tests/customer-fixed-days.test.js
git commit -m "feat(distribusi): fixed-day customers on the zone map - 3x marker, popup editor, filter, quota preview"
```

---

### Task 6: Full verification

- [ ] **Step 1:** From `server/`: `npm test` (≈10 min; run it in the background and wait). Expected: all suites pass. If a heavy suite times out while every other passes, re-run that suite alone before concluding anything.
- [ ] **Step 2:** From the repo root: `npm run build` → "built dist/app.<hash>.js".
- [ ] **Step 3:** Migration check on a scratch DB (from `server/`):
  `T="$(pwd)/prisma/_migcheck.db"; rm -f "$T"; DATABASE_URL="file:$T" npx prisma migrate deploy; DATABASE_URL="file:$T" npx prisma migrate diff --from-url "file:$T" --to-schema-datamodel prisma/schema.prisma --script; rm -f "$T"`
  Expected: "All migrations have been successfully applied"; the diff mentions nothing about `fixedDays` (two pre-existing index lines are known drift).
