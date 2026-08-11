'use strict';
// ACCOUNTING v2 — Part 6 (bank reconciliation). Mark book movements cleared against a statement; the
// cleared balance vs the statement is the running difference; unreconciled items are listed. Reuses the
// Account model and never touches the cash book. Flag on so the /accounting router is served.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let gm, acctId, incId1, expId, incId2;
const view = (qs) => request(app).get('/api/v1/accounting/reconciliation' + qs).set(auth(gm)).then((r) => r.body.data);
const mark = (itemType, itemId, cleared) => request(app).post('/api/v1/accounting/reconciliation/mark').set(auth(gm)).send({ accountId: acctId, itemType, itemId, cleared });

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'rec_gm', password: 'secret123', role: 'gm' })).body.token;
  acctId = (await request(app).post('/api/v1/accounts').set(auth(gm)).send({ name: 'BCA', type: 'bank', opening: 0 })).body.data.id;
  const mkE = (type, amount, date) => request(app).post('/api/v1/entries').set(auth(gm)).send({ type, amount, category: type === 'income' ? 'Refill' : 'Fuel', acct: acctId, date, note: `${type} ${amount}` }).then((r) => r.body.data.id);
  incId1 = await mkE('income', 100000, '2026-08-01');
  expId = await mkE('expense', 30000, '2026-08-02');
  incId2 = await mkE('income', 50000, '2026-08-03');
});
afterAll(() => prisma.$disconnect());

describe('bank reconciliation', () => {
  it('starts with nothing cleared: book 120k, cleared = opening, all unreconciled', async () => {
    const v = await view('?accountId=' + acctId);
    expect(v.bookBalance).toBe(120000);
    expect(v.clearedBalance).toBe(0);
    expect(v.unreconciledCount).toBe(3);
  });

  it('clearing the two deposits leaves the expense unreconciled; statement 150k reconciles to 0', async () => {
    await mark('entry', incId1, true);
    await mark('entry', incId2, true);
    const v = await view('?accountId=' + acctId + '&statementBalance=150000');
    expect(v.clearedBalance).toBe(150000);
    expect(v.unreconciledCount).toBe(1);
    expect(v.unreconciled[0].itemId).toBe(expId);
    expect(v.unreconciled[0].amount).toBe(-30000);
    expect(v.unclearedTotal).toBe(-30000);
    expect(v.difference).toBe(0);
    expect(v.reconciled).toBe(true);
  });

  it('clearing the expense too makes cleared == book and nothing outstanding', async () => {
    await mark('entry', expId, true);
    const v = await view('?accountId=' + acctId + '&statementBalance=120000');
    expect(v.clearedBalance).toBe(120000);
    expect(v.unreconciledCount).toBe(0);
    expect(v.difference).toBe(0);
    expect(v.reconciled).toBe(true);
  });

  it('un-clearing a deposit puts it back on the unreconciled list', async () => {
    const r = await mark('entry', incId1, false);
    expect(r.body.data.cleared).toBe(false);
    const v = await view('?accountId=' + acctId);
    expect(v.clearedBalance).toBe(20000);           // 120k − 100k
    expect(v.unreconciledCount).toBe(1);
    expect(v.unreconciled[0].itemId).toBe(incId1);
  });

  it('an unknown account returns null (no crash)', async () => {
    const v = await view('?accountId=nope');
    expect(v).toBeNull();
  });
});
