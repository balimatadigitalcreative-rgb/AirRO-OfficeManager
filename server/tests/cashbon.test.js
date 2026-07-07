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
// Make a user with an EXPLICIT per-user permission override (the granular kasbon caps),
// then log in so the fresh token carries it. Lets us test each action cap in isolation.
async function mkUser(username, permsObj) {
  await request(app).post('/api/v1/auth/register').send({ name: username, username, password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { username }, data: { permissions: JSON.stringify(permsObj) } });
  const r = await request(app).post('/api/v1/auth/login').send({ username, password: 'secret123' });
  return r.body.token;
}
// Each kasbon gets a unique date ~40 days apart → its own week/cycle, so it never trips
// the "max 1 per week" / cycle-ceiling rules (those are covered by the ACC-flow tests).
let kbSeq = 0;
function mkKasbon(tok) {
  kbSeq += 1;
  const d = new Date(Date.UTC(2026, 0, 5) + kbSeq * 40 * 86400000);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return request(app).post('/api/v1/cashbon/request').set(auth(tok)).send({ employeeId: empId, amount: 100000, date }).then((r) => r.body.data.cashbon.id);
}
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

  it('delete: an APPROVED kasbon CAN now be deleted by a kasbonDelete holder — its deduction is computed, so it disappears with the row', async () => {
    const r = await request(app).post('/api/v1/cashbon/request').set(auth(hrd)).send({ employeeId: empId, amount: 100000, date: '2026-09-05' });
    const id = r.body.data.cashbon.id;
    await request(app).post(`/api/v1/cashbon/${id}/approve`).set(auth(hrd)).send({ disbursedDate: '2026-09-05' });
    expect((await request(app).delete(`/api/v1/cashbon/${id}`).set(auth(hrd))).status).toBe(204);
    const list = await request(app).get('/api/v1/cashbon').set(auth(hrd));
    expect(list.body.data.some((c) => c.id === id)).toBe(false);   // gone → no dangling deduction
  });

  it('delete requires kasbonDelete (finance role default has none → forbidden)', async () => {
    const r = await request(app).post('/api/v1/cashbon/request').set(auth(finance)).send({ employeeId: empId, amount: 100000, date: '2026-09-13' });
    const id = r.body.data.cashbon.id;
    await request(app).post(`/api/v1/cashbon/${id}/cancel`).set(auth(finance)).send({});   // now cancelled
    expect((await request(app).delete(`/api/v1/cashbon/${id}`).set(auth(finance))).status).toBe(403);
  });
});

// Each kasbon action is gated on its OWN capability. Three users, each with exactly one
// slice of the granular caps, prove the SERVER (not just the UI) enforces per-action.
describe('Kasbon — per-action capabilities (server-enforced)', () => {
  let uReqCancel, uApproveReject, uDelete, uLegacy;
  beforeAll(async () => {
    uReqCancel = await mkUser('kb_a', { kasbonRequest: true, kasbonCancel: true, kasbonApprove: false, kasbonReject: false, kasbonDelete: false });
    uApproveReject = await mkUser('kb_b', { kasbonRequest: false, kasbonApprove: true, kasbonReject: true, kasbonCancel: false, kasbonDelete: false });
    uDelete = await mkUser('kb_c', { kasbonRequest: false, kasbonApprove: false, kasbonReject: false, kasbonCancel: false, kasbonDelete: true });
    uLegacy = await mkUser('kb_legacy', { kasbon: true, kasbonApprove: true });   // pre-split override
  });

  it('(a) request+cancel user: can request & cancel own pending, but cannot approve/reject/delete', async () => {
    const id = await mkKasbon(uReqCancel);
    expect((await request(app).post(`/api/v1/cashbon/${id}/approve`).set(auth(uReqCancel)).send({})).status).toBe(403);
    expect((await request(app).post(`/api/v1/cashbon/${id}/reject`).set(auth(uReqCancel)).send({})).status).toBe(403);
    expect((await request(app).delete(`/api/v1/cashbon/${id}`).set(auth(uReqCancel))).status).toBe(403);
    const c = await request(app).post(`/api/v1/cashbon/${id}/cancel`).set(auth(uReqCancel)).send({});   // own pending
    expect(c.status).toBe(200);
    expect(c.body.data.status).toBe('cancelled');
  });

  it('(b) approve+reject user: can view + approve + reject, but cannot request or delete', async () => {
    expect((await request(app).get('/api/v1/cashbon').set(auth(uApproveReject))).status).toBe(200);   // view allowed
    expect((await request(app).post('/api/v1/cashbon/request').set(auth(uApproveReject)).send({ employeeId: empId, amount: 50000, date: '2026-10-06' })).status).toBe(403);
    const id1 = await mkKasbon(hrd);
    expect((await request(app).post(`/api/v1/cashbon/${id1}/approve`).set(auth(uApproveReject)).send({})).status).toBe(200);
    const id2 = await mkKasbon(hrd);
    expect((await request(app).post(`/api/v1/cashbon/${id2}/reject`).set(auth(uApproveReject)).send({ reason: 'x' })).status).toBe(200);
    expect((await request(app).delete(`/api/v1/cashbon/${id1}`).set(auth(uApproveReject))).status).toBe(403);   // no delete cap
  });

  it('(c) delete-only user: can view + delete (any status), but cannot approve/reject/request', async () => {
    expect((await request(app).get('/api/v1/cashbon').set(auth(uDelete))).status).toBe(200);
    const id = await mkKasbon(hrd);
    expect((await request(app).post(`/api/v1/cashbon/${id}/approve`).set(auth(uDelete)).send({})).status).toBe(403);
    expect((await request(app).post(`/api/v1/cashbon/${id}/reject`).set(auth(uDelete)).send({})).status).toBe(403);
    expect((await request(app).post('/api/v1/cashbon/request').set(auth(uDelete)).send({ employeeId: empId, amount: 50000, date: '2026-10-07' })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/cashbon/${id}`).set(auth(uDelete))).status).toBe(204);   // delete a pending
  });

  it('delete-only user can delete a PAID kasbon (and its computed deduction goes with it)', async () => {
    const id = await mkKasbon(hrd);
    await request(app).post(`/api/v1/cashbon/${id}/approve`).set(auth(hrd)).send({ disbursedDate: '2026-10-05' });
    await request(app).patch(`/api/v1/cashbon/${id}`).set(auth(hrd)).send({ status: 'paid' });
    expect((await request(app).delete(`/api/v1/cashbon/${id}`).set(auth(uDelete))).status).toBe(204);
    const list = await request(app).get('/api/v1/cashbon').set(auth(hrd));
    expect(list.body.data.some((c) => c.id === id)).toBe(false);
  });

  it('backward-compat: a legacy kasbonApprove override still approves, rejects, cancels AND deletes', async () => {
    const idA = await mkKasbon(hrd);
    expect((await request(app).post(`/api/v1/cashbon/${idA}/approve`).set(auth(uLegacy)).send({})).status).toBe(200);
    const idR = await mkKasbon(hrd);
    expect((await request(app).post(`/api/v1/cashbon/${idR}/reject`).set(auth(uLegacy)).send({ reason: 'x' })).status).toBe(200);
    const idC = await mkKasbon(hrd);
    expect((await request(app).post(`/api/v1/cashbon/${idC}/cancel`).set(auth(uLegacy)).send({})).status).toBe(200);
    expect((await request(app).delete(`/api/v1/cashbon/${idC}`).set(auth(uLegacy))).status).toBe(204);
  });
});
