'use strict';
// Invoice creation: a stored, sequential, unique INV-YYYYMM-#### number; billable set excludes
// legacy/void/disputed rows; concurrent creates never collide (retry on the @unique clash);
// reprint via GET returns the identical stored document.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const mkCust = (t, name) => request(app).post('/api/v1/distribusi/customers').set(auth(t)).send({ name, type: 'reguler', masterPrice: 10000, armada: 'Merah' }).then((r) => r.body.data.id);
const bon = (t, cid, qty, date) => request(app).post('/api/v1/distribusi/transactions').set(auth(t)).send({ customerId: cid, qty, method: 'bon', txnDate: date || '2026-08-01' });
const invCreate = (t, cid, body) => request(app).post('/api/v1/distribusi/customers/' + cid + '/invoices').set(auth(t)).send(body || {});
const invGet = (t, id) => request(app).get('/api/v1/distribusi/invoices/' + id).set(auth(t));
const invList = (t, cid) => request(app).get('/api/v1/distribusi/customers/' + cid + '/invoices').set(auth(t)).then((r) => r.body.data);

let gm, budi, budiId, custA;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'GM', username: 'iv_gm', password: 'secret123', role: 'gm' })).token;
  const b = await reg({ name: 'Budi', username: 'iv_budi', password: 'secret123', role: 'finance' });
  budiId = b.user.id;
  await prisma.user.update({ where: { id: budiId }, data: { permissions: JSON.stringify({ distribusi: true, distribusiInput: true, distribusiBonAdjust: true }) } });
  budi = await login('iv_budi');
  custA = await mkCust(gm, 'Cust A');
  await bon(gm, custA, 10);  // 100.000
  await bon(gm, custA, 10);  // 100.000  → sisa bon 200.000, both billable
});
afterAll(() => prisma.$disconnect());

const YM = new Date().toISOString().slice(0, 7).replace('-', '');

it('create → stored INV-YYYYMM-0001 with items + total + sisaBon', async () => {
  const r = await invCreate(gm, custA, { scope: 'unpaidBon', dueDate: '', note: 'tagihan bon' });
  expect(r.status).toBe(201);
  const iv = r.body.data;
  expect(iv.number).toBe('INV-' + YM + '-0001');
  expect(iv.items.length).toBe(2);
  expect(iv.total).toBe(200000);
  expect(iv.sisaBon).toBe(200000);
  // persisted
  expect(await prisma.distInvoice.findFirst({ where: { number: iv.number } })).toBeTruthy();
});

it('next create → sequential -0002', async () => {
  const r = await invCreate(gm, custA, { scope: 'unpaidBon' });
  expect(r.body.data.number).toBe('INV-' + YM + '-0002');
});

it('5 concurrent creates → 5 DISTINCT numbers, no 500', async () => {
  const rs = await Promise.all([0, 1, 2, 3, 4].map(() => invCreate(gm, custA, { scope: 'unpaidBon' })));
  expect(rs.every((r) => r.status === 201)).toBe(true);
  const nums = rs.map((r) => r.body.data.number);
  expect(new Set(nums).size).toBe(5);
  expect(nums.every((n) => /^INV-\d{6}-\d{4}$/.test(n))).toBe(true);
});

it('reprint via GET returns the identical stored document', async () => {
  const created = (await invCreate(gm, custA, { scope: 'unpaidBon', note: 'reprint-me' })).body.data;
  const fetched = (await invGet(gm, created.id)).body.data;
  expect(fetched.number).toBe(created.number);
  expect(fetched.total).toBe(created.total);
  expect(fetched.sisaBon).toBe(created.sisaBon);
  expect(fetched.items).toEqual(created.items);
  expect(fetched.note).toBe('reprint-me');
});

it('list returns the issued invoices (newest first)', async () => {
  const list = await invList(gm, custA);
  expect(list.length).toBeGreaterThanOrEqual(8);
  expect(list[0].number > list[list.length - 1].number).toBe(true);
});

it('legacy/void/disputed rows are NOT billable → clear 400', async () => {
  const c = await mkCust(gm, 'Cust B');
  // one LEGACY bon + one VOID bon + one DISPUTED bon = nothing billable.
  await prisma.distTransaction.create({ data: { customerId: c, fleetId: 'Merah', qty: 5, unitPriceLocked: BigInt(10000), amount: BigInt(50000), method: 'bon', txnDate: '2026-08-01', status: 'active', bonCounted: true, legacy: true } });
  await prisma.distTransaction.create({ data: { customerId: c, fleetId: 'Merah', qty: 5, unitPriceLocked: BigInt(10000), amount: BigInt(50000), method: 'bon', txnDate: '2026-08-01', status: 'void', bonCounted: true } });
  const disp = (await bon(budi, c, 8)).body.data.id;   // 80.000 handled by Budi
  const dId = (await request(app).post('/api/v1/distribusi/transactions/' + disp + '/dispute').set(auth(gm)).send({ resolution: 'staf', customerClaimAmount: 0, note: 'fiktif', staffUserId: budiId })).body.data.id;
  await request(app).post('/api/v1/distribusi/disputes/' + dId + '/approve').set(auth(gm)).send({});
  const r = await invCreate(gm, c, { scope: 'unpaidBon' });
  expect(r.status).toBe(400);
  expect(r.body.error.message).toMatch(/tidak ada transaksi/i);
});

it('disputed row is excluded but the live bon IS billed', async () => {
  const c = await mkCust(gm, 'Cust C');
  const live = (await bon(gm, c, 10)).body.data.id;   // 100.000 live
  const disp = (await bon(budi, c, 5)).body.data.id;  // 50.000 disputed
  const dId = (await request(app).post('/api/v1/distribusi/transactions/' + disp + '/dispute').set(auth(gm)).send({ resolution: 'staf', customerClaimAmount: 0, note: 'x', staffUserId: budiId })).body.data.id;
  await request(app).post('/api/v1/distribusi/disputes/' + dId + '/approve').set(auth(gm)).send({});
  const r = await invCreate(gm, c, { scope: 'unpaidBon' });
  expect(r.status).toBe(201);
  expect(r.body.data.items.length).toBe(1);
  expect(r.body.data.items[0].txnId).toBe(live);
  expect(r.body.data.total).toBe(100000);
});
