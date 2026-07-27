'use strict';
// METHOD change (bon ↔ lunas) via the correction/approval flow. Same pending→approve pipeline as
// the structured correction: staff REQUESTS, a distribusiApprove holder APPLIES, requester can't
// self-approve. Applying flips method + bonCounted so every aggregate recomputes: bon→lunas drops the
// row from sisa bon (and it becomes cash money-in); lunas→bon raises sisa bon (and stops being cash).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const sisaBon = async (t, cid) => (await request(app).get(`/api/v1/distribusi/customers/${cid}`).set(auth(t))).body.data.sisaBon;
const getTxn = async (t, id) => (await request(app).get('/api/v1/distribusi/transactions').set(auth(t))).body.data.find((x) => x.id === id);
const dash = async (t) => (await request(app).get('/api/v1/distribusi/dashboard/summary').set(auth(t))).body.data;
const correct = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/corrections`).set(auth(t)).send(body);
const approve = (t, id, body) => request(app).post(`/api/v1/distribusi/change-requests/${id}/approve`).set(auth(t)).send(body || {});
const listReqs = async (t, qs) => (await request(app).get('/api/v1/distribusi/change-requests' + (qs || '')).set(auth(t))).body.data;
const audit = async (t) => (await request(app).get('/api/v1/distribusi/audit').set(auth(t))).body.data;
const TODAY = new Date().toISOString().slice(0, 10);

let gm, owner, staff, staffId, cid, bonId;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_cm', password: 'secret123', role: 'gm' })).token;
  owner = (await reg({ name: 'Owner', username: 'own_cm', password: 'secret123', role: 'owner' })).token;   // second approver
  const s = await reg({ name: 'Staf', username: 'staff_cm', password: 'secret123', role: 'finance' });
  staffId = s.user.id;
  await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: false, distribusiHargaMaster: false } });
  staff = await login('staff_cm', 'secret123');
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko A', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 500, reason: 'stok awal', fleet: 'Merah' });
  // a BON sale: 5 × 6000 = 30.000 → sisa bon 30.000
  bonId = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 5, method: 'bon', txnDate: TODAY, gallonOut: 5 })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('correction — change method (bon ↔ lunas)', () => {
  let reqId;
  it('a staff method change is a PENDING request; the txn is unchanged + shows the sisa-bon impact', async () => {
    expect(await sisaBon(gm, cid)).toBe(30000);
    const r = await correct(staff, bonId, { reason: 'harusnya lunas', qty: 5, unitPrice: 6000, gallonOut: 5, gallonIn: 0, method: 'lunas' });
    expect(r.status).toBe(201);
    reqId = r.body.data.id;
    expect(r.body.data).toMatchObject({ kind: 'correction', status: 'pending', method: 'bon', requestedMethod: 'lunas', methodChanged: true });
    expect(r.body.data.bonImpact).toBe(-30000);          // bon→lunas removes 30.000 of receivable
    expect(r.body.data.wouldGoNegative).toBe(false);
    // transaction untouched while pending
    const t = await getTxn(gm, bonId);
    expect(t.method).toBe('bon');
    expect(t.pendingRequest).toMatchObject({ kind: 'correction' });
    expect(await sisaBon(gm, cid)).toBe(30000);
  });

  it('the approver inbox shows current vs requested method + the sisa-bon impact', async () => {
    const it0 = (await listReqs(gm, '?status=pending')).find((x) => x.id === reqId);
    expect(it0).toMatchObject({ method: 'bon', requestedMethod: 'lunas', methodChanged: true, bonImpact: -30000 });
  });

  it('a requester without distribusiApprove is 403; they cannot self-approve either', async () => {
    expect((await approve(staff, reqId)).status).toBe(403);   // no cap
  });

  it('APPROVE flips bon→lunas: sisa bon drops by the amount, and it becomes cash money-in', async () => {
    const before = await dash(gm);
    expect(before.uangMasuk).toBe(0);                    // a bon sale is not cash
    const r = await approve(gm, reqId);
    expect(r.status).toBe(200);
    const t = await getTxn(gm, bonId);
    expect(t.method).toBe('lunas');
    expect(t.bonCounted).toBe(false);                    // no longer a receivable
    expect(t.correctedManual).toBe(true);                // Dikoreksi badge
    expect(await sisaBon(gm, cid)).toBe(0);              // dropped by 30.000
    const after = await dash(gm);
    expect(after.uangMasuk).toBe(30000);                 // now counts as cash received
    // audit records the method delta with the sisa-bon direction
    expect((await audit(gm)).some((x) => /Setujui koreksi/i.test(x.title) && /METODE bon → lunas/.test(x.detail))).toBe(true);
  });

  it('reversing lunas→bon raises sisa bon again and stops being cash', async () => {
    const r = await correct(staff, bonId, { reason: 'ternyata bon', qty: 5, unitPrice: 6000, gallonOut: 5, gallonIn: 0, method: 'bon' });
    expect(r.body.data.bonImpact).toBe(30000);
    await approve(gm, r.body.data.id);
    const t = await getTxn(gm, bonId);
    expect(t.method).toBe('bon');
    expect(t.bonCounted).toBe(true);
    expect(await sisaBon(gm, cid)).toBe(30000);
    expect((await dash(gm)).uangMasuk).toBe(0);
  });

  it('a method-only change needs NO price cap; the price still cannot change without it', async () => {
    // staff has no distribusiHargaMaster. Method-only change at the locked price → accepted.
    const ok = await correct(staff, bonId, { reason: 'metode saja', qty: 5, unitPrice: 6000, gallonOut: 5, gallonIn: 0, method: 'lunas' });
    expect(ok.status).toBe(201);
    await request(app).post(`/api/v1/distribusi/change-requests/${ok.body.data.id}/reject`).set(auth(gm)).send({ note: 'bersih uji' });
    // method + a PRICE change together → still blocked by the price gate at request time (403)
    const blocked = await correct(staff, bonId, { reason: 'metode+harga', qty: 5, unitPrice: 9000, gallonOut: 5, gallonIn: 0, method: 'lunas' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/harga terkunci|harga master/i);
  });

  it('a pelunasan row cannot be method-changed', async () => {
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 3, method: 'bon', txnDate: TODAY, gallonOut: 3 });   // +18.000 bon
    const payId = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 0, method: 'pelunasan', payAmount: 10000, payMethod: 'cash', txnDate: TODAY })).body.data.id;
    const r = await correct(staff, payId, { reason: 'coba ubah metode', amount: 10000, method: 'lunas' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/tidak bisa diubah|Lunas\/Bon/i);
  });

  it('a change that would make sisa bon NEGATIVE needs the approver\'s explicit confirm', async () => {
    // fresh customer: one 40.000 bon fully paid down by a 40.000 pelunasan → sisa bon 0.
    const c2 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko B', type: 'reguler', masterPrice: 8000, armada: 'Merah' })).body.data.id;
    const b2 = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c2, qty: 5, method: 'bon', txnDate: TODAY, gallonOut: 5 })).body.data.id;   // 40.000
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c2, qty: 0, method: 'pelunasan', payAmount: 40000, payMethod: 'cash', txnDate: TODAY });
    expect(await sisaBon(gm, c2)).toBe(0);
    // flip that bon → lunas: removes 40.000 of receivable while the 40.000 payment stays → raw −40.000
    const r = await correct(staff, b2, { reason: 'harusnya lunas', qty: 5, unitPrice: 8000, gallonOut: 5, gallonIn: 0, method: 'lunas' });
    expect(r.status).toBe(201);
    expect(r.body.data.wouldGoNegative).toBe(true);
    // approve WITHOUT confirm → rejected with the needs-confirm marker; txn untouched
    const noConfirm = await approve(gm, r.body.data.id);
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.body.error.message).toMatch(/negatif/i);
    expect((await getTxn(gm, b2)).method).toBe('bon');
    // approve WITH confirm (owner ≠ requester) → applies
    const ok = await approve(owner, r.body.data.id, { confirmNegative: true });
    expect(ok.status).toBe(200);
    expect((await getTxn(gm, b2)).method).toBe('lunas');
  });

  it('fleet scope holds: a Biru approver can neither see nor approve a Merah method-change (404)', async () => {
    const bu = await reg({ name: 'GM Biru', username: 'gmbiru_cm', password: 'secret123', role: 'gm' });
    await request(app).patch(`/api/v1/users/${bu.user.id}`).set(auth(gm)).send({ fleetScope: ['Biru'] });
    const biru = await login('gmbiru_cm', 'secret123');
    const r = await correct(staff, bonId, { reason: 'merah', qty: 5, unitPrice: 6000, gallonOut: 5, gallonIn: 0, method: 'bon' });
    expect((await listReqs(biru, '?status=pending')).some((x) => x.id === r.body.data.id)).toBe(false);
    expect((await approve(biru, r.body.data.id)).status).toBe(404);
  });
});
