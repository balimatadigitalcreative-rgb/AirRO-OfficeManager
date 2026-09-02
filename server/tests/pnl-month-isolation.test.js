'use strict';
// GUARD (item 5): monthly P&L figures must be period-scoped — the cash-book month sum, the Transaksi
// row sum and the double-entry Laba Rugi must agree for the same month, and one month must NEVER absorb
// another. Reproduces the reported suspicion (carry-over) and pins it shut. Uses the service directly
// (like accounting-reports.test.js) so it doesn't depend on the v2 HTTP flag.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let gm, actor;
const mk = (type, amount, category, date) => request(app).post('/api/v1/entries').set(auth(gm)).send({ type, amount, category, acct: 'cash', date, note: category });
// The cash-book month sum (the basis of Ringkasan + the Transaksi row sum): only entries dated in [from,to].
const cashMonth = async (from, to) => {
  const rows = (await prisma.entry.findMany({ where: { date: { gte: from, lte: to } } }));
  return rows.reduce((a, e) => { const n = Number(e.amount); e.type === 'income' ? a.income += n : a.expense += n; return a; }, { income: 0, expense: 0 });
};

beforeAll(async () => {
  await resetDb();
  const o = await reg({ name: 'Boss', username: 'gm_pnl', password: 'secret123', role: 'gm' });
  gm = o.token; actor = { id: o.user.id, name: 'Boss' };
  await mk('income', 1000000, 'Refill', '2026-01-10');
  await mk('expense', 400000, 'Fuel', '2026-01-20');
  await mk('income', 7000000, 'Refill', '2026-02-05');
  await mk('expense', 2500000, 'Fuel', '2026-02-15');
  await acc.backfill({ fromDate: '2026-01-01', actor });
});
afterAll(() => prisma.$disconnect());

describe('monthly P&L == cash-book month sum, and no carry-over', () => {
  it('January: Laba Rugi reflects ONLY January and equals the cash-book Jan sum', async () => {
    const is = await acc.incomeStatement({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    const cb = await cashMonth('2026-01-01', '2026-01-31');
    expect(cb).toEqual({ income: 1000000, expense: 400000 });   // cash-book Jan (Ringkasan/Transaksi basis)
    expect(is.revenue).toBe(cb.income);                          // P&L revenue == cash-book income
    expect(is.expense).toBe(cb.expense);                         // P&L expense == cash-book expense
    expect(is.revenue).not.toBe(8000000);                        // NOT Jan+Feb (the carry-over bug)
  });

  it('February reflects ONLY February', async () => {
    const is = await acc.incomeStatement({ dateFrom: '2026-02-01', dateTo: '2026-02-28' });
    expect(is.revenue).toBe(7000000);
    expect(is.expense).toBe(2500000);
  });

  it("adding March's entry does NOT change January's P&L", async () => {
    const before = await acc.incomeStatement({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    await mk('income', 9999000, 'Refill', '2026-03-09');
    await acc.backfill({ fromDate: '2026-01-01', actor });
    const after = await acc.incomeStatement({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    expect(after.revenue).toBe(before.revenue);
    expect(after.expense).toBe(before.expense);
  });
});
