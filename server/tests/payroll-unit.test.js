'use strict';
// Stage 2 — payroll per business unit. Employee PLACEMENT (businessUnitId) is server-backed
// and drives payroll grouping. This stage must not change any pay amount: it only labels an
// employee with a unit (default "Air") and audits moves. The grouping/filtering itself is a
// frontend concern (payroll is client-computed) and is covered by the browser E2E; here we pin
// the server contract: placement is authoritative, defaults to Air, is validated, and audited.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const getEmp = (t, id) => request(app).get('/api/v1/employees/' + id).set(auth(t)).then((r) => r.body.data);

let gm, empId;
beforeAll(async () => {
  await resetDb();   // helpers seed the business units (air/manufaktur/unit3)
  gm = (await reg({ name: 'Bu GM', username: 'pu_gm', password: 'secret123', role: 'gm' })).token;
  const e = await request(app).post('/api/v1/employees').set(auth(gm)).send({ name: 'Karyawan A', base: 5000000 });
  empId = e.body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('employee placement (server-authoritative)', () => {
  it('a new employee defaults to the "Air" unit', async () => {
    const row = await prisma.employee.findUnique({ where: { id: empId } });
    expect(row.businessUnitId).toBe('air');
    expect((await getEmp(gm, empId)).businessUnitId).toBe('air');
  });

  it('placement can be changed to another unit and it persists on the column', async () => {
    const r = await request(app).patch('/api/v1/employees/' + empId).set(auth(gm)).send({ businessUnitId: 'manufaktur' });
    expect(r.status).toBe(200);
    expect(r.body.data.businessUnitId).toBe('manufaktur');
    expect((await prisma.employee.findUnique({ where: { id: empId } })).businessUnitId).toBe('manufaktur');
  });

  it('an unknown unit id falls back to "Air" (never orphans the row)', async () => {
    const r = await request(app).patch('/api/v1/employees/' + empId).set(auth(gm)).send({ businessUnitId: 'does-not-exist' });
    expect(r.status).toBe(200);
    expect(r.body.data.businessUnitId).toBe('air');
  });

  it('a normal edit that omits the unit keeps the current placement (never reset to Air)', async () => {
    await request(app).patch('/api/v1/employees/' + empId).set(auth(gm)).send({ businessUnitId: 'manufaktur' });
    const r = await request(app).patch('/api/v1/employees/' + empId).set(auth(gm)).send({ base: 6000000 });   // no unit in body
    expect(r.body.data.businessUnitId).toBe('manufaktur');
  });

  it('a placement CHANGE is audited to the real actor (from the token, not the body)', async () => {
    await request(app).patch('/api/v1/employees/' + empId).set(auth(gm)).send({ businessUnitId: 'air' });
    const r = await request(app).patch('/api/v1/employees/' + empId).set(auth(gm))
      .send({ businessUnitId: 'manufaktur', businessUnitAudit: [{ from: 'x', to: 'y', byName: 'FORGED' }] });   // client-supplied audit must be ignored
    const row = await prisma.employee.findUnique({ where: { id: empId } });
    const data = JSON.parse(row.data);
    const last = data.businessUnitAudit[data.businessUnitAudit.length - 1];
    expect(last).toMatchObject({ from: 'air', to: 'manufaktur', byName: 'Bu GM' });   // server-stamped
    expect(last.byName).not.toBe('FORGED');
    expect(typeof last.at).toBe('string');
    // the client-supplied audit array is fully ignored — no forged entry survives anywhere
    expect(data.businessUnitAudit.some((h) => h.byName === 'FORGED')).toBe(false);
  });

  it('editing without changing the unit does NOT append an audit entry', async () => {
    const before = JSON.parse((await prisma.employee.findUnique({ where: { id: empId } })).data).businessUnitAudit.length;
    await request(app).patch('/api/v1/employees/' + empId).set(auth(gm)).send({ base: 6100000 });
    const after = JSON.parse((await prisma.employee.findUnique({ where: { id: empId } })).data).businessUnitAudit.length;
    expect(after).toBe(before);
  });

  it('managing placement needs the employees-edit cap (server-enforced)', async () => {
    const s = await reg({ name: 'Viewer', username: 'pu_view', password: 'secret123', role: 'finance' });
    await prisma.user.update({ where: { id: s.user.id }, data: { permissions: JSON.stringify({ payroll: true, employees: false }) } });
    const tok = (await request(app).post('/api/v1/auth/login').send({ username: 'pu_view', password: 'secret123' })).body.token;
    // a payroll-only user may READ the roster but not change placement
    expect((await request(app).get('/api/v1/employees/' + empId).set(auth(tok))).status).toBe(200);
    expect((await request(app).patch('/api/v1/employees/' + empId).set(auth(tok)).send({ businessUnitId: 'unit3' })).status).toBe(403);
  });
});
