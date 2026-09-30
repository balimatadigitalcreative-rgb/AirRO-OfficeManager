'use strict';
/*
 * FIXED DELIVERY DAYS. Some customers (a hotel on Sen/Rab/Jum) have days of their own. Zones own
 * the schedule of everybody else, so these pin that a fixed customer's days survive every zone
 * operation, that the zone still gives it an armada, and that the flag behaves at the edges.
 */
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const Z = '/api/v1/distribusi/zones';
const C = '/api/v1/distribusi/customers';
const SQ = [[-8.60, 115.20], [-8.60, 115.21], [-8.61, 115.21], [-8.61, 115.20]];
const IN = { lat: -8.605, lng: 115.205 };
const days = (c) => JSON.parse(c.deliveryDays);
let gm, zoneId;
const mk = async (name, extra) => (await request(app).post(C).set(auth(gm))
  .send(Object.assign({ name, type: 'reguler', masterPrice: 6000, armada: 'DK 9', deliveryDays: ['Rab'] }, extra || {}))).body;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_fixed', password: 'secret123', role: 'gm' })).token;
});
afterAll(() => prisma.$disconnect());

describe('the flag', () => {
  it('fixedDays without any day is refused', async () => {
    const r = await request(app).post(C).set(auth(gm)).send({ name: 'Kosong', type: 'reguler', masterPrice: 1, deliveryDays: [], fixedDays: true });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/hari/i);
  });

  it('is stored and returned', async () => {
    const r = await mk('Hotel A', Object.assign({ fixedDays: true, deliveryDays: ['Sen', 'Rab', 'Jum'] }, IN));
    expect(r.data.fixedDays).toBe(true);
  });
});

describe('zones never touch fixed days', () => {
  let hotel, warung;
  beforeAll(async () => {
    hotel = (await prisma.customer.findFirst({ where: { name: 'Hotel A' } })).id;
    warung = (await mk('Warung', IN)).data.id;
    const r = await request(app).post(Z).set(auth(gm)).send({ name: 'Utara', polygon: SQ, armada: 'DK 1', deliveryDays: ['Kam'] });
    zoneId = r.body.data.zone.id;
  });

  it('the zone gives the hotel its armada but not its day; the warung gets both', async () => {
    const h = await prisma.customer.findUnique({ where: { id: hotel } });
    expect(h.armada).toBe('DK 1');
    expect(days(h)).toEqual(['Sen', 'Rab', 'Jum']);
    const w = await prisma.customer.findUnique({ where: { id: warung } });
    expect(days(w)).toEqual(['Kam']);
  });

  it('changing the zone days leaves the hotel alone', async () => {
    await request(app).put(`${Z}/${zoneId}`).set(auth(gm)).send({ deliveryDays: ['Sab'] });
    expect(days(await prisma.customer.findUnique({ where: { id: hotel } }))).toEqual(['Sen', 'Rab', 'Jum']);
  });

  it('a new point from the field keeps the hotel days', async () => {
    await request(app).patch(`${C}/${hotel}/location`).set(auth(gm)).send({ lat: IN.lat + 0.001, lng: IN.lng, accuracy: 5 });
    expect(days(await prisma.customer.findUnique({ where: { id: hotel } }))).toEqual(['Sen', 'Rab', 'Jum']);
  });

  it('the full edit form may change a fixed customer days inside a zone (armada unchanged) — 200', async () => {
    const r = await request(app).patch(`${C}/${hotel}`).set(auth(gm)).send({ name: 'Hotel A', armada: 'DK 1', deliveryDays: ['Sen', 'Kam'] });
    expect(r.status).toBe(200);
    expect(days(await prisma.customer.findUnique({ where: { id: hotel } }))).toEqual(['Sen', 'Kam']);
  });

  it('but its armada still belongs to the zone — 409', async () => {
    expect((await request(app).patch(`${C}/${hotel}`).set(auth(gm)).send({ armada: 'DK 5' })).status).toBe(409);
  });

  it('switching the flag OFF hands the days back to the zone at once', async () => {
    const r = await request(app).patch(`${C}/${hotel}`).set(auth(gm)).send({ fixedDays: false });
    expect(r.status).toBe(200);
    expect(r.body.data.deliveryDays).toEqual(['Sab']);
    expect(days(await prisma.customer.findUnique({ where: { id: hotel } }))).toEqual(['Sab']);
  });

  it('switching it ON again keeps whatever days are sent', async () => {
    const r = await request(app).patch(`${C}/${hotel}`).set(auth(gm)).send({ fixedDays: true, deliveryDays: ['Sen', 'Rab', 'Jum'] });
    expect(r.status).toBe(200);
    expect(days(await prisma.customer.findUnique({ where: { id: hotel } }))).toEqual(['Sen', 'Rab', 'Jum']);
  });

  it('the map payload marks the hotel as fixed', async () => {
    const r = await request(app).get(Z).set(auth(gm));
    expect(r.body.data.customers.find((c) => c.id === hotel).fixedDays).toBe(true);
  });

  it('the audit trail says the fixed days changed', async () => {
    const log = await prisma.distAuditLog.findFirst({ where: { title: { contains: 'Hotel A' }, detail: { contains: 'hari tetap' } } });
    expect(log).toBeTruthy();
  });
});

describe('the delivery board shows a fixed customer on each of its days', () => {
  const shift = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dow = (iso) => ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][new Date(iso + 'T00:00:00Z').getUTCDay()];
  it('rows appear exactly on Sen/Rab/Jum, on the zone armada', async () => {
    const hotel = await prisma.customer.findFirst({ where: { name: 'Hotel A' } });
    for (let i = 1; i <= 7; i++) {
      const d = shift(todayISO(), i);
      const r = await request(app).get(`/api/v1/distribusi/deliveries?date=${d}`).set(auth(gm));
      const row = r.body.data.find((x) => x.customerId === hotel.id);
      if (['Sen', 'Rab', 'Jum'].includes(dow(d))) { expect(row).toBeTruthy(); expect(row.fleetId).toBe('DK 1'); }
      else expect(row).toBeUndefined();
    }
  });
});
