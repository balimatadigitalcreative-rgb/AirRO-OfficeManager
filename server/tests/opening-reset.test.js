'use strict';
// "Setel Ulang Stok Awal" — the −307 bug. Root cause: the preview mixed two bases (opening baseline at
// fleetId='' exact vs depot summed across ALL fleets) and applied the delta to the wrong one, and the
// write could drive stock negative. Fixes: ONE base (baseline & depot at the SAME exact scope), reject
// any result below 0, and preview == write (server dryRun of the same function).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let owner, cBiru;
const DATE = '2026-10-07';
const gallon = (fleet) => request(app).get('/api/v1/distribusi/gallon' + (fleet ? '?fleet=' + fleet : '')).set(auth(owner)).then((r) => r.body.data);
const impact = (mode, fleetId, targetQty) => request(app).get('/api/v1/distribusi/gallon/opening/reset/impact?mode=' + mode + '&fleetId=' + encodeURIComponent(fleetId) + (targetQty != null ? '&targetQty=' + targetQty : '')).set(auth(owner)).then((r) => r.body.data);
const reset = (body) => request(app).post('/api/v1/distribusi/gallon/opening/reset').set(auth(owner)).send(body);
const setOpening = (qty, fleet) => request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty, fleet, reason: 'stok awal' });
const balSnap = async () => { const d = await gallon(); const m = {}; (d.balances || []).forEach((b) => { m[b.customerId] = b.held; }); return m; };

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_or', password: 'secret123', role: 'owner' })).token;
  cBiru = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Cust Biru', type: 'reguler', masterPrice: 5000, armada: 'Biru' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('baseline 307 → 0 (nothing deployed): all figures 0, never negative', () => {
  it('preview and result are both 0 for baseline, depot and total', async () => {
    await setOpening(307, 'Biru');
    const p = await impact('delta', 'Biru', 0);
    expect(p.blocked).toBe(false);
    expect(p.baselineBefore).toBe(307); expect(p.baselineAfter).toBe(0);
    expect(p.depotBefore).toBe(307); expect(p.depotAfter).toBe(0);      // ONE base — no −307
    expect(p.totalBefore).toBe(307); expect(p.totalAfter).toBe(0);
    const r = await reset({ mode: 'delta', targetQty: 0, fleetId: 'Biru', note: 'salah input awal' });
    expect(r.status).toBe(201);
    const g = await gallon('Biru');
    expect(g.stock.atDepot).toBe(0); expect(g.stock.totalOwned).toBe(0);
    expect(g.opening.total).toBe(0);
  });
});

describe('baseline 307 → 120: delta row −187, customers byte-identical', () => {
  it('result 120; a −187 opening row appended; customer gallons unchanged', async () => {
    await setOpening(307, 'Merah');
    const before = await balSnap();
    const p = await impact('delta', 'Merah', 120);
    expect(p.delta).toBe(-187); expect(p.depotAfter).toBe(120);
    const r = await reset({ mode: 'delta', targetQty: 120, fleetId: 'Merah', note: 'koreksi' });
    expect(r.status).toBe(201);
    expect((await prisma.gallonMovement.findMany({ where: { fleetId: 'Merah', type: 'opening', qty: -187, active: true } })).length).toBe(1);
    const g = await gallon('Merah');
    expect(g.stock.atDepot).toBe(120); expect(g.opening.total).toBe(120);
    expect(await balSnap()).toEqual(before);
  });
});

describe('impossible result is rejected server-side, naming the figure', () => {
  it('opening 100, deliver 60 → depot 40; target 0 would make depot −60 → rejected', async () => {
    await setOpening(100, 'Ungu');
    const cUngu = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Cust Ungu', type: 'reguler', masterPrice: 5000, armada: 'Ungu' })).body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cUngu, qty: 60, method: 'lunas', txnDate: DATE });   // legacy depot→pelanggan (no run)
    expect((await gallon('Ungu')).stock.atDepot).toBe(40);
    const p = await impact('delta', 'Ungu', 0);
    expect(p.blocked).toBe(true);
    expect(p.offenders.some((o) => o.figure === 'depot' && o.value === -60)).toBe(true);
    const r = await reset({ mode: 'delta', targetQty: 0, fleetId: 'Ungu', note: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/depot|negatif/i);
    // void_all is guarded too (removing 100 baseline would push depot to −60)
    expect((await reset({ mode: 'void_all', fleetId: 'Ungu', note: 'x', confirm: '1' })).status).toBe(400);
  });
});

describe('fleet scope: no cross-scope summation', () => {
  it('resetting Biru leaves Merah and the global depot untouched', async () => {
    await setOpening(200, 'all');   // global depot ''
    const merahBefore = (await gallon('Merah')).stock.atDepot;
    const globalBefore = (await gallon('')).stock.atDepot;   // note: '' via no-fleet is all — use exact below
    const globalExact = (await impact('delta', '', 999)).depotBefore;   // exact global-depot depot
    await setOpening(80, 'Biru');
    await reset({ mode: 'delta', targetQty: 10, fleetId: 'Biru', note: 'koreksi biru' });
    expect((await gallon('Merah')).stock.atDepot).toBe(merahBefore);
    expect((await impact('delta', '', 999)).depotBefore).toBe(globalExact);   // global depot unchanged
    expect((await gallon('Biru')).stock.atDepot).toBe(10);
  });
});

describe('preview == write (server dryRun) for several scenarios', () => {
  it('five targets: the post-write figures equal the previewed figures', async () => {
    await setOpening(500, 'Hijau');
    for (const target of [300, 450, 100, 600, 0]) {
      const p = await impact('delta', 'Hijau', target);
      expect(p.blocked).toBe(false);
      const r = await reset({ mode: 'delta', targetQty: target, fleetId: 'Hijau', note: 'skenario ' + target });
      expect(r.status).toBe(201);
      const g = await gallon('Hijau');
      expect(g.opening.total).toBe(p.baselineAfter);   // baseline
      expect(g.stock.atDepot).toBe(p.depotAfter);      // depot
      expect(g.stock.totalOwned).toBe(p.totalAfter);   // total
    }
  });
});
