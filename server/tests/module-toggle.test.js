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

// Unit-SCOPED users — module toggles apply to them (unlike full-access users). One scoped to
// "manufaktur" (for finance/HR per-unit writes) and one scoped to "air" (distribusi/gudang are
// air-mapped and require air access, so their scoped test must use an air user).
let mfg, airUser;
const loginTok = (u) => require('supertest')(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((x) => x.body.token);
beforeAll(async () => {
  const rm = await reg({ name: 'Mfg User', username: 'mt_mfg', password: 'secret123', role: 'gm' });
  await request(app).patch('/api/v1/users/' + rm.user.id).set(auth(gm)).send({ unitScope: ['manufaktur'] });
  mfg = await loginTok('mt_mfg');
  const ra = await reg({ name: 'Air User', username: 'mt_air', password: 'secret123', role: 'gm' });
  await request(app).patch('/api/v1/users/' + ra.user.id).set(auth(gm)).send({ unitScope: ['air'] });
  airUser = await loginTok('mt_air');
});

describe('FULL-ACCESS BYPASS — the regression fix: owner/GM (unitScope all) are NEVER blocked by toggles', () => {
  const units = ['air', 'manufaktur', 'unit3'];
  afterEach(async () => { for (const u of units) await setModules(gm, u, 'all'); });

  it('a full-access GM writes finance/HR into a unit even when those modules are OFF for it', async () => {
    await setModules(gm, 'manufaktur', []);   // every module off for manufaktur
    expect((await mkEntry(gm, 'manufaktur')).status).toBe(201);   // finance write — bypassed
    expect((await mkEmp(gm, 'manufaktur')).status).toBe(201);     // hr write — bypassed
  });
  it('a full-access GM reaches distribusi + gudang even when OFF for every unit', async () => {
    for (const u of units) await setModules(gm, u, []);   // all modules off, all units
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).status).toBe(200);
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(gm))).status).toBe(200);
  });
});

describe('SCOPED-user enforcement — toggles apply per unit (default-on)', () => {
  afterEach(async () => { await setModules(gm, 'manufaktur', 'all'); });

  it('a manufaktur-scoped user: HR write to manufaktur is 403 when hr is OFF there', async () => {
    await setModules(gm, 'manufaktur', ['finance']);   // hr off
    expect((await mkEmp(mfg, 'manufaktur')).status).toBe(403);
    expect((await mkEntry(mfg, 'manufaktur')).status).toBe(201);   // finance still on
  });
  it('a manufaktur-scoped user: finance write to manufaktur is 403 when finance is OFF there', async () => {
    await setModules(gm, 'manufaktur', ['hr']);   // finance off
    expect((await mkEntry(mfg, 'manufaktur')).status).toBe(403);
    expect((await mkEmp(mfg, 'manufaktur')).status).toBe(201);     // hr now on
  });
});

describe('distribusi + gudang availability = UNION across the caller\'s accessible units', () => {
  const units = ['air', 'manufaktur', 'unit3'];
  afterEach(async () => { for (const u of units) await setModules(gm, u, 'all'); });

  it('REGRESSION: distribusi/gudang OFF for Air only → a full-access GM still gets 200 (no false 403)', async () => {
    await setModules(gm, 'air', []);   // everything off for AIR only
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).status).toBe(200);
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(gm))).status).toBe(200);
  });
  it('a SCOPED (air) user 403s when the air-mapped module is off for THEIR unit', async () => {
    // airUser is scoped to "air". Turn distribusi + gudang off for air → gone for them.
    await setModules(gm, 'air', ['finance', 'hr']);   // distribusi + gudang off for air
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(airUser))).status).toBe(403);
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(airUser))).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).status).toBe(200);   // GM bypass
  });
  it('re-enabling restores access for the scoped user', async () => {
    for (const u of units) await setModules(gm, u, 'all');
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(airUser))).status).toBe(200);
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(airUser))).status).toBe(200);
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
