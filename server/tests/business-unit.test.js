'use strict';
// Business unit (unit bisnis) — STAGE 1: labels on one company, NOT separate ledgers.
// The whole point of this stage is that it changes NOTHING behavioural: every core record
// gets a businessUnitId = "Air", counts are unchanged, and nothing is filtered by unit yet.
// The dictionary is manageable (add/rename/deactivate) behind an owner-only capability.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const bu = require('../src/services/businessUnit.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let gm, staff;
beforeAll(async () => {
  await resetDb();
  await bu.seedBusinessUnits();
  gm = (await reg({ name: 'GM', username: 'bu_gm', password: 'secret123', role: 'gm' })).token;
  const s = await reg({ name: 'Staff', username: 'bu_staff', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: s.user.id }, data: { permissions: JSON.stringify({ cashflow: true, manageBusinessUnits: false }) } });
  staff = (await request(app).post('/api/v1/auth/login').send({ username: 'bu_staff', password: 'secret123' })).body.token;
});
afterAll(() => prisma.$disconnect());

describe('business unit dictionary', () => {
  it('seeds the three starter units with Air as the default', async () => {
    const r = await request(app).get('/api/v1/business-units').set(auth(gm));
    expect(r.status).toBe(200);
    const ids = r.body.data.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining(['air', 'manufaktur', 'unit3']));
    const air = r.body.data.find((u) => u.id === 'air');
    expect(air).toMatchObject({ name: 'Air', active: true });
  });

  it('seeding is idempotent (re-running never duplicates)', async () => {
    await bu.seedBusinessUnits();
    await bu.seedBusinessUnits();
    expect(await prisma.businessUnit.count()).toBe(3);
  });

  it('any authed user may READ the list; only the cap may WRITE', async () => {
    expect((await request(app).get('/api/v1/business-units').set(auth(staff))).status).toBe(200);
    expect((await request(app).post('/api/v1/business-units').set(auth(staff)).send({ name: 'Logistik' })).status).toBe(403);
    expect((await request(app).patch('/api/v1/business-units/unit3').set(auth(staff)).send({ name: 'X' })).status).toBe(403);
  });

  it('owner-tier can add, rename and deactivate; rename changes the label only', async () => {
    const add = await request(app).post('/api/v1/business-units').set(auth(gm)).send({ name: 'Logistik', code: 'log' });
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ name: 'Logistik', code: 'LOG', active: true });   // code upper-cased
    const id = add.body.data.id;

    const ren = await request(app).patch('/api/v1/business-units/unit3').set(auth(gm)).send({ name: 'Ekspor' });
    expect(ren.status).toBe(200);
    expect(ren.body.data.name).toBe('Ekspor');

    const off = await request(app).patch(`/api/v1/business-units/${id}`).set(auth(gm)).send({ active: false });
    expect(off.body.data.active).toBe(false);
  });

  it('rejects a duplicate name and an empty name', async () => {
    expect((await request(app).post('/api/v1/business-units').set(auth(gm)).send({ name: 'Air' })).status).toBe(400);
    expect((await request(app).post('/api/v1/business-units').set(auth(gm)).send({ name: '   ' })).status).toBe(400);
  });

  it('never lets the default "Air" unit be deactivated (null-as-Air must stay live)', async () => {
    const r = await request(app).patch('/api/v1/business-units/air').set(auth(gm)).send({ active: false });
    expect(r.status).toBe(400);
    expect((await request(app).get('/api/v1/business-units').set(auth(gm))).body.data.find((u) => u.id === 'air').active).toBe(true);
  });
});

describe('backfill defaults everything to Air, changes nothing else', () => {
  it('a row created without a unit is labelled Air by the backfill (idempotent)', async () => {
    // simulate an old-build row that predates the label
    const acct = await prisma.account.create({ data: { name: 'Kas Uji', businessUnitId: null } });
    const emp = await prisma.employee.create({ data: { name: 'Uji', businessUnitId: null } });
    const before = { account: await prisma.account.count(), employee: await prisma.employee.count() };

    const filled = await bu.backfillBusinessUnit();
    expect(filled.account).toBeGreaterThanOrEqual(1);

    // counts unchanged — backfill only fills a column, never adds/removes rows
    expect(await prisma.account.count()).toBe(before.account);
    expect(await prisma.employee.count()).toBe(before.employee);
    // and the rows now read "Air"
    expect((await prisma.account.findUnique({ where: { id: acct.id } })).businessUnitId).toBe('air');
    expect((await prisma.employee.findUnique({ where: { id: emp.id } })).businessUnitId).toBe('air');

    // running again is a no-op (nothing still null)
    const again = await bu.backfillBusinessUnit();
    expect(Object.keys(again)).toHaveLength(0);
    for (const m of ['entry', 'account', 'employee', 'setoran']) {
      expect(await prisma[m].count({ where: { businessUnitId: null } })).toBe(0);
    }
  });
});
