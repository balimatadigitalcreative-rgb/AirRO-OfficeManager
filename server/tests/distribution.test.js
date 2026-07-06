'use strict';
// Distribusi module — capability gating, server-side price lock, immutability
// (append-only, no delete), correction rules, and the audit trail.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);

let owner, staff, hrd, custId;

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_d', password: 'secret123', role: 'owner' })).token;
  const s = await reg({ name: 'Staff', username: 'stf_d', password: 'secret123', role: 'finance' });
  // grant ONLY 'distribusi' to the staff user (per-user override), then re-login so the
  // fresh token carries the override → effective perms = { distribusi: true }.
  await request(app).patch(`/api/v1/users/${s.user.id}`).set(auth(owner)).send({ permissions: { distribusi: true } });
  staff = await login('stf_d', 'secret123');
  hrd = (await reg({ name: 'Hrd', username: 'hrd_d', password: 'secret123', role: 'hrd' })).token;
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — permissions, price lock, immutability, audit', () => {
  it('owner creates a customer with a master price', async () => {
    const r = await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Warung A', phone: '08123', type: 'kos', masterPrice: 6000 });
    expect(r.status).toBe(201);
    expect(r.body.data.masterPrice).toBe(6000);
    custId = r.body.data.id;
  });

  it('a role without distribusi (hrd) is forbidden on every distribusi endpoint', async () => {
    expect((await request(app).get('/api/v1/distribusi/customers').set(auth(hrd))).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(hrd))).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/dashboard/summary').set(auth(hrd))).status).toBe(403);
  });

  it('staff inputs a transaction; price is LOCKED server-side (client price ignored)', async () => {
    const r = await request(app).post('/api/v1/distribusi/transactions').set(auth(staff))
      .send({ customerId: custId, qty: 3, method: 'lunas', txnDate: '2026-07-06', unitPriceLocked: 999999, amount: 999999 });
    expect(r.status).toBe(201);
    expect(r.body.data.unitPriceLocked).toBe(6000);   // from master_price, not the client
    expect(r.body.data.amount).toBe(18000);            // 3 × 6000, computed on the server
  });

  it('staff CANNOT add customers, change the master price, or view the audit log', async () => {
    expect((await request(app).post('/api/v1/distribusi/customers').set(auth(staff)).send({ name: 'X' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/distribusi/customers/${custId}/price`).set(auth(staff)).send({ newPrice: 7000 })).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/audit').set(auth(staff))).status).toBe(403);
  });

  it('owner changes the master price → price_history written, OLD transactions untouched', async () => {
    const before = await request(app).get('/api/v1/distribusi/transactions?date=2026-07-06').set(auth(owner));
    const oldTxnId = before.body.data[0].id;
    const pr = await request(app).patch(`/api/v1/distribusi/customers/${custId}/price`).set(auth(owner)).send({ newPrice: 8000 });
    expect(pr.status).toBe(200);
    expect(pr.body.data.masterPrice).toBe(8000);
    const cust = await request(app).get(`/api/v1/distribusi/customers/${custId}`).set(auth(owner));
    expect(cust.body.data.priceHistory[0]).toMatchObject({ oldPrice: 6000, newPrice: 8000 });
    const after = await request(app).get('/api/v1/distribusi/transactions?date=2026-07-06').set(auth(owner));
    expect(after.body.data.find((t) => t.id === oldTxnId).unitPriceLocked).toBe(6000);   // locked, unchanged
  });

  it('corrections require a reason, flag staff actors, and never mutate the transaction', async () => {
    const list = await request(app).get('/api/v1/distribusi/transactions?date=2026-07-06').set(auth(owner));
    const txnId = list.body.data[0].id;
    const bad = await request(app).post(`/api/v1/distribusi/transactions/${txnId}/corrections`).set(auth(staff)).send({});
    expect(bad.status).toBe(400);   // reason required
    const ok = await request(app).post(`/api/v1/distribusi/transactions/${txnId}/corrections`).set(auth(staff)).send({ reason: 'salah qty', oldValue: { qty: 3 }, newValue: { qty: 2 } });
    expect(ok.status).toBe(201);
    expect(ok.body.data.byStaff).toBe(true);
    const after = await request(app).get('/api/v1/distribusi/transactions?date=2026-07-06').set(auth(owner));
    expect(after.body.data.find((t) => t.id === txnId).qty).toBe(3);   // original untouched
  });

  it('transactions cannot be deleted (no delete route exists)', async () => {
    const list = await request(app).get('/api/v1/distribusi/transactions').set(auth(owner));
    const del = await request(app).delete(`/api/v1/distribusi/transactions/${list.body.data[0].id}`).set(auth(owner));
    expect(del.status).toBe(404);
  });

  it('owner sees the immutable audit log covering every write kind', async () => {
    const r = await request(app).get('/api/v1/distribusi/audit').set(auth(owner));
    expect(r.status).toBe(200);
    expect(r.body.data.map((a) => a.kind)).toEqual(expect.arrayContaining(['pelanggan', 'input', 'harga', 'koreksi']));
  });

  it('dashboard summary aggregates the day', async () => {
    const r = await request(app).get('/api/v1/distribusi/dashboard/summary?date=2026-07-06').set(auth(owner));
    expect(r.status).toBe(200);
    expect(r.body.data.count).toBeGreaterThanOrEqual(1);
    expect(r.body.data.amount).toBeGreaterThanOrEqual(18000);
  });
});
