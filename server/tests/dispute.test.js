'use strict';
// TRANSACTION DISPUTE / LOSS — a disputed transaction is never deleted or hidden; only its STATUS
// changes. An approved tidak_diakui/kerugian dispute carves its amount OUT of the customer's sisa
// bon and IS the record surfaced by the Kerugian report (no duplicate). The staff who handled the
// transaction can neither raise nor approve a dispute on it. Reverse restores the balance and drops
// the loss record. Reconciliation invariant: total bon = sisa bon + dibayar + tidak diakui + kerugian.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const detail = (t, id) => request(app).get('/api/v1/distribusi/customers/' + id).set(auth(t)).then((r) => r.body.data);
const dispute = (t, txnId, body) => request(app).post('/api/v1/distribusi/transactions/' + txnId + '/dispute').set(auth(t)).send(body);
const approveD = (t, id, body) => request(app).post('/api/v1/distribusi/disputes/' + id + '/approve').set(auth(t)).send(body || {});
const reverseD = (t, id) => request(app).post('/api/v1/distribusi/disputes/' + id + '/reverse').set(auth(t)).send({});
const loss = (t) => request(app).get('/api/v1/distribusi/reports/loss?period=range&dateFrom=2026-01-01&dateTo=2026-12-31').set(auth(t)).then((r) => r.body.data);
const summary = (t) => request(app).get('/api/v1/distribusi/dashboard/summary?period=month&fleet=all').set(auth(t)).then((r) => r.body.data);

let gm, budi, budiId, cap, cid, txn150, txn650;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'dsp_gm', password: 'secret123', role: 'gm' })).token;
  // Budi — field staff who HANDLES the transaction (its actor). Holds input + the dispute cap.
  const b = await reg({ name: 'Budi', username: 'dsp_budi', password: 'secret123', role: 'finance' });
  budiId = b.user.id;
  await prisma.user.update({ where: { id: budiId }, data: { permissions: JSON.stringify({ distribusi: true, distribusiInput: true, distribusiBonAdjust: true }) } });
  budi = await login('dsp_budi');
  // A non-GM admin who holds the dispute cap (can raise, cannot approve).
  const c = await reg({ name: 'Cap', username: 'dsp_cap', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: c.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiBonAdjust: true }) } });
  cap = await login('dsp_cap');
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko Sengketa', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
  // 800.000 bon total: Budi sells a 150.000 nota (his txn) + GM sells 650.000.
  txn150 = (await request(app).post('/api/v1/distribusi/transactions').set(auth(budi)).send({ customerId: cid, qty: 15, method: 'bon', txnDate: '2026-08-01' })).body.data.id;
  txn650 = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 65, method: 'bon', txnDate: '2026-08-01' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('dispute lifecycle: raise → approve (tidak_diakui, staf) → reverse', () => {
  let dId;
  it('baseline sisa bon 800.000', async () => {
    expect((await detail(gm, cid)).sisaBon).toBe(800000);
  });
  it('the transaction actor (Budi) cannot dispute his OWN transaction — 403', async () => {
    const r = await dispute(budi, txn150, { reason: 'nota_fiktif', resolution: 'staf', customerClaimAmount: 0, note: 'saya tidak jual ini' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/sendiri/i);
  });
  it('note is required', async () => {
    const r = await dispute(gm, txn150, { reason: 'nota_fiktif', resolution: 'staf', customerClaimAmount: 0, note: '' });
    expect(r.status).toBe(400);
  });
  it('GM raises the dispute → disengketakan; balance UNCHANGED (still counted)', async () => {
    const r = await dispute(gm, txn150, { reason: 'nota_fiktif', resolution: 'staf', customerClaimAmount: 0, note: 'nota fiktif diselidiki', staffUserId: budiId });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'disengketakan', resolution: 'staf', disputedAmount: 150000, transactionId: txn150, staffUserId: budiId });
    dId = r.body.data.id;
    expect((await detail(gm, cid)).sisaBon).toBe(800000);   // disengketakan still counts
  });
  it('a non-GM with the cap cannot approve — 403', async () => {
    const r = await approveD(cap, dId);
    expect(r.status).toBe(403);
    expect((await detail(gm, cid)).sisaBon).toBe(800000);
  });
  it('GM approves → tidak_diakui; sisa bon becomes 650.000; row STILL visible with dispute', async () => {
    const r = await approveD(gm, dId);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'tidak_diakui', staffLiabilityId: dId });
    const d = await detail(gm, cid);
    expect(d.sisaBon).toBe(650000);
    const row = d.transactions.find((t) => t.id === txn150);
    expect(row).toBeTruthy();                         // never deleted/hidden
    expect(row.dispute.status).toBe('tidak_diakui');
    expect(row.dispute.deducts).toBe(true);
    expect(d.disputeSummary.tidak_diakui).toMatchObject({ n: 1, amount: 150000 });
  });
  it('RECONCILIATION INVARIANT holds: total bon = sisa bon + dibayar + tidak diakui + kerugian', async () => {
    const d = await detail(gm, cid);
    const r = d.reconcile;
    expect(r.totalBon).toBe(r.sisaBon + r.dibayar + r.tidakDiakui + r.kerugian);
    expect(r.totalBon).toBe(800000);
    expect(r.tidakDiakui).toBe(150000);
    expect(r.sisaBon).toBe(650000);
  });
  it('dashboard receivable drops by the disputed amount (excluded from receivables)', async () => {
    expect((await summary(gm)).receivable).toBe(650000);
  });
  it('Kerugian report shows the SAME record, linked to the customer + transaction, charged to Budi', async () => {
    const rep = await loss(gm);
    const item = rep.items.find((x) => x.source === 'dispute' && x.transactionId === txn150);
    expect(item).toBeTruthy();
    expect(item.amount).toBe(150000);
    expect(item.customerId).toBe(cid);
    expect(item.responsibleUserId).toBe(budiId);
    const staffLine = rep.byStaff.find((s) => s.responsibleUserId === budiId);
    expect(staffLine && staffLine.total).toBe(150000);
  });
  it('reverse → sisa bon back to 800.000 and the loss record voided (gone from Kerugian)', async () => {
    const r = await reverseD(gm, dId);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('diakui_kembali');
    const d = await detail(gm, cid);
    expect(d.sisaBon).toBe(800000);
    const row = d.transactions.find((t) => t.id === txn150);
    expect(row.dispute.status).toBe('diakui_kembali');   // still visible, re-acknowledged
    const rep = await loss(gm);
    expect(rep.items.some((x) => x.source === 'dispute' && x.transactionId === txn150)).toBe(false);
    expect(rep.byStaff.find((s) => s.responsibleUserId === budiId)).toBeFalsy();
  });
  it('a reversed dispute lets a fresh dispute be raised again', async () => {
    const r = await dispute(gm, txn150, { reason: 'lainnya', resolution: 'perusahaan', customerClaimAmount: 50000, note: 'coba lagi sebagian' });
    expect(r.status).toBe(201);
    expect(r.body.data.disputedAmount).toBe(100000);   // 150k − 50k acknowledged
  });
});
