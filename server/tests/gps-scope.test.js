'use strict';
/*
 * VEHICLE TRACKING IS SCOPED TO THE USER'S OWN FLEET.
 *
 * Two independent gates, and both are enforced on the SERVER:
 *   distribusiLacakArmada  — may you see tracking at all? Without it every path is 403.
 *   fleetScope             — WHOSE vehicles? Resolved from the session (the JWT), never from a
 *                            request parameter. ["Biru"] sees DK8184AP and nothing else.
 *
 * The convention (lib/fleet-scope): null / 'all' / '' = every fleet; an array restricts; an explicit
 * [] restricts to NOTHING. These tests pin all three, because reading [] as "unrestricted" would hand
 * a cleared account the whole fleet.
 */
process.env.CARTRACK_USERNAME = 'test-user';
process.env.CARTRACK_PASSWORD = 'test-pass';
process.env.CARTRACK_TZ = 'UTC';
process.env.APP_TZ = 'Asia/Makassar';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const cartrack = require('../src/services/cartrack.service');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const devices = (t) => request(app).get('/api/v1/gps/devices').set(auth(t));

const VEHICLES = [
  { vehicle_id: 452461087, registration: 'DK8919AQ', vehicle_name: 'DK8919AQ (MERAH)' },
  { vehicle_id: 452461090, registration: 'DK8184AP', vehicle_name: 'DK8184AP (BIRU)' },
];
const STATUS = [
  { vehicle_id: 452461087, registration: 'DK8919AQ', event_ts: '2026-09-12 16:30:05+08', speed: 44, bearing: 351, ignition: true,
    location: { latitude: -8.6712, longitude: 115.2126 } },
  { vehicle_id: 452461090, registration: 'DK8184AP', event_ts: '2026-09-12 16:21:19+08', speed: 0, bearing: 48, ignition: false,
    location: { latitude: -8.6500, longitude: 115.2167 } },
];
cartrack.listVehicles = async () => VEHICLES.map(cartrack.normalizeVehicle);
cartrack.listStatuses = async () => STATUS.map(cartrack.normalizeStatus);

// One account per shape of access. Only `permissions` and `fleetScope` differ — there is no separate
// tracking mechanism to configure, which is the point.
const mkUser = async (username, permissions, fleetScope) => {
  const u = await reg({ name: username, username, password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: u.user.id }, data: {
    permissions: JSON.stringify(permissions),
    fleetScope: fleetScope === undefined ? 'all' : JSON.stringify(fleetScope),
  } });
  return { id: u.user.id, token: await login(username, 'secret123') };
};

let gm, driverBiru, driverMerah, backOffice, noTrack, emptyScope, drifted;
let merahDevice, biruDevice;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_scope', password: 'secret123', role: 'gm' })).token;
  await require('../src/services/settings.service').set('airro_fleet', ['Merah', 'Biru']);
  await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({});
  const all = (await devices(gm)).body.data;
  merahDevice = all.find((d) => d.fleetId === 'Merah');
  biruDevice = all.find((d) => d.fleetId === 'Biru');

  const TRACK = { distribusiPengiriman: true, distribusiLacakArmada: true };
  driverBiru = await mkUser('sopir_biru', TRACK, ['Biru']);
  driverMerah = await mkUser('sopir_merah', TRACK, ['Merah']);
  backOffice = await mkUser('kantor', TRACK, undefined);                       // fleetScope 'all' = every fleet
  noTrack = await mkUser('gudang', { distribusiPengiriman: true, distribusiLacakArmada: false });
  emptyScope = await mkUser('kosong', TRACK, []);                              // explicitly NO fleet
  drifted = await mkUser('salahtulis', TRACK, ['biru ']);                      // case + trailing space
});
afterAll(() => prisma.$disconnect());

describe('the capability gates the whole feature', () => {
  it('without distribusiLacakArmada every tracking path is 403', async () => {
    expect((await devices(noTrack.token)).status).toBe(403);
    expect((await request(app).post('/api/v1/gps/refresh').set(auth(noTrack.token)).send({})).status).toBe(403);
    expect((await request(app).post('/api/v1/gps/sync').set(auth(noTrack.token)).send({})).status).toBe(403);
    expect((await request(app).patch(`/api/v1/gps/devices/${biruDevice.id}/fleet`).set(auth(noTrack.token)).send({ fleetId: 'Biru' })).status).toBe(403);
  });

  it('the 403 names the capability, not the vehicles behind it', async () => {
    const r = await devices(noTrack.token);
    expect(r.body.error.message).toMatch(/distribusiLacakArmada/);
    expect(JSON.stringify(r.body)).not.toContain('DK8184AP');
    expect(JSON.stringify(r.body)).not.toContain('DK8919AQ');
  });
});

describe('fleetScope decides WHICH vehicles', () => {
  it('a driver scoped to Biru receives ONLY DK8184AP', async () => {
    const r = await devices(driverBiru.token);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].registration).toBe('DK8184AP');
    expect(r.body.scope).toMatchObject({ all: false, fleets: ['Biru'] });
    // Not a word about the other truck — not in the payload, not in a count, not in a total.
    expect(JSON.stringify(r.body)).not.toContain('DK8919AQ');
    expect(JSON.stringify(r.body)).not.toContain('452461087');
  });

  it('a driver scoped to Merah receives ONLY DK8919AQ', async () => {
    const r = await devices(driverMerah.token);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].registration).toBe('DK8919AQ');
  });

  it('back office (fleetScope "all" = unrestricted) sees BOTH', async () => {
    const r = await devices(backOffice.token);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.scope.all).toBe(true);
    expect(r.body.data.map((d) => d.registration).sort()).toEqual(['DK8184AP', 'DK8919AQ']);
  });

  it('a REFRESH is scoped too — the position of the other fleet never comes back', async () => {
    const r = await request(app).post('/api/v1/gps/refresh').set(auth(driverBiru.token)).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.data).toHaveLength(1);
    expect(r.body.data.data[0].registration).toBe('DK8184AP');
    expect(JSON.stringify(r.body)).not.toContain('115.2126');     // the Merah longitude
  });

  it('a crafted request naming the OTHER fleet\'s vehicle is refused, not served', async () => {
    // The driver has a real device id for a truck outside their scope. Scope is resolved from the
    // session, so naming the id changes nothing: this is the IDOR shape fixed in the payslip endpoint.
    const r = await request(app).patch(`/api/v1/gps/devices/${merahDevice.id}/fleet`).set(auth(driverBiru.token)).send({ fleetId: 'Biru' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain('DK8919AQ');     // the error discloses no vehicle
  });

  it('changing a fleetScope changes what a user sees — no code change, no deploy', async () => {
    await prisma.user.update({ where: { id: driverBiru.id }, data: { fleetScope: JSON.stringify(['Merah']) } });
    const t = await login('sopir_biru', 'secret123');             // scope rides the token
    const r = await devices(t);
    expect(r.body.data.map((d) => d.registration)).toEqual(['DK8919AQ']);
    await prisma.user.update({ where: { id: driverBiru.id }, data: { fleetScope: JSON.stringify(['Biru']) } });
    driverBiru.token = await login('sopir_biru', 'secret123');
  });
});

describe('every empty case explains itself', () => {
  it('capability but NO armada assigned → emptyScope, and no vehicles', async () => {
    const r = await devices(emptyScope.token);
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('emptyScope');
    expect(r.body.data).toHaveLength(0);
    // An explicit [] must never be read as "all" — that is the whole fleet handed to a cleared account.
    expect(r.body.scope.all).toBe(false);
  });

  it('a fleetScope that matches no armada is DRIFT, reported rather than shown as empty', async () => {
    const r = await devices(drifted.token);
    // 'biru ' differs only by case and a trailing space, so it still resolves…
    expect(r.body.data.map((d) => d.registration)).toEqual(['DK8184AP']);
    expect(r.body.scope.drift).toHaveLength(0);
    // …but a genuinely unknown name is surfaced.
    await prisma.user.update({ where: { id: drifted.id }, data: { fleetScope: JSON.stringify(['Hijau']) } });
    const t = await login('salahtulis', 'secret123');
    const r2 = await devices(t);
    expect(r2.body.state).toBe('driftScope');
    expect(r2.body.scope.drift).toEqual(['Hijau']);
    expect(r2.body.data).toHaveLength(0);
  });

  it('an armada with no GPS device mapped says so, instead of rendering nothing', async () => {
    await require('../src/services/settings.service').set('airro_fleet', ['Merah', 'Biru', 'Kuning']);
    const u = await mkUser('sopir_kuning', { distribusiPengiriman: true, distribusiLacakArmada: true }, ['Kuning']);
    const r = await devices(u.token);
    expect(r.body.state).toBe('noDevice');
    expect(r.body.scope.fleets).toEqual(['Kuning']);
    await require('../src/services/settings.service').set('airro_fleet', ['Merah', 'Biru']);
  });

  it('an unmapped vehicle belongs to no fleet, so a scoped driver is never shown one', async () => {
    await prisma.gpsDevice.create({ data: { provider: 'cartrack', vehicleId: '999', vehicleName: 'DK0000XX (KUNING)', fleetId: '' } });
    const driver = await devices(driverBiru.token);
    expect(driver.body.data.map((d) => d.vehicleId)).toEqual(['452461090']);
    expect(driver.body.unmapped).toHaveLength(0);          // not even a count
    const boss = await devices(gm);
    expect(boss.body.unmapped).toHaveLength(1);            // the admin still gets the warning
    await prisma.gpsDevice.delete({ where: { provider_vehicleId: { provider: 'cartrack', vehicleId: '999' } } });
  });
});

describe('who looked is written down', () => {
  it('viewing tracking data is audited, with the fleet that was viewed', async () => {
    const u = await mkUser('sopir_audit', { distribusiPengiriman: true, distribusiLacakArmada: true }, ['Biru']);
    await devices(u.token);
    const rows = await prisma.distAuditLog.findMany({ where: { kind: 'lacak_armada', actorId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].fleetId).toBe('Biru');
    expect(rows[0].title).toMatch(/posisi kendaraan/i);
  });

  it('the panel reloading all day does not flood the log — one row per fleet per day', async () => {
    const u = await mkUser('sopir_audit2', { distribusiPengiriman: true, distribusiLacakArmada: true }, ['Biru']);
    await devices(u.token); await devices(u.token); await devices(u.token);
    const rows = await prisma.distAuditLog.findMany({ where: { kind: 'lacak_armada', actorId: u.id } });
    expect(rows).toHaveLength(1);
  });

  it('an unrestricted viewer is logged as having seen every fleet', async () => {
    await devices(backOffice.token);
    const rows = await prisma.distAuditLog.findMany({ where: { kind: 'lacak_armada', actorId: backOffice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toMatch(/semua armada/i);
  });
});

describe('route ordering starts from the truck in YOUR scope', () => {
  const DAY = todayISO();
  beforeAll(async () => {
    const c = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm))
      .send({ name: 'Warung Biru', type: 'reguler', masterPrice: 6000, armada: 'Biru', lat: -8.68, lng: 115.23 })).body.data.id;
    await request(app).post('/api/v1/distribusi/deliveries/order').set(auth(gm)).send({ customerId: c, date: DAY, qty: 2 });
  });

  it('with no phone position, the origin is the driver\'s own vehicle — no selection step', async () => {
    // A FRESH fix: ordering a whole day from a three-hour-old position looks right and is wrong.
    await prisma.gpsDevice.update({ where: { provider_vehicleId: { provider: 'cartrack', vehicleId: '452461090' } }, data: { lastFixAt: new Date() } });
    const r = await request(app).get(`/api/v1/distribusi/deliveries/route?date=${DAY}`).set(auth(driverBiru.token));
    expect(r.status).toBe(200);
    expect(r.body.origin.source).toBe('vehicle');
    expect(r.body.originVehicle.registration).toBe('DK8184AP');
  });

  it('a STALE fix is refused as an origin rather than quietly used', async () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await prisma.gpsDevice.update({ where: { provider_vehicleId: { provider: 'cartrack', vehicleId: '452461090' } }, data: { lastFixAt: old } });
    const r = await request(app).get(`/api/v1/distribusi/deliveries/route?date=${DAY}`).set(auth(driverBiru.token));
    expect(r.body.origin.source).not.toBe('vehicle');
    expect(r.body.originVehicle).toBeNull();
  });

  it('naming another fleet\'s vehicle as the origin does not reach it', async () => {
    await prisma.gpsDevice.update({ where: { provider_vehicleId: { provider: 'cartrack', vehicleId: '452461090' } }, data: { lastFixAt: new Date() } });
    await prisma.gpsDevice.update({ where: { provider_vehicleId: { provider: 'cartrack', vehicleId: '452461087' } }, data: { lastFixAt: new Date() } });
    const r = await request(app).get(`/api/v1/distribusi/deliveries/route?date=${DAY}&vehicleId=${merahDevice.id}`).set(auth(driverBiru.token));
    // vehicleId only NARROWS an already-scoped list: the Merah truck is not in it, so it selects
    // nothing and the origin falls through — it never becomes the Merah position.
    expect(r.body.originVehicle).toBeNull();
    expect(r.body.origin && r.body.origin.lat).not.toBe(-8.6712);
  });

  it('an explicit phone position still wins — the driver is where the driver is', async () => {
    const r = await request(app).get(`/api/v1/distribusi/deliveries/route?date=${DAY}&lat=-8.7&lng=115.25`).set(auth(driverBiru.token));
    expect(r.body.origin).toMatchObject({ source: 'driver', lat: -8.7 });
  });
});

describe('the mapping control is not rendered for a driver', () => {
  // The server refusal above is the enforcement; this pins the UI half so the control cannot drift
  // back to the tracking capability and start appearing for drivers.
  const jsx = fs.readFileSync(path.join(__dirname, '..', '..', 'distribution.jsx'), 'utf8');

  it('the fleet <select> is gated on canGpsMap (settings), never on canGps', () => {
    const i = jsx.indexOf('gps-sel');
    expect(i).toBeGreaterThan(0);
    const guard = jsx.slice(Math.max(0, i - 200), i);
    expect(guard).toContain('canGpsMap ?');
  });

  it('the provider SYNC button is gated on canGpsMap too', () => {
    expect(jsx).toMatch(/canGpsMap && <button[^>]*onClick=\{sync\}/);
  });

  it('the panel renders nothing at all without the tracking capability', () => {
    expect(jsx).toContain('if (!canGps || !info) return null;');
  });
});
