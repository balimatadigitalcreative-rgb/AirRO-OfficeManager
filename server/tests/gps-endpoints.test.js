'use strict';
/*
 * THE ADAPTER MAY REQUEST TWO PATHS AND NO OTHERS.
 *
 * Verified 200 against the live Indonesia API:
 *   /vehicles         identity only on this tenant — registration, model, licence, NO position
 *   /vehicles/status  the live feed, every vehicle in ONE call
 * Verified 404: /vehicles/{id}/status, /vehicles/{id}/position, /positions.
 *
 * The first release called only /vehicles and every device read "belum ada posisi" — a blank that
 * looked exactly like "the trucks are parked". These tests stub `fetch` and assert the EXACT set of
 * URLs the adapter requests, so a wrong or extra endpoint fails the build instead of quietly
 * returning nothing. They also assert one call serves both vehicles: per-vehicle polling would
 * multiply the request count by the size of the fleet.
 */
process.env.CARTRACK_USERNAME = 'test-user';
process.env.CARTRACK_PASSWORD = 'test-pass';
process.env.CARTRACK_TZ = 'UTC';
process.env.APP_TZ = 'Asia/Makassar';

const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const cartrack = require('../src/services/cartrack.service');
const config = require('../src/config/env');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);

const BASE = config.cartrack.baseUrl;
const VERIFIED = [BASE + '/vehicles', BASE + '/vehicles/status'];
// Paths the live API answers with 404. If one of these is ever requested, the adapter has regressed.
const KNOWN_404 = ['/vehicles/452461087/status', '/vehicles/452461087/position', '/positions', '/vehicles/positions'];

const VEHICLES = { data: [
  { vehicle_id: 452461087, registration: 'DK8919AQ', vehicle_name: 'DK8919AQ (MERAH)', default_timezone: null },
  { vehicle_id: 452461090, registration: 'DK8184AP', vehicle_name: 'DK8184AP (BIRU)', default_timezone: 'Asia/Bangkok' },
] };
const STATUS = { data: [
  { vehicle_id: 452461087, registration: 'DK8919AQ', event_ts: '2026-09-12 16:30:05+08', speed: 44, bearing: 351,
    ignition: true, location: { latitude: -8.6712, longitude: 115.2126 } },
  { vehicle_id: 452461090, registration: 'DK8184AP', event_ts: '2026-09-12 16:21:19+08', speed: 0, bearing: 48,
    ignition: false, location: { latitude: -8.65, longitude: 115.2167 } },
] };

let calls = [];
let headers = [];
const realFetch = global.fetch;
// Record every outbound request and answer it. Anything the adapter asks for shows up in `calls`.
const installFetch = () => {
  calls = []; headers = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    headers.push((opts && opts.headers) || {});
    const body = u.endsWith('/vehicles/status') ? STATUS : (u.endsWith('/vehicles') ? VEHICLES : { data: [] });
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
};

let gm, driver;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_ep', password: 'secret123', role: 'gm' })).token;
  // A DRIVER: delivery capability only. No `settings`, so no mapping rights.
  const d = await reg({ name: 'Sopir', username: 'sopir_ep', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: d.user.id }, data: { permissions: JSON.stringify({ distribusiPengiriman: true }) } });
  driver = await login('sopir_ep', 'secret123');
  await require('../src/services/settings.service').set('airro_fleet', ['Merah', 'Biru']);
});
afterAll(() => { global.fetch = realFetch; return prisma.$disconnect(); });
beforeEach(installFetch);

describe('the adapter requests ONLY the two verified paths', () => {
  it('listVehicles hits /vehicles and listStatuses hits /vehicles/status — nothing else', async () => {
    await cartrack.listVehicles();
    await cartrack.listStatuses();
    expect(calls).toEqual(VERIFIED);
  });

  it('a full sync touches no path outside the verified set', async () => {
    const r = await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({});
    expect(r.status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
    for (const u of calls) expect(VERIFIED).toContain(u);
  });

  it('a position refresh asks for the STATUS feed and never the identity list', async () => {
    const r = await request(app).post('/api/v1/gps/refresh').set(auth(gm)).send({});
    expect(r.status).toBe(200);
    expect(calls).toEqual([BASE + '/vehicles/status']);
  });

  it('no request is ever made to a path the live API answers with 404', async () => {
    await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({});
    for (const bad of KNOWN_404) {
      expect(calls.some((u) => u.endsWith(bad))).toBe(false);
    }
  });

  it('ONE call covers the whole fleet — never one request per vehicle', async () => {
    await require('../src/services/gps.service').refreshPositions({ force: true });   // past the cache
    const statusCalls = calls.filter((u) => u.endsWith('/vehicles/status'));
    expect(statusCalls).toHaveLength(1);
    // …and it did return both vehicles, so per-vehicle polling would buy nothing.
    const list = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data;
    expect(list.filter((d) => d.lat != null)).toHaveLength(2);
  });

  it('every request carries Basic auth, and no URL ever carries the credentials', async () => {
    await cartrack.listStatuses();
    expect(headers[0].Authorization).toMatch(/^Basic /);
    for (const u of calls) {
      expect(u).not.toContain('test-pass');
      expect(u).not.toContain('test-user');
    }
  });
});

describe('refreshing the position is delivery work, not configuration', () => {
  it('a driver without `settings` CAN refresh positions', async () => {
    const r = await request(app).post('/api/v1/gps/refresh').set(auth(driver)).send({});
    expect(r.status).toBe(200);
  });

  it('…but still cannot sync or re-map a vehicle', async () => {
    expect((await request(app).post('/api/v1/gps/sync').set(auth(driver)).send({})).status).toBe(403);
    const d = (await request(app).get('/api/v1/gps/devices').set(auth(driver))).body.data[0];
    expect((await request(app).patch(`/api/v1/gps/devices/${d.id}/fleet`).set(auth(driver)).send({ fleetId: 'Biru' })).status).toBe(403);
  });

  it('a refresh updates the position but NEVER the mapping', async () => {
    const before = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data.find((x) => x.vehicleId === '452461087');
    await request(app).post('/api/v1/gps/refresh').set(auth(gm)).send({});
    const after = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data.find((x) => x.vehicleId === '452461087');
    expect(after.fleetId).toBe(before.fleetId);
    expect(after.lat).toBe(-8.6712);
    expect(after.headingDeg).toBe(351);
    expect(after.ignitionOn).toBe(true);
  });

  it('the provider call is cached briefly, so a whole team pressing [Coba lagi] is ONE request', async () => {
    const gps = require('../src/services/gps.service');
    await gps.refreshPositions({ force: true });     // prime the cache
    installFetch();                                  // forget those calls
    await gps.refreshPositions({});
    await gps.refreshPositions({});
    await gps.refreshPositions({});
    expect(calls).toHaveLength(0);                   // three presses, zero provider calls
  });
});

describe('an empty position says WHY, and when we last asked', () => {
  it('a successful attempt is recorded with its time', async () => {
    await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({});
    const body = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body;
    expect(body.lastAttempt).toMatchObject({ ok: true, error: '' });
    expect(typeof body.lastAttempt.at).toBe('number');
  });

  it('a provider failure is recorded with its reason — not left as a blank position', async () => {
    const gps = require('../src/services/gps.service');
    global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'upstream down' });
    await gps.refreshPositions({ force: true });
    const body = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body;
    expect(body.lastAttempt.ok).toBe(false);
    expect(body.lastAttempt.error).toMatch(/503/);
    // The recorded reason must never carry the credentials into a screen or a log.
    expect(body.lastAttempt.error).not.toContain('test-pass');
  });

  it('a FAILED attempt starts no cooldown \u2014 [Coba lagi] must really retry', async () => {
    const gps = require('../src/services/gps.service');
    // The clock is pinned, because the property only shows itself when the failure happens AFTER a
    // cooldown has expired: if a failure restarted the cooldown, the retry five seconds later would be
    // served a twenty-second-old refusal and the button would look broken to someone already staring
    // at an error.
    const nowSpy = jest.spyOn(Date, 'now');
    let T = 1758000000000;
    nowSpy.mockImplementation(() => T);
    try {
      await gps.refreshPositions({ force: true });                   // a success at T
      T += 25000;                                                    // ...cooldown expires
      global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'down' });
      await gps.refreshPositions({});                                // a real attempt, which FAILS
      T += 5000;                                                     // only 5s later
      installFetch();                                                // provider healthy again
      await gps.refreshPositions({});                                // no force
      expect(calls).toEqual([BASE + '/vehicles/status']);            // it reached the provider
    } finally { nowSpy.mockRestore(); }
  });

  it('a device that has never been synced is posState "never", not an unexplained blank', async () => {
    await prisma.gpsDevice.create({ data: { provider: 'cartrack', vehicleId: '777', vehicleName: 'DK7777ZZ (MERAH)', fleetId: 'Merah' } });
    const d = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data.find((x) => x.vehicleId === '777');
    expect(d.posState).toBe('never');
    expect(d.lat).toBeNull();
  });

  it('a device the provider reports without coordinates is posState "noFix"', async () => {
    await prisma.gpsDevice.update({ where: { provider_vehicleId: { provider: 'cartrack', vehicleId: '777' } }, data: { lastSyncAt: new Date() } });
    const d = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data.find((x) => x.vehicleId === '777');
    expect(d.posState).toBe('noFix');
  });
});
