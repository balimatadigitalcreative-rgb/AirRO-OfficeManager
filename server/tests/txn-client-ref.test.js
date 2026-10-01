'use strict';
// IDEMPOTENT FIELD WRITES — the phone sends a clientRef with every sale, bon payment and gallon damage
// charge. A retry after a lost response (same clientRef) returns the row already saved instead of
// recording it twice; the same ref for another customer is refused.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
const ALL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
let gm, cA, cB;

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'cr_gm', password: 'secret123', role: 'gm' })).body.token;
  cA = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'A', type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL })).body.data.id;
  cB = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'B', type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL })).body.data.id;
  await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ hargaGantiRugiGalon: 45000 });
});
afterAll(() => prisma.$disconnect());

it('a sale sent twice with the same clientRef is saved once', async () => {
  const body = { customerId: cA, qty: 3, method: 'bon', txnDate: today, clientRef: 'ref-sale-0001' };
  const r1 = await request(app).post(`${D}/transactions`).set(auth(gm)).send(body);
  const r2 = await request(app).post(`${D}/transactions`).set(auth(gm)).send(body);
  expect(r1.status).toBe(201); expect(r2.status).toBe(201);
  expect(r2.body.data.id).toBe(r1.body.data.id);
  expect(r2.body.data.replay).toBe(true);
  expect(await prisma.distTransaction.count({ where: { clientRef: 'ref-sale-0001' } })).toBe(1);
  expect(r2.body.data.sisaBon).toBe(18000);
});
it('a bon payment sent twice is saved once', async () => {
  const body = { customerId: cA, method: 'pelunasan', payAmount: 6000, payMethod: 'tunai', txnDate: today, clientRef: 'ref-pay-0001' };
  const r1 = await request(app).post(`${D}/transactions`).set(auth(gm)).send(body);
  const r2 = await request(app).post(`${D}/transactions`).set(auth(gm)).send(body);
  expect(r2.body.data.id).toBe(r1.body.data.id);
  expect(await prisma.distTransaction.count({ where: { customerId: cA, method: 'pelunasan' } })).toBe(1);
});
it('a gallon damage charge sent twice is saved once', async () => {
  const att = (await request(app).post('/api/v1/attachments').set(auth(gm)).send({ name: 'g.jpg', mime: 'image/jpeg', isImg: true, data: 'data:image/jpeg;base64,AAAA' })).body.data.id;
  const body = { qty: 1, kind: 'pecah', payMethod: 'tunai', photoId: att, clientRef: 'ref-dmg-0001' };
  const r1 = await request(app).post(`${D}/customers/${cA}/gallon-damage`).set(auth(gm)).send(body);
  const r2 = await request(app).post(`${D}/customers/${cA}/gallon-damage`).set(auth(gm)).send(body);
  expect(r1.status).toBe(201);
  expect(r2.body.data.transaction.id).toBe(r1.body.data.transaction.id);
  expect(r2.body.data.replay).toBe(true);
  expect(await prisma.distTransaction.count({ where: { kind: 'ganti_rugi' } })).toBe(1);
});
it('the same clientRef for another customer is refused; no ref keeps the old behaviour', async () => {
  const r = await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cB, qty: 1, method: 'lunas', txnDate: today, clientRef: 'ref-sale-0001' });
  expect(r.status).toBe(409);
  const a = await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cB, qty: 1, method: 'lunas', txnDate: today });
  const b = await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cB, qty: 1, method: 'lunas', txnDate: today });
  expect(a.body.data.id).not.toBe(b.body.data.id);
});
it('Final fix: a field expense sent twice with the same clientRef is saved once; another armada is refused', async () => {
  const body = { date: today, fleet: 'DK 1', amount: 15000, category: 'bensin', method: 'tunai', clientRef: 'ref-exp-0001' };
  const r1 = await request(app).post(`${D}/expenses`).set(auth(gm)).send(body);
  const r2 = await request(app).post(`${D}/expenses`).set(auth(gm)).send(body);
  expect(r1.status).toBe(201);
  expect(r2.body.data.id).toBe(r1.body.data.id);
  expect(r2.body.data.replay).toBe(true);
  expect(await prisma.distExpense.count({ where: { clientRef: 'ref-exp-0001' } })).toBe(1);
  const other = await request(app).post(`${D}/expenses`).set(auth(gm)).send({ ...body, fleet: 'DK 2' });
  expect(other.status).toBe(409);
});
