'use strict';
// PART 1 — gallon capabilities live in the GUDANG namespace (the user sees Stok Galon under Gudang),
// and a CUSTOMER capability may never grant a WAREHOUSE write. Lint + migration-safety + behavioural.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { resolvePerms, ROLE_PERMS } = require('../src/config/permissions');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);

describe('route-prefix lint — every /gallon route gates on a gudang* cap', () => {
  it('no gallon route uses a distribusi customer/gallon/hard-delete cap', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/distribution.routes.js'), 'utf8');
    const gallonRoutes = src.split('\n').filter((l) => /router\.(get|post|delete|put|patch)\('\/gallon/.test(l));
    expect(gallonRoutes.length).toBeGreaterThanOrEqual(18);
    for (const line of gallonRoutes) {
      expect(line).toMatch(/require(Cap|AnyCap)\(\s*\[?\s*'gudang/);                  // gates on a gudang* cap
      expect(line).not.toMatch(/distribusiCustomers|distribusiGallon\b|distribusiGallonReset|distribusiHardDelete|distribusi\.galon/);
    }
  });
});

describe('migration safety — no role gains a capability it did not have', () => {
  // The new gudang gallon caps are derived from the OLD distribusi gates. Assert the mapping and that
  // no role WIDENS: a distribusiCustomers-only actor must NOT gain a gallon write.
  it('built-in roles map exactly; destructive caps stay owner/GM-tier', () => {
    const o = resolvePerms('owner', ROLE_PERMS.owner), g = resolvePerms('gm', ROLE_PERMS.gm), f = resolvePerms('finance', ROLE_PERMS.finance);
    expect(o).toMatchObject({ gudangGalonView: true, gudangGalonKoreksi: true, gudangGalonOpname: true, gudangGalonReset: true, gudangGalonHardDelete: true, 'gudang.galon.reset_total': true });
    expect(g).toMatchObject({ gudangGalonView: true, gudangGalonKoreksi: true, gudangGalonOpname: true, gudangGalonReset: true, gudangGalonHardDelete: false, 'gudang.galon.reset_total': false });
    for (const cap of ['gudangGalonView', 'gudangGalonKoreksi', 'gudangGalonOpname', 'gudangGalonReset', 'gudangGalonHardDelete', 'gudang.galon.reset_total']) expect(f[cap]).toBeFalsy();
  });
  it('distribusiCustomers alone does NOT grant gudangGalonKoreksi/Opname (defect fixed, not widened)', () => {
    const r = resolvePerms('finance', { distribusiCustomers: true, distribusiInput: true });
    expect(r.gudangGalonKoreksi).toBeFalsy();
    expect(r.gudangGalonOpname).toBeFalsy();
  });
  it('distribusiGallon still yields gudangGalonView (viewers preserved)', () => {
    expect(resolvePerms('finance', { distribusiGallon: true }).gudangGalonView).toBe(true);
  });
  it('gudangKelola is retired (no longer exposed)', () => {
    expect(resolvePerms('owner', ROLE_PERMS.owner).gudangKelola).toBeUndefined();
  });
});

describe('behavioural — the API enforces the split at the route', () => {
  let owner;
  beforeAll(async () => { await resetDb(); owner = (await reg({ name: 'Own', username: 'own_gc', password: 'secret123', role: 'owner' })).token; });
  afterAll(() => prisma.$disconnect());

  it('gudangGalonView WITHOUT gudangGalonKoreksi: sees Stok Galon, correction rejected 403', async () => {
    const u = await reg({ name: 'Viewer', username: 'view_gc', password: 'secret123', role: 'finance' });
    await request(app).patch('/api/v1/users/' + u.user.id).set(auth(owner)).send({ permissions: { gudangGalonView: true } });
    const t = await login('view_gc', 'secret123');
    expect((await request(app).get('/api/v1/distribusi/gallon').set(auth(t))).status).toBe(200);
    const corr = await request(app).post('/api/v1/distribusi/gallon/correction').set(auth(t)).send({ qty: 5, reason: 'x' });
    expect(corr.status).toBe(403);
  });
  it('distribusiCustomers alone no longer permits gallon correction', async () => {
    const u = await reg({ name: 'CustMgr', username: 'cust_gc', password: 'secret123', role: 'finance' });
    await request(app).patch('/api/v1/users/' + u.user.id).set(auth(owner)).send({ permissions: { distribusiCustomers: true, distribusiInput: true } });
    const t = await login('cust_gc', 'secret123');
    const corr = await request(app).post('/api/v1/distribusi/gallon/correction').set(auth(t)).send({ qty: 5, reason: 'x' });
    expect(corr.status).toBe(403);
  });
  it('a gudangGalonKoreksi holder CAN correct; a non-owner cannot reset-total', async () => {
    const u = await reg({ name: 'StockClerk', username: 'clerk_gc', password: 'secret123', role: 'finance' });
    await request(app).patch('/api/v1/users/' + u.user.id).set(auth(owner)).send({ permissions: { gudangGalonView: true, gudangGalonKoreksi: true } });
    const t = await login('clerk_gc', 'secret123');
    const c = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'C', type: 'reguler', masterPrice: 5000, armada: 'Merah' })).body.data.id;
    const corr = await request(app).post('/api/v1/distribusi/gallon/correction').set(auth(t)).send({ qty: 5, customerId: undefined, reason: 'koreksi depot' });
    expect(corr.status).toBe(201);
    expect((await request(app).post('/api/v1/distribusi/gallon/reset-total').set(auth(t)).send({ mode: 'retire', counts: { depot: 0 }, note: 'x', confirm: 'RESET TOTAL' })).status).toBe(403);
  });
});
