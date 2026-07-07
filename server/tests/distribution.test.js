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

describe('Distribusi — retroactive master-price change (options + adjustments)', () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const mkCust = async (price) => (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Adj-' + Math.round(price) + '-' + Date.now().toString(36).slice(-4), type: 'reguler', masterPrice: price })).body.data.id;
  const mkTxn = async (cid, qty, method) => (await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cid, qty, method, txnDate: today() })).body.data.id;
  const getCust = (cid) => request(app).get(`/api/v1/distribusi/customers/${cid}`).set(auth(owner)).then((r) => r.body.data);

  it('preview reports count + total delta per scope, writing nothing', async () => {
    const cid = await mkCust(12000);
    await mkTxn(cid, 3, 'lunas'); await mkTxn(cid, 2, 'bon');
    const p = await request(app).post(`/api/v1/distribusi/customers/${cid}/price/preview`).set(auth(owner)).send({ newPrice: 13000 });
    expect(p.status).toBe(200);
    expect(p.body.data.scopes.all).toEqual({ count: 2, totalDelta: 5000 });     // (13000-12000)×(3+2)
    expect(p.body.data.scopes.cycle).toEqual({ count: 2, totalDelta: 5000 });   // both dated today → in-cycle
    expect(p.body.data.scopes.bon).toEqual({ count: 1, totalDelta: 2000 });     // only the bon txn
    const c = await getCust(cid);
    expect(c.masterPrice).toBe(12000);
    expect(c.transactions.every((t) => t.adjustAmount === 0)).toBe(true);
  });

  it('option (a) new-only: master price updates; old transactions keep their effective amount', async () => {
    const cid = await mkCust(12000);
    await mkTxn(cid, 3, 'lunas');
    const r = await request(app).patch(`/api/v1/distribusi/customers/${cid}/price`).set(auth(owner)).send({ newPrice: 13000, scope: null });
    expect(r.status).toBe(200);
    expect(r.body.data.masterPrice).toBe(13000);
    expect(r.body.data.affected).toBe(0);
    const c = await getCust(cid);
    expect(c.transactions[0].effectiveAmount).toBe(36000);   // 3 × 12000, unchanged
    expect(c.transactions[0].adjusted).toBe(false);
  });

  it('option (b) all: appends +delta per txn; originals intact; bon & audit follow', async () => {
    const cid = await mkCust(12000);
    const lunasId = await mkTxn(cid, 3, 'lunas');
    const bonId = await mkTxn(cid, 2, 'bon');
    const r = await request(app).patch(`/api/v1/distribusi/customers/${cid}/price`).set(auth(owner)).send({ newPrice: 13000, scope: 'all' });
    expect(r.status).toBe(200);
    expect(r.body.data.affected).toBe(2);
    expect(r.body.data.totalDelta).toBe(5000);
    const c = await getCust(cid);
    const L = c.transactions.find((t) => t.id === lunasId), B = c.transactions.find((t) => t.id === bonId);
    expect(L.amount).toBe(36000);            // ORIGINAL untouched
    expect(L.adjustAmount).toBe(3000);
    expect(L.effectiveAmount).toBe(39000);   // 3 × 13000
    expect(L.adjusted).toBe(true);
    expect(B.effectiveAmount).toBe(26000);   // 2 × 13000
    expect(c.sisaBon).toBe(26000);           // receivable follows the new price
    expect(c.priceAdjustments[0]).toMatchObject({ count: 2, totalDelta: 5000, oldPrice: 12000, newPrice: 13000, scope: 'all' });
    const audit = await request(app).get('/api/v1/distribusi/audit?kind=harga').set(auth(owner));
    expect(audit.body.data.some((a) => /cakupan all/.test(a.detail) && /2 transaksi/.test(a.detail) && /selisih 5000/.test(a.detail))).toBe(true);
  });

  it('cancel the batch → adjustments revert (effective + bon back), audited; originals still intact', async () => {
    const cid = await mkCust(12000);
    const bonId = await mkTxn(cid, 2, 'bon');
    const r = await request(app).patch(`/api/v1/distribusi/customers/${cid}/price`).set(auth(owner)).send({ newPrice: 13000, scope: 'all' });
    const batchId = r.body.data.batchId;
    expect((await getCust(cid)).sisaBon).toBe(26000);
    const cancel = await request(app).delete(`/api/v1/distribusi/price-adjustments/${batchId}`).set(auth(owner));
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.reversed).toBe(1);
    const c = await getCust(cid);
    expect(c.sisaBon).toBe(24000);           // back to 2 × 12000
    expect(c.transactions.find((t) => t.id === bonId).adjustAmount).toBe(0);
    expect(c.transactions.find((t) => t.id === bonId).amount).toBe(24000);   // original never changed
    expect(c.priceAdjustments.length).toBe(0);
    expect((await request(app).get('/api/v1/distribusi/audit?kind=harga').set(auth(owner))).body.data.some((a) => /Batalkan penyesuaian/.test(a.title))).toBe(true);
  });

  it('scope "bon": only unpaid (bon) transactions get adjusted', async () => {
    const cid = await mkCust(12000);
    await mkTxn(cid, 3, 'lunas'); await mkTxn(cid, 2, 'bon');
    const r = await request(app).patch(`/api/v1/distribusi/customers/${cid}/price`).set(auth(owner)).send({ newPrice: 13000, scope: 'bon' });
    expect(r.body.data.affected).toBe(1);
    expect(r.body.data.totalDelta).toBe(2000);
    const c = await getCust(cid);
    expect(c.transactions.find((t) => t.method === 'lunas').adjusted).toBe(false);
    expect(c.transactions.find((t) => t.method === 'bon').adjusted).toBe(true);
  });

  it('preview / retroactive change / cancel require distribusiHargaMaster (staff forbidden)', async () => {
    const cid = await mkCust(12000);
    expect((await request(app).post(`/api/v1/distribusi/customers/${cid}/price/preview`).set(auth(staff)).send({ newPrice: 13000 })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/distribusi/customers/${cid}/price`).set(auth(staff)).send({ newPrice: 13000, scope: 'all' })).status).toBe(403);
    expect((await request(app).delete('/api/v1/distribusi/price-adjustments/nope').set(auth(staff))).status).toBe(403);
  });
});

describe('Distribusi — per-fleet data separation (server-enforced)', () => {
  let merahCust, biruCust, staffMerah, staffBiru;
  const mkStaff = async (username, fleet) => {
    const r = await reg({ name: username, username, password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${r.user.id}`).set(auth(owner)).send({ permissions: { distribusi: true, distribusiCustomers: true }, fleetScope: [fleet] });
    return login(username, 'secret123');
  };
  beforeAll(async () => {
    const cm = await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Cust Merah', type: 'reguler', masterPrice: 10000, armada: 'Merah' });
    const cb = await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Cust Biru', type: 'reguler', masterPrice: 10000, armada: 'Biru' });
    merahCust = cm.body.data.id; biruCust = cb.body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: merahCust, qty: 2, method: 'bon', txnDate: '2026-08-01' });
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: biruCust, qty: 3, method: 'lunas', txnDate: '2026-08-01' });
    staffMerah = await mkStaff('staff_merah', 'Merah');
    staffBiru = await mkStaff('staff_biru', 'Biru');
  });

  it('a new transaction copies the customer fleet onto the record (fleetId)', async () => {
    const t = await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: merahCust, qty: 1, method: 'lunas', txnDate: '2026-08-02' });
    expect(t.body.data.fleetId).toBe('Merah');
  });

  it('scoped staff sees ONLY its fleet customers + transactions', async () => {
    const custs = await request(app).get('/api/v1/distribusi/customers').set(auth(staffMerah));
    expect(custs.body.data.every((c) => c.armada === 'Merah')).toBe(true);
    expect(custs.body.data.some((c) => c.id === merahCust)).toBe(true);
    expect(custs.body.data.some((c) => c.id === biruCust)).toBe(false);
    const txns = await request(app).get('/api/v1/distribusi/transactions').set(auth(staffMerah));
    expect(txns.body.data.every((t) => t.fleetId === 'Merah')).toBe(true);
    // Biru staff mirror
    const custsB = await request(app).get('/api/v1/distribusi/customers').set(auth(staffBiru));
    expect(custsB.body.data.every((c) => c.armada === 'Biru')).toBe(true);
  });

  it('scoped staff CANNOT open a cross-fleet customer (404)', async () => {
    expect((await request(app).get(`/api/v1/distribusi/customers/${biruCust}`).set(auth(staffMerah))).status).toBe(404);
    expect((await request(app).get(`/api/v1/distribusi/customers/${merahCust}`).set(auth(staffMerah))).status).toBe(200);
  });

  it('scoped staff CANNOT write across fleets (transaction / customer)', async () => {
    // transaction for a Biru customer → 403
    expect((await request(app).post('/api/v1/distribusi/transactions').set(auth(staffMerah)).send({ customerId: biruCust, qty: 1, method: 'lunas', txnDate: '2026-08-03' })).status).toBe(403);
    // creating a customer with another fleet → 403
    expect((await request(app).post('/api/v1/distribusi/customers').set(auth(staffMerah)).send({ name: 'X', type: 'reguler', masterPrice: 9000, armada: 'Biru' })).status).toBe(403);
  });

  it('a scoped staff\'s new customer is FORCED to its fleet (armada omitted → its fleet)', async () => {
    const r = await request(app).post('/api/v1/distribusi/customers').set(auth(staffMerah)).send({ name: 'Baru Merah', type: 'reguler', masterPrice: 9000 });
    expect(r.status).toBe(201);
    expect(r.body.data.armada).toBe('Merah');
    // and a transaction they add on their own customer records fleetId Merah
    const t = await request(app).post('/api/v1/distribusi/transactions').set(auth(staffMerah)).send({ customerId: merahCust, qty: 1, method: 'lunas', txnDate: '2026-08-04' });
    expect(t.body.data.fleetId).toBe('Merah');
  });

  it('full-access (owner) sees all fleets and can filter by ?fleet', async () => {
    const all = await request(app).get('/api/v1/distribusi/customers').set(auth(owner));
    expect(all.body.data.some((c) => c.id === merahCust) && all.body.data.some((c) => c.id === biruCust)).toBe(true);
    const merahOnly = await request(app).get('/api/v1/distribusi/customers?fleet=Merah').set(auth(owner));
    expect(merahOnly.body.data.every((c) => c.armada === 'Merah')).toBe(true);
    // dashboard customer count honours the fleet filter
    const sB = await request(app).get('/api/v1/distribusi/dashboard/summary?date=2026-08-01&fleet=Biru').set(auth(owner));
    expect(sB.body.data.customers).toBe(1);   // only Cust Biru carries the Biru fleet
    const sScopedB = await request(app).get('/api/v1/distribusi/dashboard/summary?date=2026-08-01').set(auth(staffBiru));
    expect(sScopedB.body.data.customers).toBe(1);   // scoped Biru staff sees only its fleet
  });
});
