'use strict';
// Per-customer legacy (archive) import — columns: Tanggal · Harga · Pembelian Lunas · Pembelian Bon
// · Catatan. Exactly ONE of Lunas/Bon per row (PURCHASES only). The server re-parses the date
// ROBUSTLY from ANY day/month/year format (dd/mm/yyyy, d-m-yy, yyyy-mm-dd, Excel serial), day-first,
// and skips unparseable dates. Purchases stay archive-only (no gallon movement); bon rows reconcile
// the customer's sisa bon. Dedupe by (date+type+amount); batch undo removes the whole batch.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const imp = (t, id, rows) => request(app).post(`/api/v1/distribusi/customers/${id}/transactions/import`).set(auth(t)).send({ rows });
const detail = (t, id) => request(app).get(`/api/v1/distribusi/customers/${id}`).set(auth(t)).then((r) => r.body.data);

let gm, cid;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_rich', password: 'secret123', role: 'gm' })).token;
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Rich', type: 'reguler', masterPrice: 5000, armada: 'Merah' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('legacy import — ROBUST date parsing (any d/m/y format, day-first)', () => {
  it('accepts dd/mm/yyyy, d-m-yy, ISO and an Excel serial → the correct ISO date', async () => {
    const rows = [
      { txnDate: '25/12/2026', price: 12000, lunasQty: 1 },   // dd/mm/yyyy
      { txnDate: '5-1-26', price: 12000, lunasQty: 1 },        // d-m-yy → 2026-01-05
      { txnDate: '2026-12-25', price: 12000, bonQty: 1 },      // already ISO (bon; different type → not a dup of #1)
      { txnDate: '46017', price: 12000, lunasQty: 1 },         // Excel serial → 2025-12-26
    ];
    const r = await imp(gm, cid, rows);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ imported: 4, received: 4 });
    const got = (await prisma.distTransaction.findMany({ where: { customerId: cid }, select: { txnDate: true }, orderBy: { txnDate: 'asc' } })).map((t) => t.txnDate);
    expect(got).toEqual(['2025-12-26', '2026-01-05', '2026-12-25', '2026-12-25']);
  });

  it('day-first is assumed for an ambiguous date: 03/04/2026 → 3 April (2026-04-03)', async () => {
    const c2 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'DayFirst', type: 'reguler', masterPrice: 5000, armada: 'Merah' })).body.data.id;
    await imp(gm, c2, [{ txnDate: '03/04/2026', price: 10000, lunasQty: 1 }]);
    const t = await prisma.distTransaction.findFirst({ where: { customerId: c2 } });
    expect(t.txnDate).toBe('2026-04-03');   // April 3rd, never March 4th
  });

  it('an impossible date (32/13/2026) is skipped as invalid, not coerced', async () => {
    const c3 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'BadDate', type: 'reguler', masterPrice: 5000, armada: 'Merah' })).body.data.id;
    const r = await imp(gm, c3, [
      { txnDate: '32/13/2026', price: 10000, lunasQty: 1 },   // invalid → skip
      { txnDate: '01/02/2026', price: 10000, lunasQty: 1 },   // valid
    ]);
    expect(r.body).toMatchObject({ imported: 1, skipped: 1 });
    expect((await prisma.distTransaction.findFirst({ where: { customerId: c3 } })).txnDate).toBe('2026-02-01');
  });
});

describe('legacy import — columns (Lunas / Bon only) + sisa bon', () => {
  let cid2, batchId;
  const ROWS = [
    { txnDate: '05/01/2026', price: 12000, lunasQty: 10 },              // LUNAS → 120,000
    { txnDate: '06/01/2026', price: 12000, bonQty: 5 },                 // BON   → 60,000
    { txnDate: '10/01/2026', price: 10000, bonQty: 4 },                 // BON   → 40,000
    { txnDate: '21/01/2026', price: 12000, lunasQty: 2, bonQty: 1 },    // both actions → SKIP
    { txnDate: '22/01/2026', price: 12000 },                            // no action → SKIP
    { txnDate: '23/01/2026', bonQty: 3 },                               // purchase w/o Harga → SKIP
    { txnDate: '20/01/2026', paymentAmount: 30000 },                    // legacy payment field → ignored → SKIP
  ];
  beforeAll(async () => {
    cid2 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Cols', type: 'reguler', masterPrice: 5000, armada: 'Merah' })).body.data.id;
  });

  it('derives lunas/bon; skips both-filled / no-action / no-price / payment-only rows', async () => {
    const r = await imp(gm, cid2, ROWS);
    expect(r.body).toMatchObject({ imported: 3, skipped: 4, received: 7 });
    batchId = r.body.batchId;
    const raw = await prisma.distTransaction.findMany({ where: { importBatchId: batchId }, orderBy: { txnDate: 'asc' } });
    expect(raw.map((t) => t.method)).toEqual(['lunas', 'bon', 'bon']);   // no pelunasan
    expect(raw.find((t) => t.method === 'lunas')).toMatchObject({ qty: 10, unitPriceLocked: 12000, amount: 120000 });
    expect(raw.filter((t) => t.method === 'bon').map((t) => t.amount).sort((a, b) => a - b)).toEqual([40000, 60000]);
    expect(await prisma.gallonMovement.count({ where: { customerId: cid2 } })).toBe(0);   // archive-only
  });

  it('sisa bon reflects the imported bon purchases: 60,000 + 40,000 = 100,000', async () => {
    const d = await detail(gm, cid2);
    expect(d.sisaBon).toBe(100000);
    const list = (await request(app).get('/api/v1/distribusi/customers?fleet=Merah').set(auth(gm))).body.data.find((c) => c.id === cid2);
    expect(list.sisaBon).toBe(100000);
    expect(list.totalGalon).toBe(0);
  });

  it('re-importing the same rows is idempotent (all skipped as duplicates)', async () => {
    const r = await imp(gm, cid2, ROWS);
    expect(r.body.imported).toBe(0);
    expect(await prisma.distTransaction.count({ where: { customerId: cid2, legacy: true } })).toBe(3);
  });

  it('undo removes exactly the batch; sisa bon drops back to 0', async () => {
    const del = await request(app).delete(`/api/v1/distribusi/customers/${cid2}/transactions/legacy-batch/${batchId}`).set(auth(gm));
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(3);
    expect((await detail(gm, cid2)).sisaBon).toBe(0);
  });
});
