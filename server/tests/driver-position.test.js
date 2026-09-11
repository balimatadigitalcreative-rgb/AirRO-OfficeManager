'use strict';
/*
 * PHONE POSITION as the primary source for route ordering.
 *
 * WHAT THE PLATFORM CANNOT DO, pinned here because the product must not drift into promising it:
 * a web app cannot force location on, a denied permission never re-prompts, and positions arrive only
 * while the delivery screen is open. So these tests check the honest behaviours — batching thresholds,
 * the watch stopping when the tab hides, recovery instructions on denial — rather than any guarantee
 * of coverage.
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
const settings = require('../src/services/settings.service');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);

const DEPOT = { lat: -8.650000, lng: 115.216700 };
const PHONE = { lat: -8.670458, lng: 115.212629 };
const TRUCK = { lat: -8.681300, lng: 115.230000 };

cartrack.listVehicles = async () => [
  { vehicle_id: 452461090, registration: 'DK8184AP', vehicle_name: 'DK8184AP (BIRU)' },
].map(cartrack.normalizeVehicle);
cartrack.listStatuses = async () => [
  { vehicle_id: 452461090, registration: 'DK8184AP', event_ts: new Date().toISOString(), speed: 0,
    location: { latitude: TRUCK.lat, longitude: TRUCK.lng } },
].map(cartrack.normalizeStatus);

let gm, driver, driverId, custId;
const DAY = todayISO();

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_pos', password: 'secret123', role: 'gm' })).token;
  await settings.set('airro_fleet', ['Merah', 'Biru']);
  const d = await reg({ name: 'Sopir Biru', username: 'sopir_pos', password: 'secret123', role: 'finance' });
  driverId = d.user.id;
  await prisma.user.update({ where: { id: driverId }, data: {
    permissions: JSON.stringify({ distribusiPengiriman: true, distribusiLacakArmada: true }),
    fleetScope: JSON.stringify(['Biru']),
  } });
  driver = await login('sopir_pos', 'secret123');
  custId = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm))
    .send({ name: 'Warung Biru', type: 'reguler', masterPrice: 6000, armada: 'Biru', lat: -8.69, lng: 115.24 })).body.data.id;
  await request(app).post('/api/v1/distribusi/deliveries/order').set(auth(gm)).send({ customerId: custId, date: DAY, qty: 2 });
});
afterAll(() => prisma.$disconnect());

const post = (t, body) => request(app).post('/api/v1/distribusi/position').set(auth(t)).send(body);

describe('storing a position', () => {
  it('a driver posts their own fix and it is kept as the latest for that user', async () => {
    const r = await post(driver, { lat: PHONE.lat, lng: PHONE.lng, accuracy: 12, recordedAt: Date.now() });
    expect(r.status).toBe(200);
    const rows = await prisma.driverPosition.findMany({ where: { userId: driverId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].lat).toBeCloseTo(PHONE.lat, 5);
  });

  it('a second fix REPLACES the first — this is a position, not a trail', async () => {
    await post(driver, { lat: PHONE.lat + 0.001, lng: PHONE.lng, accuracy: 10, recordedAt: Date.now() });
    const rows = await prisma.driverPosition.findMany({ where: { userId: driverId } });
    expect(rows).toHaveLength(1);                       // still one row: no history accumulates
    expect(rows[0].lat).toBeCloseTo(PHONE.lat + 0.001, 5);
  });

  it('the fleet comes from the SESSION — a fleetId in the body is ignored', async () => {
    await post(driver, { lat: PHONE.lat, lng: PHONE.lng, accuracy: 9, fleetId: 'Merah', userId: 'somebody-else' });
    const row = await prisma.driverPosition.findUnique({ where: { userId: driverId } });
    expect(row.fleetId).toBe('Biru');                   // their own scope, not the crafted value
    expect(await prisma.driverPosition.count()).toBe(1);
  });

  it('a low-accuracy fix is rejected rather than stored as noise', async () => {
    const r = await post(driver, { lat: PHONE.lat, lng: PHONE.lng, accuracy: 850 });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/[Aa]kurasi/);
    const row = await prisma.driverPosition.findUnique({ where: { userId: driverId } });
    expect(row.accuracy).toBe(9);                       // the good fix still stands
  });

  it('nonsense coordinates are refused', async () => {
    expect((await post(driver, { lat: 'x', lng: 1 })).status).toBe(400);
  });
});

describe('reading positions is scoped and logged', () => {
  it('a driver sees their own fleet only', async () => {
    const other = await reg({ name: 'Sopir Merah', username: 'sopir_merah_pos', password: 'secret123', role: 'finance' });
    await prisma.user.update({ where: { id: other.user.id }, data: {
      permissions: JSON.stringify({ distribusiPengiriman: true, distribusiLacakArmada: true }),
      fleetScope: JSON.stringify(['Merah']),
    } });
    const t = await login('sopir_merah_pos', 'secret123');
    await post(t, { lat: -8.6, lng: 115.2, accuracy: 11 });
    const mine = await request(app).get('/api/v1/distribusi/positions').set(auth(driver));
    expect(mine.status).toBe(200);
    expect(mine.body.data.every((p) => p.fleetId === 'Biru')).toBe(true);
    expect(JSON.stringify(mine.body)).not.toContain('Sopir Merah');
  });

  it('viewing positions is audited', async () => {
    const rows = await prisma.distAuditLog.findMany({ where: { kind: 'lacak_posisi' } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('without distribusiLacakArmada the list is refused, though posting still works', async () => {
    const u = await reg({ name: 'Tanpa Lacak', username: 'nolacak_pos', password: 'secret123', role: 'finance' });
    await prisma.user.update({ where: { id: u.user.id }, data: { permissions: JSON.stringify({ distribusiPengiriman: true, distribusiLacakArmada: false }) } });
    const t = await login('nolacak_pos', 'secret123');
    expect((await request(app).get('/api/v1/distribusi/positions').set(auth(t))).status).toBe(403);
    expect((await post(t, { lat: -8.6, lng: 115.2, accuracy: 10 })).status).toBe(200);
  });
});

describe('source priority for the route origin', () => {
  it('the PHONE wins when it is fresher than the vehicle fix', async () => {
    await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({});
    await prisma.gpsDevice.updateMany({ data: { lastFixAt: new Date(Date.now() - 5 * 60 * 1000) } });   // truck: 5 min old
    await post(driver, { lat: PHONE.lat, lng: PHONE.lng, accuracy: 10, recordedAt: Date.now() });       // phone: now
    const r = await request(app).get(`/api/v1/distribusi/deliveries/route?date=${DAY}`).set(auth(driver));
    expect(r.status).toBe(200);
    expect(r.body.origin.source).toBe('phone');
    expect(r.body.origin.lat).toBeCloseTo(PHONE.lat, 5);
    expect(r.body.origin.ageMs).toBeLessThan(60000);       // the screen can say how old it is
  });

  it('the VEHICLE wins when the phone fix is older', async () => {
    await prisma.driverPosition.update({ where: { userId: driverId }, data: { recordedAt: new Date(Date.now() - 30 * 60 * 1000) } });
    await prisma.gpsDevice.updateMany({ data: { lastFixAt: new Date() } });
    const r = await request(app).get(`/api/v1/distribusi/deliveries/route?date=${DAY}`).set(auth(driver));
    expect(r.body.origin.source).toBe('vehicle');
    expect(r.body.originVehicle.registration).toBe('DK8184AP');
  });

  it('with BOTH stale it falls back to the depot, and says so', async () => {
    await settings.set('depotOrigin', DEPOT);
    await prisma.gpsDevice.updateMany({ data: { lastFixAt: new Date(Date.now() - 6 * 60 * 60 * 1000) } });
    const r = await request(app).get(`/api/v1/distribusi/deliveries/route?date=${DAY}`).set(auth(driver));
    expect(r.body.origin.source).toBe('depot');
    expect(r.body.origin.lat).toBeCloseTo(DEPOT.lat, 5);
  });

  it('with Cartrack SWITCHED OFF, routing still works from the phone', async () => {
    await settings.set('cartrackAktif', false);
    await post(driver, { lat: PHONE.lat, lng: PHONE.lng, accuracy: 10, recordedAt: Date.now() });
    const r = await request(app).get(`/api/v1/distribusi/deliveries/route?date=${DAY}`).set(auth(driver));
    expect(r.status).toBe(200);
    expect(r.body.origin.source).toBe('phone');
    // …and the panel reports the provider as OFF, which is a different state from "not configured".
    const dev = await request(app).get('/api/v1/gps/devices').set(auth(gm));
    expect(dev.body.providerEnabled).toBe(false);
    expect(dev.body.configured).toBe(false);
    expect((await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({})).status).toBe(400);
    await settings.set('cartrackAktif', true);
  });
});

describe('completing a stop without a position', () => {
  let stopId;
  beforeAll(async () => {
    const board = await request(app).get(`/api/v1/distribusi/deliveries?date=${DAY}&fleet=all`).set(auth(gm));
    stopId = board.body.data[0].id;
  });

  it('with the requirement OFF (the default) a stop closes normally', async () => {
    const r = await request(app).patch(`/api/v1/distribusi/deliveries/${stopId}`).set(auth(driver)).send({ status: 'terkirim' });
    expect(r.status).toBe(200);
    await request(app).patch(`/api/v1/distribusi/deliveries/${stopId}`).set(auth(driver)).send({ status: 'pending' });
  });

  it('with it ON and no recent fix, completing is refused — with a message, not a silent failure', async () => {
    await settings.set('wajibPosisiSelesai', true);
    await prisma.driverPosition.update({ where: { userId: driverId }, data: { recordedAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const r = await request(app).patch(`/api/v1/distribusi/deliveries/${stopId}`).set(auth(driver)).send({ status: 'terkirim' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/[Aa]ktifkan lokasi/);
  });

  it('a driver whose GPS genuinely failed can still finish, with a reason that is logged', async () => {
    const r = await request(app).patch(`/api/v1/distribusi/deliveries/${stopId}`).set(auth(driver))
      .send({ status: 'terkirim', noLocationReason: 'GPS HP saya mati sejak pagi' });
    expect(r.status).toBe(200);
    const a = await prisma.distAuditLog.findFirst({ where: { kind: 'pengiriman', title: { contains: 'tanpa posisi' } }, orderBy: { createdAt: 'desc' } });
    expect(a).toBeTruthy();
    expect(a.detail).toContain('GPS HP saya mati');
    expect(a.actorName).toBe('Sopir Biru');
    await settings.set('wajibPosisiSelesai', false);
  });

  it('a fresh fix satisfies the requirement with no reason needed', async () => {
    await settings.set('wajibPosisiSelesai', true);
    await request(app).patch(`/api/v1/distribusi/deliveries/${stopId}`).set(auth(driver)).send({ status: 'pending' });
    await post(driver, { lat: PHONE.lat, lng: PHONE.lng, accuracy: 10, recordedAt: Date.now() });
    const r = await request(app).patch(`/api/v1/distribusi/deliveries/${stopId}`).set(auth(driver)).send({ status: 'terkirim' });
    expect(r.status).toBe(200);
    await settings.set('wajibPosisiSelesai', false);
  });
});

describe('retention', () => {
  it('positions past the 8-hour window are deleted, not archived', async () => {
    await prisma.driverPosition.update({ where: { userId: driverId }, data: { recordedAt: new Date(Date.now() - 9 * 60 * 60 * 1000) } });
    await request(app).get('/api/v1/distribusi/positions').set(auth(driver));    // any read purges
    expect(await prisma.driverPosition.findUnique({ where: { userId: driverId } })).toBeNull();
  });
});

describe('the client collects honestly', () => {
  // The behaviours the platform imposes, pinned so they cannot quietly regress into a promise of
  // coverage the browser will never deliver.
  const jsx = fs.readFileSync(path.join(__dirname, '..', '..', 'distribution.jsx'), 'utf8');

  it('uses watchPosition, not a getCurrentPosition polling loop', () => {
    expect(jsx).toMatch(/navigator\.geolocation\.watchPosition\(/);
    expect(jsx).toContain('enableHighAccuracy: true');
  });

  it('batches uploads at 100 m or 60 s, whichever comes first', () => {
    expect(jsx).toContain('const POS_MOVE_M = 100;');
    expect(jsx).toContain('const POS_EVERY_MS = 60000;');
    expect(jsx).toContain('if (!(moved > POS_MOVE_M || due)) return;');
  });

  it('stops the watch when the screen is hidden and resumes on return', () => {
    expect(jsx).toContain("document.addEventListener('visibilitychange', vis)");
    expect(jsx).toMatch(/if \(document\.hidden\) stop\(\); else if \(perm === 'granted'\) start\(\);/);
    expect(jsx).toMatch(/clearWatch/);
  });

  it('a denied permission shows recovery instructions instead of another useless prompt', () => {
    expect(jsx).toContain("const denied = perm === 'denied';");
    expect(jsx).toMatch(/denied \?[\s\S]{0,400}geoHelp\(1\)/);
  });

  it('tells the driver plainly that it only works while the screen is open', () => {
    expect(jsx).toContain('dist.posOnlyOpen');
    expect(jsx).toContain('dist.posPrivacy');
  });

  it('never invents a position when permission is missing', () => {
    // No default coordinates anywhere in the watch component.
    const i = jsx.indexOf('function DriverWatch(');
    const body = jsx.slice(i, jsx.indexOf('function LocCoverage()', i));
    expect(body).not.toMatch(/lat:\s*-?\d+\.\d+/);
  });
});
