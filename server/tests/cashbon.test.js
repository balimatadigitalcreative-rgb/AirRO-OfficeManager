'use strict';
// Kasbon ACC flow: a request is pending (never deducts) until approved; approving
// stamps the disbursed date (which drives the deduction cycle); reject/cancel keep it
// out of deductions. requestDate is exposed alongside the legacy `date`.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body.token);
let hrd, finance, empId;

beforeAll(async () => {
  await resetDb();
  hrd = await reg({ name: 'Dewi', username: 'hrd_kb', password: 'secret123', role: 'hrd' });          // kasbon + kasbonApprove
  finance = await reg({ name: 'Andi', username: 'fin_kb', password: 'secret123', role: 'finance' });   // kasbon, NO kasbonApprove
  const e = await request(app).post('/api/v1/employees').set(auth(hrd)).send({ name: 'Budi', department: 'Driver', base: 5000000 });
  empId = e.body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('Kasbon — ACC + disbursed date', () => {
  let kbId;

  it('request → pending, no disbursedDate, exposes requestDate', async () => {
    const r = await request(app).post('/api/v1/cashbon/request').set(auth(hrd)).send({ employeeId: empId, amount: 500000, date: '2026-07-05', note: 'x' });
    expect(r.status).toBe(201);
    const cb = r.body.data.cashbon;
    expect(cb.status).toBe('pending');
    expect(cb.disbursedDate == null).toBe(true);
    expect(cb.requestDate).toBe('2026-07-05');
    kbId = cb.id;
  });

  it('approve with a disbursedDate → approved + disbursedDate set', async () => {
    const r = await request(app).post(`/api/v1/cashbon/${kbId}/approve`).set(auth(hrd)).send({ disbursedDate: '2026-07-16' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('approved');
    expect(r.body.data.disbursedDate).toBe('2026-07-16');
  });

  it('approve without a disbursedDate defaults to a valid date', async () => {
    const r2 = await request(app).post('/api/v1/cashbon/request').set(auth(hrd)).send({ employeeId: empId, amount: 200000, date: '2026-07-13' });
    const a = await request(app).post(`/api/v1/cashbon/${r2.body.data.cashbon.id}/approve`).set(auth(hrd)).send({});
    expect(a.status).toBe(200);
    expect(a.body.data.status).toBe('approved');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(a.body.data.disbursedDate)).toBe(true);
  });

  it('cancel an approved kasbon → status cancelled (deduction removed client-side)', async () => {
    const r = await request(app).patch(`/api/v1/cashbon/${kbId}`).set(auth(hrd)).send({ status: 'cancelled' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('cancelled');
    expect(r.body.data.disbursedDate).toBe('2026-07-16');   // stays for the record; just no longer deducts
  });

  it('reject → status rejected', async () => {
    const r2 = await request(app).post('/api/v1/cashbon/request').set(auth(hrd)).send({ employeeId: empId, amount: 100000, date: '2026-07-20' });
    const j = await request(app).post(`/api/v1/cashbon/${r2.body.data.cashbon.id}/reject`).set(auth(hrd)).send({ reason: 'nope' });
    expect(j.status).toBe(200);
    expect(j.body.data.status).toBe('rejected');
  });
});

describe('Kasbon — cancel (submitter/approver) + delete rules', () => {
  it('submitter (no kasbonApprove) can cancel their OWN pending kasbon', async () => {
    const r = await request(app).post('/api/v1/cashbon/request').set(auth(finance)).send({ employeeId: empId, amount: 100000, date: '2026-08-05' });
    const c = await request(app).post(`/api/v1/cashbon/${r.body.data.cashbon.id}/cancel`).set(auth(finance)).send({});
    expect(c.status).toBe(200);
    expect(c.body.data.status).toBe('cancelled');
    expect(c.body.data.cancelledBy).toBeTruthy();
  });

  it("submitter CANNOT cancel someone else's kasbon", async () => {
    const r = await request(app).post('/api/v1/cashbon/request').set(auth(hrd)).send({ employeeId: empId, amount: 100000, date: '2026-08-13' });   // created by hrd
    const c = await request(app).post(`/api/v1/cashbon/${r.body.data.cashbon.id}/cancel`).set(auth(finance)).send({});   // finance tries
    expect(c.status).toBe(403);
  });

  it('submitter cannot cancel their own once APPROVED — but an approver can', async () => {
    const r = await request(app).post('/api/v1/cashbon/request').set(auth(finance)).send({ employeeId: empId, amount: 100000, date: '2026-08-20' });
    const id = r.body.data.cashbon.id;
    await request(app).post(`/api/v1/cashbon/${id}/approve`).set(auth(hrd)).send({ disbursedDate: '2026-08-20' });
    expect((await request(app).post(`/api/v1/cashbon/${id}/cancel`).set(auth(finance)).send({})).status).toBe(403);
    const byApprover = await request(app).post(`/api/v1/cashbon/${id}/cancel`).set(auth(hrd)).send({});
    expect(byApprover.status).toBe(200);
    expect(byApprover.body.data.status).toBe('cancelled');
  });

  it('delete: an APPROVED kasbon cannot be deleted directly (must cancel first)', async () => {
    const r = await request(app).post('/api/v1/cashbon/request').set(auth(hrd)).send({ employeeId: empId, amount: 100000, date: '2026-09-05' });
    const id = r.body.data.cashbon.id;
    await request(app).post(`/api/v1/cashbon/${id}/approve`).set(auth(hrd)).send({ disbursedDate: '2026-09-05' });
    expect((await request(app).delete(`/api/v1/cashbon/${id}`).set(auth(hrd))).status).toBe(400);
    await request(app).post(`/api/v1/cashbon/${id}/cancel`).set(auth(hrd)).send({});
    expect((await request(app).delete(`/api/v1/cashbon/${id}`).set(auth(hrd))).status).toBe(204);
  });

  it('delete requires kasbonApprove (finance is forbidden)', async () => {
    const r = await request(app).post('/api/v1/cashbon/request').set(auth(finance)).send({ employeeId: empId, amount: 100000, date: '2026-09-13' });
    const id = r.body.data.cashbon.id;
    await request(app).post(`/api/v1/cashbon/${id}/cancel`).set(auth(finance)).send({});   // now cancelled
    expect((await request(app).delete(`/api/v1/cashbon/${id}`).set(auth(finance))).status).toBe(403);
  });
});
