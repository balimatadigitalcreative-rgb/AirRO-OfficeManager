'use strict';
// CORRECTION / VOID of LEGACY (archive) transactions. The old blanket block ("arsip tidak masuk
// hitungan") was wrong: archive bon/pelunasan DO feed Sisa Bon (customerBonBalance's BON_TXN has no
// legacy filter), so a mistyped archive row corrupts a real receivable. They are now correctable and
// voidable through the SAME approval engine, with the same guards (fleet, cap, self-approve, and a hard
// block only on an issued invoice). This asserts the balance math + the guards.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const imp = (t, id, rows) => request(app).post(`/api/v1/distribusi/customers/${id}/transactions/import`).set(auth(t)).send({ rows });
const detail = (t, id) => request(app).get(`/api/v1/distribusi/customers/${id}`).set(auth(t)).then((r) => r.body.data);
const correct = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/corrections`).set(auth(t)).send(body);
const preview = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/corrections/preview`).set(auth(t)).send(body);
const voidReq = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/void`).set(auth(t)).send(body);
const approve = (t, id) => request(app).post(`/api/v1/distribusi/change-requests/${id}/approve`).set(auth(t)).send({});
// Sisa Bon Berjalan (running balance), mirror of bonEffectOf in distribution.jsx, over a customer's rows.
const lastRunning = (txns) => {
  const eff = (x) => { if (x.voided || x.status === 'void' || !x.bonCounted) return 0; if (x.method === 'bon') return Math.max(0, x.effectiveAmount != null ? x.effectiveAmount : x.amount); if (x.method === 'pelunasan') return -x.amount; return 0; };
  const o2n = txns.slice().sort((a, b) => (a.txnDate || '').localeCompare(b.txnDate || '') || (a.createdAt || 0) - (b.createdAt || 0));
  let run = 0; o2n.forEach((t) => { run += eff(t); });
  return Math.max(0, run);
};
const bonRow = (d, code) => d.transactions.find((t) => t.method === 'bon' && t.amount === code);

let gm, staff, staffId;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'GM', username: 'lc_gm', password: 'secret123', role: 'gm' })).token;   // koreksi + approve + legacyImport + hargaMaster
  const s = await reg({ name: 'Staf', username: 'lc_staff', password: 'secret123', role: 'finance' });
  staffId = s.user.id;
  await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiApprove: false, distribusiLegacyImport: true } });
  staff = await login('lc_staff', 'secret123');
});
afterAll(() => prisma.$disconnect());

const mkCust = async (name) => (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name, type: 'reguler', masterPrice: 6500, armada: 'Merah' })).body.data.id;

describe('Correct an archive bon — Sisa Bon + every later running balance shift', () => {
  it('78.000 → 65.000: pending leaves it unchanged; approve drops Sisa Bon by exactly 13.000 and the KPI equals the last running balance', async () => {
    const cid = await mkCust('Arsip A');
    await imp(gm, cid, [
      { txnDate: '2026-07-01', price: 6500, bonQty: 12 },   // BON 78.000 (archive, the one to fix)
      { txnDate: '2026-08-01', price: 5000, bonQty: 4 },    // later BON 20.000
      { txnDate: '2026-08-05', paymentAmount: 10000 },      // later PELUNASAN 10.000
    ]);
    let d = await detail(gm, cid);
    expect(d.sisaBon).toBe(88000);                          // 78 + 20 − 10
    const row = bonRow(d, 78000); expect(row.legacy).toBe(true);

    // server preview (dry-run): the same figure the approval will produce, computed server-side
    const pv = (await preview(staff, row.id, { qty: 10, unitPrice: 6500, gallonOut: 0, gallonIn: 0 })).body.data;
    expect(pv).toMatchObject({ oldAmount: 78000, newAmount: 65000, oldSisaBon: 88000, newSisaBon: 75000, bonDelta: -13000, legacy: true, invoice: null });
    expect(pv.laterRowsCount).toBe(2);                      // the Aug bon + the pelunasan both re-run

    // staff requests; the row is UNCHANGED while pending
    const reqId = (await correct(staff, row.id, { reason: 'salah ketik nominal arsip', qty: 10, unitPrice: 6500, gallonOut: 0, gallonIn: 0 })).body.data.id;
    d = await detail(gm, cid);
    expect(bonRow(d, 78000).amount).toBe(78000);            // original still 78.000
    expect(d.sisaBon).toBe(88000);
    expect(bonRow(d, 78000).pendingRequest).toMatchObject({ kind: 'correction' });

    // approve → applied
    expect((await approve(gm, reqId)).status).toBe(200);
    d = await detail(gm, cid);
    expect(bonRow(d, 65000).amount).toBe(65000);            // corrected
    expect(bonRow(d, 65000).legacy).toBe(true);             // still an archive row
    expect(d.sisaBon).toBe(75000);                          // dropped by exactly 13.000
    expect(d.sisaBon).toBe(lastRunning(d.transactions));    // KPI == last row's Sisa Bon Berjalan
  });
});

describe('Void an archive pelunasan — Sisa Bon rises by its amount', () => {
  it('a legacy 10.000 payment voided returns 10.000 to the receivable', async () => {
    const cid = await mkCust('Arsip B');
    await imp(gm, cid, [
      { txnDate: '2026-06-01', price: 5000, bonQty: 10 },   // BON 50.000
      { txnDate: '2026-06-10', paymentAmount: 10000 },      // PELUNASAN 10.000 (to void)
    ]);
    let d = await detail(gm, cid);
    expect(d.sisaBon).toBe(40000);
    const pel = d.transactions.find((t) => t.method === 'pelunasan');
    const reqId = (await voidReq(staff, pel.id, { reason: 'pembayaran arsip tidak pernah ada' })).body.data.id;
    expect((await detail(gm, cid)).sisaBon).toBe(40000);    // unchanged while pending
    expect((await approve(gm, reqId)).status).toBe(200);
    d = await detail(gm, cid);
    expect(d.sisaBon).toBe(50000);                          // rose by 10.000
  });
});

describe('Guards still hold on archive rows', () => {
  it('a row inside an ISSUED invoice is blocked, and the error names the invoice', async () => {
    // Legacy rows are never billable (invoices exclude them), so the invoice guard is exercised with an
    // ACTIVE bon that has been invoiced — correcting it must be refused and name the invoice.
    const cid = await mkCust('Faktur');
    const bon = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 5, method: 'bon', txnDate: '2026-05-01', gallonOut: 5 })).body.data;   // active BON 32.500
    const inv = (await request(app).post(`/api/v1/distribusi/customers/${cid}/invoices`).set(auth(gm)).send({ scope: 'unpaidBon' })).body.data;
    expect(inv.number).toBeTruthy();
    const r = await correct(staff, bon.id, { reason: 'ubah', qty: 4, unitPrice: 6500, gallonOut: 4, gallonIn: 0 });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain(inv.number);     // invoice named in the error
    expect(r.body.error.details && r.body.error.details.invoice).toBe(inv.number);
  });

  it('the requester can NOT approve their own archive correction', async () => {
    const cid = await mkCust('SelfAppr');
    await imp(gm, cid, [{ txnDate: '2026-05-02', price: 5000, bonQty: 5 }]);   // BON 25.000
    const row = bonRow(await detail(gm, cid), 25000);
    // grant staff approve temporarily → still blocked because they filed it
    await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiApprove: true, distribusiLegacyImport: true } });
    const self = await login('lc_staff', 'secret123');
    const reqId = (await correct(self, row.id, { reason: 'x', qty: 4, unitPrice: 5000, gallonOut: 0, gallonIn: 0 })).body.data.id;
    expect((await approve(self, reqId)).status).toBe(403);
    await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiApprove: false, distribusiLegacyImport: true } });
    staff = await login('lc_staff', 'secret123');
  });

  it('a legacy LUNAS row (affects no balance) is still correctable, and the preview says Sisa Bon is unchanged', async () => {
    const cid = await mkCust('LunasArsip');
    await imp(gm, cid, [
      { txnDate: '2026-04-01', price: 5000, bonQty: 6 },    // BON 30.000 (so there's a balance)
      { txnDate: '2026-04-02', price: 5000, lunasQty: 4 },  // LUNAS 20.000 (archive cash sale — no receivable)
    ]);
    let d = await detail(gm, cid);
    expect(d.sisaBon).toBe(30000);
    const lunas = d.transactions.find((t) => t.method === 'lunas');
    const pv = (await preview(staff, lunas.id, { qty: 3, unitPrice: 5000, gallonOut: 0, gallonIn: 0 })).body.data;
    expect(pv.bonDelta).toBe(0);                             // lunas never touches Sisa Bon
    expect(pv.newSisaBon).toBe(pv.oldSisaBon);
    const reqId = (await correct(staff, lunas.id, { reason: 'salah qty arsip', qty: 3, unitPrice: 5000, gallonOut: 0, gallonIn: 0 })).body.data.id;
    expect((await approve(gm, reqId)).status).toBe(200);
    d = await detail(gm, cid);
    expect(d.transactions.find((t) => t.method === 'lunas').amount).toBe(15000);   // corrected
    expect(d.sisaBon).toBe(30000);                          // Sisa Bon genuinely unchanged
  });
});
