'use strict';
// Customer balance ADJUSTMENT (penyesuaian) — corrects CURRENT gallons-held / outstanding bon.
// Unlike the archive import, an approved adjustment DOES move receivables + gallon stock. Immutable
// delta record; GM/owner-approved before it takes effect; reversed (never deleted) by an opposite
// record. Balances derive from base + Σ(approved deltas).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const detail = (t, id) => request(app).get('/api/v1/distribusi/customers/' + id).set(auth(t)).then((r) => r.body.data);
const adjust = (t, id, body) => request(app).post('/api/v1/distribusi/customers/' + id + '/adjustments').set(auth(t)).send(body);
const approve = (t, id) => request(app).post('/api/v1/distribusi/adjustments/' + id + '/approve').set(auth(t)).send({});
const reverse = (t, id) => request(app).post('/api/v1/distribusi/adjustments/' + id + '/reverse').set(auth(t)).send({});

let gm, staff, cid;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'adj_gm', password: 'secret123', role: 'gm' })).token;
  // A NON-GM admin who holds distribusiPenyesuaian (can create + list, but NOT approve).
  const s = await reg({ name: 'Staf', username: 'adj_staff', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: s.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiInput: true, distribusiPenyesuaian: true }) } });
  staff = await login('adj_staff');
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 200, reason: 'stok awal', fleet: 'Merah' });
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Adj', type: 'reguler', masterPrice: 50000, armada: 'Merah' })).body.data.id;
  // bon 500.000 (qty 10 × 50.000) AND 12 gallons delivered → gallonsHeld 12.
  await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 10, method: 'bon', txnDate: '2026-08-01', gallonOut: 12 });
});
afterAll(() => prisma.$disconnect());

describe('BON adjustment — pending → approve → reverse', () => {
  let adjId;
  it('baseline: sisa bon 500.000, gallons held 12', async () => {
    const d = await detail(gm, cid);
    expect(d.sisaBon).toBe(500000);
    expect(d.gallonsHeld).toBe(12);
  });
  it('adjust bon to 350.000 (salah_input) → PENDING; balance UNCHANGED', async () => {
    const r = await adjust(staff, cid, { kind: 'bon', mode: 'set', value: 350000, reason: 'salah_input' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ kind: 'bon', before: 500000, after: 350000, delta: -150000, status: 'pending' });
    adjId = r.body.data.id;
    expect((await detail(gm, cid)).sisaBon).toBe(500000);   // not applied yet
  });
  it('a NON-GM (with the cap) cannot approve — server rejects (403)', async () => {
    const r = await approve(staff, adjId);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/GM\/Owner/i);
    expect((await detail(gm, cid)).sisaBon).toBe(500000);   // still not applied
  });
  it('GM approves → sisa bon 350.000; revenue-side unchanged (no new transaction)', async () => {
    const before = await prisma.distTransaction.count({ where: { customerId: cid } });
    const r = await approve(gm, adjId);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('approved');
    expect((await detail(gm, cid)).sisaBon).toBe(350000);
    expect(await prisma.distTransaction.count({ where: { customerId: cid } })).toBe(before);   // adjustment is NOT a sale
  });
  it('the adjustment is listed in the customer detail (Riwayat Penyesuaian)', async () => {
    const d = await detail(gm, cid);
    const a = (d.adjustments || []).find((x) => x.id === adjId);
    expect(a).toMatchObject({ kind: 'bon', before: 500000, after: 350000, status: 'approved', reason: 'salah_input', approvedByName: 'Boss' });
  });
  it('reverse → sisa bon back to 500.000; BOTH records visible', async () => {
    const r = await reverse(gm, adjId);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ reversalOf: adjId, delta: 150000, status: 'approved' });
    expect((await detail(gm, cid)).sisaBon).toBe(500000);
    const d = await detail(gm, cid);
    expect(d.adjustments.find((x) => x.id === adjId).reversedById).toBe(r.body.data.id);   // original marked reversed
    expect(d.adjustments.filter((x) => x.kind === 'bon').length).toBe(2);                  // original + reversal
  });
});

describe('GALON adjustment — writes a penyesuaian movement, stock stays consistent', () => {
  it('adjust galon 12 → 10 → pending; approve → gallons held 10 + a penyesuaian movement exists', async () => {
    const r = await adjust(gm, cid, { kind: 'galon', mode: 'set', value: 10, reason: 'galon_pecah_hilang' });
    expect(r.body.data).toMatchObject({ kind: 'galon', before: 12, after: 10, delta: -2, status: 'pending' });
    expect((await detail(gm, cid)).gallonsHeld).toBe(12);   // pending → not applied
    await approve(gm, r.body.data.id);
    expect((await detail(gm, cid)).gallonsHeld).toBe(10);
    const mv = await prisma.gallonMovement.findMany({ where: { customerId: cid, type: 'penyesuaian' } });
    expect(mv.length).toBe(1);
    expect(mv[0].qty).toBe(-2);
  });
});

describe('validation', () => {
  it('rejects a zero-change adjustment and a negative galon result', async () => {
    expect((await adjust(gm, cid, { kind: 'bon', mode: 'delta', delta: 0, reason: 'salah_input' })).status).toBe(400);
    expect((await adjust(gm, cid, { kind: 'galon', mode: 'set', value: -1, reason: 'salah_input' })).status).toBe(400);
  });
  it('requires a note for lainnya / penghapusan_piutang', async () => {
    expect((await adjust(gm, cid, { kind: 'bon', mode: 'delta', delta: -1000, reason: 'lainnya' })).status).toBe(400);
    const ok = await adjust(gm, cid, { kind: 'bon', mode: 'delta', delta: -1000, reason: 'lainnya', note: 'koreksi manual' });
    expect(ok.status).toBe(201);
  });
  it('penghapusan_piutang may clamp bon to 0 (with note)', async () => {
    const c2 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Writeoff', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c2, qty: 5, method: 'bon', txnDate: '2026-08-01', gallonOut: 0 });
    const r = await adjust(gm, c2, { kind: 'bon', mode: 'delta', delta: -999999, reason: 'penghapusan_piutang', note: 'piutang dihapus' });
    expect(r.status).toBe(201);
    expect(r.body.data.after).toBe(0);
    await approve(gm, r.body.data.id);
    expect((await detail(gm, c2)).sisaBon).toBe(0);
  });
});

describe('report', () => {
  it('GET /reports/adjustments returns the adjustments + summary', async () => {
    const r = await request(app).get('/api/v1/distribusi/reports/adjustments?status=approved').set(auth(gm));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.summary).toHaveProperty('galonDelta');
    expect(r.body.summary).toHaveProperty('bonDelta');
  });
});
