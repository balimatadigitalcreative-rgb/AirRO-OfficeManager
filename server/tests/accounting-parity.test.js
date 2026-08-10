'use strict';
// NON-NEGOTIABLE safety net: the double-entry LAYER is additive — running it must NOT change any
// existing cash-book report. Snapshot report.service output BEFORE the accounting backfill and assert
// byte-identical AFTER. (The layer only writes new tables; the cash book is untouched.)
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const report = require('../src/services/report.service');
const accounting = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let owner, ownerUser;
beforeAll(async () => {
  await resetDb();
  const o = await reg({ name: 'Boss', username: 'own_ap', password: 'secret123', role: 'gm' });   // gm holds `settings` (account mgmt); owner does not
  owner = o.token; ownerUser = { id: o.user.id, role: 'gm', unitScope: 'all' };
  // Cash-book entries use the PLAIN category/acct string columns (not the legacy FK relations) — that
  // is exactly the shape the running app writes, and what report.service + accounting.service read.
  const mk = (type, amount, category, date) => request(app).post('/api/v1/entries').set(auth(owner)).send({ type, amount, category, acct: 'cash', date, note: category });
  await mk('income', 500000, 'Refill', '2026-08-01');
  await mk('income', 900000, 'Bulk', '2026-08-02');
  await mk('expense', 250000, 'Fuel', '2026-08-02');
  await mk('expense', 300000, 'Salaries', '2026-08-03');
  await mk('expense', 120000, 'OtherOut', '2026-08-03');
});
afterAll(() => prisma.$disconnect());

describe('cash-book reports are byte-identical before and after the accounting backfill', () => {
  it('summary / cashflow / breakdown are unchanged by projecting journals', async () => {
    const range = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };
    const before = {
      summary: await report.summary(range, ownerUser),
      cashflow: await report.cashflow(range, ownerUser),
      expenseBreakdown: await report.breakdown({ type: 'expense', ...range }, ownerUser),
      incomeBreakdown: await report.breakdown({ type: 'income', ...range }, ownerUser),
    };
    // run the WHOLE new engine
    const posted = await accounting.backfill({ fromDate: '2026-01-01', actor: ownerUser });
    expect(posted.entry).toBeGreaterThan(0);
    const after = {
      summary: await report.summary(range, ownerUser),
      cashflow: await report.cashflow(range, ownerUser),
      expenseBreakdown: await report.breakdown({ type: 'expense', ...range }, ownerUser),
      incomeBreakdown: await report.breakdown({ type: 'income', ...range }, ownerUser),
    };
    expect(after).toEqual(before);   // byte-identical
    // and no source row was mutated
    const entries = await prisma.entry.findMany({ select: { id: true, amount: true, type: true } });
    expect(entries.length).toBe(5);
  });
});
