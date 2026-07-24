'use strict';
// FIELD-LEVEL PRICE GATE on transaction corrections.
//   qty / gallonOut / gallonIn → anyone who may request a correction (distribusiKoreksi).
//   unitPrice                  → ONLY distribusiHargaMaster.
// Enforced SERVER-SIDE at both doors — submitting a request AND approving one — and always compared
// against the transaction's stored unitPriceLocked, never a client-supplied "old" value. A staff
// correction can therefore move the total only via qty (amount = qty × unitPrice, server-computed).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const correct = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/corrections`).set(auth(t)).send(body);
const approve = (t, id) => request(app).post(`/api/v1/distribusi/change-requests/${id}/approve`).set(auth(t)).send({});
const reject = (t, id, note) => request(app).post(`/api/v1/distribusi/change-requests/${id}/reject`).set(auth(t)).send({ note });
const getTxn = async (t, id) => (await request(app).get('/api/v1/distribusi/transactions').set(auth(t))).body.data.find((x) => x.id === id);
const audit = async (t) => (await request(app).get('/api/v1/distribusi/audit').set(auth(t))).body.data;

const PRICE = 6000;
let owner, gm, staff, staffId, noPriceApprover, cid, txnId;

const freshSale = async () => (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm))
  .send({ customerId: cid, qty: 5, method: 'bon', txnDate: '2026-03-01', gallonOut: 5 })).body.data.id;

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_pg', password: 'secret123', role: 'owner' })).token;   // has HargaMaster + Approve
  gm = (await reg({ name: 'Boss', username: 'gm_pg', password: 'secret123', role: 'gm' })).token;            // has HargaMaster + Approve
  // STAFF: may request corrections, but NOT change prices and NOT approve
  const s = await reg({ name: 'Staf Andi', username: 'staff_pg', password: 'secret123', role: 'finance' });
  staffId = s.user.id;
  await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gm)).send({ permissions: {
    distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiHargaMaster: false, distribusiApprove: false,
  } });
  staff = await login('staff_pg', 'secret123');
  // APPROVER WITHOUT the price cap — may approve ordinary corrections but not price changes
  const a = await reg({ name: 'Penyetuju Biasa', username: 'appr_pg', password: 'secret123', role: 'finance' });
  await request(app).patch(`/api/v1/users/${a.user.id}`).set(auth(gm)).send({ permissions: {
    distribusi: true, distribusiKoreksi: true, distribusiApprove: true, distribusiHargaMaster: false,
  } });
  noPriceApprover = await login('appr_pg', 'secret123');

  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko A', type: 'reguler', masterPrice: PRICE, armada: 'Merah' })).body.data.id;
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 500, reason: 'stok awal', fleet: 'Merah' });
  txnId = await freshSale();   // 5 × 6000 = 30.000
});
afterAll(() => prisma.$disconnect());

describe('correction — unit price is capability-gated (distribusiHargaMaster)', () => {
  it('STAFF: a crafted request that CHANGES the price is rejected server-side (403)', async () => {
    const r = await correct(staff, txnId, { reason: 'naikkan harga', qty: 5, unitPrice: 9000, gallonOut: 5, gallonIn: 0 });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/harga terkunci|harga master/i);
    // nothing was created, the transaction is untouched
    expect(await prisma.distChangeRequest.count({ where: { transactionId: txnId } })).toBe(0);
    const t = await getTxn(gm, txnId);
    expect(t.unitPriceLocked).toBe(PRICE);
    expect(t.amount).toBe(30000);
  });

  it('STAFF: correcting qty/gallons is allowed and the total follows qty × the LOCKED price', async () => {
    const r = await correct(staff, txnId, { reason: 'salah hitung galon', qty: 3, unitPrice: PRICE, gallonOut: 3, gallonIn: 0 });
    expect(r.status).toBe(201);
    expect(r.body.data.requested).toMatchObject({ qty: 3, unitPrice: PRICE, gallonOut: 3 });
    expect(r.body.data.newAmount).toBe(3 * PRICE);   // 18.000 — moved only by qty
    const ap = await approve(gm, r.body.data.id);
    expect(ap.status).toBe(200);
    const t = await getTxn(gm, txnId);
    expect(t.qty).toBe(3);
    expect(t.unitPriceLocked).toBe(PRICE);           // price untouched
    expect(t.amount).toBe(18000);
  });

  it('STAFF: omitting unitPrice entirely is fine — the server pins it to the stored price', async () => {
    const id = await freshSale();
    const r = await correct(staff, id, { reason: 'tanpa harga', qty: 2, gallonOut: 2, gallonIn: 0 });
    expect(r.status).toBe(201);
    expect(r.body.data.requested.unitPrice).toBe(PRICE);   // pinned, not 0
    expect(r.body.data.newAmount).toBe(2 * PRICE);
    await reject(gm, r.body.data.id, 'bersih-bersih uji');
  });

  it('HARGA MASTER holder: can change the price and the total recomputes; audit records old → new', async () => {
    const id = await freshSale();
    const r = await correct(gm, id, { reason: 'harga salah saat input', qty: 5, unitPrice: 7500, gallonOut: 5, gallonIn: 0 });
    expect(r.status).toBe(201);
    expect(r.body.data.newAmount).toBe(5 * 7500);   // 37.500
    // gm can't approve their own → owner (also a Harga Master holder) approves
    const ap = await approve(owner, r.body.data.id);
    expect(ap.status).toBe(200);
    const t = await getTxn(gm, id);
    expect(t.unitPriceLocked).toBe(7500);
    expect(t.amount).toBe(37500);
    // the audit calls the price change out explicitly, old → new
    const a = await audit(gm);
    expect(a.some((x) => /Setujui koreksi/i.test(x.title) && /HARGA 6000 → 7500/.test(x.detail))).toBe(true);
  });

  it('APPROVER without the price cap cannot APPLY a price change (403) — but may still reject it', async () => {
    const id = await freshSale();
    // a Harga Master holder submits a price change…
    const r = await correct(gm, id, { reason: 'koreksi harga', qty: 5, unitPrice: 8000, gallonOut: 5, gallonIn: 0 });
    expect(r.status).toBe(201);
    const rid = r.body.data.id;
    // …an approver WITHOUT distribusiHargaMaster is blocked at the approve door
    const blocked = await approve(noPriceApprover, rid);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/mengubah harga|harga master/i);
    // the request is NOT consumed — still pending, transaction untouched
    const still = await prisma.distChangeRequest.findUnique({ where: { id: rid } });
    expect(still.status).toBe('pending');
    expect((await getTxn(gm, id)).unitPriceLocked).toBe(PRICE);
    // that approver CAN still reject it (rejecting changes nothing)
    const rej = await reject(noPriceApprover, rid, 'harga master belum diubah');
    expect(rej.status).toBe(200);
    expect(rej.body.data.status).toBe('rejected');
    expect((await getTxn(gm, id)).unitPriceLocked).toBe(PRICE);
  });

  it('APPROVER without the price cap CAN approve an ordinary (qty-only) correction', async () => {
    const id = await freshSale();
    const r = await correct(staff, id, { reason: 'galon kurang', qty: 4, unitPrice: PRICE, gallonOut: 4, gallonIn: 0 });
    expect(r.status).toBe(201);
    const ap = await approve(noPriceApprover, r.body.data.id);
    expect(ap.status).toBe(200);
    const t = await getTxn(gm, id);
    expect(t.qty).toBe(4);
    expect(t.amount).toBe(4 * PRICE);
  });

  it('PELUNASAN corrections are unaffected — still gated by the ordinary correction right', async () => {
    const c2 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko B', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c2, qty: 10, method: 'bon', txnDate: '2026-03-02', gallonOut: 10 });
    const payId = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c2, qty: 0, method: 'pelunasan', payAmount: 40000, payMethod: 'cash', txnDate: '2026-03-03' })).body.data.id;
    // a staff WITHOUT the price cap may correct the payment amount
    const r = await correct(staff, payId, { reason: 'salah nominal', amount: 55000 });
    expect(r.status).toBe(201);
    expect(r.body.data.newAmount).toBe(55000);
    // and an approver without the price cap may apply it (no price is involved)
    expect((await approve(noPriceApprover, r.body.data.id)).status).toBe(200);
    expect((await getTxn(gm, payId)).amount).toBe(55000);
  });
});
