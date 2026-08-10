'use strict';
// LOCATION-BASED gallon ledger: a gallon is never destroyed, only relocated between four locations —
// DEPOT · ARMADA · PELANGGAN · RUSAK/HILANG. load_out/load_return (via rit muat/tutup) are the missing
// depot↔armada link. INVARIANT asserted after every write path:
//   depot + armada + pelanggan + rusak/hilang === total galon dimiliki.
// And customer gallon counts must be untouched by depot/armada/opname work (asserted per customer).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let owner, cBiru, cMerah;
const DATE = '2026-10-06';
// Global position (all fleets) — depot + Σarmada + pelanggan + rusak aggregate consistently here.
const pos = () => request(app).get('/api/v1/distribusi/gallon').set(auth(owner)).then((r) => r.body.data);
const balSnap = async () => { const d = await pos(); const m = {}; (d.balances || []).forEach((b) => { m[b.customerId] = b.held; }); return m; };
const sell = (customerId, qty, method) => request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId, qty, method: method || 'lunas', txnDate: DATE });
// The invariant must hold after EVERY write path.
async function expectInvariant() {
  const d = await pos();
  const s = d.stock;
  expect(s.atDepot + s.atArmada + s.atCustomers + s.rusakHilang).toBe(s.totalDimiliki);
  expect(d.invariant.ok).toBe(true);
  return s;
}

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_loc', password: 'secret123', role: 'owner' })).token;
  cBiru = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Cust Biru', type: 'reguler', masterPrice: 5000, armada: 'Biru' })).body.data.id;
  cMerah = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Cust Merah', type: 'reguler', masterPrice: 5000, armada: 'Merah' })).body.data.id;
  // Global depot baseline 500.
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 500, fleet: 'all', reason: 'stok awal depot' });
});
afterAll(() => prisma.$disconnect());

let runId, custAfterDelivery;

describe('depot → armada (load_out)', () => {
  it('muat 80 to Biru → depot −80, armada +80, pelanggan unchanged, invariant holds', async () => {
    const before = await balSnap();
    const r = await request(app).post('/api/v1/distribusi/runs/open').set(auth(owner)).send({ date: DATE, fleet: 'Biru', gallonsOut: 80 });
    expect(r.status).toBe(201); runId = r.body.data.id;
    const s = await expectInvariant();
    expect(s.atDepot).toBe(420);            // 500 − 80
    expect(s.atArmada).toBe(80);
    expect(s.armadaByFleet.Biru).toBe(80);
    expect(s.totalOwned).toBe(500);          // relocation — good total unchanged (runs never add/remove)
    expect(await balSnap()).toEqual(before); // no customer moved
  });
});

describe('armada → pelanggan (delivery)', () => {
  it('deliver 62 → armada 18, pelanggan +62, invariant holds', async () => {
    expect((await sell(cBiru, 62, 'lunas')).status).toBe(201);
    const s = await expectInvariant();
    expect(s.atArmada).toBe(18);             // 80 − 62
    expect(s.armadaByFleet.Biru).toBe(18);
    expect(s.atCustomers).toBe(62);
    expect(s.atDepot).toBe(420);             // depot untouched by an armada→customer delivery
    const d = await pos();
    expect(d.balances.find((b) => b.customerId === cBiru).held).toBe(62);
    custAfterDelivery = await balSnap();      // baseline for "customers unchanged by later depot/armada work"
  });
});

describe('reconciliation: selisih resolved as rusak', () => {
  it('close with 15 returned → selisih 3; unresolved close is rejected', async () => {
    const bad = await request(app).post(`/api/v1/distribusi/runs/${runId}/close`).set(auth(owner)).send({ gallonsFullReturned: 15, gallonsEmptyReturned: 0 });
    expect(bad.status).toBe(400);            // selisih ≠ 0 needs a reason/resolution
  });
  it('resolve as rusak → load_return 15 then armada 0, rusak/hilang +3, invariant holds, customers unchanged', async () => {
    const r = await request(app).post(`/api/v1/distribusi/runs/${runId}/close`).set(auth(owner)).send({ gallonsFullReturned: 15, gallonsEmptyReturned: 0, diffReason: '3 galon pecah di jalan', resolution: 'rusak' });
    expect(r.status).toBe(200);
    const s = await expectInvariant();
    expect(s.atArmada).toBe(0);              // 18 − 15 (load_return) − 3 (rusak off the truck)
    expect(s.rusakHilang).toBe(3);
    expect(s.atDepot).toBe(435);             // 420 + 15 returned
    expect(s.totalOwned).toBe(497);          // good total dropped by the 3 broken
    expect(s.totalDimiliki).toBe(500);       // grand total conserved (rusak still owned)
    expect(await balSnap()).toEqual(custAfterDelivery);   // customer gallons untouched by the rusak resolution
  });
});

describe('stok opname at depot', () => {
  it('physical count 2 fewer → correction row, invariant holds, history intact, customers unchanged', async () => {
    const opn = await request(app).post('/api/v1/distribusi/gallon/opname').set(auth(owner)).send({ location: 'depot', count: 433, note: 'hitung fisik gudang' });
    expect(opn.status).toBe(201);
    expect(opn.body.data).toMatchObject({ location: 'depot', systemFigure: 435, count: 433, diff: -2 });
    // a correction row exists (opname never edits history silently)
    const corr = await prisma.gallonMovement.findMany({ where: { type: 'correction', note: { contains: 'Opname depot' } } });
    expect(corr.length).toBe(1);
    expect(corr[0].qty).toBe(-2);
    const s = await expectInvariant();
    expect(s.atDepot).toBe(433);
    expect(s.totalDimiliki).toBe(498);       // 500 − 2 written off
    expect(await balSnap()).toEqual(custAfterDelivery);
    // opname history records who/when/difference
    const hist = await request(app).get('/api/v1/distribusi/gallon/opname/history').set(auth(owner));
    expect(hist.body.data.length).toBeGreaterThanOrEqual(1);
    expect(hist.body.data[0].detail).toMatch(/selisih -2/);
  });
});

describe('integrity guard (silent-leakage check)', () => {
  it('clean ledger reports no mismatch; a deleted delivery row is detected and repaired', async () => {
    const clean = await request(app).get('/api/v1/distribusi/gallon/integrity').set(auth(owner));
    expect(clean.body.data.missingCount).toBe(0);
    expect(clean.body.data.orphanCount).toBe(0);
    // simulate silent leakage: hard-delete the delivery_out row for the Biru sale
    await prisma.gallonMovement.deleteMany({ where: { customerId: cBiru, type: 'delivery_out' } });
    const broken = await request(app).get('/api/v1/distribusi/gallon/integrity').set(auth(owner));
    expect(broken.body.data.missingCount).toBe(1);
    const audit = await request(app).get('/api/v1/distribusi/audit').set(auth(owner));
    expect(audit.body.data.some((a) => /Ketidakcocokan ledger galon/.test(a.title))).toBe(true);
    // owner repair recreates the missing delivery_out
    const rep = await request(app).post('/api/v1/distribusi/gallon/integrity/repair').set(auth(owner));
    expect(rep.body.data.created).toBe(1);
    expect((await request(app).get('/api/v1/distribusi/gallon/integrity').set(auth(owner))).body.data.missingCount).toBe(0);
  });
});
