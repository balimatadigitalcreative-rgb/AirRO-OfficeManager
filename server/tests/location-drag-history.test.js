'use strict';
// GESER TITIK — the pin may be dragged away from the phone's GPS fix (which can be tens of metres off).
// History keeps HOW the point was set, the device fix and how far the pin was moved from it. A point
// typed in the customer form now leaves a history row too (it used to leave only a generic audit).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
let gm, cid;
const hist = async () => prisma.customerLocationHistory.findMany({ where: { customerId: cid }, orderBy: { createdAt: 'desc' } });

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'lg_gm', password: 'secret123', role: 'gm' })).body.token;
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Pak Wayan', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

it('a dragged pin records method, device fix and distance from the device', async () => {
  const r = await request(app).patch(`${D}/customers/${cid}/location`).set(auth(gm)).send({ lat: -8.67120, lng: 115.22626, accuracy: 25, method: 'geser', deviceLat: -8.67120, deviceLng: 115.22610, deviceAccuracy: 25 });
  expect(r.status).toBe(200);
  const h = (await hist())[0];
  expect(h.method).toBe('geser');
  expect(h.deviceLat).toBeCloseTo(-8.6712);
  expect(h.fromDeviceM).toBeGreaterThan(15);
  expect(h.fromDeviceM).toBeLessThan(20);
  const audit = (await request(app).get(`${D}/audit`).set(auth(gm))).body.data;
  expect(audit.some((a) => /Set lokasi/.test(a.title) && /digeser \d+ m dari GPS/.test(a.detail || ''))).toBe(true);
});

it('a plain GPS capture stays method gps', async () => {
  await request(app).patch(`${D}/customers/${cid}/location`).set(auth(gm)).send({ lat: -8.6713, lng: 115.2262, accuracy: 10 });
  expect((await hist())[0].method).toBe('gps');
});

it('coordinates typed in the customer form leave a history row with the previous point', async () => {
  const r = await request(app).patch(`${D}/customers/${cid}`).set(auth(gm)).send({ lat: -8.6800, lng: 115.2300 });
  expect(r.status).toBe(200);
  const h = (await hist())[0];
  expect(h.method).toBe('form');
  expect(h.prevLat).toBeCloseTo(-8.6713);
  expect(h.lat).toBeCloseTo(-8.68);
  expect(h.movedM).toBeGreaterThan(500);
});
