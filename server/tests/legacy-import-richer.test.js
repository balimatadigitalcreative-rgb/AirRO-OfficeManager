'use strict';
// Per-customer legacy (archive) import — columns: Tanggal · Harga · Pembelian Lunas · Pembelian Bon
// · Pembayaran Bon · Catatan. A single spreadsheet row EXPANDS into 1–3 transactions, all on the
// row's date: Lunas (qty×Harga), Bon (qty×Harga → sisa bon), Pelunasan (payment → reduces sisa bon).
// The server re-parses the date ROBUSTLY from ANY day/month/year format (day-first). Purchases stay
// archive-only (no gallon movement). Dedupe keys on the RESULTING transaction (date+type+amount) so a
// same-date lunas & bon are never dups of each other; batch undo removes the whole batch.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const imp = (t, id, rows) => request(app).post(`/api/v1/distribusi/customers/${id}/transactions/import`).set(auth(t)).send({ rows });
const detail = (t, id) => request(app).get(`/api/v1/distribusi/customers/${id}`).set(auth(t)).then((r) => r.body.data);
const mkCust = async (t, name) => (await request(app).post('/api/v1/distribusi/customers').set(auth(t)).send({ name, type: 'reguler', masterPrice: 5000, armada: 'Merah' })).body.data.id;

let gm;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_rich', password: 'secret123', role: 'gm' })).token;
});
afterAll(() => prisma.$disconnect());

describe('legacy import — ROBUST date parsing (any d/m/y format, day-first)', () => {
  it('accepts dd/mm/yyyy, d-m-yy, ISO and an Excel serial → the correct ISO date', async () => {
    const cid = await mkCust(gm, 'Dates');
    const rows = [
      { txnDate: '25/12/2026', price: 12000, lunasQty: 1 },   // dd/mm/yyyy
      { txnDate: '5-1-26', price: 12000, lunasQty: 1 },        // d-m-yy → 2026-01-05
      { txnDate: '2026-12-25', price: 12000, bonQty: 1 },      // ISO (bon; different type → not a dup of #1)
      { txnDate: '46017', price: 12000, lunasQty: 1 },         // Excel serial → 2025-12-26
    ];
    const r = await imp(gm, cid, rows);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ imported: 4 });
    const got = (await prisma.distTransaction.findMany({ where: { customerId: cid }, select: { txnDate: true }, orderBy: { txnDate: 'asc' } })).map((t) => t.txnDate);
    expect(got).toEqual(['2025-12-26', '2026-01-05', '2026-12-25', '2026-12-25']);
  });

  it('day-first for an ambiguous date: 03/04/2026 → 3 April; 32/13/2026 is skipped as invalid', async () => {
    const cid = await mkCust(gm, 'DayFirst');
    const r = await imp(gm, cid, [
      { txnDate: '03/04/2026', price: 10000, lunasQty: 1 },   // → 2026-04-03 (never March 4th)
      { txnDate: '32/13/2026', price: 10000, lunasQty: 1 },   // invalid → skip
    ]);
    expect(r.body).toMatchObject({ imported: 1, skipped: 1 });
    expect((await prisma.distTransaction.findFirst({ where: { customerId: cid } })).txnDate).toBe('2026-04-03');
  });
});

describe('one row → MULTIPLE transactions (lunas + bon + payment on the same date)', () => {
  let cid, batchId;
  beforeAll(async () => { cid = await mkCust(gm, 'Expand'); });

  it('Lunas 2 & Bon 3 @ 13000 in ONE row → a 26,000 lunas AND a 39,000 bon, both dated 25 Dec 2026', async () => {
    const r = await imp(gm, cid, [{ txnDate: '25/12/2026', price: 13000, lunasQty: 2, bonQty: 3, note: 'catatan' }]);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ imported: 2, received: 1 });
    batchId = r.body.batchId;
    const raw = await prisma.distTransaction.findMany({ where: { customerId: cid } });
    expect(raw.map((t) => t.method).sort()).toEqual(['bon', 'lunas']);
    expect(raw.find((t) => t.method === 'lunas')).toMatchObject({ qty: 2, unitPriceLocked: 13000, amount: 26000, txnDate: '2026-12-25', note: 'catatan' });
    expect(raw.find((t) => t.method === 'bon')).toMatchObject({ qty: 3, unitPriceLocked: 13000, amount: 39000, txnDate: '2026-12-25' });
    expect(raw.every((t) => t.legacy === true && t.importBatchId === batchId)).toBe(true);   // same batch
    expect(await prisma.gallonMovement.count({ where: { customerId: cid } })).toBe(0);         // archive-only
  });

  it('sisa bon rises by the BON amount only (the lunas does not): += 39,000', async () => {
    expect((await detail(gm, cid)).sisaBon).toBe(39000);
  });

  it('re-importing the same row skips BOTH transactions as duplicates', async () => {
    const r = await imp(gm, cid, [{ txnDate: '25/12/2026', price: 13000, lunasQty: 2, bonQty: 3, note: 'catatan' }]);
    expect(r.body.imported).toBe(0);
    expect(r.body.skipped).toBe(2);
    expect(await prisma.distTransaction.count({ where: { customerId: cid } })).toBe(2);   // still 2
  });

  it('a row with Lunas + Bon + Pembayaran creates THREE transactions', async () => {
    const c3 = await mkCust(gm, 'Three');
    const r = await imp(gm, c3, [{ txnDate: '01/02/2026', price: 10000, lunasQty: 1, bonQty: 1, paymentAmount: 5000 }]);
    expect(r.body).toMatchObject({ imported: 3 });
    const raw = await prisma.distTransaction.findMany({ where: { customerId: c3 } });
    expect(raw.map((t) => t.method).sort()).toEqual(['bon', 'lunas', 'pelunasan']);
    expect(raw.every((t) => t.txnDate === '2026-02-01')).toBe(true);
    expect((await detail(gm, c3)).sisaBon).toBe(5000);   // bon 10,000 − pelunasan 5,000
  });

  it('empty row (no action) and a purchase without Harga are skipped', async () => {
    const c4 = await mkCust(gm, 'Skips');
    const r = await imp(gm, c4, [
      { txnDate: '03/03/2026' },                          // no lunas/bon/payment → skip (empty)
      { txnDate: '04/03/2026', bonQty: 3 },               // qty without Harga → skip
      { txnDate: '05/03/2026', price: 8000, lunasQty: 1 },// valid
    ]);
    expect(r.body).toMatchObject({ imported: 1, skipped: 2 });
  });

  it('undo removes the row\'s transactions together; sisa bon drops back to 0', async () => {
    const del = await request(app).delete(`/api/v1/distribusi/customers/${cid}/transactions/legacy-batch/${batchId}`).set(auth(gm));
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(2);   // both the lunas and the bon
    expect((await detail(gm, cid)).sisaBon).toBe(0);
  });
});
