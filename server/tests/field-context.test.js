'use strict';
// FIELD CONTEXT — what the phone needs once: today, the armada (and the armada list it may pick), the
// field rules, the warehouse, and each pending stop's expected gallons (for Mode latihan's offline rit
// plan). And a driver may fix a customer's WhatsApp number without holding customer-editing rights.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const D = '/api/v1/distribusi';
const today = todayISO();
const ALL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
let gm, driver, cA, cB, cOther;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'fc_gm', password: 'secret123', role: 'gm' })).token;
  await request(app).put('/api/v1/settings/airro_fleet').set(auth(gm)).send({ value: ['DK 1', 'DK 2'] });
  const d = await reg({ name: 'Sopir', username: 'fc_driver', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: d.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiPengiriman: true }), fleetScope: JSON.stringify(['DK 1']) } });
  driver = await login('fc_driver');
  cA = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'A', type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL, phone: '0812' })).body.data.id;
  cB = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'B', type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL })).body.data.id;
  cOther = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'C', type: 'reguler', masterPrice: 6000, armada: 'DK 2', deliveryDays: ALL })).body.data.id;
  for (const q of [3, 5]) await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cA, qty: q, method: 'lunas', txnDate: today });
  await request(app).put(`${D}/depot`).set(auth(gm)).send({ lat: -8.65, lng: 115.2 });
  await request(app).get(`${D}/deliveries?date=${today}&fleet=DK%201`).set(auth(gm));
});
afterAll(() => prisma.$disconnect());

it('a scoped driver gets their armada, the rules, the warehouse and each stop\'s expected gallons', async () => {
  const r = await request(app).get(`${D}/field-context?date=${today}`).set(auth(driver));
  expect(r.status).toBe(200);
  const c = r.body.data;
  expect(c.today).toBe(today);
  expect(c.fleet).toBe('DK 1');
  expect(c.fleets).toEqual(['DK 1']);
  expect(c.rules.ritSop.minLoad).toBe(80);
  expect(c.depot).toEqual({ lat: -8.65, lng: 115.2 });
  const board = (await request(app).get(`${D}/deliveries?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
  const stopB = board.find((s) => s.customerId === cB);
  expect(c.demand[stopB.id]).toBe(1);   // no history → 1
  const stopA = board.find((s) => s.customerId === cA);
  if (stopA && stopA.status === 'pending') expect(c.demand[stopA.id]).toBe(4);   // avg(3,5)
});
it('a driver cannot ask for another armada', async () => {
  expect((await request(app).get(`${D}/field-context?fleet=DK%202`).set(auth(driver))).status).toBe(403);
});
it('a full-access user without a choice gets the first armada of the list; a choice wins', async () => {
  expect((await request(app).get(`${D}/field-context`).set(auth(gm))).body.data.fleet).toBe('DK 1');
  expect((await request(app).get(`${D}/field-context?fleet=DK%202`).set(auth(gm))).body.data.fleet).toBe('DK 2');
  expect((await request(app).get(`${D}/field-context`).set(auth(gm))).body.data.fleets).toEqual(['DK 1', 'DK 2']);
});
it('a driver can set a customer\'s WhatsApp number (normalised, audited) without customer-editing rights', async () => {
  const r = await request(app).patch(`${D}/customers/${cB}/phone`).set(auth(driver)).send({ phone: '0812 3456 7890' });
  expect(r.status).toBe(200);
  expect(r.body.data.phone).toBe('081234567890');
  const audit = (await request(app).get(`${D}/audit`).set(auth(gm))).body.data;
  expect(audit.some((a) => /Ubah nomor WA/.test(a.title))).toBe(true);
  expect((await request(app).patch(`${D}/customers/${cB}`).set(auth(driver)).send({ phone: '1' })).status).toBe(403);
});
it('a driver cannot touch a customer outside their armada', async () => {
  expect((await request(app).patch(`${D}/customers/${cOther}/phone`).set(auth(driver)).send({ phone: '0811' })).status).toBe(404);
});
it('an open rit from an earlier day is reported (it blocks opening a new one)', async () => {
  const { addDaysISO } = require('../src/config/permissions');
  const yesterday = addDaysISO(today, -1);
  await prisma.deliveryRun.deleteMany();
  expect((await request(app).post(`${D}/runs/open`).set(auth(gm)).send({ date: yesterday, fleet: 'DK 1', gallonsOut: 90 })).status).toBe(201);
  const c = (await request(app).get(`${D}/field-context`).set(auth(driver))).body.data;
  expect(c.openRun).toMatchObject({ date: yesterday, runNo: 1, gallonsOut: 90, status: 'open', sold: 0 });
  const none = (await request(app).get(`${D}/field-context?fleet=DK%202`).set(auth(gm))).body.data;
  expect(none.openRun).toBeNull();
});

it('Final fix: the context says whether a gallon adjustment waits for the office (owner setting)', async () => {
  const a = await request(app).get(`${D}/field-context?date=${today}`).set(auth(driver));
  expect(a.body.data.galonNeedsApproval).toBe(true);
  expect((await request(app).put('/api/v1/settings/adjustmentApproval').set(auth(gm)).send({ value: { galon: false } })).status).toBe(200);
  const b = await request(app).get(`${D}/field-context?date=${today}`).set(auth(driver));
  expect(b.body.data.galonNeedsApproval).toBe(false);
  await request(app).put('/api/v1/settings/adjustmentApproval').set(auth(gm)).send({ value: { galon: true } });
});
