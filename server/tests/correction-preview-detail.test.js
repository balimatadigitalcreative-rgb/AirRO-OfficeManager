'use strict';
// The customer-detail correction/void surface (distribution.jsx · tab Transaksi) reuses the EXISTING
// approval-gated engine — no second flow. This covers the pieces that surface backs it:
//   1. previewCorrection — a server DRY-RUN of the live "Nominal → · Sisa Bon →" impact, computed by
//      the SAME normalizeCorrection/projectedRawBon the approval applies, persisting NOTHING.
//   2. getCustomer now returns pendingRequest (for the row badge + inline approve/reject) and the real
//      gallonOut/gallonIn per row (so the modal pre-fills them).
//   3. The invariant the feature promises: after an applied correction the customer's Sisa Bon KPI
//      equals the last transaction row's running balance (Sisa Bon Berjalan).
//   4. The field-level price gate holds in the PREVIEW too (a non-Harga-Master caller can't move price).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const detailOf = async (t, cid) => (await request(app).get(`/api/v1/distribusi/customers/${cid}`).set(auth(t))).body.data;
const preview = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/corrections/preview`).set(auth(t)).send(body);
const correct = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/corrections`).set(auth(t)).send(body);
const approve = (t, id) => request(app).post(`/api/v1/distribusi/change-requests/${id}/approve`).set(auth(t)).send({});

// The client's Sisa Bon Berjalan (running balance) — mirror of bonEffectOf in distribution.jsx.
const bonEffect = (x) => {
  if (x.voided || x.status === 'void' || !x.bonCounted) return 0;
  if (x.method === 'bon') return Math.max(0, x.effectiveAmount != null ? x.effectiveAmount : x.amount);
  if (x.method === 'pelunasan') return -x.amount;
  return 0;
};
const lastRunning = (txns) => {
  const o2n = txns.slice().sort((a, b) => (a.txnDate || '').localeCompare(b.txnDate || '') || (a.createdAt || 0) - (b.createdAt || 0));
  let run = 0; o2n.forEach((t) => { run += bonEffect(t); });
  return Math.max(0, run);
};

let gm, staff, staffId, cid, bonId;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_pv', password: 'secret123', role: 'gm' })).token;   // holds distribusiApprove + Harga Master
  const s = await reg({ name: 'Staf Budi', username: 'staff_pv', password: 'secret123', role: 'finance' });
  staffId = s.user.id;
  // staff may REQUEST corrections but NOT approve and NOT change the price (no Harga Master)
  await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiApprove: false, distribusiHargaMaster: false } });
  staff = await login('staff_pv', 'secret123');
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko PV', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 500, reason: 'stok awal', fleet: 'Merah' });
  // two bon sales so the running balance has more than one row
  await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 4, method: 'bon', txnDate: '2026-04-01', gallonOut: 4 });   // 24.000
  bonId = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 5, method: 'bon', txnDate: '2026-04-02', gallonOut: 5 })).body.data.id;   // 30.000
});
afterAll(() => prisma.$disconnect());

describe('Customer-detail correction — preview dry-run', () => {
  it('previewCorrection returns the SERVER-computed nominal + sisa-bon impact and persists nothing', async () => {
    const before = await detailOf(gm, cid);
    expect(before.sisaBon).toBe(54000);   // 24.000 + 30.000
    // dry-run: correct the 30.000 bon to qty 2 (12.000). Reason is NOT required to preview.
    const r = await preview(staff, bonId, { qty: 2, unitPrice: 6000, gallonOut: 2, gallonIn: 0 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ oldAmount: 30000, newAmount: 12000, delta: -18000, oldSisaBon: 54000, newSisaBon: 36000, bonDelta: -18000, wouldGoNegative: false });
    // NOTHING persisted: the txn is untouched, the balance is unchanged, no request was created.
    const after = await detailOf(gm, cid);
    expect(after.sisaBon).toBe(54000);
    const row = after.transactions.find((x) => x.id === bonId);
    expect(row.amount).toBe(30000);
    expect(row.qty).toBe(5);
    expect(row.pendingRequest).toBe(null);
  });

  it('the field-level price gate holds in the preview: a non-Harga-Master caller cannot move the price', async () => {
    expect((await preview(staff, bonId, { qty: 5, unitPrice: 7000, gallonOut: 5 })).status).toBe(403);
    // …but the same fields at the LOCKED price preview fine.
    expect((await preview(staff, bonId, { qty: 5, unitPrice: 6000, gallonOut: 5 })).status).toBe(200);
  });

  it('preview requires the correction cap (a viewer without distribusiKoreksi is 403)', async () => {
    const v = await reg({ name: 'Viewer', username: 'view_pv', password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${v.user.id}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiKoreksi: false } });
    const vt = await login('view_pv', 'secret123');
    expect((await preview(vt, bonId, { qty: 2, unitPrice: 6000, gallonOut: 2 })).status).toBe(403);
  });
});

describe('Customer-detail correction — pending visibility + applied invariant', () => {
  let reqId;
  it('a submitted request surfaces on the customer-detail row (pendingRequest) with the real gallons', async () => {
    const r = await correct(staff, bonId, { reason: 'salah hitung galon saat ramai', qty: 3, unitPrice: 6000, gallonOut: 3, gallonIn: 0 });
    expect(r.status).toBe(201);
    reqId = r.body.data.id;
    const d = await detailOf(gm, cid);
    const row = d.transactions.find((x) => x.id === bonId);
    // the row is still ACTIVE, but now carries the pending request for the badge + inline decide
    expect(row.amount).toBe(30000);
    expect(row.pendingRequest).toMatchObject({ id: reqId, kind: 'correction', reason: 'salah hitung galon saat ramai', requestedByName: 'Staf Budi' });
    expect(row.pendingRequest.requestedById).toBe(staffId);   // so the UI can hide "Setujui" on your own request
    expect(row.gallonOut).toBe(5);   // real per-row gallons, so the modal pre-fills them
    expect(d.sisaBon).toBe(54000);   // unchanged while pending
  });

  it('after APPROVE, the Sisa Bon KPI equals the last row running balance (Sisa Bon Berjalan)', async () => {
    expect((await approve(gm, reqId)).status).toBe(200);
    const d = await detailOf(gm, cid);
    const row = d.transactions.find((x) => x.id === bonId);
    expect(row.amount).toBe(18000);          // 3 × 6000, applied
    expect(row.pendingRequest).toBe(null);   // no longer pending
    expect(row.corrected).toBe(true);        // "Dikoreksi" badge
    expect(d.sisaBon).toBe(42000);           // 24.000 + 18.000
    // THE INVARIANT: the KPI equals the running balance after the last row.
    expect(d.sisaBon).toBe(lastRunning(d.transactions));
  });
});
