'use strict';
// Stage 4 — inter-unit transfers. ONE internal money movement between two units, stored as a
// linked PAIR (payer expense + receiver income). The invariant: each single unit sees its own
// leg as real income/expense, but the COMBINED view eliminates the pair (internal trade nets to
// zero) so consolidated income/expense/net-profit are UNCHANGED, while cash still reconciles.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const entries = async (t) => (await request(app).get('/api/v1/entries?limit=5000').set(auth(t))).body.data;

// Replicate the client aggregation rules exactly (finance-shell computeStats).
const combinedIncome = (es) => es.filter((e) => e.type === 'income' && !e.interUnit).reduce((s, e) => s + e.amount, 0);
const combinedExpense = (es) => es.filter((e) => e.type === 'expense' && !e.interUnit).reduce((s, e) => s + e.amount, 0);
const unitIncome = (es, u) => es.filter((e) => e.type === 'income' && (e.businessUnitId || 'air') === u).reduce((s, e) => s + e.amount, 0);
const unitExpense = (es, u) => es.filter((e) => e.type === 'expense' && (e.businessUnitId || 'air') === u).reduce((s, e) => s + e.amount, 0);
// account balance = opening + income-on-acct − expense-on-acct (transfers table unused here)
const acctBal = (es, acct, opening) => opening
  + es.filter((e) => e.acct === acct && e.type === 'income').reduce((s, e) => s + e.amount, 0)
  - es.filter((e) => e.acct === acct && e.type === 'expense').reduce((s, e) => s + e.amount, 0);

const AIR_OPEN = 5000000, MFG_OPEN = 3000000;
let gm, staff, airAcct, mfgAcct;
beforeAll(async () => {
  await resetDb();   // seeds air/manufaktur/unit3
  gm = (await reg({ name: 'IU GM', username: 'iu_gm', password: 'secret123', role: 'gm' })).token;
  const s = await reg({ name: 'Staff', username: 'iu_staff', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: s.user.id }, data: { permissions: JSON.stringify({ cashflow: true, addEntry: true, interUnitTransfer: false }) } });
  staff = (await request(app).post('/api/v1/auth/login').send({ username: 'iu_staff', password: 'secret123' })).body.token;
  airAcct = (await request(app).post('/api/v1/accounts').set(auth(gm)).send({ name: 'Kas Air', type: 'cash', opening: AIR_OPEN, businessUnitId: 'air' })).body.data.id;
  mfgAcct = (await request(app).post('/api/v1/accounts').set(auth(gm)).send({ name: 'Kas MFG', type: 'cash', opening: MFG_OPEN, businessUnitId: 'manufaktur' })).body.data.id;
  // some ordinary income/expense on each side so there's a real baseline
  await request(app).post('/api/v1/entries').set(auth(gm)).send({ type: 'income', amount: 1000000, date: '2026-07-01', category: 'Refill', acct: airAcct, businessUnitId: 'air' });
  await request(app).post('/api/v1/entries').set(auth(gm)).send({ type: 'expense', amount: 200000, date: '2026-07-02', category: 'Fuel', acct: mfgAcct, businessUnitId: 'manufaktur' });
});
afterAll(() => prisma.$disconnect());

const X = 2000000;
let baseline, groupId;

describe('inter-unit transfer Air → Manufaktur', () => {
  it('requires the interUnitTransfer capability (server-enforced)', async () => {
    const r = await request(app).post('/api/v1/inter-unit-transfers').set(auth(staff))
      .send({ fromUnitId: 'air', toUnitId: 'manufaktur', fromAccountId: airAcct, toAccountId: mfgAcct, amount: X, date: '2026-07-10' });
    expect(r.status).toBe(403);
  });

  it('validates: same unit / same account / zero amount are rejected', async () => {
    const bad = (body) => request(app).post('/api/v1/inter-unit-transfers').set(auth(gm)).send(body).then((r) => r.status);
    expect(await bad({ fromUnitId: 'air', toUnitId: 'air', fromAccountId: airAcct, toAccountId: mfgAcct, amount: X, date: '2026-07-10' })).toBe(400);
    expect(await bad({ fromUnitId: 'air', toUnitId: 'manufaktur', fromAccountId: airAcct, toAccountId: airAcct, amount: X, date: '2026-07-10' })).toBe(400);
    expect(await bad({ fromUnitId: 'air', toUnitId: 'manufaktur', fromAccountId: airAcct, toAccountId: mfgAcct, amount: 0, date: '2026-07-10' })).toBe(400);
  });

  it('posts a linked PAIR and audits both legs to the real actor', async () => {
    baseline = await entries(gm);
    const r = await request(app).post('/api/v1/inter-unit-transfers').set(auth(gm))
      .send({ fromUnitId: 'air', toUnitId: 'manufaktur', fromAccountId: airAcct, toAccountId: mfgAcct, amount: X, date: '2026-07-10', note: 'Air pays MFG' });
    expect(r.status).toBe(201);
    groupId = r.body.data.transferGroupId;
    const legs = await prisma.entry.findMany({ where: { transferGroupId: groupId } });
    expect(legs).toHaveLength(2);
    const payer = legs.find((l) => l.type === 'expense'), receiver = legs.find((l) => l.type === 'income');
    expect(payer).toMatchObject({ businessUnitId: 'air', acct: airAcct, amount: X, interUnit: true, counterpartUnitId: 'manufaktur', counterpartAccountId: mfgAcct });
    expect(receiver).toMatchObject({ businessUnitId: 'manufaktur', acct: mfgAcct, amount: X, interUnit: true, counterpartUnitId: 'air', counterpartAccountId: airAcct });
    expect(payer.createdByName).toBe('IU GM');   // audited actor
    expect(receiver.createdByName).toBe('IU GM');
  });

  it('(a) Air single-unit expense +X, Manufaktur single-unit income +X', async () => {
    const now = await entries(gm);
    expect(unitExpense(now, 'air')).toBe(unitExpense(baseline, 'air') + X);
    expect(unitIncome(now, 'manufaktur')).toBe(unitIncome(baseline, 'manufaktur') + X);
  });

  it('(b) combined income / expense / net-profit are UNCHANGED (internal trade eliminated)', async () => {
    const now = await entries(gm);
    expect(combinedIncome(now)).toBe(combinedIncome(baseline));
    expect(combinedExpense(now)).toBe(combinedExpense(baseline));
    expect(combinedIncome(now) - combinedExpense(now)).toBe(combinedIncome(baseline) - combinedExpense(baseline));
  });

  it('(c) payer account −X, receiver account +X', async () => {
    const now = await entries(gm);
    expect(acctBal(now, airAcct, AIR_OPEN)).toBe(acctBal(baseline, airAcct, AIR_OPEN) - X);
    expect(acctBal(now, mfgAcct, MFG_OPEN)).toBe(acctBal(baseline, mfgAcct, MFG_OPEN) + X);
  });

  it('(d) sum of per-unit cash == combined cash (unchanged by internal transfer)', async () => {
    const now = await entries(gm);
    // combined cash = opening + all non-reference income − expense (inter-unit legs net to zero)
    const cash = (es) => (AIR_OPEN + MFG_OPEN)
      + es.filter((e) => e.type === 'income' && !e.reference).reduce((s, e) => s + e.amount, 0)
      - es.filter((e) => e.type === 'expense' && !e.reference).reduce((s, e) => s + e.amount, 0);
    expect(cash(now)).toBe(cash(baseline));   // combined cash unchanged
    // per-unit cash sums to the same
    const unitCash = (es, u, open) => open
      + es.filter((e) => e.type === 'income' && !e.reference && (e.businessUnitId || 'air') === u).reduce((s, e) => s + e.amount, 0)
      - es.filter((e) => e.type === 'expense' && !e.reference && (e.businessUnitId || 'air') === u).reduce((s, e) => s + e.amount, 0);
    expect(unitCash(now, 'air', AIR_OPEN) + unitCash(now, 'manufaktur', MFG_OPEN)).toBe(cash(now));
  });

  it('an inter-unit leg cannot be edited in isolation (must be voided)', async () => {
    const leg = await prisma.entry.findFirst({ where: { transferGroupId: groupId } });
    const r = await request(app).patch('/api/v1/entries/' + leg.id).set(auth(gm)).send({ amount: 999 });
    expect(r.status).toBe(400);
  });

  it('void reverses BOTH legs (never orphans one) and restores the pre-transfer state', async () => {
    const del = await request(app).delete('/api/v1/inter-unit-transfers/' + groupId).set(auth(gm));
    expect(del.status).toBe(200);
    expect(await prisma.entry.count({ where: { transferGroupId: groupId } })).toBe(0);
    const now = await entries(gm);
    expect(unitExpense(now, 'air')).toBe(unitExpense(baseline, 'air'));       // back to baseline
    expect(unitIncome(now, 'manufaktur')).toBe(unitIncome(baseline, 'manufaktur'));
    expect(acctBal(now, airAcct, AIR_OPEN)).toBe(acctBal(baseline, airAcct, AIR_OPEN));
  });

  it('deleting ONE leg via the normal entry path also removes its partner (no orphan)', async () => {
    const r = await request(app).post('/api/v1/inter-unit-transfers').set(auth(gm))
      .send({ fromUnitId: 'air', toUnitId: 'manufaktur', fromAccountId: airAcct, toAccountId: mfgAcct, amount: 500000, date: '2026-07-11' });
    const gid = r.body.data.transferGroupId;
    const legs = await prisma.entry.findMany({ where: { transferGroupId: gid } });
    await request(app).delete('/api/v1/entries/' + legs[0].id).set(auth(gm));
    expect(await prisma.entry.count({ where: { transferGroupId: gid } })).toBe(0);   // both gone
  });

  it('a non-holder cannot void either', async () => {
    const r = await request(app).post('/api/v1/inter-unit-transfers').set(auth(gm))
      .send({ fromUnitId: 'air', toUnitId: 'manufaktur', fromAccountId: airAcct, toAccountId: mfgAcct, amount: 100000, date: '2026-07-12' });
    expect((await request(app).delete('/api/v1/inter-unit-transfers/' + r.body.data.transferGroupId).set(auth(staff))).status).toBe(403);
  });
});
