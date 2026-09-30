'use strict';
/*
 * CUSTOMER ZONES — areas on the map that OWN the delivery schedule of the customers inside them.
 *
 * The owner chose "the schedule follows the zone": a zone's armada + delivery days are written onto
 * every customer inside it. That is a bulk schedule change, so these tests pin the guard rails as
 * much as the feature:
 *   - capabilities: seeing the map vs managing zones (owner/GM tier), enforced by the server;
 *   - every change can be PREVIEWED (dryRun) and a preview writes nothing;
 *   - a zone field left empty never blanks a customer's schedule; leaving a zone keeps the schedule;
 *   - hand placement (zoneManual) survives boundary edits and new coordinates;
 *   - a new coordinate from the field puts the customer in the right zone immediately;
 *   - a customer's own armada/days cannot be edited behind the zone's back (409, says which zone);
 *   - regenerating a delivery board never rewrites the armada of a day already done.
 */
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const Z = '/api/v1/distribusi/zones';

// Two neighbourhoods ~3 km apart, each a square of ~1 km.
const NORTH = [[-8.60, 115.20], [-8.60, 115.21], [-8.61, 115.21], [-8.61, 115.20]];
const SOUTH = [[-8.63, 115.20], [-8.63, 115.21], [-8.64, 115.21], [-8.64, 115.20]];
const IN_N = { lat: -8.605, lng: 115.205 };
const IN_S = { lat: -8.635, lng: 115.205 };
const OUTSIDE = { lat: -8.70, lng: 115.30 };

let gm, viewer, driver;
const mk = async (name, loc, extra) => {
  const r = await request(app).post('/api/v1/distribusi/customers').set(auth(gm))
    .send(Object.assign({ name, type: 'reguler', masterPrice: 6000, armada: 'DK 9', deliveryDays: ['Rab'] }, loc || {}, extra || {}));
  return r.body.data.id;
};
const get = (id) => prisma.customer.findUnique({ where: { id } });
const days = (c) => JSON.parse(c.deliveryDays);

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_zone', password: 'secret123', role: 'gm' })).token;
  const v = await reg({ name: 'Planner', username: 'plan_zone', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: v.user.id }, data: { permissions: JSON.stringify({ distribusiPengiriman: true, distribusiZona: true }) } });
  viewer = await login('plan_zone', 'secret123');
  const d = await reg({ name: 'Sopir', username: 'sopir_zone', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: d.user.id }, data: { permissions: JSON.stringify({ distribusiPengiriman: true }) } });
  driver = await login('sopir_zone', 'secret123');
});
afterAll(() => prisma.$disconnect());

describe('capability defaults', () => {
  const { resolvePerms } = require('../src/config/permissions');
  it('owner and GM hold both; nobody else gains them from a field cap', () => {
    for (const role of ['owner', 'gm']) expect(resolvePerms(role, null)).toMatchObject({ distribusiZona: true, distribusiZonaKelola: true });
    const field = resolvePerms('finance', JSON.stringify({ distribusi: true, distribusiPengiriman: true, distribusiRute: true, distribusiCustomers: true }));
    expect(field).toMatchObject({ distribusiZona: false, distribusiZonaKelola: false });
  });
  it('an explicit grant wins', () => {
    expect(resolvePerms('finance', JSON.stringify({ distribusiZona: true })).distribusiZona).toBe(true);
  });
});

describe('capabilities', () => {
  it('a delivery driver cannot see the zone map', async () => {
    const r = await request(app).get(Z).set(auth(driver));
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/distribusiZona/);
  });

  it('a viewer sees the map but cannot change a zone', async () => {
    expect((await request(app).get(Z).set(auth(viewer))).status).toBe(200);
    const r = await request(app).post(Z).set(auth(viewer)).send({ name: 'X', polygon: NORTH });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/distribusiZonaKelola/);
  });
});

describe('creating a zone', () => {
  let a, b, far, noLoc, zn;
  beforeAll(async () => {
    a = await mk('Warung A', IN_N);
    b = await mk('Warung B', IN_N, { armada: 'DK 7', deliveryDays: ['Sab'] });
    far = await mk('Toko Jauh', OUTSIDE);
    noLoc = await mk('Belum Titik', null);
  });

  it('dryRun previews the change and writes nothing', async () => {
    const r = await request(app).post(Z).set(auth(gm)).send({ name: 'Utara', polygon: NORTH, armada: 'DK 1', deliveryDays: ['Sen', 'Kam'], dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.data.changes.map((c) => c.name).sort()).toEqual(['Warung A', 'Warung B']);
    expect(await prisma.distZone.count()).toBe(0);
    expect((await get(a)).armada).toBe('DK 9');
  });

  it('creating applies the zone schedule to the customers inside — and only them', async () => {
    const r = await request(app).post(Z).set(auth(gm)).send({ name: 'Utara', polygon: NORTH, armada: 'DK 1', deliveryDays: ['Sen', 'Kam'] });
    expect(r.status).toBe(201);
    zn = r.body.data.zone.id;
    expect(r.body.data.applied).toBe(2);
    for (const id of [a, b]) {
      const c = await get(id);
      expect(c.zoneId).toBe(zn);
      expect(c.armada).toBe('DK 1');
      expect(days(c)).toEqual(['Sen', 'Kam']);
    }
    const f = await get(far);
    expect(f.zoneId).toBeNull();
    expect(f.armada).toBe('DK 9');
    expect((await get(noLoc)).zoneId).toBeNull();
  });

  it('the bulk schedule change is audited with who and how many', async () => {
    const log = await prisma.distAuditLog.findFirst({ where: { title: { contains: 'Utara' } }, orderBy: { createdAt: 'desc' } });
    expect(log).toBeTruthy();
    expect(log.actorName).toBe('Boss');
    expect(log.detail).toMatch(/2 pelanggan/);
  });

  it('the map lists zones with their member counts, and every located customer', async () => {
    const r = await request(app).get(Z).set(auth(gm));
    const z = r.body.data.zones.find((x) => x.id === zn);
    expect(z).toMatchObject({ name: 'Utara', armada: 'DK 1', deliveryDays: ['Sen', 'Kam'], count: 2 });
    expect(z.polygon).toEqual(NORTH);
    const ids = r.body.data.customers.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([a, b, far]));
    expect(ids).not.toContain(noLoc);                         // no point → not on the map…
    expect(r.body.data.coverage).toMatchObject({ withoutCoords: 1 });   // …but counted
  });

  it('a customer cannot have its armada/days edited behind the zone\'s back', async () => {
    const r = await request(app).patch(`/api/v1/distribusi/customers/${a}`).set(auth(gm)).send({ armada: 'DK 5' });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/Zona Utara|Utara/);
    // Sending the SAME values (a full edit form) is fine.
    const ok = await request(app).patch(`/api/v1/distribusi/customers/${a}`).set(auth(gm)).send({ name: 'Warung A2', armada: 'DK 1', deliveryDays: ['Sen', 'Kam'] });
    expect(ok.status).toBe(200);
  });

  it('a new point captured in the field joins the zone at once', async () => {
    const r = await request(app).patch(`/api/v1/distribusi/customers/${far}/location`).set(auth(gm)).send({ lat: IN_N.lat, lng: IN_N.lng, accuracy: 8 });
    expect(r.status).toBe(200);
    const c = await get(far);
    expect(c.zoneId).toBe(zn);
    expect(c.armada).toBe('DK 1');
    expect(r.body.data.armada).toBe('DK 1');                  // the response is the post-zone state
  });

  it('shrinking the boundary releases a customer and KEEPS their last schedule', async () => {
    const tiny = [[-8.600, 115.200], [-8.600, 115.2001], [-8.6001, 115.2001], [-8.6001, 115.200]];
    const r = await request(app).put(`${Z}/${zn}`).set(auth(gm)).send({ polygon: tiny });
    expect(r.status).toBe(200);
    const c = await get(a);
    expect(c.zoneId).toBeNull();
    expect(c.armada).toBe('DK 1');
    expect(days(c)).toEqual(['Sen', 'Kam']);
    await request(app).put(`${Z}/${zn}`).set(auth(gm)).send({ polygon: NORTH });   // restore
    expect((await get(a)).zoneId).toBe(zn);
  });

  it('a zone field left empty never blanks anyone\'s schedule', async () => {
    const s = await mk('Warung Selatan', IN_S, { armada: 'DK 3', deliveryDays: ['Jum'] });
    const r = await request(app).post(Z).set(auth(gm)).send({ name: 'Selatan', polygon: SOUTH, armada: '', deliveryDays: [] });
    expect(r.status).toBe(201);
    const c = await get(s);
    expect(c.zoneId).toBe(r.body.data.zone.id);
    expect(c.armada).toBe('DK 3');
    expect(days(c)).toEqual(['Jum']);
  });

  it('changing the zone schedule reaches every member', async () => {
    const r = await request(app).put(`${Z}/${zn}`).set(auth(gm)).send({ deliveryDays: ['Sel', 'Jum'] });
    expect(r.status).toBe(200);
    for (const id of [a, b]) expect(days(await get(id))).toEqual(['Sel', 'Jum']);
  });

  it('rejects a boundary that is not an area', async () => {
    expect((await request(app).post(Z).set(auth(gm)).send({ name: 'Garis', polygon: [[-8.6, 115.2], [-8.61, 115.21]] })).status).toBe(400);
  });
});

describe('placing a customer by hand', () => {
  let c, north, south;
  beforeAll(async () => {
    const zs = (await request(app).get(Z).set(auth(gm))).body.data.zones;
    north = zs.find((z) => z.name === 'Utara').id;
    south = zs.find((z) => z.name === 'Selatan').id;
    c = await mk('Kost Pindahan', IN_N);
  });

  it('moves the customer into another zone and pins them there', async () => {
    const r = await request(app).post(`${Z}/assign`).set(auth(gm)).send({ customerId: c, zoneId: south });
    expect(r.status).toBe(200);
    const row = await get(c);
    expect(row).toMatchObject({ zoneId: south, zoneManual: true });
  });

  it('a boundary edit does not pull a hand-placed customer back', async () => {
    await request(app).put(`${Z}/${north}`).set(auth(gm)).send({ name: 'Utara' });
    expect((await get(c)).zoneId).toBe(south);
  });

  it('"ikuti lokasi" hands the customer back to their point', async () => {
    const r = await request(app).post(`${Z}/assign`).set(auth(gm)).send({ customerId: c, auto: true });
    expect(r.status).toBe(200);
    expect(await get(c)).toMatchObject({ zoneId: north, zoneManual: false });
  });

  it('keeping a customer OUT of every zone', async () => {
    await request(app).post(`${Z}/assign`).set(auth(gm)).send({ customerId: c, zoneId: null });
    expect(await get(c)).toMatchObject({ zoneId: null, zoneManual: true });
  });
});

describe('deleting a zone', () => {
  it('releases its customers and keeps their schedules', async () => {
    const zs = (await request(app).get(Z).set(auth(gm))).body.data.zones;
    const s = zs.find((z) => z.name === 'Selatan');
    const members = await prisma.customer.findMany({ where: { zoneId: s.id } });
    expect(members.length).toBeGreaterThan(0);
    const r = await request(app).delete(`${Z}/${s.id}`).set(auth(gm));
    expect(r.status).toBe(200);
    for (const m of members) {
      const after = await get(m.id);
      expect(after.zoneId).toBeNull();
      expect(after.armada).toBe(m.armada);
      expect(after.deliveryDays).toBe(m.deliveryDays);
    }
  });
});

describe('automatic zones', () => {
  it('dryRun groups the points and writes nothing', async () => {
    const before = await prisma.distZone.count();
    const r = await request(app).post(`${Z}/auto`).set(auth(gm)).send({ k: 2, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.data.groups).toHaveLength(2);
    r.body.data.groups.forEach((g) => { expect(g.polygon.length).toBeGreaterThanOrEqual(3); expect(g.count).toBeGreaterThan(0); });
    expect(await prisma.distZone.count()).toBe(before);
  });

  it('applying replaces the zones; each suggests the armada most of its customers already use', async () => {
    const r = await request(app).post(`${Z}/auto`).set(auth(gm)).send({ k: 2, keepManual: true });
    expect(r.status).toBe(200);
    const zs = await prisma.distZone.findMany();
    expect(zs).toHaveLength(2);
    zs.forEach((z) => expect(JSON.parse(z.deliveryDays)).toEqual([]));   // days are left to the owner
    const located = await prisma.customer.findMany({ where: { lat: { not: null }, zoneManual: false } });
    located.forEach((c) => expect(c.zoneId).not.toBeNull());
    // keepManual: the customer kept OUT by hand is still out.
    expect(await prisma.customer.findFirst({ where: { name: 'Kost Pindahan' } })).toMatchObject({ zoneId: null, zoneManual: true });
  });
});

describe('the delivery board never rewrites a day already done', () => {
  const shift = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  it('a delivered stop keeps its armada; a pending future stop follows the new one', async () => {
    const ALL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const id = await mk('Langganan Harian', OUTSIDE, { armada: 'DK 4', deliveryDays: ALL });
    const past = shift(todayISO(), -3), future = shift(todayISO(), 3);
    await request(app).get(`/api/v1/distribusi/deliveries?date=${past}`).set(auth(gm));
    await request(app).get(`/api/v1/distribusi/deliveries?date=${future}`).set(auth(gm));
    await prisma.delivery.updateMany({ where: { customerId: id, date: past }, data: { status: 'terkirim' } });
    // The owner moves this customer's area to another armada.
    await request(app).patch(`/api/v1/distribusi/customers/${id}`).set(auth(gm)).send({ armada: 'DK 8' });
    await request(app).get(`/api/v1/distribusi/deliveries?date=${past}`).set(auth(gm));
    await request(app).get(`/api/v1/distribusi/deliveries?date=${future}`).set(auth(gm));
    const done = await prisma.delivery.findFirst({ where: { customerId: id, date: past } });
    const next = await prisma.delivery.findFirst({ where: { customerId: id, date: future } });
    expect(done.fleetId).toBe('DK 4');
    expect(next.fleetId).toBe('DK 8');
  });
});

describe('the zone map screen is wired in, and honest about its third party', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

  it('ships in the bundle after the code it uses', () => {
    const build = read('build.mjs');
    const at = (f) => build.indexOf("'" + f + "'");
    expect(at('dist-zones.js')).toBeGreaterThan(0);
    expect(at('dist-zones.jsx')).toBeGreaterThan(at('distribution.jsx'));   // needs trD, useLiveKey, DIST
  });

  it('the menu item and the screen are both gated on distribusiZona; managing on distribusiZonaKelola', () => {
    const shell = read('finance-shell.jsx');
    expect(shell).toMatch(/id: 'dist-zones'[^\n]*caps: \['distribusiZona'\]/);
    expect(shell).toMatch(/screen === 'dist-zones' && p\.distribusiZona/);
    expect(shell).toMatch(/canManage=\{!!p\.distribusiZonaKelola\}/);
  });

  it('Leaflet is vendored (loaded from our own origin); only the OSM tiles are third-party, and attributed', () => {
    const jsx = read('dist-zones.jsx');
    expect(fs.existsSync(path.join(root, 'vendor', 'leaflet', 'leaflet.js'))).toBe(true);
    expect(jsx).toMatch(/'\/vendor\/leaflet\/leaflet\.js'/);
    expect(jsx).not.toMatch(/unpkg|cdnjs|jsdelivr/);
    expect(jsx).toMatch(/tile\.openstreetmap\.org/);
    expect(jsx).toMatch(/OpenStreetMap<\/a>/);                  // attribution is a licence condition
  });

  it('every save goes through the preview first', () => {
    const jsx = read('dist-zones.jsx');
    // create / update / assign are always called with dryRun first inside previewThen.
    expect(jsx).toMatch(/\(\) => window\.API\.distribusi\.zones\.create\(Object\.assign\(\{\}, body, \{ dryRun: true \}\)\)/);
    expect(jsx).toMatch(/\(\) => window\.API\.distribusi\.zones\.update\(id, Object\.assign\(\{\}, body, \{ dryRun: true \}\)\)/);
    expect(jsx).toMatch(/\(\) => window\.API\.distribusi\.zones\.assign\(Object\.assign\(\{\}, body, \{ dryRun: true \}\)\)/);
    expect(jsx).toMatch(/window\.API\.distribusi\.zones\.remove\(id, true\)/);
  });
});
