'use strict';
// Stage B — per-user business-unit access on the surfaces Stage A deferred: WRITE guards
// (create/update reject an out-of-scope unit), REPORTS (scoped totals), account BALANCE, plain +
// inter-unit TRANSFERS (initiate only from an accessible unit; list filtered to touched units), and
// the DISTRIBUTION mapping (all distribusi = unit "air"; a non-air user is 403'd everywhere).
// Invariant: an "all" user sees exactly today's behaviour.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const setUnit = (t, id, unitScope) => request(app).patch('/api/v1/users/' + id).set(auth(t)).send({ unitScope });
const mkEntry = (t, body) => request(app).post('/api/v1/entries').set(auth(t)).send({ type: 'income', amount: 100000, date: '2026-08-01', ...body });
const mkAccount = (t, body) => request(app).post('/api/v1/accounts').set(auth(t)).send({ name: 'A', ...body });
const mkEmp = (t, body) => request(app).post('/api/v1/employees').set(auth(t)).send({ name: 'E', base: 4000000, ...body });

let gm, rezz, mfg, both, rezzId, mfgId, bothId;
let airAcct, airAcct2, mfgAcct, airEntry, mfgEntry, u3Entry;

beforeAll(async () => {
  await resetDb();   // units: air / manufaktur / unit3
  gm = (await reg({ name: 'GM', username: 'b_gm', password: 'secret123', role: 'gm' })).token;
  // Two scoped admins (gm role → full caps) so we exercise every capability; only their UNIT differs.
  const r = await reg({ name: 'Rezz', username: 'b_rezz', password: 'secret123', role: 'gm' }); rezzId = r.user.id;
  const m = await reg({ name: 'Mfg', username: 'b_mfg', password: 'secret123', role: 'gm' }); mfgId = m.user.id;
  const bo = await reg({ name: 'Both', username: 'b_both', password: 'secret123', role: 'gm' }); bothId = bo.user.id;

  airAcct = (await mkAccount(gm, { name: 'Kas Air', businessUnitId: 'air' })).body.data.id;
  airAcct2 = (await mkAccount(gm, { name: 'BCA Air', businessUnitId: 'air' })).body.data.id;
  mfgAcct = (await mkAccount(gm, { name: 'Kas Mfg', businessUnitId: 'manufaktur' })).body.data.id;
  airEntry = (await mkEntry(gm, { amount: 111000, businessUnitId: 'air', accountId: airAcct })).body.data.id;
  mfgEntry = (await mkEntry(gm, { amount: 222000, businessUnitId: 'manufaktur', accountId: mfgAcct })).body.data.id;
  u3Entry = (await mkEntry(gm, { amount: 55000, businessUnitId: 'unit3' })).body.data.id;   // a THIRD unit neither scoped user may see

  await setUnit(gm, rezzId, ['air']);
  await setUnit(gm, mfgId, ['manufaktur']);
  await setUnit(gm, bothId, ['air', 'manufaktur']);
  rezz = await login('b_rezz');   // fresh token carries the scope
  mfg = await login('b_mfg');
  both = await login('b_both');
});
afterAll(() => prisma.$disconnect());

describe('WRITE guards — entries', () => {
  it('a scoped user can create in their unit', async () => {
    const r = await mkEntry(rezz, { businessUnitId: 'air' });
    expect(r.status).toBe(201);
    expect(r.body.data.businessUnitId).toBe('air');
  });
  it('creating in another unit is rejected (403)', async () => {
    expect((await mkEntry(rezz, { businessUnitId: 'manufaktur' })).status).toBe(403);
  });
  it('creating with NO unit lands in the user\'s allowed unit (not the "air" default for a non-air user)', async () => {
    const r = await mkEntry(mfg, {});   // mfg-scoped, no unit specified
    expect(r.status).toBe(201);
    expect(r.body.data.businessUnitId).toBe('manufaktur');
  });
  it('editing an out-of-scope entry is 404; moving an entry into another unit is 403', async () => {
    expect((await request(app).patch('/api/v1/entries/' + mfgEntry).set(auth(rezz)).send({ note: 'x' })).status).toBe(404);
    expect((await request(app).patch('/api/v1/entries/' + airEntry).set(auth(rezz)).send({ businessUnitId: 'manufaktur' })).status).toBe(403);
    expect((await request(app).patch('/api/v1/entries/' + airEntry).set(auth(rezz)).send({ note: 'ok' })).status).toBe(200);
  });
});

describe('WRITE guards — accounts & employees', () => {
  it('account create: out-of-scope 403, in-scope 201, shared 201', async () => {
    expect((await mkAccount(rezz, { name: 'X', businessUnitId: 'manufaktur' })).status).toBe(403);
    expect((await mkAccount(rezz, { name: 'X', businessUnitId: 'air' })).status).toBe(201);
    expect((await mkAccount(rezz, { name: 'Bersama', businessUnitId: 'shared' })).status).toBe(201);
  });
  it('employee create: out-of-scope 403, in-scope 201', async () => {
    expect((await mkEmp(rezz, { businessUnitId: 'manufaktur' })).status).toBe(403);
    const ok = await mkEmp(rezz, { businessUnitId: 'air' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.businessUnitId).toBe('air');
  });
  it('a scoped user cannot read/patch another unit\'s account (404) or its balance (404)', async () => {
    expect((await request(app).get('/api/v1/accounts/' + mfgAcct).set(auth(rezz))).status).toBe(404);
    expect((await request(app).get('/api/v1/accounts/' + mfgAcct + '/balance').set(auth(rezz))).status).toBe(404);
    expect((await request(app).get('/api/v1/accounts/' + airAcct + '/balance').set(auth(rezz))).status).toBe(200);
  });
});

describe('REPORTS are scoped to the caller\'s unit(s)', () => {
  it('summary: a scoped user sees only their unit\'s revenue', async () => {
    const rezzSum = (await request(app).get('/api/v1/reports/summary').set(auth(rezz))).body.data;
    const gmSum = (await request(app).get('/api/v1/reports/summary').set(auth(gm))).body.data;
    expect(rezzSum.revenue).toBeGreaterThan(0);
    expect(rezzSum.revenue).toBeLessThan(gmSum.revenue);       // company total strictly larger
    // rezz's revenue must NOT include the 222.000 manufaktur entry
    const mfgSum = (await request(app).get('/api/v1/reports/summary').set(auth(mfg))).body.data;
    expect(rezzSum.revenue + mfgSum.revenue).toBeLessThanOrEqual(gmSum.revenue);
  });
  it('cashflow + breakdown never leak another unit', async () => {
    const cf = (await request(app).get('/api/v1/reports/cashflow').set(auth(rezz))).body.data;
    const gmCf = (await request(app).get('/api/v1/reports/cashflow').set(auth(gm))).body.data;
    const sum = (rows) => rows.reduce((a, r) => a + r.rev, 0);
    expect(sum(cf)).toBeLessThan(sum(gmCf));
    expect((await request(app).get('/api/v1/reports/breakdown?type=income').set(auth(rezz))).status).toBe(200);
  });
  it('a MULTI-unit user\'s "Semua" total = sum of THEIR units only, never the whole company', async () => {
    // Only the unit3 entry (55.000) is in neither scoped user's units and nothing else touches unit3,
    // so the ONLY difference between the multi-unit user's total and the company total is that row.
    const bothSum = (await request(app).get('/api/v1/reports/summary').set(auth(both))).body.data;
    const gmSum = (await request(app).get('/api/v1/reports/summary').set(auth(gm))).body.data;
    expect(gmSum.revenue - bothSum.revenue).toBe(55000);   // exactly the unit3 row is withheld
    // and the combined entry list excludes the unit3 row
    const ids = (await request(app).get('/api/v1/entries').set(auth(both))).body.data.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([airEntry, mfgEntry]));
    expect(ids).not.toContain(u3Entry);
  });
});

describe('TRANSFERS — plain (account-to-account)', () => {
  let airXfer, mfgXfer;
  beforeAll(async () => {
    airXfer = (await request(app).post('/api/v1/transfers').set(auth(gm)).send({ fromId: airAcct, toId: airAcct2, amount: 50000, date: '2026-08-02' })).body.data.id;
    mfgXfer = (await request(app).post('/api/v1/transfers').set(auth(gm)).send({ fromId: mfgAcct, toId: airAcct, amount: 30000, date: '2026-08-02' })).body.data.id;
  });
  it('list is filtered to transfers touching the caller\'s unit(s)', async () => {
    const ids = (await request(app).get('/api/v1/transfers').set(auth(rezz))).body.data.map((t) => t.id);
    expect(ids).toContain(airXfer);   // both legs air
    expect(ids).toContain(mfgXfer);   // touches air (the TO account) → visible
    // a mfg-only user does NOT see the pure air→air transfer
    const mfgIds = (await request(app).get('/api/v1/transfers').set(auth(mfg))).body.data.map((t) => t.id);
    expect(mfgIds).not.toContain(airXfer);
  });
  it('a scoped user can only INITIATE from an account in their unit', async () => {
    // rezz pays from an air account → ok; from the manufaktur account → 403
    expect((await request(app).post('/api/v1/transfers').set(auth(rezz)).send({ fromId: airAcct, toId: airAcct2, amount: 1000, date: '2026-08-03' })).status).toBe(201);
    expect((await request(app).post('/api/v1/transfers').set(auth(rezz)).send({ fromId: mfgAcct, toId: airAcct, amount: 1000, date: '2026-08-03' })).status).toBe(403);
  });
});

describe('INTER-UNIT transfers — initiate only FROM an accessible unit', () => {
  const iut = (t, body) => request(app).post('/api/v1/inter-unit-transfers').set(auth(t)).send({ fromAccountId: 'x', toAccountId: 'y', amount: 40000, date: '2026-08-04', ...body });
  it('a scoped user can transfer FROM their unit TO any unit', async () => {
    const r = await iut(rezz, { fromUnitId: 'air', toUnitId: 'manufaktur', fromAccountId: airAcct, toAccountId: mfgAcct });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ fromUnit: 'air', toUnit: 'manufaktur' });
  });
  it('a scoped user CANNOT initiate from a unit they can\'t access (403)', async () => {
    expect((await iut(rezz, { fromUnitId: 'manufaktur', toUnitId: 'air', fromAccountId: mfgAcct, toAccountId: airAcct })).status).toBe(403);
  });
  it('the all-access GM can initiate from any unit', async () => {
    expect((await iut(gm, { fromUnitId: 'manufaktur', toUnitId: 'air', fromAccountId: mfgAcct, toAccountId: airAcct })).status).toBe(201);
  });
});

describe('DISTRIBUTION mapping — all distribusi = unit "air"', () => {
  it('an "air"/all user reaches distribution normally', async () => {
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).status).toBe(200);
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(rezz))).status).toBe(200);
  });
  it('a user scoped away from "air" is 403 on every distribution endpoint', async () => {
    expect((await request(app).get('/api/v1/distribusi/transactions').set(auth(mfg))).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/dashboard/summary').set(auth(mfg))).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/customers').set(auth(mfg))).status).toBe(403);
  });
});

describe('INVARIANT — the all-access GM is unchanged', () => {
  it('GM reads every unit\'s entries and both units\' reports', async () => {
    const ids = (await request(app).get('/api/v1/entries').set(auth(gm))).body.data.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([airEntry, mfgEntry]));
    expect((await request(app).get('/api/v1/accounts/' + mfgAcct + '/balance').set(auth(gm))).status).toBe(200);
  });
});
