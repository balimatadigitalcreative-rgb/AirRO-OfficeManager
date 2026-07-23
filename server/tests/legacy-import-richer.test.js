'use strict';
// Richer per-customer legacy import: Tanggal · Harga · Pembelian Lunas · Pembelian Bon · Pembayaran
// Bon. Exactly one action column per row → lunas / bon / pelunasan. Purchases stay archive-only for
// gallons/KPIs/cash, but bon and pelunasan reconcile the customer's sisa bon
// (= Σ bon − Σ pelunasan). Dedupe by (date+type+amount); batch undo removes the whole batch.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const imp = (t, id, rows) => request(app).post(`/api/v1/distribusi/customers/${id}/transactions/import`).set(auth(t)).send({ rows });
const detail = (t, id) => request(app).get(`/api/v1/distribusi/customers/${id}`).set(auth(t)).then((r) => r.body.data);

let gm, cid;
// mixed rows: a lunas purchase, two bon purchases, and a payment against the bon
const ROWS = [
  { txnDate: '2026-01-05', price: 12000, lunasQty: 10 },                 // LUNAS  → 120,000
  { txnDate: '2026-01-06', price: 12000, bonQty: 5 },                    // BON    → 60,000
  { txnDate: '2026-01-10', price: 10000, bonQty: 4 },                    // BON    → 40,000
  { txnDate: '2026-01-20', paymentAmount: 30000 },                       // PELUNASAN → −30,000
  { txnDate: '2026-01-21', price: 12000, lunasQty: 2, bonQty: 1 },       // two actions → SKIP
  { txnDate: '2026-01-22', price: 12000 },                               // no action → SKIP
  { txnDate: 'bad-date', price: 12000, lunasQty: 1 },                    // bad date → SKIP
  { txnDate: '2026-01-23', bonQty: 3 },                                  // purchase w/o Harga → SKIP
];

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_rich', password: 'secret123', role: 'gm' })).token;
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Rich', type: 'reguler', masterPrice: 5000, armada: 'Merah' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — richer legacy import (lunas / bon / pelunasan)', () => {
  let batchId;
  it('derives the right TYPE per row; skips multi/empty/invalid rows', async () => {
    const r = await imp(gm, cid, ROWS);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ imported: 4, skipped: 4, received: 8 });   // 4 valid, 4 skipped
    batchId = r.body.batchId;
    const raw = await prisma.distTransaction.findMany({ where: { importBatchId: batchId }, orderBy: { txnDate: 'asc' } });
    expect(raw.map((t) => t.method)).toEqual(['lunas', 'bon', 'bon', 'pelunasan']);
    expect(raw.every((t) => t.legacy === true)).toBe(true);
    // computed amounts
    expect(raw.find((t) => t.method === 'lunas')).toMatchObject({ qty: 10, unitPriceLocked: 12000, amount: 120000 });
    expect(raw.filter((t) => t.method === 'bon').map((t) => t.amount).sort((a, b) => a - b)).toEqual([40000, 60000]);
    const pay = raw.find((t) => t.method === 'pelunasan');
    expect(pay).toMatchObject({ qty: 0, unitPriceLocked: 0, amount: 30000 });
    // no gallon movement for any archive row
    expect(await prisma.gallonMovement.count({ where: { customerId: cid } })).toBe(0);
  });

  it('sisa bon reconciles: Σ bon − Σ pelunasan = 60,000 + 40,000 − 30,000 = 70,000', async () => {
    const d = await detail(gm, cid);
    expect(d.sisaBon).toBe(70000);
    // and the customer LIST agrees
    const list = (await request(app).get('/api/v1/distribusi/customers?fleet=Merah').set(auth(gm))).body.data.find((c) => c.id === cid);
    expect(list.sisaBon).toBe(70000);
    // purchases stay archive-only: gallons-sold stat still 0 (no live sales), history shows all 4 rows
    expect(list.totalGalon).toBe(0);
    expect(d.transactions.filter((t) => t.legacy).length).toBe(4);
  });

  it('re-importing the same file is idempotent (all skipped as duplicates)', async () => {
    const r = await imp(gm, cid, ROWS);
    expect(r.body.imported).toBe(0);
    expect(r.body.skipped).toBe(8);
    expect(await prisma.distTransaction.count({ where: { customerId: cid, legacy: true } })).toBe(4);   // still 4
  });

  it('a same-day purchase and payment of the same amount are BOTH kept (dedupe keys on type)', async () => {
    const r = await imp(gm, cid, [
      { txnDate: '2026-02-01', price: 5000, lunasQty: 1 },   // lunas 5,000
      { txnDate: '2026-02-01', paymentAmount: 5000 },        // pelunasan 5,000 — same date+amount, different TYPE
    ]);
    expect(r.body.imported).toBe(2);   // not collapsed
  });

  it('undo removes exactly the batch (only its 4 rows); sisa bon drops accordingly', async () => {
    const before = (await detail(gm, cid)).sisaBon;   // batch1 net 70,000 + batch2 (5k lunas + 5k pelunasan) → 65,000
    expect(before).toBe(65000);
    const del = await request(app).delete(`/api/v1/distribusi/customers/${cid}/transactions/legacy-batch/${batchId}`).set(auth(gm));
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(4);                       // only batch1's rows
    expect(await prisma.distTransaction.count({ where: { customerId: cid, legacy: true } })).toBe(2);   // batch2 survives
    // batch1's bon (60k+40k) and pelunasan (30k) are gone; the leftover batch2 pelunasan (5k) has no
    // bon to offset it → sisa bon floors at 0.
    expect((await detail(gm, cid)).sisaBon).toBe(0);
  });
});
