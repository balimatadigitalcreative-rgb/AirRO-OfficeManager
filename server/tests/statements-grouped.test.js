'use strict';
// Neraca / Laba Rugi API: the grouped per-account rows the UI renders MUST sum to the server totals
// (so the client never recomputes), the balance-sheet equation must hold, and unit scoping must filter.
process.env.ACCOUNTING_V2 = 'true';
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');

const actor = { id: null, name: 'test' };
const sum = (rows) => rows.reduce((s, r) => s + r.balance, 0);

beforeEach(async () => { await resetDb(); await acc.seedChart(); });
afterAll(() => prisma.$disconnect());

async function seed(businessUnitId) {
  // revenue 1,000,000 (Dr Kas / Cr Pendapatan); HPP 300,000; opex 200,000 (both paid from Kas).
  const bu = businessUnitId ? { businessUnitId } : {};
  await acc.postJournal({ sourceType: 'manual', sourceId: 'j1' + (businessUnitId || ''), date: '2026-08-10', actor, ...bu, lines: [{ code: '1-1000', debit: 1000000 }, { code: '4-1000', credit: 1000000 }] });
  await acc.postJournal({ sourceType: 'manual', sourceId: 'j2' + (businessUnitId || ''), date: '2026-08-11', actor, ...bu, lines: [{ code: '5-1000', debit: 300000 }, { code: '1-1000', credit: 300000 }] });
  await acc.postJournal({ sourceType: 'manual', sourceId: 'j3' + (businessUnitId || ''), date: '2026-08-12', actor, ...bu, lines: [{ code: '6-1000', debit: 200000 }, { code: '1-1000', credit: 200000 }] });
}

describe('Neraca / Laba Rugi grouped statements', () => {
  it('balance-sheet grouped rows sum to the totals and the equation balances', async () => {
    await seed();
    const bs = await acc.balanceSheet();
    expect(sum(bs.assetRows)).toBe(bs.assets);           // 500,000 (1,000,000 − 300,000 − 200,000)
    expect(sum(bs.liabilityRows)).toBe(bs.liabilities);  // 0
    expect(sum(bs.equityRows)).toBe(bs.equityBase);      // 0 (retained earnings carried in netIncome)
    expect(bs.assets).toBe(500000);
    expect(bs.netIncome).toBe(500000);
    expect(bs.equity).toBe(bs.equityBase + bs.netIncome);
    expect(bs.balanced).toBe(true);                      // assets === liabilities + equity
    expect(bs.assets).toBe(bs.liabilities + bs.equity);
  });

  it('income-statement grouped rows sum to the totals; profit + margin are server-derived', async () => {
    await seed();
    const is = await acc.incomeStatement();
    expect(sum(is.revenueRows)).toBe(is.revenue);   // 1,000,000
    expect(sum(is.hppRows)).toBe(is.hpp);           // 300,000 (cogs subtype)
    expect(sum(is.opexRows)).toBe(is.opex);         // 200,000
    expect(is.grossProfit).toBe(is.revenue - is.hpp);
    expect(is.profit).toBe(is.revenue - is.expense);
    expect(is.profit).toBe(500000);
    expect(is.margin).toBe(50);
  });

  it('unit scoping filters accountBalances / income-statement to one business unit', async () => {
    await seed('air');
    await seed('mfg');
    const all = await acc.incomeStatement();
    const air = await acc.incomeStatement({ businessUnitId: 'air' });
    expect(all.revenue).toBe(2000000);   // both units
    expect(air.revenue).toBe(1000000);   // only 'air'
    expect(air.profit).toBe(500000);
  });

  it('journalList lists the period entries chronologically and is unit-scoped (Jurnal tab)', async () => {
    await seed('air');
    await seed('mfg');
    const all = await acc.journalList({});
    expect(all.rows.length).toBe(6);                 // 3 entries per unit
    const air = await acc.journalList({ businessUnitId: 'air' });
    expect(air.rows.length).toBe(3);
    const j1 = air.rows.find((r) => r.sourceId === 'j1air');
    expect(j1.amount).toBe(1000000);                 // Σ in-scope debit of the entry
    // newest-first ordering
    expect(air.rows[0].date >= air.rows[air.rows.length - 1].date).toBe(true);
  });
});
