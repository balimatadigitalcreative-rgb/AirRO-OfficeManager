'use strict';
// Per-business-unit MODULE TOGGLE. The GM turns app modules (finance | hr | distribusi | gudang)
// on/off per unit. Server ENFORCEMENT (not just nav hiding):
//   • finance/hr are unit-scoped → a write to a unit whose module is off is 403 (the record's own
//     businessUnitId decides), other units unaffected;
//   • distribusi/gudang have no per-row unit (air-mapped) → their routers follow the AIR unit's
//     enabledModules: turn the module off for Air and every endpoint 403s.
// Invariant: with every unit's enabledModules = 'all' (the migration default) nothing changes.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const bu = require('../src/services/businessUnit.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const setModules = (t, id, enabledModules) => request(app).patch('/api/v1/business-units/' + id).set(auth(t)).send({ enabledModules });
const mkEntry = (t, unit) => request(app).post('/api/v1/entries').set(auth(t)).send({ type: 'income', amount: 1000, date: '2026-08-01', businessUnitId: unit });
const mkEmp = (t, unit) => request(app).post('/api/v1/employees').set(auth(t)).send({ name: 'E', base: 4000000, businessUnitId: unit });

let gm;
beforeAll(async () => {
  await resetDb();   // units air / manufaktur / unit3, each enabledModules default 'all'
  gm = (await reg({ name: 'GM', username: 'mt_gm', password: 'secret123', role: 'gm' })).token;
});
afterAll(() => prisma.$disconnect());

describe('default = all modules enabled (non-breaking)', () => {
  it('every seeded unit reports enabledModules "all"', async () => {
    const list = (await request(app).get('/api/v1/business-units').set(auth(gm))).body.data;
    for (const u of list) expect(u.enabledModules).toBe('all');
  });
  it('with defaults, finance/hr/distribusi/gudang all work as before', async () => {
    expect((await mkEntry(gm, 'manufaktur')).status).toBe(201);
    expect((await mkEmp(gm, 'manufaktur')).status).toBe(201);
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).status).toBe(200);
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(gm))).status).toBe(200);
  });
});

describe('helpers: parse / serialize / moduleEnabledFor', () => {
  it('parseEnabledModules: "all"/null → null; array kept (unknown keys dropped)', () => {
    expect(bu.parseEnabledModules('all')).toBeNull();
    expect(bu.parseEnabledModules(null)).toBeNull();
    expect(bu.parseEnabledModules(JSON.stringify(['finance', 'bogus']))).toEqual(['finance']);
  });
  it('serializeEnabledModules: a FULL selection collapses to canonical "all"', () => {
    expect(bu.serializeEnabledModules('all')).toBe('all');
    expect(bu.serializeEnabledModules(['finance', 'hr', 'distribusi', 'gudang'])).toBe('all');
    expect(bu.serializeEnabledModules(['finance'])).toBe(JSON.stringify(['finance']));
  });
  it('moduleEnabledFor: null/all → every module true; array → membership', () => {
    expect(bu.moduleEnabledFor('all', 'hr')).toBe(true);
    expect(bu.moduleEnabledFor(JSON.stringify(['finance']), 'finance')).toBe(true);
    expect(bu.moduleEnabledFor(JSON.stringify(['finance']), 'hr')).toBe(false);
  });
});

describe('finance/hr per-unit enforcement', () => {
  beforeAll(async () => {
    // Manufaktur: only finance stays on (hr off). Air/unit3 untouched (still all).
    await setModules(gm, 'manufaktur', ['finance']);
  });
  afterAll(async () => { await setModules(gm, 'manufaktur', 'all'); });   // restore

  it('creating an HR record for a unit with hr OFF is 403', async () => {
    expect((await mkEmp(gm, 'manufaktur')).status).toBe(403);
  });
  it('finance still works for that unit (finance stayed on)', async () => {
    expect((await mkEntry(gm, 'manufaktur')).status).toBe(201);
  });
  it('OTHER units are unaffected — hr still works for Air', async () => {
    expect((await mkEmp(gm, 'air')).status).toBe(201);
  });
  it('turning finance OFF for a unit then rejects finance writes there, but not elsewhere', async () => {
    await setModules(gm, 'manufaktur', ['hr']);   // finance off, hr on
    expect((await mkEntry(gm, 'manufaktur')).status).toBe(403);
    expect((await mkEntry(gm, 'air')).status).toBe(201);   // Air unaffected
    expect((await mkEmp(gm, 'manufaktur')).status).toBe(201);   // hr now on
  });
});

describe('distribusi + gudang follow the AIR unit\'s modules', () => {
  afterEach(async () => { await setModules(gm, 'air', 'all'); });   // always restore

  it('distribusi OFF for Air → every distribution endpoint 403s', async () => {
    await setModules(gm, 'air', ['finance', 'hr', 'gudang']);   // distribusi off
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/dashboard/summary').set(auth(gm))).status).toBe(403);
    // gudang still fine (still enabled)
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(gm))).status).toBe(200);
  });
  it('gudang OFF for Air → every warehouse endpoint 403s (distribusi still fine)', async () => {
    await setModules(gm, 'air', ['finance', 'hr', 'distribusi']);   // gudang off
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(gm))).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).status).toBe(200);
  });
  it('re-enabling restores access', async () => {
    await setModules(gm, 'air', 'all');
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).status).toBe(200);
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(gm))).status).toBe(200);
  });
});

describe('management stays reachable regardless of module toggles', () => {
  it('a unit with ZERO modules can still be managed (users/settings/business-units unaffected)', async () => {
    await setModules(gm, 'manufaktur', []);   // no operational modules at all
    const unit = (await request(app).get('/api/v1/business-units').set(auth(gm))).body.data.find((u) => u.id === 'manufaktur');
    expect(unit.enabledModules).toEqual([]);   // stored as empty list, not 'all'
    // management endpoints unaffected
    expect((await request(app).get('/api/v1/users').set(auth(gm))).status).toBe(200);
    expect((await request(app).get('/api/v1/business-units').set(auth(gm))).status).toBe(200);
    await setModules(gm, 'manufaktur', 'all');   // restore
  });
});
