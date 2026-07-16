'use strict';
// Location quality: GPS accuracy stored on set/paste; location photo stored as an Attachment ref
// (not base64 in the record), with who/when; photo NOT part of the completeness check.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let gm, cid;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_loc', password: 'secret123', role: 'gm' })).token;
  const c = await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'C1', phone: '0811', type: 'reguler', masterPrice: 5000, armada: 'Merah' });
  cid = c.body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — location accuracy + photo', () => {
  it('setLocation stores accuracy (metres) and builds the maps link', async () => {
    const r = await request(app).patch(`/api/v1/distribusi/customers/${cid}/location`).set(auth(gm)).send({ lat: -8.67, lng: 115.21, accuracy: 12 });
    expect(r.status).toBe(200);
    expect(r.body.data.locationAccuracy).toBe(12);
    expect(r.body.data.hasLocation).toBe(true);
    expect(r.body.data.mapsLink).toMatch(/-8\.67,115\.21/);
  });

  it('pasting a maps link clears the stale accuracy (pasted link has no GPS ±m)', async () => {
    const r = await request(app).patch(`/api/v1/distribusi/customers/${cid}`).set(auth(gm)).send({ mapsUrl: 'https://maps.app.goo.gl/abc' });
    expect(r.status).toBe(200);
    expect(r.body.data.locationAccuracy).toBeNull();
  });

  it('a location photo is stored as an Attachment REF (not base64 in the customer row) + who/when', async () => {
    // upload via the existing attachment flow → get an id
    const up = await request(app).post('/api/v1/attachments').set(auth(gm)).send({ data: PNG, name: 'rumah.png', mime: 'image/png', isImg: true });
    expect(up.status).toBe(201);
    const photoId = up.body.data.id;
    const r = await request(app).patch(`/api/v1/distribusi/customers/${cid}/location-photo`).set(auth(gm)).send({ photoId });
    expect(r.status).toBe(200);
    expect(r.body.data.locationPhotoId).toBe(photoId);
    expect(r.body.data.locationPhotoByName).toBe('Boss');
    expect(r.body.data.locationPhotoAt).toBeGreaterThan(0);
    // the customer row stores only the id — no base64 anywhere on it
    const raw = await prisma.customer.findUnique({ where: { id: cid } });
    expect(raw.locationPhotoId).toBe(photoId);
    expect(JSON.stringify(raw)).not.toMatch(/base64|data:image/);
    // bytes are fetched lazily from the attachment store
    const bytes = await request(app).get(`/api/v1/attachments/${photoId}`).set(auth(gm));
    expect(bytes.body.data.data).toBe(PNG);
  });

  it('the photo is NOT part of the completeness check (removing it keeps the customer complete)', async () => {
    // C1 has phone + location → complete regardless of photo
    let d = (await request(app).get(`/api/v1/distribusi/customers/${cid}`).set(auth(gm))).body.data;
    expect(d.complete).toBe(true);
    const r = await request(app).patch(`/api/v1/distribusi/customers/${cid}/location-photo`).set(auth(gm)).send({ photoId: null });
    expect(r.body.data.locationPhotoId).toBeNull();
    d = (await request(app).get(`/api/v1/distribusi/customers/${cid}`).set(auth(gm))).body.data;
    expect(d.complete).toBe(true);   // still complete without a photo
  });

  it('delivery board exposes locationPhotoId for the lazy "Foto lokasi" button', async () => {
    const up = await request(app).post('/api/v1/attachments').set(auth(gm)).send({ data: PNG, name: 'p.png', mime: 'image/png', isImg: true });
    await request(app).patch(`/api/v1/distribusi/customers/${cid}/location-photo`).set(auth(gm)).send({ photoId: up.body.data.id });
    // schedule the customer today so it appears on the board
    await request(app).patch(`/api/v1/distribusi/customers/${cid}`).set(auth(gm)).send({ deliveryDays: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] });
    const board = await request(app).get('/api/v1/distribusi/deliveries?date=2026-10-05&fleet=all').set(auth(gm));
    const stop = board.body.data.find((s) => s.customerId === cid);
    expect(stop && stop.locationPhotoId).toBe(up.body.data.id);
  });

  it('location + photo respect fleet scope (a Biru-scoped user cannot touch a Merah customer)', async () => {
    const u = await reg({ name: 'Helper', username: 'help_loc', password: 'secret123', role: 'gm' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ fleetScope: ['Biru'] });
    const t = (await request(app).post('/api/v1/auth/login').send({ username: 'help_loc', password: 'secret123' })).body.token;
    expect((await request(app).patch(`/api/v1/distribusi/customers/${cid}/location`).set(auth(t)).send({ lat: 1, lng: 1, accuracy: 5 })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/distribusi/customers/${cid}/location-photo`).set(auth(t)).send({ photoId: null })).status).toBe(403);
  });
});
