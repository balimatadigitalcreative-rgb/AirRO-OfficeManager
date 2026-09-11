'use strict';
// ROUTE ORDERING BY PROXIMITY (Phase 1 — straight-line / haversine, no external API).
// Asserts: ordering from a known position walks nearest-neighbour with correct per-leg + cumulative
// distance; customers WITHOUT coordinates land in a trailing "belum ada lokasi" group instead of
// disappearing; a pinned ("urutan tetap") stop keeps its position; a missing driver position falls back
// to the depot (and then the centroid) with the origin LABELLED so the UI can say so; and saving the
// suggested order writes seq and is audited.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const DATE = '2026-09-11';
const FLEET = 'Merah';
// A small grid around Denpasar. O is the driver; A is nearest, then B, then C.
const O = { lat: -8.65, lng: 115.21 };
const P = { A: { lat: -8.651, lng: 115.211 }, B: { lat: -8.66, lng: 115.22 }, C: { lat: -8.68, lng: 115.24 } };

const route = (t, qs) => request(app).get('/api/v1/distribusi/deliveries/route?' + qs).set(auth(t));
const audit = async (t) => (await request(app).get('/api/v1/distribusi/audit').set(auth(t))).body.data;

let gm;
const cust = {}; const stop = {};

// Create a customer (optionally with coords) + a pending stop for DATE, seeded in a deliberate order.
async function mkStop(name, coords, seq) {
  const c = await prisma.customer.create({ data: { name, armada: FLEET, masterPrice: 6000, type: 'reguler', lat: coords ? coords.lat : null, lng: coords ? coords.lng : null } });
  cust[name] = c;
  const d = await prisma.delivery.create({ data: { date: DATE, fleetId: FLEET, customerId: c.id, source: 'jadwal', status: 'pending', seq } });
  stop[name] = d;
  return d;
}

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_route', password: 'secret123', role: 'gm' })).token;
  // Seeded SCRAMBLED (C first, then A, then B) so a correct result proves it really reordered.
  await mkStop('C FAR', P.C, 0);
  await mkStop('A NEAR', P.A, 1);
  await mkStop('B MID', P.B, 2);
  await mkStop('NO LOC', null, 3);          // no coordinates — must not disappear
});
afterAll(() => prisma.$disconnect());

describe('ordering from the driver position', () => {
  it('walks nearest-neighbour and reports per-leg + cumulative distance', async () => {
    const r = await route(gm, 'date=' + DATE + '&fleet=' + FLEET + '&lat=' + O.lat + '&lng=' + O.lng);
    expect(r.status).toBe(200);
    const b = r.body;
    expect(b.origin).toMatchObject({ source: 'driver' });
    expect(b.data.map((s) => s.customerName)).toEqual(['A NEAR', 'B MID', 'C FAR']);   // nearest first
    // cumulative is ascending and each step == previous cumulative + this leg
    let prevCum = 0;
    b.data.forEach((s, i) => {
      expect(s.order).toBe(i + 1);
      expect(s.legKm).toBeGreaterThan(0);
      expect(Math.abs(s.cumKm - (prevCum + s.legKm))).toBeLessThanOrEqual(0.1);
      expect(s.cumKm).toBeGreaterThan(prevCum - 0.001);
      prevCum = s.cumKm;
    });
    expect(b.totalKm).toBeCloseTo(b.data[b.data.length - 1].cumKm, 5);
    // the nearest stop really is a short hop, the farthest a long one
    expect(b.data[0].legKm).toBeLessThan(1);
    expect(b.data[2].legKm).toBeGreaterThan(1);
  });

  it('customers without coordinates come back in a trailing group, never dropped', async () => {
    const b = (await route(gm, 'date=' + DATE + '&fleet=' + FLEET + '&lat=' + O.lat + '&lng=' + O.lng)).body;
    expect(b.data.some((s) => s.customerName === 'NO LOC')).toBe(false);
    expect(b.unlocated.map((s) => s.customerName)).toEqual(['NO LOC']);
    expect(b.coverage).toMatchObject({ total: 4, withCoords: 3, withoutCoords: 1, pct: 75 });
  });

  it('[Mulai dari titik terjauh] starts at the far end instead', async () => {
    const b = (await route(gm, 'date=' + DATE + '&fleet=' + FLEET + '&lat=' + O.lat + '&lng=' + O.lng + '&strategy=farthest')).body;
    expect(b.strategy).toBe('farthest');
    expect(b.data[0].customerName).toBe('C FAR');
    expect(b.data.map((s) => s.customerName)).toEqual(['C FAR', 'B MID', 'A NEAR']);
  });
});

describe('pinned ("urutan tetap") stops', () => {
  it('keep their position while everything else is reordered around them', async () => {
    const pin = await request(app).patch('/api/v1/distribusi/deliveries/' + stop['C FAR'].id + '/pin').set(auth(gm)).send({ pinned: true });
    expect(pin.status).toBe(200);
    expect(pin.body.data.pinned).toBe(true);
    // C FAR is seeded FIRST (seq 0) and pinned, so it stays first even though it is the farthest stop.
    const b = (await route(gm, 'date=' + DATE + '&fleet=' + FLEET + '&lat=' + O.lat + '&lng=' + O.lng)).body;
    expect(b.data.map((s) => s.customerName)).toEqual(['C FAR', 'A NEAR', 'B MID']);
    expect(b.data[0].pinned).toBe(true);
    // unpin again so the later tests see a clean board
    await request(app).patch('/api/v1/distribusi/deliveries/' + stop['C FAR'].id + '/pin').set(auth(gm)).send({ pinned: false });
  });
});

describe('geolocation denied / unavailable', () => {
  it('falls back to the DEPOT origin and labels it', async () => {
    await require('../src/services/settings.service').set('depotOrigin', { lat: O.lat, lng: O.lng });
    const b = (await route(gm, 'date=' + DATE + '&fleet=' + FLEET)).body;   // no lat/lng, as if denied
    expect(b.origin).toMatchObject({ source: 'depot', lat: O.lat, lng: O.lng });
    expect(b.data.map((s) => s.customerName)).toEqual(['A NEAR', 'B MID', 'C FAR']);
  });

  it('falls back to the CENTROID when no depot is configured', async () => {
    await require('../src/services/settings.service').set('depotOrigin', null);
    const b = (await route(gm, 'date=' + DATE + '&fleet=' + FLEET)).body;
    expect(b.origin.source).toBe('centroid');
    expect(b.data).toHaveLength(3);   // still ordered, never an error
  });
});

describe('saving the suggested order', () => {
  it('writes seq in the given order and is audited', async () => {
    const b = (await route(gm, 'date=' + DATE + '&fleet=' + FLEET + '&lat=' + O.lat + '&lng=' + O.lng)).body;
    const order = b.data.map((s) => s.id).concat(b.unlocated.map((s) => s.id));   // full permutation
    const save = await request(app).put('/api/v1/distribusi/deliveries/reorder').set(auth(gm)).send({ date: DATE, fleet: FLEET, order, source: 'proximity' });
    expect(save.status).toBe(200);
    expect(save.body.data.count).toBe(4);
    const rows = await prisma.delivery.findMany({ where: { date: DATE }, orderBy: { seq: 'asc' } });
    expect(rows.map((r) => r.id)).toEqual(order);           // seq now matches the suggested order
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2, 3]);
    expect((await audit(gm)).some((x) => /Simpan urutan rute/i.test(x.title) && /urutan jarak/i.test(x.detail))).toBe(true);
  });

  it('a stop can still be completed out of sequence — the order is only a suggestion', async () => {
    const last = (await prisma.delivery.findMany({ where: { date: DATE }, orderBy: { seq: 'desc' }, take: 1 }))[0];
    const r = await request(app).patch('/api/v1/distribusi/deliveries/' + last.id).set(auth(gm)).send({ status: 'terkirim' });
    expect(r.status).toBe(200);   // never blocked, never flagged
  });
});
