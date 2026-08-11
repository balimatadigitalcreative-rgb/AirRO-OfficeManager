'use strict';
// ACCOUNTING v2 — Part 3 (receivables integration). The NON-NEGOTIABLE invariant: finance receivables
// (the Piutang Usaha journal balance) equals Σ customer Sisa Bon — across EVERY case that moves the
// receivable: plain bon, pelunasan, price corrections, tidak_diakui + kerugian disputes, legacy rows,
// and an overpayment (which reclasses to a customer-credit liability instead of a negative Piutang).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let owner, actor;
const custs = {};
beforeAll(async () => {
  await resetDb();
  const o = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'own_rcv', password: 'secret123', role: 'gm' })).body;
  owner = o.token; actor = { id: o.user.id, name: 'Boss' };
  const mkCust = async (name, armada) => (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name, type: 'reguler', masterPrice: 10000, armada })).body.data;
  const bon = (id, qty, date) => request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: id, qty, method: 'bon', txnDate: date }).then((r) => r.body.data);
  const A = await mkCust('A RIRIS', 'Merah'); custs.A = A.id;
  const B = await mkCust('B ADI', 'Merah'); custs.B = B.id;
  const C = await mkCust('C SITI', 'Biru'); custs.C = C.id;
  const D = await mkCust('D BUDI', 'Biru'); custs.D = D.id;
  const E = await mkCust('E OVER', 'Merah'); custs.E = E.id;
  const F = await mkCust('F LEGACY', 'Biru'); custs.F = F.id;

  // A: bon 100k − pelunasan 30k = 70k
  await bon(custs.A, 10, '2026-08-01');
  await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: custs.A, method: 'pelunasan', txnDate: '2026-08-05', payAmount: 30000 });
  // B: bon 80k + price correction +20k = 100k
  const bB = await bon(custs.B, 8, '2026-08-01');
  await prisma.correction.create({ data: { transactionId: bB.id, reason: 'penyesuaian harga', kind: 'price', deltaAmount: 20000n, active: true } });
  // C: bon 50k − tidak_diakui 20k = 30k
  const bC = await bon(custs.C, 5, '2026-08-01');
  await prisma.distTransactionDispute.create({ data: { transactionId: bC.id, customerId: custs.C, fleetId: 'Biru', status: 'tidak_diakui', reason: 'nominal_beda', disputedAmount: 20000n, note: 'selisih' } });
  // D: bon 60k − kerugian 60k = 0 (full company loss)
  const bD = await bon(custs.D, 6, '2026-08-01');
  await prisma.distTransactionDispute.create({ data: { transactionId: bD.id, customerId: custs.D, fleetId: 'Biru', status: 'kerugian', reason: 'galon_tidak_diterima', disputedAmount: 60000n, note: 'hilang' } });
  // E: bon 40k then an OVERPAYMENT pelunasan 60k (only reachable via legacy import — the API caps it).
  //    Sisa Bon floors at 0; the 20k excess must land in Uang Muka Pelanggan, not a negative Piutang.
  await bon(custs.E, 4, '2026-08-01');
  await prisma.distTransaction.create({ data: { customerId: custs.E, fleetId: 'Merah', qty: 0, unitPriceLocked: 0n, amount: 60000n, method: 'pelunasan', txnDate: '2026-08-06', status: 'active', bonCounted: true, actorName: 'legacy' } });
  // F: LEGACY bon 25k (bonCounted) — still a real receivable.
  await prisma.distTransaction.create({ data: { customerId: custs.F, fleetId: 'Biru', qty: 0, unitPriceLocked: 0n, amount: 25000n, method: 'bon', txnDate: '2026-01-01', status: 'active', legacy: true, bonCounted: true, actorName: 'legacy' } });

  await acc.backfill({ fromDate: '2026-01-01', actor });
});
afterAll(() => prisma.$disconnect());

describe('finance receivables == Σ customer Sisa Bon (full parity)', () => {
  it('the sum of every customer Sisa Bon is the expected 225k', async () => {
    const list = (await request(app).get('/api/v1/distribusi/customers').set(auth(owner))).body.data;
    const byId = {}; list.forEach((c) => { byId[c.id] = c.sisaBon || 0; });
    expect(byId[custs.A]).toBe(70000);
    expect(byId[custs.B]).toBe(100000);
    expect(byId[custs.C]).toBe(30000);
    expect(byId[custs.D]).toBe(0);
    expect(byId[custs.E]).toBe(0);
    expect(byId[custs.F]).toBe(25000);
    const total = list.reduce((s, c) => s + (c.sisaBon || 0), 0);
    expect(total).toBe(225000);
  });

  it('the Piutang Usaha journal balance equals Σ Sisa Bon exactly', async () => {
    const list = (await request(app).get('/api/v1/distribusi/customers').set(auth(owner))).body.data;
    const sumSisaBon = list.reduce((s, c) => s + (c.sisaBon || 0), 0);
    expect(await acc.receivablesBalance()).toBe(sumSisaBon);
    expect(await acc.receivablesBalance()).toBe(225000);
  });

  it('the overpayment sits in Uang Muka Pelanggan (liability), not a negative Piutang', async () => {
    const rows = await acc.accountBalances();
    expect((rows.find((r) => r.code === '2-3000') || {}).balance).toBe(20000);   // E's 20k excess
    expect((rows.find((r) => r.code === '1-1200') || {}).balance).toBe(225000);   // Piutang never negative
  });

  it('the company loss (kerugian) lands in Beban Kerugian Piutang', async () => {
    const rows = await acc.accountBalances();
    expect((rows.find((r) => r.code === '6-7000') || {}).balance).toBe(60000);   // D's 60k write-off
  });

  it('trial balance and the balance-sheet equation still hold', async () => {
    expect((await acc.trialBalance()).balanced).toBe(true);
    const bs = await acc.balanceSheet();
    expect(bs.balanced).toBe(true);
    expect(bs.assets).toBe(bs.liabilities + bs.equity);
  });
});
