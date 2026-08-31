'use strict';
// CAPABILITY SPLIT — "Belum Terkirim" (carry-over) moved behind its OWN cap `distribusiBelumTerkirim`,
// separate from the field team's daily-route cap `distribusiPengiriman`. A field user with only
// distribusiPengiriman must be REJECTED on every carry-over surface and see no count leak; a back-office
// user with the new cap sees everything. A stop carried into today is a normal 'tambahan' for field staff.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { resolvePerms } = require('../src/config/permissions');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const iso = (d) => d.toISOString().slice(0, 10);
const shift = (n) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const TODAY = iso(new Date());
const YEST = shift(-1);

let gm, field, admin, biruCust;
const mkCust = async (name, armada) => (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name, type: 'reguler', masterPrice: 10000, armada })).body.data.id;
const mkStop = (id, customerId, fleetId, date, status, extra) => prisma.delivery.create({ data: { id, customerId, fleetId, date, source: 'jadwal', status, seq: 0, ...(extra || {}) } });

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_split', password: 'secret123', role: 'gm' })).token;
  biruCust = await mkCust('Warung', 'Biru');
  await mkStop('spOut', biruCust, 'Biru', YEST, 'pending', { note: 'urgent 2 galon' });

  // FIELD user: runs the daily route (distribusiPengiriman) but NOT the back-office carry-over cap.
  const f = await reg({ name: 'Sopir', username: 'field_split', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: f.user.id }, data: { permissions: JSON.stringify({ distribusiPengiriman: true, distribusiDashboard: true }) } });
  field = await login('field_split', 'secret123');

  // BACK-OFFICE user: holds the carry-over cap.
  const a = await reg({ name: 'Admin BO', username: 'admin_split', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: a.user.id }, data: { permissions: JSON.stringify({ distribusiPengiriman: true, distribusiDashboard: true, distribusiBelumTerkirim: true }) } });
  admin = await login('admin_split', 'secret123');
});
afterAll(() => prisma.$disconnect());

describe('field user (distribusiPengiriman, NOT distribusiBelumTerkirim) is locked out', () => {
  it('403 on every carry-over endpoint, even with crafted requests', async () => {
    const get = await request(app).get('/api/v1/distribusi/deliveries/outstanding').set(auth(field));
    expect(get.status).toBe(403);
    const resolve = await request(app).post('/api/v1/distribusi/deliveries/outstanding/spOut/resolve').set(auth(field)).send({ action: 'kirim' });
    expect(resolve.status).toBe(403);
    const bulk = await request(app).post('/api/v1/distribusi/deliveries/outstanding/bulk-carry').set(auth(field)).send({ ids: ['spOut'] });
    expect(bulk.status).toBe(403);
    const prev = await request(app).post('/api/v1/distribusi/deliveries/outstanding/bulk-carry/preview').set(auth(field)).send({ ids: ['spOut'] });
    expect(prev.status).toBe(403);
    const undo = await request(app).post('/api/v1/distribusi/deliveries/outstanding/undo-carry').set(auth(field)).send({ items: [{ id: 'spOut' }] });
    expect(undo.status).toBe(403);
  });
  it('the outstanding COUNT does not leak through the dashboard summary', async () => {
    const r = await request(app).get('/api/v1/distribusi/dashboard/summary').set(auth(field));
    expect(r.status).toBe(200);
    expect(r.body.data.outstanding == null).toBe(true);   // null — never a number for a field user
  });
});

describe('back-office user (distribusiBelumTerkirim) sees + acts', () => {
  it('gets the list, the count, and can bulk carry', async () => {
    const list = await request(app).get('/api/v1/distribusi/deliveries/outstanding').set(auth(admin));
    expect(list.status).toBe(200);
    expect(list.body.data.map((x) => x.id)).toContain('spOut');
    const sum = await request(app).get('/api/v1/distribusi/dashboard/summary').set(auth(admin));
    expect(sum.body.data.outstanding).toBeTruthy();
    expect(sum.body.data.outstanding.count).toBeGreaterThanOrEqual(1);
    const carry = await request(app).post('/api/v1/distribusi/deliveries/outstanding/bulk-carry').set(auth(admin)).send({ ids: ['spOut'], date: TODAY });
    expect(carry.body.data.added).toBe(1);
  });
});

describe('a carried stop is an ordinary today stop for the field team (no back-office leak)', () => {
  it('the field user sees it on the board as a normal tambahan; no rescheduled marker leaks', async () => {
    // admin carried spOut above → a new tambahan today for the customer
    const created = await prisma.delivery.findFirst({ where: { customerId: biruCust, date: TODAY, source: 'tambahan' } });
    expect(created).toBeTruthy();
    expect(created.pendingReason).toBe('');                 // no "dijadwalkan ulang" back-office reason on the field stop
    expect(created.note).toBe('urgent 2 galon');            // carries only the customer's own note
    // the field user's board shows it as a plain pending tambahan
    const board = await request(app).get('/api/v1/distribusi/deliveries?date=' + TODAY).set(auth(field));
    const row = (board.body.data || []).find((s) => s.id === created.id);
    expect(row).toBeTruthy();
    expect(row.source).toBe('tambahan');
    expect(row.status).toBe('pending');
    expect(row.pendingReason).toBe('');                     // nothing revealing the outstanding history
  });
});

describe('migration invariant: the new cap widens nobody', () => {
  it('a field role (distribusiPengiriman only) resolves distribusiBelumTerkirim to FALSE; owner/GM true', async () => {
    expect(resolvePerms('finance', JSON.stringify({ distribusiPengiriman: true })).distribusiBelumTerkirim).toBe(false);
    expect(resolvePerms('owner', null).distribusiBelumTerkirim).toBe(true);
    expect(resolvePerms('gm', null).distribusiBelumTerkirim).toBe(true);
    // and it is NOT derived from distribusiPengiriman — granting the route cap never grants carry-over
    expect(resolvePerms('finance', JSON.stringify({ distribusiPengiriman: true, distribusiOrder: true })).distribusiBelumTerkirim).toBe(false);
  });
});
