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

describe('Distribusi — delivery days, fleet, editable customer types', () => {
  it('seed types exist (reguler/kos/cafe/bulk) and are readable with base distribusi', async () => {
    const r = await request(app).get('/api/v1/distribusi/customer-types').set(auth(staff));
    expect(r.status).toBe(200);
    expect(r.body.data.map((t) => t.id).sort()).toEqual(['bulk', 'cafe', 'kos', 'reguler']);
  });

  it('create customer with deliveryDays + armada; both round-trip (and canonicalise)', async () => {
    const r = await request(app).post('/api/v1/distribusi/customers').set(auth(owner))
      .send({ name: 'Warung Kirim', type: 'reguler', masterPrice: 12000, deliveryDays: ['Rab', 'Sen', 'zzz'], armada: 'BIRU' });
    expect(r.status).toBe(201);
    expect(r.body.data.deliveryDays).toEqual(['Sen', 'Rab']);   // dedup + canonical Mon..Sun order, junk dropped
    expect(r.body.data.armada).toBe('BIRU');
    const got = await request(app).get(`/api/v1/distribusi/customers/${r.body.data.id}`).set(auth(owner));
    expect(got.body.data.deliveryDays).toEqual(['Sen', 'Rab']);
  });

  it('old customer without the columns shows []/"" (back-compat)', async () => {
    const c = await request(app).get(`/api/v1/distribusi/customers/${custId}`).set(auth(owner));
    expect(c.body.data.deliveryDays).toEqual([]);
    expect(c.body.data.armada).toBe('');
  });

  it('edit customer (type/phone/days/armada) via PATCH — needs distribusiCustomers; masterPrice untouched', async () => {
    const made = await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Edit Me', type: 'reguler', masterPrice: 9000 });
    const id = made.body.data.id;
    // staff (distribusi only, no distribusiCustomers) is forbidden to edit
    expect((await request(app).patch(`/api/v1/distribusi/customers/${id}`).set(auth(staff)).send({ phone: '0811' })).status).toBe(403);
    const r = await request(app).patch(`/api/v1/distribusi/customers/${id}`).set(auth(owner)).send({ type: 'kos', phone: '0899', deliveryDays: ['Jum'], armada: 'MERAH' });
    expect(r.status).toBe(200);
    expect(r.body.data.type).toBe('kos');
    expect(r.body.data.phone).toBe('0899');
    expect(r.body.data.deliveryDays).toEqual(['Jum']);
    expect(r.body.data.armada).toBe('MERAH');
    expect(r.body.data.masterPrice).toBe(9000);   // NOT changed by the edit route
  });

  it('fleet list is readable through the distribusi module (base cap)', async () => {
    await prisma.fleet.create({ data: { plate: 'BIRU' } });
    const r = await request(app).get('/api/v1/distribusi/fleet').set(auth(staff));
    expect(r.status).toBe(200);
    expect(r.body.data.some((f) => f.plate === 'BIRU')).toBe(true);
  });

  it('create a new type "Kantor"; usable on a customer; rename is safe (id stable)', async () => {
    const t = await request(app).post('/api/v1/distribusi/customer-types').set(auth(owner)).send({ label: 'Kantor' });
    expect(t.status).toBe(201);
    const typeId = t.body.data.id;
    const cust = await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'PT Contoh', type: typeId, masterPrice: 15000 });
    expect(cust.body.data.type).toBe(typeId);
    // rename keeps the id → the customer is unaffected
    const rn = await request(app).patch(`/api/v1/distribusi/customer-types/${typeId}`).set(auth(owner)).send({ label: 'Kantor Pusat' });
    expect(rn.status).toBe(200);
    const still = await request(app).get(`/api/v1/distribusi/customers/${cust.body.data.id}`).set(auth(owner));
    expect(still.body.data.type).toBe(typeId);
  });

  it('duplicate / empty type names are rejected', async () => {
    expect((await request(app).post('/api/v1/distribusi/customer-types').set(auth(owner)).send({ label: 'Reguler' })).status).toBe(400);   // dup (case-insensitive)
    expect((await request(app).post('/api/v1/distribusi/customer-types').set(auth(owner)).send({ label: '   ' })).status).toBe(400);        // empty
  });

  it('type write needs distribusiCustomers (staff forbidden)', async () => {
    expect((await request(app).post('/api/v1/distribusi/customer-types').set(auth(staff)).send({ label: 'X' })).status).toBe(403);
  });

  it('deleting a type IN USE is refused until customers are reassigned', async () => {
    const t = await request(app).post('/api/v1/distribusi/customer-types').set(auth(owner)).send({ label: 'Sekolah' });
    const typeId = t.body.data.id;
    const cust = await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'SD Ceria', type: typeId, masterPrice: 8000 });
    // in use → refused, reports the count
    const refused = await request(app).delete(`/api/v1/distribusi/customer-types/${typeId}`).set(auth(owner));
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.inUse).toBe(1);
    // reassign to reguler, then delete succeeds
    const ok = await request(app).delete(`/api/v1/distribusi/customer-types/${typeId}?reassignTo=reguler`).set(auth(owner));
    expect(ok.status).toBe(200);
    expect(ok.body.data.reassigned).toBe(1);
    const moved = await request(app).get(`/api/v1/distribusi/customers/${cust.body.data.id}`).set(auth(owner));
    expect(moved.body.data.type).toBe('reguler');   // no customer left on a missing type
  });
});
