'use strict';
// Creator attribution is server-stamped from the token (name + role at input time)
// and must never be forgeable from the request body. Entry/Employee are covered in
// entries.test.js / resources.test.js; this file covers Kasbon + Approvals.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let hrd;

async function reg(c) {
  await request(app).post('/api/v1/auth/register').send(c);
  const r = await request(app).post('/api/v1/auth/login').send({ username: c.username, password: c.password });
  return r.body.token;
}

beforeAll(async () => {
  await resetDb();
  hrd = await reg({ name: 'Dewi', username: 'hrd_c', password: 'secret123', role: 'hrd' });
});
afterAll(() => prisma.$disconnect());

describe('Creator attribution — kasbon + approvals', () => {
  let empId;

  it('kasbon request stamps createdBy { name, role } from the token', async () => {
    const emp = await request(app).post('/api/v1/employees').set(auth(hrd)).send({ name: 'Target', department: 'Driver', base: 5000000 });
    expect(emp.status).toBe(201);
    empId = emp.body.data.id;
    const r = await request(app).post('/api/v1/cashbon/request').set(auth(hrd)).send({ employeeId: empId, amount: 100000, date: '2026-06-10', note: 'x' });
    expect(r.status).toBe(201);
    expect(r.body.data.cashbon.createdBy).toEqual({ name: 'Dewi', role: 'hrd' });
  });

  it('kasbon direct create ignores a forged createdBy in the body', async () => {
    const r = await request(app).post('/api/v1/cashbon').set(auth(hrd))
      .send({ employeeId: empId, amount: 50000, date: '2026-06-11', status: 'pending', createdByName: 'Fake', createdByRole: 'owner' });
    expect(r.status).toBe(201);
    expect(r.body.data.createdBy).toEqual({ name: 'Dewi', role: 'hrd' });
  });

  it('approval create stamps createdBy from the token, ignoring the body', async () => {
    const r = await request(app).post('/api/v1/approvals').set(auth(hrd))
      .send({ type: 'purchase', title: 'Beli galon', who: 'Budi', createdByName: 'Fake', createdByRole: 'owner' });
    expect(r.status).toBe(201);
    expect(r.body.data.createdBy).toEqual({ name: 'Dewi', role: 'hrd' });
    const list = await request(app).get('/api/v1/approvals').set(auth(hrd));
    const row = list.body.data.find((a) => a.id === r.body.data.id);
    expect(row.createdBy).toEqual({ name: 'Dewi', role: 'hrd' });   // survives round-trip
  });

  it('updating an approval does not change the original creator snapshot', async () => {
    const c = await request(app).post('/api/v1/approvals').set(auth(hrd)).send({ type: 'custom', title: 'X' });
    const upd = await request(app).patch(`/api/v1/approvals/${c.body.data.id}`).set(auth(hrd)).send({ status: 'approved', createdByName: 'Tamper', createdByRole: 'owner' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.createdBy).toEqual({ name: 'Dewi', role: 'hrd' });
  });
});
