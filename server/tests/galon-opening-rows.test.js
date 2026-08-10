'use strict';
// RINCIAN STOK AWAL — per-row opening/depot management. Fixes the two selection bugs: rows written by
// earlier resets (note "reset stok galon", excluded by isOpeningRow) ARE listed + voidable, and the
// panel lists every fleet + the global depot (no scope mismatch). customerId=null ONLY → money and
// customer gallon counts are structurally untouched.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const S = (v) => String(v);

let owner, cA, resetRowId, purchaseId;
const DATE = '2026-10-09';
const panel = (fleet) => request(app).get('/api/v1/distribusi/gallon/opening-rows' + (fleet ? '?fleet=' + fleet : '')).set(auth(owner)).then((r) => r.body.data);
const gallon = () => request(app).get('/api/v1/distribusi/gallon').set(auth(owner)).then((r) => r.body.data);
const bulk = (ids, action, note) => request(app).post('/api/v1/distribusi/gallon/opening-rows/bulk').set(auth(owner)).send({ ids, action, note });
const bulkPrev = (ids, action) => request(app).post('/api/v1/distribusi/gallon/opening-rows/bulk/preview').set(auth(owner)).send({ ids, action }).then((r) => r.body.data);

async function moneySnapshot() {
  const txns = await prisma.distTransaction.findMany({ select: { id: true, amount: true, method: true, status: true } });
  const invs = await prisma.distInvoice.findMany({ select: { id: true, total: true, sisaBon: true } });
  const custRes = await request(app).get('/api/v1/distribusi/customers').set(auth(owner));
  return {
    txns: txns.map((t) => ({ id: t.id, amount: S(t.amount), method: t.method, status: t.status })).sort((a, b) => a.id.localeCompare(b.id)),
    invoices: invs.map((i) => ({ id: i.id, total: S(i.total), sisaBon: S(i.sisaBon) })).sort((a, b) => a.id.localeCompare(b.id)),
    sisaBon: custRes.body.data.map((c) => ({ id: c.id, sisaBon: S(c.sisaBon), galon: c.gallonsHeld })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_or2', password: 'secret123', role: 'owner' })).token;
  cA = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'BU RIRIS', code: 'C-A', type: 'reguler', masterPrice: 13000, armada: 'Merah' })).body.data.id;
  await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cA, qty: 5, method: 'bon', txnDate: DATE });
  await request(app).post('/api/v1/distribusi/customers/' + cA + '/invoices').set(auth(owner)).send({ scope: 'unpaidBon' });
  // Opening baseline 611 as three rows (600 set, +5, +6 adjustments).
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 600, fleet: 'all', reason: 'stok awal' });
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 605, fleet: 'all', reason: 'sesuaikan' });
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 611, fleet: 'all', reason: 'sesuaikan' });
  // An "invisible" reset-attempt row (isOpeningRow REJECTS it) + a LINKED purchase (hard-delete blocked).
  resetRowId = (await prisma.gallonMovement.create({ data: { type: 'correction', qty: -100, customerId: null, fleetId: '', active: true, note: 'Reset stok galon oleh GM: total → 0' } })).id;
  purchaseId = (await prisma.gallonMovement.create({ data: { type: 'purchase', qty: 50, customerId: null, cashEntryId: 'ce-1', fleetId: '', active: true, note: 'beli' } })).id;
});
afterAll(() => prisma.$disconnect());

describe('the panel lists every contributing row and sums to the displayed baseline', () => {
  it('baseline = 611 and includes the reset-attempt row flagged "tidak terklasifikasi"', async () => {
    const p = await panel();
    expect(p.baseline).toBe(611);                                  // matches the Stok Galon figure
    expect((await gallon()).opening.total).toBe(611);
    const reset = p.rows.find((r) => r.id === resetRowId);
    expect(reset).toBeTruthy();
    expect(reset.classification).toBe('reset');
    expect(reset.unclassified).toBe(true);                         // excluded by isOpeningRow, but shown here
    expect(reset.voidable).toBe(true);                             // and IS actionable
    // opening rows sum to the baseline
    expect(p.rows.filter((r) => r.isOpening && r.active).reduce((a, r) => a + r.qty, 0)).toBe(611);
  });
});

describe('void one row drops the baseline by exactly that qty; money + customer gallons untouched', () => {
  it('voiding the +6 adjustment → baseline 605; every transaction / Sisa Bon / customer galon identical', async () => {
    const before = await moneySnapshot();
    const row6 = (await panel()).rows.find((r) => r.isOpening && r.qty === 6);
    expect(row6).toBeTruthy();
    const r = await bulk([row6.id], 'batal', 'salah input');
    expect(r.status).toBe(201);
    expect((await panel()).baseline).toBe(605);
    expect(await moneySnapshot()).toEqual(before);                 // transactions, Sisa Bon AND customer galon unchanged
  });
});

describe('the reset-attempt row (isOpeningRow rejects it) is voidable here', () => {
  it('voids the "reset stok galon" correction → depot rises by 100, money untouched', async () => {
    const money = await moneySnapshot();
    const depotBefore = (await gallon()).stock.atDepot;
    const r = await bulk([resetRowId], 'batal', 'bersihkan sisa reset');
    expect(r.status).toBe(201);
    expect((await gallon()).stock.atDepot).toBe(depotBefore + 100);   // removing a −100 correction
    expect(await moneySnapshot()).toEqual(money);
  });
});

describe('bulk void of all voidable rows → baseline 0, nothing negative; linked row is blocked', () => {
  it('selecting every row voids the unlinked ones (baseline 0) and reports the purchase blocked', async () => {
    const ids = (await panel()).rows.filter((r) => r.active).map((r) => r.id);
    const prev = await bulkPrev(ids, 'batal');
    expect(prev.blockedNeg).toBe(false);
    expect(prev.after.baseline).toBe(0);
    expect(prev.blocked.some((b) => b.id === purchaseId && b.reason === 'cash_linked')).toBe(true);
    const r = await bulk(ids, 'batal', 'reset manual');
    expect(r.status).toBe(201);
    expect((await panel()).baseline).toBe(0);
    const g = await gallon();
    expect(g.stock.atDepot).toBeGreaterThanOrEqual(0);
    expect(g.stock.totalDimiliki).toBeGreaterThanOrEqual(0);
  });
});

describe('hard-delete a linked row is blocked, naming the reason', () => {
  it('hapus on the purchase (cashEntryId) → blocked cash_linked (named), nothing processed', async () => {
    const prev = await bulkPrev([purchaseId], 'hapus');
    expect(prev.eligibleCount).toBe(0);
    const b = prev.blocked.find((x) => x.id === purchaseId);
    expect(b.reason).toBe('cash_linked');
    expect(b.ref).toBe('ce-1');                       // named ref, not a bare count
    const r = await bulk([purchaseId], 'hapus', 'x');
    expect(r.status).toBe(400);
  });
  it('PROBLEM A: hapus on ACTIVE unlinked rows → blocked "still_active" (NOT "linked")', async () => {
    // seed a fresh ACTIVE unlinked opening on an isolated fleet, then try to HARD-DELETE it while active
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 40, fleet: 'Ijo', reason: 'stok awal' });
    const activeOpening = (await panel('Ijo')).rows.filter((r) => r.isOpening && r.active).map((r) => r.id);
    expect(activeOpening.length).toBeGreaterThan(0);
    const prev = await request(app).post('/api/v1/distribusi/gallon/opening-rows/bulk/preview').set(auth(owner)).send({ ids: activeOpening, action: 'hapus', fleetId: 'Ijo' }).then((r) => r.body.data);
    expect(prev.eligibleCount).toBe(0);
    expect(prev.blocked.every((b) => b.reason === 'still_active')).toBe(true);   // named still_active, not cash/txn "linked"
    await request(app).post('/api/v1/distribusi/gallon/opening-rows/bulk').set(auth(owner)).send({ ids: activeOpening, action: 'batal', fleetId: 'Ijo', note: 'cleanup' });   // clean up
  });
  it('a depot correction with EMPTY-STRING link fields is NOT blocked', async () => {
    const emptyLink = (await prisma.gallonMovement.create({ data: { type: 'correction', qty: 7, customerId: null, transactionId: '', cashEntryId: '', fleetId: 'Ijo', active: true, note: 'empty links' } })).id;
    const prev = await request(app).post('/api/v1/distribusi/gallon/opening-rows/bulk/preview').set(auth(owner)).send({ ids: [emptyLink], action: 'batal', fleetId: 'Ijo' }).then((r) => r.body.data);
    expect(prev.eligibleCount).toBe(1);          // "" link fields are NOT real links → actionable
    expect(prev.blocked.length).toBe(0);
    await prisma.gallonMovement.deleteMany({ where: { id: emptyLink } });
  });
});

describe('restore a voided batch returns the baseline', () => {
  it('void the +5 row then restore the batch → baseline returns', async () => {
    // reactivate everything first (previous test voided all) via restore of that batch is complex; instead
    // re-establish a known row: pick a currently-voided opening row and restore it, then void+restore again.
    const voided = (await panel(undefined)).rows.find((r) => r.isOpening && !r.active && r.qty === 600);
    // restore the 600 baseline row so we have a live opening to test the round-trip
    await request(app).post('/api/v1/distribusi/gallon/opening-rows/bulk').set(auth(owner)).send({ ids: [voided.id], action: 'pulihkan', note: 'x' });
    const base1 = (await panel()).baseline;
    expect(base1).toBe(600);
    const r = await bulk([voided.id], 'batal', 'tes');
    const batchId = r.body.data.batchId;
    expect((await panel()).baseline).toBe(0);
    const restore = await request(app).post('/api/v1/distribusi/gallon/opening-rows/restore').set(auth(owner)).send({ batchId });
    expect(restore.status).toBe(200);
    expect((await panel()).baseline).toBe(600);
  });
});

// Runs LAST + fully fleet-scoped (Kuning/Nila) so it never disturbs the tests above.
describe('PROBLEM B: preview from the same write path — after == baseline − Σ(selected opening qty)', () => {
  const bulkP = (ids, action, fleetId) => request(app).post('/api/v1/distribusi/gallon/opening-rows/bulk/preview').set(auth(owner)).send({ ids, action, fleetId }).then((r) => r.body.data);
  const bulkF = (ids, action, fleetId, note) => request(app).post('/api/v1/distribusi/gallon/opening-rows/bulk').set(auth(owner)).send({ ids, action, fleetId, note });
  it('voiding a subset of opening rows reduces the baseline by exactly their qty sum', async () => {
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 500, fleet: 'Kuning', reason: 'stok awal' });
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 893, fleet: 'Kuning', reason: 'sesuaikan' });   // +393
    const p0 = await panel('Kuning');
    expect(p0.baseline).toBe(893);
    const row393 = p0.rows.find((r) => r.qty === 393);
    const money = await moneySnapshot();
    const prev = await bulkP([row393.id], 'batal', 'Kuning');
    expect(prev.after.baseline).toBe(893 - 393);                       // == baseline − Σ(selected qty)
    const r = await bulkF([row393.id], 'batal', 'Kuning', 'buang penyesuaian');
    expect(r.status).toBe(201);
    expect((await panel('Kuning')).baseline).toBe(500);                // actual matches preview exactly
    expect(await moneySnapshot()).toEqual(money);                      // money byte-identical
  });
  it('"Batalkan semua" clears the ledger to 0 with no negative and the invariant holds', async () => {
    // offsetting junk: opening 300 + a "reset stok galon" −300 on a fresh fleet (depot nets to 0)
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 300, fleet: 'Nila', reason: 'stok awal' });
    await prisma.gallonMovement.create({ data: { type: 'correction', qty: -300, customerId: null, fleetId: 'Nila', active: true, note: 'Reset stok galon oleh X: total → 0' } });
    const p = await panel('Nila');
    expect(p.baseline).toBe(300);
    const ids = p.rows.filter((r) => r.voidable).map((r) => r.id);
    const prev = await bulkP(ids, 'batal', 'Nila');
    expect(prev.blockedNeg).toBe(false);                               // voiding ALL nets depot to 0 — never negative
    expect(prev.after.baseline).toBe(0);
    await bulkF(ids, 'batal', 'Nila', 'bersihkan');
    const g = await request(app).get('/api/v1/distribusi/gallon?fleet=Nila').set(auth(owner)).then((r) => r.body.data);
    expect(g.stock.atDepot + g.stock.atArmada + g.stock.atCustomers + g.stock.rusakHilang).toBe(g.stock.totalDimiliki);
    const p2 = await panel('Nila');
    expect(p2.baseline).toBe(0);
    expect(p2.unclassifiedDepot).toBe(0);                              // "depot tak terklasifikasi" → 0
  });
});
