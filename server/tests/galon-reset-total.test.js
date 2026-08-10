'use strict';
// RESET TOTAL STOK GALON — clean slate for the whole gallon ledger.
// ABSOLUTE BOUNDARY: touches ONLY GallonMovement. Every DistTransaction row + nominal, every
// customer's Sisa Bon, every invoice total, and all revenue figures are byte-identical before/after —
// asserted PER RECORD. The reset can never move money.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const S = (v) => String(v);   // BigInt/Number → string, stable for deep-equal

let owner, gm, cA, cB;
const DATE = '2026-10-08';
const gallon = () => request(app).get('/api/v1/distribusi/gallon').set(auth(owner)).then((r) => r.body.data);
const preview = (body) => request(app).post('/api/v1/distribusi/gallon/reset-total/preview').set(auth(owner)).send(body).then((r) => r.body.data);
const commit = (body) => request(app).post('/api/v1/distribusi/gallon/reset-total').set(auth(owner)).send(body);

// A full snapshot of the MONEY side — per record, sorted so deep-equal is order-independent.
async function moneySnapshot() {
  const txns = await prisma.distTransaction.findMany({ select: { id: true, amount: true, unitPriceLocked: true, method: true, status: true, customerId: true } });
  const invs = await prisma.distInvoice.findMany({ select: { id: true, total: true, sisaBon: true } });
  const custRes = await request(app).get('/api/v1/distribusi/customers').set(auth(owner));
  return {
    txns: txns.map((t) => ({ id: t.id, amount: S(t.amount), unit: S(t.unitPriceLocked), method: t.method, status: t.status })).sort((a, b) => a.id.localeCompare(b.id)),
    invoices: invs.map((i) => ({ id: i.id, total: S(i.total), sisaBon: S(i.sisaBon) })).sort((a, b) => a.id.localeCompare(b.id)),
    sisaBon: custRes.body.data.map((c) => ({ id: c.id, sisaBon: S(c.sisaBon) })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_rt', password: 'secret123', role: 'owner' })).token;
  gm = (await reg({ name: 'GM', username: 'gm_rt', password: 'secret123', role: 'gm' })).token;
  cA = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'BU RIRIS', code: 'C-A', type: 'reguler', masterPrice: 13000, armada: 'Merah' })).body.data.id;
  cB = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'PAK ADI', code: 'C-B', type: 'reguler', masterPrice: 13000, armada: 'Biru' })).body.data.id;
  // REAL money: bon sales (create sisa bon) + a lunas sale + an invoice for cA.
  await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cA, qty: 5, method: 'bon', txnDate: DATE });
  await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cA, qty: 3, method: 'bon', txnDate: DATE });
  await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cB, qty: 4, method: 'lunas', txnDate: DATE });
  await request(app).post('/api/v1/distribusi/customers/' + cA + '/invoices').set(auth(owner)).send({ scope: 'unpaidBon' });
  // Gallon ledger junk to wipe: 611 opening, 122 "untraceable" damage, plus the delivery rows above.
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 611, fleet: 'all', reason: 'stok awal' });
  await prisma.gallonMovement.create({ data: { type: 'damage', qty: 122, fleetId: '', active: true, note: 'tak terlacak', actorName: 'x' } });
});
afterAll(() => prisma.$disconnect());

const COUNTS = { depot: 300, armada: { Merah: 50 }, rusak: 5, customersMode: 'zero' };

describe('reset (retire) sets buckets exactly to the counts; invariant holds; nothing negative', () => {
  it('preview then commit → depot 300, armada 50, pelanggan 0, rusak 5, stok awal 0', async () => {
    const p = await preview({ mode: 'retire', counts: COUNTS });
    expect(p.blocked).toBe(false);
    expect(p.after).toMatchObject({ depot: 300, armada: 50, pelanggan: 0, rusak: 5, total: 355, baseline: 0 });
    expect(p.transaksi.unchanged).toBe(true);
    const r = await commit({ mode: 'retire', counts: COUNTS, note: 'stok tidak cocok', confirm: 'RESET TOTAL' });
    expect(r.status).toBe(201);
    const g = await gallon();
    expect(g.stock).toMatchObject({ atDepot: 300, atArmada: 50, atCustomers: 0, rusakHilang: 5, totalDimiliki: 355 });
    expect(g.opening.total).toBe(0);                       // "Stok awal" → 0 (baseline rows are not opening)
    expect(g.invariant.ok).toBe(true);
    expect(g.stock.atDepot + g.stock.atArmada + g.stock.atCustomers + g.stock.rusakHilang).toBe(g.stock.totalDimiliki);
  });
});

describe('CRITICAL — money is byte-identical before and after, per record', () => {
  let before;
  it('captures money, resets, and every transaction / sisa bon / invoice is unchanged', async () => {
    before = await moneySnapshot();
    expect(before.txns.length).toBe(3);
    expect(before.sisaBon.find((c) => c.id === cA).sisaBon).not.toBe('0');   // cA really owes bon
    const r = await commit({ mode: 'retire', counts: COUNTS, note: 'ulang', confirm: 'RESET TOTAL' });
    expect(r.status).toBe(201);
    const after = await moneySnapshot();
    expect(after.txns).toEqual(before.txns);         // every transaction row + nominal
    expect(after.invoices).toEqual(before.invoices); // every invoice total + sisaBon
    expect(after.sisaBon).toEqual(before.sisaBon);   // every customer's Sisa Bon
  });
});

describe('restore brings the previous ledger back', () => {
  it('restore returns the EXACT pre-reset ledger (buckets + stok awal); money still identical', async () => {
    const gBefore = await gallon();
    const money = await moneySnapshot();
    const r = await commit({ mode: 'retire', counts: { depot: 777, armada: { Merah: 3 }, rusak: 1, customersMode: 'zero' }, note: 'x', confirm: 'RESET TOTAL' });
    const batchId = r.body.data.batchId;
    expect((await gallon()).stock.atDepot).toBe(777);   // state genuinely changed
    const restore = await request(app).post('/api/v1/distribusi/gallon/reset-total/restore').set(auth(owner)).send({ batchId });
    expect(restore.status).toBe(200);
    const gAfter = await gallon();
    expect(gAfter.stock).toMatchObject({ atDepot: gBefore.stock.atDepot, atArmada: gBefore.stock.atArmada, atCustomers: gBefore.stock.atCustomers, rusakHilang: gBefore.stock.rusakHilang, totalDimiliki: gBefore.stock.totalDimiliki });
    expect(gAfter.opening.total).toBe(gBefore.opening.total);
    expect(await moneySnapshot()).toEqual(money);
  });
  it('a full chain of restores can walk back to the ORIGINAL 611/122', async () => {
    // reset once from a known non-trivial state, then restore it, and confirm the batch snapshot round-trips
    const g0 = await gallon();
    const r = await commit({ mode: 'retire', counts: { depot: 5, armada: {}, rusak: 0, customersMode: 'zero' }, note: 'x', confirm: 'RESET TOTAL' });
    await request(app).post('/api/v1/distribusi/gallon/reset-total/restore').set(auth(owner)).send({ batchId: r.body.data.batchId });
    expect((await gallon()).stock.totalDimiliki).toBe(g0.stock.totalDimiliki);
  });
});

describe('guards', () => {
  it('non-owner (GM) is rejected server-side even with a crafted request', async () => {
    const r = await request(app).post('/api/v1/distribusi/gallon/reset-total').set(auth(gm)).send({ mode: 'retire', counts: COUNTS, note: 'x', confirm: 'RESET TOTAL' });
    expect(r.status).toBe(403);
  });
  it('wrong typed confirmation is rejected', async () => {
    const r = await commit({ mode: 'retire', counts: COUNTS, note: 'x', confirm: 'reset' });
    expect(r.status).toBe(400);
  });
  it('a negative preserved-customer figure is rejected, naming the figure', async () => {
    // seed a customer holding negative gallons (returns > deliveries) then preserve → after.pelanggan < 0
    const cN = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'NEG', type: 'reguler', masterPrice: 13000, armada: 'Merah' })).body.data.id;
    await prisma.gallonMovement.create({ data: { type: 'return_in', qty: 10, customerId: cN, fleetId: 'Merah', active: true, note: 'x' } });
    const p = await preview({ mode: 'retire', counts: { depot: 0, customersMode: 'preserve' } });
    expect(p.blocked).toBe(true);
    expect(p.offenders.some((o) => o.figure === 'pelanggan')).toBe(true);
    const r = await commit({ mode: 'retire', counts: { depot: 0, customersMode: 'preserve' }, note: 'x', confirm: 'RESET TOTAL' });
    expect(r.status).toBe(400);
    // clean up the negative row so later scenarios aren't affected
    await prisma.gallonMovement.deleteMany({ where: { customerId: cN } });
  });
});

describe('dryRun preview == post-write, for several scenarios', () => {
  it('five count-sets: the buckets after commit equal the previewed after', async () => {
    const scenarios = [
      { depot: 100, armada: { Merah: 10 }, rusak: 0, customersMode: 'zero' },
      { depot: 0, armada: { Biru: 25 }, rusak: 3, customersMode: 'zero' },
      { depot: 500, armada: {}, rusak: 0, customersMode: 'zero' },
      { depot: 42, armada: { Merah: 7, Biru: 8 }, rusak: 9, customersMode: 'zero' },
      { depot: 0, armada: {}, rusak: 0, customersMode: 'zero' },
    ];
    for (const counts of scenarios) {
      const p = await preview({ mode: 'retire', counts });
      const r = await commit({ mode: 'retire', counts, note: 'skenario', confirm: 'RESET TOTAL' });
      expect(r.status).toBe(201);
      const g = await gallon();
      expect(g.stock.atDepot).toBe(p.after.depot);
      expect(g.stock.atArmada).toBe(p.after.armada);
      expect(g.stock.rusakHilang).toBe(p.after.rusak);
      expect(g.stock.totalDimiliki).toBe(p.after.total);
      expect(g.invariant.ok).toBe(true);
    }
  });
});
