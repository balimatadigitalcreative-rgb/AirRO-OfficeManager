'use strict';
// APPROVAL-GATED corrections & voids. A correction/void no longer applies immediately — it is a
// PENDING request that an approver (distribusiApprove) must approve, and corrections are STRUCTURED
// (edit qty/unitPrice/gallonOut/gallonIn, or the pelunasan amount; the server recomputes the total).
// This asserts: request leaves the txn untouched + flags it pending; a 2nd request is blocked; the
// request previews the recomputed total; approve applies amount+sisa bon+gallons; reject changes
// nothing; a requester can't approve their own; void behaves the same; every step is audited; the
// cap + fleet scope are server-enforced.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const sisaBon = async (t, cid) => (await request(app).get(`/api/v1/distribusi/customers/${cid}`).set(auth(t))).body.data.sisaBon;
const held = async (t, cid) => (await request(app).get(`/api/v1/distribusi/customers/${cid}`).set(auth(t))).body.data.gallonsHeld;
const getTxn = async (t, id) => (await request(app).get('/api/v1/distribusi/transactions').set(auth(t))).body.data.find((x) => x.id === id);
const correct = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/corrections`).set(auth(t)).send(body);
const voidReq = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/void`).set(auth(t)).send(body);
const listReqs = async (t, qs) => (await request(app).get('/api/v1/distribusi/change-requests' + (qs || '')).set(auth(t))).body.data;
const approve = (t, id) => request(app).post(`/api/v1/distribusi/change-requests/${id}/approve`).set(auth(t)).send({});
const reject = (t, id, note) => request(app).post(`/api/v1/distribusi/change-requests/${id}/reject`).set(auth(t)).send({ note });
const audit = async (t) => (await request(app).get('/api/v1/distribusi/audit').set(auth(t))).body.data;

let gm, staff, staffId, cid, bonId;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_cr', password: 'secret123', role: 'gm' })).token;   // holds distribusiApprove
  // a staff who may REQUEST corrections/voids but NOT approve
  const s = await reg({ name: 'Staf Andi', username: 'staff_cr', password: 'secret123', role: 'finance' });
  staffId = s.user.id;
  await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiApprove: false } });
  staff = await login('staff_cr', 'secret123');
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko A', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 500, reason: 'stok awal', fleet: 'Merah' });
  // a bon sale: 5 galon × 6000 = 30.000, 5 galon out
  bonId = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 5, method: 'bon', txnDate: '2026-03-01', gallonOut: 5 })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — approval-gated structured corrections', () => {
  let reqId;
  it('a staff correction (qty 5→3) creates a PENDING request and leaves the transaction UNCHANGED', async () => {
    expect(await sisaBon(gm, cid)).toBe(30000);
    expect(await held(gm, cid)).toBe(5);
    const r = await correct(staff, bonId, { reason: 'salah hitung galon', qty: 3, unitPrice: 6000, gallonOut: 3, gallonIn: 0 });
    expect(r.status).toBe(201);
    reqId = r.body.data.id;
    expect(r.body.data).toMatchObject({ kind: 'correction', status: 'pending', method: 'bon' });
    // preview: recomputed total + delta, current vs requested
    expect(r.body.data.current).toMatchObject({ qty: 5, unitPrice: 6000, amount: 30000, gallonOut: 5 });
    expect(r.body.data.requested).toMatchObject({ qty: 3, unitPrice: 6000, gallonOut: 3 });
    expect(r.body.data.newAmount).toBe(18000);
    expect(r.body.data.delta).toBe(-12000);
    // the transaction itself is untouched + flagged pending
    const txn = await getTxn(gm, bonId);
    expect(txn.amount).toBe(30000);
    expect(txn.qty).toBe(5);
    expect(txn.status).toBe('active');
    expect(txn.pendingRequest).toMatchObject({ kind: 'correction', requestedByName: 'Staf Andi' });
    expect(await sisaBon(gm, cid)).toBe(30000);   // unchanged while pending
  });

  it('a SECOND request on the same transaction is blocked while one is pending', async () => {
    expect((await correct(staff, bonId, { reason: 'lagi', qty: 2, unitPrice: 6000, gallonOut: 2 })).status).toBe(400);
    expect((await voidReq(staff, bonId, { reason: 'batalkan' })).status).toBe(400);
  });

  it('the requester can NOT approve their own request (even if they had the cap)', async () => {
    // give the staff the approve cap temporarily → still blocked because they are the requester
    await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiApprove: true } });
    const selfTok = await login('staff_cr', 'secret123');
    expect((await approve(selfTok, reqId)).status).toBe(403);
    // revoke again
    await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiApprove: false } });
    staff = await login('staff_cr', 'secret123');
  });

  it('a non-approver gets 403 on the inbox + decide endpoints', async () => {
    expect((await request(app).get('/api/v1/distribusi/change-requests').set(auth(staff))).status).toBe(403);
    expect((await approve(staff, reqId)).status).toBe(403);
    expect((await reject(staff, reqId, 'x')).status).toBe(403);
  });

  it('the request shows up in the approver inbox with the recomputed preview', async () => {
    const reqs = await listReqs(gm, '?status=pending');
    const it0 = reqs.find((x) => x.id === reqId);
    expect(it0).toBeTruthy();
    expect(it0).toMatchObject({ kind: 'correction', customerName: 'Toko A', newAmount: 18000, delta: -12000 });
    expect(it0.requestedBy.name).toBe('Staf Andi');
  });

  it('APPROVE applies the correction: amount, sisa bon and gallon movements all update', async () => {
    const r = await approve(gm, reqId);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('approved');
    const txn = await getTxn(gm, bonId);
    expect(txn.amount).toBe(18000);           // recomputed 3 × 6000
    expect(txn.qty).toBe(3);
    expect(txn.correctedManual).toBe(true);   // "Dikoreksi" badge
    expect(txn.pendingRequest).toBe(null);    // no longer pending
    expect(await sisaBon(gm, cid)).toBe(18000);
    expect(await held(gm, cid)).toBe(3);      // gallon_out rewritten 5 → 3
    // audit: requested + approved
    const a = await audit(gm);
    expect(a.some((x) => /Pengajuan koreksi/i.test(x.title) && /salah hitung/.test(x.detail))).toBe(true);
    expect(a.some((x) => /Setujui koreksi/i.test(x.title))).toBe(true);
  });

  it('REJECT changes nothing on the transaction and closes the request with the note', async () => {
    // qty-only (the price is capability-gated — this staff has no distribusiHargaMaster; see
    // correction-price-gate.test.js). 2 × 6000 = 12.000 requested, then rejected.
    const r2 = await correct(staff, bonId, { reason: 'mau ubah jumlah', qty: 2, unitPrice: 6000, gallonOut: 2, gallonIn: 0 });
    const rid = r2.body.data.id;
    expect(r2.body.data.newAmount).toBe(12000);
    const rej = await reject(gm, rid, 'jumlah asli sudah benar');
    expect(rej.status).toBe(200);
    expect(rej.body.data.status).toBe('rejected');
    expect(rej.body.data.decisionNote).toBe('jumlah asli sudah benar');
    const txn = await getTxn(gm, bonId);
    expect(txn.amount).toBe(18000);   // still the approved value, unchanged by the rejected request
    expect(txn.qty).toBe(3);
    expect(txn.pendingRequest).toBe(null);
    expect((await audit(gm)).some((x) => /Tolak koreksi/i.test(x.title) && /sudah benar/.test(x.detail))).toBe(true);
  });

  it('reject requires a note', async () => {
    const r3 = await correct(staff, bonId, { reason: 'x', qty: 2, unitPrice: 6000, gallonOut: 2 });
    expect((await reject(gm, r3.body.data.id, '')).status).toBe(400);
    // clean up: reject it properly so the txn has no pending request for the void test
    await reject(gm, r3.body.data.id, 'batal uji');
  });

  it('a VOID request behaves the same: pending → approve cancels the transaction', async () => {
    const vr = await voidReq(staff, bonId, { reason: 'transaksi ganda' });
    expect(vr.status).toBe(201);
    expect(vr.body.data).toMatchObject({ kind: 'void', status: 'pending' });
    expect(vr.body.data.delta).toBe(-18000);
    expect((await getTxn(gm, bonId)).status).toBe('active');   // still active while pending
    const ap = await approve(gm, vr.body.data.id);
    expect(ap.status).toBe(200);
    const txn = await getTxn(gm, bonId);
    expect(txn.status).toBe('void');
    expect(await sisaBon(gm, cid)).toBe(0);       // dropped from receivables
    expect(await held(gm, cid)).toBe(0);          // gallon movements reversed
    expect((await audit(gm)).some((x) => /Setujui pembatalan/i.test(x.title))).toBe(true);
  });

  it('PELUNASAN corrections edit only the payment amount', async () => {
    const c2 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko B', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c2, qty: 10, method: 'bon', txnDate: '2026-03-02', gallonOut: 10 });   // 100.000 bon
    const payId = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c2, qty: 0, method: 'pelunasan', payAmount: 40000, payMethod: 'cash', txnDate: '2026-03-03' })).body.data.id;
    expect(await sisaBon(gm, c2)).toBe(60000);
    const cr = await correct(staff, payId, { reason: 'salah nominal', amount: 55000 });
    expect(cr.status).toBe(201);
    expect(cr.body.data.requested).toMatchObject({ amount: 55000 });
    expect(cr.body.data.newAmount).toBe(55000);
    await approve(gm, cr.body.data.id);
    expect(await sisaBon(gm, c2)).toBe(45000);   // 100.000 − 55.000
    // over-payment is rejected at request time (can't pay more than owed)
    expect((await correct(staff, payId, { reason: 'kelebihan', amount: 999999 })).status).toBe(400);
  });

  it('fleet scope: an approver of another fleet cannot see or decide the request (404)', async () => {
    // a fleet-scoped GM restricted to 'Biru'
    const bu = await reg({ name: 'GM Biru', username: 'gmbiru_cr', password: 'secret123', role: 'gm' });
    await request(app).patch(`/api/v1/users/${bu.user.id}`).set(auth(gm)).send({ fleetScope: ['Biru'] });
    const biru = await login('gmbiru_cr', 'secret123');
    const c3 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko C', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
    const tid = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c3, qty: 4, method: 'bon', txnDate: '2026-03-04', gallonOut: 4 })).body.data.id;
    const cr = await correct(staff, tid, { reason: 'x', qty: 2, unitPrice: 6000, gallonOut: 2 });
    // the Biru GM doesn't see the Merah request, and can't approve it
    expect((await listReqs(biru, '?status=pending')).some((x) => x.id === cr.body.data.id)).toBe(false);
    expect((await approve(biru, cr.body.data.id)).status).toBe(404);
  });
});
