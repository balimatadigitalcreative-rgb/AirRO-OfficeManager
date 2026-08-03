'use strict';
// Stage A — per-user BUSINESS-UNIT access control. A GM can restrict a user to one unit, several
// units, or all. The server ENFORCES the scope on every core read (entries / accounts / employees /
// setoran / payroll): a user scoped to "air" cannot read another unit's records even by crafting a
// request. Existing users default to unitScope='all' (no behaviour change). A last-all-access-admin
// lockout guard mirrors the manageUsers guard so the org can never lose every full-access admin.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const mkEntry = (t, unit, amount) => request(app).post('/api/v1/entries').set(auth(t)).send({ type: 'income', amount, date: '2026-08-01', businessUnitId: unit });
const mkAccount = (t, unit, name) => request(app).post('/api/v1/accounts').set(auth(t)).send({ name, businessUnitId: unit });
const mkEmp = (t, unit, name) => request(app).post('/api/v1/employees').set(auth(t)).send({ name, base: 4000000, businessUnitId: unit });
const setUnit = (t, id, unitScope) => request(app).patch('/api/v1/users/' + id).set(auth(t)).send({ unitScope });

let gm, rezzId;
let airEntry, mfgEntry, airAcct, mfgAcct, sharedAcct, airEmp, mfgEmp;

beforeAll(async () => {
  await resetDb();   // seeds units: air / manufaktur / unit3
  gm = (await reg({ name: 'Pak GM', username: 'us_gm', password: 'secret123', role: 'gm' })).token;   // full caps, unitScope defaults 'all'

  // Records in two different units (+ a "shared" account that belongs to no single unit).
  airEntry = (await mkEntry(gm, 'air', 100000)).body.data.id;
  mfgEntry = (await mkEntry(gm, 'manufaktur', 200000)).body.data.id;
  airAcct = (await mkAccount(gm, 'air', 'Kas Air')).body.data.id;
  mfgAcct = (await mkAccount(gm, 'manufaktur', 'Kas Manufaktur')).body.data.id;
  sharedAcct = (await mkAccount(gm, 'shared', 'Kas Bersama')).body.data.id;
  airEmp = (await mkEmp(gm, 'air', 'Staf Air')).body.data.id;
  mfgEmp = (await mkEmp(gm, 'manufaktur', 'Staf Manufaktur')).body.data.id;

  // A finance user "rezz", restricted by the GM to the "air" unit only. Must RE-LOGIN after the
  // scope change so the fresh token carries unitScope=["air"].
  const r = await reg({ name: 'Rezz', username: 'us_rezz', password: 'secret123', role: 'finance' });
  rezzId = r.user.id;
});
afterAll(() => prisma.$disconnect());

describe('scope is stored + surfaced on the user shape', () => {
  it('a new user defaults to unitScope "all" (no behaviour change)', async () => {
    const list = (await request(app).get('/api/v1/users').set(auth(gm))).body.data;
    expect(list.find((u) => u.id === rezzId).unitScope).toBe('all');
  });
  it('the GM can restrict rezz to ["air"], and it round-trips as an array', async () => {
    const r = await setUnit(gm, rezzId, ['air']);
    expect(r.status).toBe(200);
    expect(r.body.data.unitScope).toEqual(['air']);
    // the token minted at rezz's next login carries the scope (login/me return the parsed value)
    const me = await request(app).post('/api/v1/auth/login').send({ username: 'us_rezz', password: 'secret123' });
    expect(me.body.user.unitScope).toEqual(['air']);
  });
});

describe('an "air"-scoped user cannot read another unit (server-enforced)', () => {
  let rezz;
  beforeAll(async () => { rezz = await login('us_rezz', 'secret123'); });   // token now carries ["air"]

  it('GET /entries returns only air rows, never manufaktur', async () => {
    const rows = (await request(app).get('/api/v1/entries').set(auth(rezz))).body.data;
    const ids = rows.map((e) => e.id);
    expect(ids).toContain(airEntry);
    expect(ids).not.toContain(mfgEntry);
  });
  it('crafting ?businessUnit=manufaktur cannot escape the scope (empty, not the mfg row)', async () => {
    const rows = (await request(app).get('/api/v1/entries?businessUnit=manufaktur').set(auth(rezz))).body.data;
    expect(rows.map((e) => e.id)).not.toContain(mfgEntry);
    expect(rows.length).toBe(0);
  });
  it('GET /entries/:id for a manufaktur row is 404 (existence not revealed)', async () => {
    expect((await request(app).get('/api/v1/entries/' + mfgEntry).set(auth(rezz))).status).toBe(404);
    expect((await request(app).get('/api/v1/entries/' + airEntry).set(auth(rezz))).status).toBe(200);
  });
  it('GET /accounts returns air + shared, never another unit', async () => {
    const ids = (await request(app).get('/api/v1/accounts').set(auth(rezz))).body.data.map((a) => a.id);
    expect(ids).toContain(airAcct);
    expect(ids).toContain(sharedAcct);   // Bersama stays visible (belongs to no single unit)
    expect(ids).not.toContain(mfgAcct);
  });
  it('GET /accounts/:id for a manufaktur account is 404', async () => {
    expect((await request(app).get('/api/v1/accounts/' + mfgAcct).set(auth(rezz))).status).toBe(404);
    expect((await request(app).get('/api/v1/accounts/' + sharedAcct).set(auth(rezz))).status).toBe(200);
  });
  it('GET /employees returns only air staff', async () => {
    const ids = (await request(app).get('/api/v1/employees').set(auth(rezz))).body.data.map((e) => e.id);
    expect(ids).toContain(airEmp);
    expect(ids).not.toContain(mfgEmp);
    expect((await request(app).get('/api/v1/employees/' + mfgEmp).set(auth(rezz))).status).toBe(404);
  });
  it('GET /payroll breakdown excludes other units', async () => {
    const emps = (await request(app).get('/api/v1/payroll').set(auth(rezz))).body.data.employees;
    const ids = emps.map((e) => e.id);
    expect(ids).toContain(airEmp);
    expect(ids).not.toContain(mfgEmp);
  });
});

describe('a legacy null-unit row counts as "air" (Stage-1 backfill rule)', () => {
  it('an air-scoped user still sees rows with businessUnitId = null', async () => {
    const legacy = await prisma.entry.create({ data: { type: 'income', amount: 5000, date: '2026-08-02', businessUnitId: null } });
    const rezz = await login('us_rezz', 'secret123');
    const ids = (await request(app).get('/api/v1/entries').set(auth(rezz))).body.data.map((e) => e.id);
    expect(ids).toContain(legacy.id);
  });
});

describe('the all-access GM view is unchanged', () => {
  it('the GM (unitScope all) still reads every unit', async () => {
    const ids = (await request(app).get('/api/v1/entries').set(auth(gm))).body.data.map((e) => e.id);
    expect(ids).toContain(airEntry);
    expect(ids).toContain(mfgEntry);
    const acctIds = (await request(app).get('/api/v1/accounts').set(auth(gm))).body.data.map((a) => a.id);
    expect(acctIds).toEqual(expect.arrayContaining([airAcct, mfgAcct, sharedAcct]));
  });
});

describe('multi-unit + grant-back', () => {
  it('the GM can widen rezz to ["air","manufaktur"] → both units visible', async () => {
    await setUnit(gm, rezzId, ['air', 'manufaktur']);
    const rezz = await login('us_rezz', 'secret123');
    const ids = (await request(app).get('/api/v1/entries').set(auth(rezz))).body.data.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([airEntry, mfgEntry]));
  });
  it('the GM can grant rezz back to "all" (every unit again)', async () => {
    const r = await setUnit(gm, rezzId, 'all');
    expect(r.body.data.unitScope).toBe('all');
    const rezz = await login('us_rezz', 'secret123');
    const ids = (await request(app).get('/api/v1/entries').set(auth(rezz))).body.data.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([airEntry, mfgEntry]));
  });
});

describe('last-all-access-admin lockout guard', () => {
  it('the ONLY all-access admin (GM) cannot be restricted to a unit', async () => {
    const meList = (await request(app).get('/api/v1/users').set(auth(gm))).body.data;
    const gmRow = meList.find((u) => u.username === 'us_gm');
    const r = await setUnit(gm, gmRow.id, ['air']);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/semua unit/i);
  });
  it('with a SECOND all-access admin present, restricting the first IS allowed', async () => {
    const admin2 = await reg({ name: 'Admin Dua', username: 'us_admin2', password: 'secret123', role: 'gm' });
    const gmRow = (await request(app).get('/api/v1/users').set(auth(gm))).body.data.find((u) => u.username === 'us_gm');
    const r = await setUnit(gm, gmRow.id, ['air']);
    expect(r.status).toBe(200);
    expect(r.body.data.unitScope).toEqual(['air']);
    // restore the GM to all-access so later teardown/other checks aren't affected
    await setUnit(admin2.token, gmRow.id, 'all');
  });
  it('deleting the last all-access admin is blocked', async () => {
    // Restrict admin2 to a unit while the GM is all-access → the GM is now the ONLY all-access admin.
    const admin2Row = (await request(app).get('/api/v1/users').set(auth(gm))).body.data.find((u) => u.username === 'us_admin2');
    await setUnit(gm, admin2Row.id, ['manufaktur']);   // admin2 keeps manageUsers, but loses all-unit access
    const gmRow = (await request(app).get('/api/v1/users').set(auth(gm))).body.data.find((u) => u.username === 'us_gm');
    // admin2 still administers users (unitScope never gates user management), so it attempts the delete.
    const admin2Tok = await login('us_admin2', 'secret123');
    const del = await request(app).delete('/api/v1/users/' + gmRow.id).set(auth(admin2Tok));
    expect(del.status).toBe(400);
    expect(del.body.error.message).toMatch(/semua unit/i);
  });
});
