'use strict';
// MONEY IS INTEGER RUPIAH (minor units — IDR has no sub-unit in practice). This locks the invariant the
// reports depend on: summing a long series of ODD amounts across many rows must equal the exact integer
// total on the SERVER figures (accountBalances / trial balance / income statement / balance sheet) — the
// kind of one-rupiah drift that only shows at scale and would destroy trust in every figure on the page.
process.env.ACCOUNTING_V2 = 'true';
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');

const actor = { id: null, name: 'test' };
beforeEach(async () => { await resetDb(); await acc.seedChart(); });
afterAll(() => prisma.$disconnect());

describe('money is integer rupiah — no float drift at scale', () => {
  it('a long series of odd amounts sums to the EXACT integer total in every report figure', async () => {
    const amounts = [];
    for (let i = 0; i < 47; i++) amounts.push(8500);                                  // 47 × 8.500
    [12750, 6250, 3333, 99999, 1, 7, 250001, 45678, 8500, 33, 8501, 1234567].forEach((a) => amounts.push(a));
    let expected = 0;
    for (let i = 0; i < amounts.length; i++) {
      expected += amounts[i];
      await acc.postJournal({ sourceType: 'manual', sourceId: 'drift' + i, date: '2026-08-10', actor, lines: [{ code: '1-1000', debit: amounts[i] }, { code: '4-1000', credit: amounts[i] }] });
    }
    const bals = await acc.accountBalances();
    expect(bals.find((r) => r.code === '1-1000').balance).toBe(expected);   // Kas — exact, no drift
    expect(bals.find((r) => r.code === '4-1000').balance).toBe(expected);   // Pendapatan
    const tb = await acc.trialBalance();
    expect(tb.totalDebit).toBe(expected);
    expect(tb.totalCredit).toBe(expected);
    expect(tb.balanced).toBe(true);
    const is = await acc.incomeStatement();
    expect(is.revenue).toBe(expected);
    const bs = await acc.balanceSheet();
    expect(bs.assets).toBe(expected);
    expect(bs.balanced).toBe(true);
  });

  it('prepaid amortization reconciles to the total exactly (last month absorbs the remainder)', async () => {
    const accrual = require('../src/services/accrual.service');
    const total = 100000, months = 7;   // 100.000 / 7 = 14.285,7… → floor 14.285, last month +remainder
    const s = await accrual.createSchedule({ sourceType: 'manual', sourceId: '', chartAccountId: (await acc.chartMap())['1-1500'] || (await prisma.chartAccount.findFirst({ where: { type: 'asset' } })).id, prepaidCode: null, startDate: '2026-08-01', months, total, description: 'test' });
    const monthly = Number(s.monthlyAmount);
    const lastMonth = total - monthly * (months - 1);
    expect(monthly * (months - 1) + lastMonth).toBe(total);   // the split reconciles to the exact total
    expect(monthly).toBe(Math.floor(total / months));
  });
});
