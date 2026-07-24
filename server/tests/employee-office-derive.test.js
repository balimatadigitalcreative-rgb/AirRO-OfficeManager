'use strict';
// "Posisi kantor" was removed from the employee FORM, but Employee.office is NOT dropped — it is the
// <OFFICE> segment of the NIP (<OFFICE>-YY-NNN) and the key of the per-office running counter
// (EmployeeNip @@unique([office, year, seq])). Office is now DERIVED from the employee's business
// unit via BusinessUnit.officeCode (air→AIRRO, manufaktur→MFG, unit3→NSN), server-side, so the
// client can never send an arbitrary office. Existing NIPs are historical identifiers: changing a
// unit never rewrites one.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const businessUnit = require('../src/services/businessUnit.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const nipFor = (t, body) => request(app).post('/api/v1/employees/nip').set(auth(t)).send(body);
const mkEmp = (t, body) => request(app).post('/api/v1/employees').set(auth(t)).send(body);
const patchEmp = (t, id, body) => request(app).patch(`/api/v1/employees/${id}`).set(auth(t)).send(body);
const YY = String(new Date().getFullYear()).slice(2);

let gm;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_off', password: 'secret123', role: 'gm' })).token;
  await businessUnit.seedBusinessUnits();
  // the migration sets these for existing DBs; seedBusinessUnits does it for a fresh one
  await prisma.businessUnit.update({ where: { id: 'air' }, data: { officeCode: 'AIRRO' } });
  await prisma.businessUnit.update({ where: { id: 'manufaktur' }, data: { officeCode: 'MFG' } });
  await prisma.businessUnit.update({ where: { id: 'unit3' }, data: { officeCode: 'NSN' } });
});
afterAll(() => prisma.$disconnect());

describe('employee office is derived from the business unit (NIP intact)', () => {
  it('the unit dictionary exposes an editable officeCode (air→AIRRO, manufaktur→MFG, unit3→NSN)', async () => {
    const r = await request(app).get('/api/v1/business-units').set(auth(gm));
    expect(r.status).toBe(200);
    const by = {}; r.body.data.forEach((u) => { by[u.id] = u.officeCode; });
    expect(by).toMatchObject({ air: 'AIRRO', manufaktur: 'MFG', unit3: 'NSN' });
  });

  it('a NIP allocated for "Manufaktur" uses the MFG prefix and its own running number', async () => {
    const a = await nipFor(gm, { businessUnitId: 'manufaktur' });
    expect(a.status).toBe(200);
    expect(a.body.data.nip).toBe(`MFG-${YY}-001`);
    const b = await nipFor(gm, { businessUnitId: 'manufaktur' });
    expect(b.body.data.nip).toBe(`MFG-${YY}-002`);      // per-office counter increments
    // a different unit has its OWN counter — no collision, no unique-constraint error
    const c = await nipFor(gm, { businessUnitId: 'air' });
    expect(c.body.data.nip).toBe(`AIRRO-${YY}-001`);
    const d = await nipFor(gm, { businessUnitId: 'unit3' });
    expect(d.body.data.nip).toBe(`NSN-${YY}-001`);
  });

  it('the endpoint IGNORES a client-sent office — only the unit decides', async () => {
    // craft a request naming another office; the derivation must win
    const r = await nipFor(gm, { businessUnitId: 'manufaktur', office: 'AIRRO' });
    expect(r.status).toBe(200);
    expect(r.body.data.nip.startsWith('MFG-')).toBe(true);
  });

  it('creating an employee under Manufaktur stores office=MFG even if the body says otherwise', async () => {
    const nip = (await nipFor(gm, { businessUnitId: 'manufaktur' })).body.data.nip;
    const r = await mkEmp(gm, { id: 'e-mfg', name: 'Mfg Satu', businessUnitId: 'manufaktur', office: 'AIRRO', nip, base: 5000000 });
    expect(r.status).toBe(201);
    const row = await prisma.employee.findUnique({ where: { id: 'e-mfg' } });
    expect(row.office).toBe('MFG');                 // derived, not the 'AIRRO' the client sent
    expect(row.businessUnitId).toBe('manufaktur');
    expect(row.nip).toBe(nip);
    expect(nip.startsWith('MFG-')).toBe(true);
  });

  it('changing an employee\'s unit updates the derived office but NEVER rewrites their NIP', async () => {
    const before = await prisma.employee.findUnique({ where: { id: 'e-mfg' } });
    const r = await patchEmp(gm, 'e-mfg', { businessUnitId: 'air' });
    expect(r.status).toBe(200);
    const after = await prisma.employee.findUnique({ where: { id: 'e-mfg' } });
    expect(after.businessUnitId).toBe('air');
    expect(after.office).toBe('AIRRO');             // future NIPs would use AIRRO…
    expect(after.nip).toBe(before.nip);             // …but the existing NIP is untouched (still MFG-)
    expect(after.nip.startsWith('MFG-')).toBe(true);
    // the client blob stays consistent with the column
    expect(JSON.parse(after.data).office).toBe('AIRRO');
    expect(JSON.parse(after.data).nip).toBe(before.nip);
  });

  it('an explicit Regenerasi NIP DOES pick up the new office prefix', async () => {
    const r = await request(app).post('/api/v1/employees/e-mfg/regenerate-nip').set(auth(gm)).send();
    expect(r.status).toBe(200);
    expect(r.body.data.nip.startsWith('AIRRO-')).toBe(true);   // the unit is now Air
  });

  it('existing employees keep their NIPs; a mismatch is REPORTED, never rewritten', async () => {
    // an employee whose stored office disagrees with their unit (the pre-change world)
    await prisma.employee.create({ data: { id: 'e-legacy', name: 'Lama', base: 0, nip: `NSN-${YY}-900`, office: 'NSN', businessUnitId: 'air', data: JSON.stringify({ id: 'e-legacy', name: 'Lama', nip: `NSN-${YY}-900`, office: 'NSN', businessUnitId: 'air' }) } });
    const rows = await businessUnit.auditOfficeUnitMismatch();
    const hit = rows.find((x) => x.id === 'e-legacy');
    expect(hit).toMatchObject({ office: 'NSN', expected: 'AIRRO', unit: 'air' });
    // nothing was changed by the audit
    const still = await prisma.employee.findUnique({ where: { id: 'e-legacy' } });
    expect(still.office).toBe('NSN');
    expect(still.nip).toBe(`NSN-${YY}-900`);
  });

  it('the office→unit mapping is owner-editable, and only affects NEW NIPs', async () => {
    const upd = await request(app).patch('/api/v1/business-units/unit3').set(auth(gm)).send({ officeCode: 'MFG' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.officeCode).toBe('MFG');
    // a NIP for unit3 now CONTINUES the shared MFG counter (never restarts → no unique clash)
    const usedBefore = await prisma.employeeNip.count({ where: { office: 'MFG', year: YY } });
    const n = await nipFor(gm, { businessUnitId: 'unit3' });
    expect(n.body.data.nip).toBe(`MFG-${YY}-${String(usedBefore + 1).padStart(3, '0')}`);
    // an invalid code is rejected
    expect((await request(app).patch('/api/v1/business-units/unit3').set(auth(gm)).send({ officeCode: 'XYZ' })).status).toBe(400);
  });

  it('an unknown/blank unit still yields a NIP (AIRRO default) — allocation never dead-ends', async () => {
    const r = await nipFor(gm, { businessUnitId: 'does-not-exist' });
    expect(r.status).toBe(200);
    expect(r.body.data.nip.startsWith('AIRRO-')).toBe(true);
    const r2 = await nipFor(gm, {});
    expect(r2.status).toBe(200);
    expect(r2.body.data.nip.startsWith('AIRRO-')).toBe(true);
  });
});
