'use strict';
// Dashboard money-in split: CASH (what delivery staff physically deposit) vs TRANSFER (paid
// straight to the company account). A `lunas` sale is always cash; a `pelunasan` (bon settlement)
// is cash unless paid by bank transfer. The split must always re-sum to the existing money-in
// total, honour the period/fleet scope, and expose per-fleet cash for reconciliation.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let owner, custMerah, custBiru;
const DAY = '2026-09-10';
const sale = (cust, qty, method) => request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cust, qty, method, txnDate: DAY });
const pay = (cust, amount, payMethod) => request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cust, method: 'pelunasan', payAmount: amount, payMethod, txnDate: DAY });
const summary = (q = '') => request(app).get(`/api/v1/distribusi/dashboard/summary?date=${DAY}${q}`).set(auth(owner)).then((r) => r.body.data);

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_cs', password: 'secret123', role: 'owner' })).token;
  custMerah = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Cust Merah', type: 'reguler', masterPrice: 5000, armada: 'Merah' })).body.data.id;
  custBiru = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Cust Biru', type: 'reguler', masterPrice: 6000, armada: 'Biru' })).body.data.id;

  // Merah: lunas 4×5000 = 20 000 (cash). bon 2×5000 = 10 000 (receivable, not money-in).
  await sale(custMerah, 4, 'lunas');
  await sale(custMerah, 2, 'bon');
  // Merah: settle 7 000 of that bon in CASH.
  await pay(custMerah, 7000, 'cash');
  // Biru: lunas 3×6000 = 18 000 (cash). bon 5×6000 = 30 000, settle 12 000 by TRANSFER.
  await sale(custBiru, 3, 'lunas');
  await sale(custBiru, 5, 'bon');
  await pay(custBiru, 12000, 'transfer');
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — dashboard CASH vs TRANSFER split', () => {
  // Expected (all fleets): cash = 20000 + 18000 + 7000 = 45000 ; transfer = 12000 ; total = 57000.
  it('splits money-in into cash + transfer, and the split re-sums to the total', async () => {
    const s = await summary();
    expect(s.todayCash).toBe(45000);
    expect(s.todayTransfer).toBe(12000);
    expect(s.uangMasuk).toBe(57000);                       // unchanged existing total
    expect(s.todayCash + s.todayTransfer).toBe(s.uangMasuk);   // invariant: cash + transfer == money-in
    // the 7-day period figures split the same way and also re-sum
    expect(s.periodInCash).toBe(45000);
    expect(s.periodInTransfer).toBe(12000);
    expect(s.periodInCash + s.periodInTransfer).toBe(s.periodIn);
  });

  it('a bank-transfer pelunasan is NOT counted as cash the driver owes', async () => {
    const s = await summary();
    // Biru's only cash money-in is its lunas 18 000 — the 12 000 settlement was a transfer.
    const biru = s.todayCashByFleet.find((f) => f.fleetId === 'Biru');
    expect(biru).toMatchObject({ cash: 18000, transfer: 12000 });
    const merah = s.todayCashByFleet.find((f) => f.fleetId === 'Merah');
    expect(merah).toMatchObject({ cash: 27000, transfer: 0 });   // 20 000 lunas + 7 000 cash pelunasan
  });

  it('respects the fleet filter: ?fleet=Biru shows only that fleet’s cash vs transfer', async () => {
    const s = await summary('&fleet=Biru');
    expect(s.todayCash).toBe(18000);
    expect(s.todayTransfer).toBe(12000);
    expect(s.uangMasuk).toBe(30000);
    expect(s.todayCash + s.todayTransfer).toBe(s.uangMasuk);
    expect(s.todayCashByFleet.every((f) => f.fleetId === 'Biru')).toBe(true);
  });

  it('cash+transfer == money-in still holds when there are zero transfers (all cash)', async () => {
    const s = await summary('&fleet=Merah');
    expect(s.todayTransfer).toBe(0);
    expect(s.todayCash).toBe(27000);
    expect(s.todayCash + s.todayTransfer).toBe(s.uangMasuk);
  });
});
