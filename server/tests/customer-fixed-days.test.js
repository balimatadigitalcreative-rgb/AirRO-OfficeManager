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

  it('switching OFF with the payload the screens really send (old fixed days still in it) → 200 + the zone day', async () => {
    // Both the customer form and the map popup always send deliveryDays, pre-filled with the old
    // fixed days. That must not trip the "days belong to the zone" lock — the zone takes them over.
    await request(app).patch(`${C}/${hotel}`).set(auth(gm)).send({ fixedDays: true, deliveryDays: ['Sen', 'Rab', 'Jum'] });
    const r = await request(app).patch(`${C}/${hotel}`).set(auth(gm)).send({ name: 'Hotel A', armada: 'DK 1', deliveryDays: ['Sen', 'Rab', 'Jum'], fixedDays: false });
    expect(r.status).toBe(200);
    expect(r.body.data.deliveryDays).toEqual(['Sab']);
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

describe('the daily planner counts fixed-day visits', () => {
  // Fresh world: 10 regular customers in one neighbourhood + 2 hotels there on Sen/Rab/Jum.
  const P = (i) => ({ lat: -8.650 + (i % 5) * 0.001, lng: 115.220 + Math.floor(i / 5) * 0.001 });
  let hotels;
  beforeAll(async () => {
    // Delivery rows from the board test reference customers: start from a clean database.
    await resetDb();
    gm = (await reg({ name: 'Boss', username: 'gm_fixed_plan', password: 'secret123', role: 'gm' })).token;
    for (let i = 0; i < 10; i++) await mk('Biasa ' + i, P(i));
    hotels = [(await mk('Hotel X', Object.assign({ fixedDays: true, deliveryDays: ['Sen', 'Rab', 'Jum'] }, P(2)))).data.id,
      (await mk('Hotel Y', Object.assign({ fixedDays: true, deliveryDays: ['Sen', 'Min'] }, P(3)))).data.id];
    await mk('Hotel Tanpa Titik', { fixedDays: true, deliveryDays: ['Sel', 'Kam'] });
  });
  const auto = (body) => request(app).post(`${Z}/auto`).set(auth(gm)).send(Object.assign({ mode: 'daily', armadas: ['DK 1'] }, body));

  it('a slot counts regular + fixed and never exceeds the maximum', async () => {
    const r = await auto({ maxPerDay: 4, dryRun: true });
    expect(r.status).toBe(200);
    r.body.data.groups.forEach((g) => expect(g.count + g.fixed).toBeLessThanOrEqual(4));
    const sen = r.body.data.groups.find((g) => g.day === 'Sen');
    expect(sen.fixed).toBe(2);                                  // Hotel X + Hotel Y
    expect(r.body.data.groups.reduce((s, g) => s + g.count, 0)).toBe(10);   // every regular placed
    expect(r.body.data.fixedCustomers).toBe(2);
    expect(r.body.data.sundayVisits).toBe(1);                   // Hotel Y's Minggu: kept, not counted
  });

  it('fixed visits alone over the maximum → 400 naming the day and the customers', async () => {
    // Two armadas so 10 one-customer routes fit (12 slots) and the FIXED check is what refuses.
    const r = await auto({ maxPerDay: 1, armadas: ['DK 1', 'DK 2'], dryRun: true });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Senin/);
    expect(r.body.error.message).toMatch(/Hotel X/);
  });

  it('not enough room once fixed visits are counted → 400 Kapasitas kurang', async () => {
    const r = await auto({ maxPerDay: 2, dryRun: true });     // 6 slots × 2 = 12 − 4 fixed visits = 8 < 10
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Kapasitas kurang/);
  });

  it('applying keeps every fixed day, gives hotels the armada, and a hotel without a point is untouched', async () => {
    const r = await auto({ maxPerDay: 4 });
    expect(r.status).toBe(200);
    const x = await prisma.customer.findUnique({ where: { id: hotels[0] } });
    expect(JSON.parse(x.deliveryDays)).toEqual(['Sen', 'Rab', 'Jum']);
    expect(x.armada).toBe('DK 1');
    expect(x.zoneId).not.toBeNull();
    const nop = await prisma.customer.findFirst({ where: { name: 'Hotel Tanpa Titik' } });
    expect(JSON.parse(nop.deliveryDays)).toEqual(['Sel', 'Kam']);
    expect(nop.zoneId).toBeNull();
  });

  it('with no regular customers at all → a clear 400', async () => {
    await prisma.customer.updateMany({ where: { fixedDays: false }, data: { lat: null, lng: null } });
    const r = await auto({ maxPerDay: 4, dryRun: true });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/pelanggan biasa/);
  });
});

describe('an armada whose whole quota goes to fixed-day customers', () => {
  // West: 2 regular customers + 2 hotels fixed on EVERY working day. East: 2 regular customers.
  // Max 2/day: the west armada's quota is used up by the hotels on all six days, so its regular
  // customers must move to the east armada — and the west armada still needs a zone, or nothing
  // would give the hotels their armada.
  const SIX = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  let hotelIds;
  beforeAll(async () => {
    await resetDb();
    gm = (await reg({ name: 'Boss', username: 'gm_fixed_only', password: 'secret123', role: 'gm' })).token;
    await mk('Barat 1', { lat: -8.650, lng: 115.100 }); await mk('Barat 2', { lat: -8.651, lng: 115.101 });
    await mk('Timur 1', { lat: -8.650, lng: 115.400 }); await mk('Timur 2', { lat: -8.651, lng: 115.401 });
    hotelIds = [(await mk('Hotel B1', { lat: -8.652, lng: 115.100, fixedDays: true, deliveryDays: SIX })).data.id,
      (await mk('Hotel B2', { lat: -8.649, lng: 115.102, fixedDays: true, deliveryDays: SIX })).data.id];
  });
  const auto = (extra) => request(app).post(`${Z}/auto`).set(auth(gm)).send(Object.assign({ mode: 'daily', maxPerDay: 2, armadas: ['DK 1', 'DK 2'] }, extra));

  it('preview: every day of the west armada shows the 2 fixed visits and no regular customer', async () => {
    const r = await auto({ dryRun: true });
    expect(r.status).toBe(200);
    const west = r.body.data.groups.filter((g) => g.fixed === 2);
    expect(west.map((g) => g.day).sort()).toEqual(SIX.slice().sort());
    west.forEach((g) => expect(g.count).toBe(0));
    r.body.data.groups.forEach((g) => expect(g.count + g.fixed).toBeLessThanOrEqual(2));
    expect(r.body.data.locked).toBeGreaterThanOrEqual(0);            // fixed customers are not counted as "locked"
    expect(r.body.data.locked).toBeLessThanOrEqual(4);
  });

  it('applying: the hotels keep all six days and get the west armada through a zone of that armada', async () => {
    const r = await auto({});
    expect(r.status).toBe(200);
    // The audit states the same "locked" count the owner saw in the preview; hotels are not counted.
    const log = await prisma.distAuditLog.findFirst({ where: { title: { startsWith: 'Zona per hari' } }, orderBy: { createdAt: 'desc' } });
    if (r.body.data.locked > 0) expect(log.detail).toContain(r.body.data.locked + ' dikunci di rutenya');
    else expect(log.detail).not.toMatch(/dikunci di rutenya/);
    const hotels = await prisma.customer.findMany({ where: { id: { in: hotelIds } } });
    const westArmada = hotels[0].armada;
    hotels.forEach((h) => { expect(days(h)).toEqual(SIX); expect(h.armada).toBe(westArmada); expect(h.zoneId).not.toBeNull(); });
    const z = await prisma.distZone.findUnique({ where: { id: hotels[0].zoneId } });
    expect(z.armada).toBe(westArmada);
    const west = await prisma.customer.findMany({ where: { name: { startsWith: 'Barat' } } });
    west.forEach((c) => expect(c.armada).not.toBe(westArmada));      // moved to the other armada
  });
});

describe('the customer form offers the switch', () => {
  const fs = require('fs'); const path = require('path');
  const jsx = fs.readFileSync(path.join(__dirname, '..', '..', 'distribution.jsx'), 'utf8');
  it('form state, both saves, and the detail badge carry fixedDays', () => {
    expect(jsx).toMatch(/fixedDays: !!d\.fixedDays/);                            // openEdit
    expect((jsx.match(/fixedDays: !!form\.fixedDays/g) || []).length).toBe(2);   // create + update payloads
    expect(jsx).toMatch(/trD\('cust\.fixedDays'\)/);
    expect(jsx).toMatch(/trD\('cust\.fixedBadge'\)/);
  });
  it('the edited screens still compile (a static match cannot see a JSX syntax error)', () => {
    // @babel/parser, NOT the frontend's esbuild: the deploy runs these tests in a checkout that has only
    // the SERVER's dependencies installed, and @babel/parser always ships with jest.
    const { parse } = require('@babel/parser');
    ['distribution.jsx', 'dist-zones.jsx'].forEach((f) => {
      expect(() => parse(fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8'), { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
    });
  });
  it('a fixed customer with no day is caught before saving', () => {
    expect(jsx).toMatch(/form\.fixedDays && !form\.deliveryDays\.length\) \{ setFormErr\(trD\('cust\.fixedNeedDay'\)\)/);
  });
});

describe('the zone map shows and edits fixed days', () => {
  const fs = require('fs'); const path = require('path');
  const jsx = fs.readFileSync(path.join(__dirname, '..', '..', 'dist-zones.jsx'), 'utf8');
  const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'finance-shell.jsx'), 'utf8');
  it('fixed customers get their own marker and filter', () => {
    expect(jsx).toMatch(/c\.fixedDays[\s\S]{0,400}zn-fx/);
    expect(jsx).toMatch(/\['fixed', trD\('zn\.fFixed'/);
  });
  it('the popup edits fixed days through the customer API, only with the customer capability', () => {
    // The editor belongs to the customer it was opened for: shown only for them and saved to THEM —
    // never to whoever is picked now (searching or clicking elsewhere changes the pick).
    expect(jsx).toMatch(/customers\.update\(fx\.id, fx\.on \? \{ fixedDays: true, deliveryDays: fx\.days \} : \{ fixedDays: false \}\)/);
    expect(jsx).toMatch(/\{fx\.on && <div className="zn-days">/);   // no day chips while the switch is off
    expect(jsx).toMatch(/fx && fx\.id === picked\.id/);
    expect(jsx).not.toMatch(/customers\.update\(picked\.id/);
    expect(shell).toMatch(/<DIST\.Zones[^>]*canCustomers=\{!!p\.distribusiCustomers\}/);
  });
  it('the legend explains the 3x marker, and the popup button reads "Atur hari tetap"', () => {
    expect(jsx).toMatch(/zn-lg-fx[\s\S]{0,80}trD\('zn\.lgFixed'\)/);
    const i18n = fs.readFileSync(path.join(__dirname, '..', '..', 'finance-i18n.js'), 'utf8');
    expect(i18n).toMatch(/'zn\.fxEdit': 'Atur hari tetap'/);
    expect(i18n).toMatch(/'zn\.fxEdit': 'Set fixed days'/);
    expect(i18n).toMatch(/'zn\.lgFixed': 'Hari tetap/);
  });
  it('the daily preview shows regular + fixed against the maximum and skips polygon-less rows on the map', () => {
    expect(jsx).toMatch(/trD\('zn\.nPlusFixed'/);
    expect(jsx).toMatch(/if \(!z\.polygon\) return;/);
  });
});
