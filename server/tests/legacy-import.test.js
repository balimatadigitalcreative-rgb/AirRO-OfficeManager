'use strict';
// Per-customer LEGACY transaction import: archive-only rows that must NOT touch any aggregate
// (KPIs, cash integration, gallon stock, receivables), are idempotent, and can be undone by GM/owner.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);

let gm, cid;
const ROWS = [
  { txnDate: '2026-01-05', qty: 10, price: 12000, method: 'lunas', note: 'saldo awal' },
  { txnDate: '2026-01-06', qty: 5, price: 12000, method: 'bon' },
  { txnDate: '2026-01-07', qty: 3, price: 12000, method: 'lunas' },
];
const impLegacy = (t, id, rows, skipped) => request(app).post(`/api/v1/distribusi/customers/${id}/transactions/import`).set(auth(t)).send({ rows, skipped });

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_leg', password: 'secret123', role: 'gm' })).token;
  const c = await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'C1', phone: '0811', type: 'reguler', masterPrice: 5000, armada: 'Merah' });
  cid = c.body.data.id;
  // one REAL sale so aggregates are non-zero to begin with
  await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 4, method: 'bon', txnDate: '2026-02-01' });
});
afterAll(() => prisma.$disconnect());

// snapshot the aggregates that MUST stay unchanged by a legacy import
async function aggregates() {
  const list = (await request(app).get('/api/v1/distribusi/customers').set(auth(gm))).body.data.find((c) => c.id === cid);
  const dash = (await request(app).get('/api/v1/distribusi/dashboard/summary?date=2026-02-01').set(auth(gm))).body.data;
  const gallon = (await request(app).get('/api/v1/distribusi/gallon?fleet=Merah').set(auth(gm))).body.data.stock;
  const cash = (await request(app).get('/api/v1/distribusi/cash-integration?dateFrom=2026-01-01&dateTo=2026-12-31').set(auth(gm))).body.data;
  return { listSisaBon: list.sisaBon, listTotalGalon: list.totalGalon, listTxnCount: list.txnCount, receivable: dash.receivable, gallonOwned: gallon.totalOwned, cashTxns: cash.transactions.length };
}

describe('Distribusi — legacy transaction import (archive only)', () => {
  let before, batchId;
  it('imports archive rows with legacy=true, unit price from the row, and one batch id', async () => {
    before = await aggregates();
    const r = await impLegacy(gm, cid, ROWS, 0);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ imported: 3, skipped: 0, received: 3 });
    batchId = r.body.batchId;
    const raw = await prisma.distTransaction.findMany({ where: { importBatchId: batchId } });
    expect(raw.length).toBe(3);
    expect(raw.every((t) => t.legacy === true)).toBe(true);
    const one = raw.find((t) => t.qty === 10);
    expect(one).toMatchObject({ unitPriceLocked: 12000, amount: 120000 });   // row price, NOT master 5000
    // NO gallon movement was written for legacy rows
    expect(await prisma.gallonMovement.count({ where: { customerId: cid } })).toBe(1);   // just the real sale's delivery_out
  });

  it('legacy rows do NOT change KPIs / receivables / gallon stock / cash integration', async () => {
    const after = await aggregates();
    expect(after.listSisaBon).toBe(before.listSisaBon);       // receivable unchanged
    expect(after.listTotalGalon).toBe(before.listTotalGalon); // gallons-sold unchanged
    expect(after.listTxnCount).toBe(before.listTxnCount);     // txn count excludes legacy
    expect(after.receivable).toBe(before.receivable);
    expect(after.gallonOwned).toBe(before.gallonOwned);
    expect(after.cashTxns).toBe(before.cashTxns);             // cash integration excludes legacy
  });

  it('legacy rows DO appear in the customer detail history (flagged) + import list; record unchanged', async () => {
    const d = (await request(app).get(`/api/v1/distribusi/customers/${cid}`).set(auth(gm))).body.data;
    const legacyRows = d.transactions.filter((t) => t.legacy);
    expect(legacyRows.length).toBe(3);
    expect(d.imports.length).toBe(1);
    expect(d.imports[0]).toMatchObject({ batchId, count: 3 });
    // the customer record itself is untouched
    expect(d.masterPrice).toBe(5000);
    expect(d.phone).toBe('0811');
  });

  it('re-importing the same file skips every row as a duplicate (idempotent)', async () => {
    const r = await impLegacy(gm, cid, ROWS, 0);
    expect(r.body).toMatchObject({ imported: 0, skipped: 3 });
    expect(await prisma.distTransaction.count({ where: { customerId: cid, legacy: true } })).toBe(3);   // still 3
  });

  it('an invalid date / bad qty is skipped', async () => {
    const r = await impLegacy(gm, cid, [
      { txnDate: 'not-a-date', qty: 2, price: 1000 },   // bad date → skip
      { txnDate: '2026-03-01', qty: 0, price: 1000 },   // qty 0 → skip (schema allows int; service skips)
      { txnDate: '2026-03-02', qty: 2, price: 1000 },   // ok
    ], 0);
    expect(r.body.imported).toBe(1);
    expect(r.body.skipped).toBe(2);
  });

  it('the import is audited (who, batch, imported/skipped)', async () => {
    const audit = (await request(app).get('/api/v1/distribusi/audit?kind=impor').set(auth(gm))).body.data;
    expect(audit.some((a) => /Impor riwayat: C1/.test(a.title) && new RegExp(batchId).test(a.detail) && /3 ditambah/.test(a.detail))).toBe(true);
  });

  it('undo a batch (GM) removes exactly those rows; aggregates still unchanged', async () => {
    const del = await request(app).delete(`/api/v1/distribusi/customers/${cid}/transactions/legacy-batch/${batchId}`).set(auth(gm));
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(3);
    expect(await prisma.distTransaction.count({ where: { importBatchId: batchId } })).toBe(0);
    const after = await aggregates();
    expect(after.receivable).toBe(before.receivable);
    expect(after.gallonOwned).toBe(before.gallonOwned);
  });

  it('a non-GM/owner CANNOT undo (server rejects 403) even with the import cap', async () => {
    const r2 = await impLegacy(gm, cid, [{ txnDate: '2026-04-01', qty: 1, price: 1000 }], 0);
    const u = await reg({ name: 'Fin', username: 'fin_leg', password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ permissions: { distribusiLegacyImport: true } });
    const t = await login('fin_leg', 'secret123');
    // finance holds the import cap → CAN import
    expect((await impLegacy(t, cid, [{ txnDate: '2026-04-02', qty: 1, price: 1000 }], 0)).status).toBe(201);
    // …but CANNOT undo (GM/owner only, enforced in the service)
    expect((await request(app).delete(`/api/v1/distribusi/customers/${cid}/transactions/legacy-batch/${r2.body.batchId}`).set(auth(t))).status).toBe(403);
  });

  it('import is gated by distribusiLegacyImport', async () => {
    const u = await reg({ name: 'NoCap', username: 'nocap_leg', password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ permissions: { distribusiLegacyImport: false } });
    const t = await login('nocap_leg', 'secret123');
    expect((await impLegacy(t, cid, [{ txnDate: '2026-05-01', qty: 1, price: 1000 }], 0)).status).toBe(403);
  });
});
