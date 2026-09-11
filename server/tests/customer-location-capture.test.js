'use strict';
/*
 * CAPTURING A CUSTOMER'S LOCATION AT THE DOOR.
 *
 * The save path was never broken — PATCH /customers/:id/location has always overwritten freely on a
 * staff-tier capability. What was broken was everything AROUND it: the button rendered nothing at all
 * on desktop, and every geolocation failure (denied / unavailable / a 15s timeout indoors) produced
 * the same "izin ditolak", so a feature that worked looked dead.
 *
 * These tests pin the server half: the capability, the overwrite trail with the distance moved, the
 * mandatory reason for removal, revert, and the coverage count the office reads.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);

// Two points about 1.2 km apart in Denpasar — the "lokasi lama 1,2 km dari lokasi baru" case.
const DOOR = { lat: -8.670458, lng: 115.212629 };
const FAR = { lat: -8.681300, lng: 115.212629 };

let gm, staff, noCap, custId;

const mkCustomer = async (name, armada) => (await request(app).post('/api/v1/distribusi/customers').set(auth(gm))
  .send({ name, type: 'reguler', masterPrice: 6000, armada })).body.data.id;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_loc', password: 'secret123', role: 'gm' })).token;
  // A DELIVERY HELPER: the delivery board only. distribusiLokasiSimpan is derived from it, which is
  // the point — nobody who could tag a location yesterday needs a new grant today.
  const s = await reg({ name: 'Sopir', username: 'sopir_loc', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: s.user.id }, data: { permissions: JSON.stringify({ distribusiPengiriman: true }) } });
  staff = await login('sopir_loc', 'secret123');
  // Someone with the module but explicitly WITHOUT the location capability.
  const n = await reg({ name: 'Gudang', username: 'gudang_loc', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: n.user.id }, data: { permissions: JSON.stringify({ distribusiPengiriman: true, distribusiLokasiSimpan: false }) } });
  noCap = await login('gudang_loc', 'secret123');
  custId = await mkCustomer('Warung Bu Made', 'Merah');
});
afterAll(() => prisma.$disconnect());

describe('capture', () => {
  it('a delivery helper CAN save a location, and it persists', async () => {
    const r = await request(app).patch(`/api/v1/distribusi/customers/${custId}/location`).set(auth(staff))
      .send({ lat: DOOR.lat, lng: DOOR.lng, accuracy: 12 });
    expect(r.status).toBe(200);
    const c = await prisma.customer.findUnique({ where: { id: custId } });
    expect(c.lat).toBeCloseTo(DOOR.lat, 6);
    expect(c.lng).toBeCloseTo(DOOR.lng, 6);
    expect(c.locationAccuracy).toBe(12);
    expect(c.locationSetByName).toBe('Sopir');          // accountability, not just a coordinate
    expect(c.mapsUrl).toContain('maps?q=');             // navigable immediately
  });

  it('the capture is written to history', async () => {
    const h = await prisma.customerLocationHistory.findMany({ where: { customerId: custId } });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ action: 'set', prevLat: null, movedM: null });
    expect(h[0].actorName).toBe('Sopir');
  });

  it('a user without the capability is refused — the UI hiding it is not the control', async () => {
    const r = await request(app).patch(`/api/v1/distribusi/customers/${custId}/location`).set(auth(noCap))
      .send({ lat: DOOR.lat, lng: DOOR.lng, accuracy: 10 });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/distribusiLokasiSimpan/);
  });

  it('nonsense coordinates are refused rather than stored', async () => {
    const r = await request(app).patch(`/api/v1/distribusi/customers/${custId}/location`).set(auth(staff))
      .send({ lat: 999, lng: 'x' });
    expect(r.status).toBe(400);
  });
});

describe('overwrite', () => {
  it('replacing a point records BOTH sides and how far it moved', async () => {
    const r = await request(app).patch(`/api/v1/distribusi/customers/${custId}/location`).set(auth(staff))
      .send({ lat: FAR.lat, lng: FAR.lng, accuracy: 8 });
    expect(r.status).toBe(200);
    const h = await prisma.customerLocationHistory.findFirst({ where: { customerId: custId }, orderBy: { createdAt: 'desc' } });
    expect(h.action).toBe('set');
    expect(h.prevLat).toBeCloseTo(DOOR.lat, 6);         // the OLD value is kept, not overwritten away
    expect(h.lat).toBeCloseTo(FAR.lat, 6);
    // ~1.2 km — the number the person was shown before confirming, stored as shown.
    expect(h.movedM).toBeGreaterThan(1100);
    expect(h.movedM).toBeLessThan(1300);
  });

  it('the audit trail names the distance, so a suspicious jump is findable later', async () => {
    const a = await prisma.distAuditLog.findFirst({ where: { kind: 'pelanggan', title: { contains: 'Set lokasi' } }, orderBy: { createdAt: 'desc' } });
    expect(a.detail).toMatch(/geser \d+ m dari titik lama/);
  });

  it('the previous point can be restored without a survey visit', async () => {
    const r = await request(app).post(`/api/v1/distribusi/customers/${custId}/location/revert`).set(auth(staff)).send({});
    expect(r.status).toBe(200);
    const c = await prisma.customer.findUnique({ where: { id: custId } });
    expect(c.lat).toBeCloseTo(DOOR.lat, 6);             // back to the first capture
    const h = await prisma.customerLocationHistory.findFirst({ where: { customerId: custId }, orderBy: { createdAt: 'desc' } });
    expect(h.action).toBe('revert');
  });
});

describe('removal requires a written reason', () => {
  it('clearing without a note is refused', async () => {
    const r = await request(app).delete(`/api/v1/distribusi/customers/${custId}/location`).set(auth(staff)).send({ note: '' });
    expect(r.status).toBe(400);
    const c = await prisma.customer.findUnique({ where: { id: custId } });
    expect(c.lat).not.toBeNull();                       // nothing was thrown away
  });

  it('with a note it clears, and the customer returns to "belum ada lokasi"', async () => {
    const r = await request(app).delete(`/api/v1/distribusi/customers/${custId}/location`).set(auth(staff))
      .send({ note: 'terambil di toko sebelah' });
    expect(r.status).toBe(200);
    const c = await prisma.customer.findUnique({ where: { id: custId } });
    expect(c.lat).toBeNull();
    expect(c.lng).toBeNull();
    expect(c.mapsUrl).toBe('');                         // otherwise it still counts as "located"
    const h = await prisma.customerLocationHistory.findFirst({ where: { customerId: custId }, orderBy: { createdAt: 'desc' } });
    expect(h).toMatchObject({ action: 'clear', note: 'terambil di toko sebelah' });
    expect(h.prevLat).toBeCloseTo(DOOR.lat, 6);         // still revertible
  });

  it('a cleared location is still restorable from history', async () => {
    const r = await request(app).post(`/api/v1/distribusi/customers/${custId}/location/revert`).set(auth(staff)).send({});
    expect(r.status).toBe(200);
    expect((await prisma.customer.findUnique({ where: { id: custId } })).lat).toBeCloseTo(DOOR.lat, 6);
  });

  it('the history endpoint shows who, when, and what moved', async () => {
    const r = await request(app).get(`/api/v1/distribusi/customers/${custId}/location/history`).set(auth(staff));
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(4);
    expect(r.body.data[0]).toHaveProperty('actorName');
    expect(r.body.data.some((h) => h.action === 'clear' && h.note)).toBe(true);
  });
});

describe('coverage — the number the office reads', () => {
  it('counts COORDINATES, and reports link-only customers separately', async () => {
    const withLink = await mkCustomer('Punya Link Saja', 'Merah');
    await prisma.customer.update({ where: { id: withLink }, data: { mapsUrl: 'https://maps.app.goo.gl/xyz' } });
    await mkCustomer('Belum Ada Lokasi', 'Merah');
    const r = await request(app).get('/api/v1/distribusi/customers/location-coverage').set(auth(gm));
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(3);
    expect(r.body.data.withCoords).toBe(1);
    // A pasted link navigates by hand and is invisible to routing — counting it would make the gap
    // look smaller than it is, which is how a gap stays open.
    expect(r.body.data.linkOnly).toBe(1);
    expect(r.body.data.without).toBe(2);
    expect(r.body.data.pct).toBe(33);
    expect(r.body.data.byFleet[0]).toMatchObject({ fleetId: 'Merah', total: 3, withCoords: 1 });
  });
});

describe('bulk clear is admin-only, previewed, and named', () => {
  let a, b;
  beforeAll(async () => {
    a = await mkCustomer('Batch A', 'Merah');
    b = await mkCustomer('Batch B', 'Merah');
    for (const id of [a, b]) {
      await request(app).patch(`/api/v1/distribusi/customers/${id}/location`).set(auth(gm)).send({ lat: DOOR.lat, lng: DOOR.lng, accuracy: 9 });
    }
  });

  it('a delivery helper cannot bulk-clear', async () => {
    const r = await request(app).post('/api/v1/distribusi/customers/location/bulk-clear').set(auth(staff))
      .send({ ids: [a, b], note: 'salah batch' });
    expect(r.status).toBe(403);
  });

  it('the preview NAMES every customer that would lose its point', async () => {
    const r = await request(app).post('/api/v1/distribusi/customers/location/bulk-clear/preview').set(auth(gm)).send({ ids: [a, b, custId] });
    expect(r.status).toBe(200);
    expect(r.body.data.affected).toHaveLength(3);
    expect(r.body.data.affected.map((x) => x.name).sort()).toEqual(['Batch A', 'Batch B', 'Warung Bu Made']);
    expect(r.body.data.affected[0]).toHaveProperty('setBy');
  });

  it('it needs a reason too, and reports what it skipped', async () => {
    expect((await request(app).post('/api/v1/distribusi/customers/location/bulk-clear').set(auth(gm)).send({ ids: [a], note: '' })).status).toBe(400);
    const noLoc = await mkCustomer('Tanpa Lokasi', 'Merah');
    const r = await request(app).post('/api/v1/distribusi/customers/location/bulk-clear').set(auth(gm))
      .send({ ids: [a, b, noLoc], note: 'batch salah ambil' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ cleared: 2, skipped: 1 });
    expect((await prisma.customer.findUnique({ where: { id: a } })).lat).toBeNull();
    // …and each one is still individually revertible.
    const h = await prisma.customerLocationHistory.findFirst({ where: { customerId: a }, orderBy: { createdAt: 'desc' } });
    expect(h.action).toBe('clear');
    expect(h.prevLat).toBeCloseTo(DOOR.lat, 6);
  });
});

describe('the client explains a failure instead of swallowing it', () => {
  // The save path was fine; these are the two things that made it look dead. Pinned statically so the
  // explanations cannot quietly disappear in a refactor.
  const jsx = fs.readFileSync(path.join(__dirname, '..', '..', 'distribution.jsx'), 'utf8');

  it('a denied permission produces per-browser instructions, not a generic message', () => {
    expect(jsx).toContain('function geoHelp(');
    expect(jsx).toMatch(/navigator\.permissions[\s\S]{0,200}geolocation/);   // detected BEFORE the tap
    expect(jsx).toContain('dist.locHelpIos');
    expect(jsx).toContain('dist.locHelpChrome');
  });

  it('a timeout is not reported as a denial', () => {
    expect(jsx).toContain("if (code === 3) return trD('dist.locHelpTimeout');");
  });

  it('desktop says why the button is absent instead of rendering nothing', () => {
    expect(jsx).toContain("if (!touch) return <span className=\"dist-loc-hint\">{trD('dist.locDesktopOnly')}</span>;");
  });

  it('a low-accuracy fix is warned about before saving, with the number shown', () => {
    expect(jsx).toContain('const ACC_WARN = 50;');
    expect(jsx).toContain('dist.locAccBad');
  });

  it('only ONE position is ever read — no background trace of the staff member', () => {
    // A CALL, not the word: the module comment says "there is no watchPosition", and a bare substring
    // check would fail on the very sentence promising the thing it is testing for.
    expect(jsx).not.toMatch(/\.watchPosition\s*\(/);
    expect(jsx).toMatch(/\.getCurrentPosition\s*\(/);
  });
});
