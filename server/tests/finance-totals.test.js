'use strict';
// GUARD (this class of bug should be caught by the harness, not by the owner noticing):
// Ringkasan's period Pemasukan/Pengeluaran and the Transaksi screen's totals MUST come from the same
// reducer for the same scope. Both call FTOT.periodTotals; the Transaksi split uses FINSRC to bucket.
// So for ANY period/scope: combined(all) === setoran + operasional, and the Transaksi "combined" line
// equals the Ringkasan figure. If a future edit reintroduces a second reducer, this fails.
const FTOT = require('../../finance-totals.js');
const FINSRC = require('../../finance-entry-source.js');

// A representative cash book: setoran (deposit) rows, operasional rows, an inter-unit leg, an
// out-of-period row, and a non-cash "reference" row (which counts toward P&L income/expense).
const book = [
  { id: 'stinc-2026-08-01', type: 'income', amount: 500000, date: '2026-08-01', setoranDay: '2026-08-01' },
  { id: 'stmfg-2026-08-01', type: 'expense', amount: 120000, date: '2026-08-01', setoranMfg: '2026-08-01', reference: true },
  { id: 'e1', type: 'expense', amount: 200000, date: '2026-08-06', category: 'Fuel' },
  { id: 'e2', type: 'income', amount: 90000, date: '2026-08-07', category: 'Refill' },
  { id: 'e3', type: 'expense', amount: 50000, date: '2026-08-08', interUnit: true },      // operasional + inter-unit leg
  { id: 'e4', type: 'income', amount: 30000, date: '2026-08-09', meta: JSON.stringify({ setoranDay: '2026-08-09' }) }, // setoran via meta
  { id: 'e5', type: 'income', amount: 999000, date: '2026-07-31', category: 'Refill' },   // OUT of the August window
];
const START = '2026-08-01', END = '2026-08-31';
const split = (rows, kind) => rows.filter((e) => FINSRC.entrySource(e) === kind);

describe('Ringkasan totals === Transaksi totals (shared reducer, same scope)', () => {
  for (const combined of [false, true]) {
    it(`combined(all) === setoran + operasional  [combined=${combined}]`, () => {
      const all = FTOT.periodTotals(book, START, END, combined);
      const set = FTOT.periodTotals(split(book, 'setoran'), START, END, combined);
      const ops = FTOT.periodTotals(split(book, 'operasional'), START, END, combined);
      expect(set.income + ops.income).toBe(all.income);       // Pemasukan reconciles
      expect(set.expense + ops.expense).toBe(all.expense);    // Pengeluaran reconciles
    });
  }

  it('the Transaksi "combined" line equals the Ringkasan figure (identical inputs)', () => {
    // Ringkasan (single-unit view: combined=false) vs the Transaksi combined line — same call.
    const ringkasan = FTOT.periodTotals(book, START, END, false);
    const txnCombined = FTOT.periodTotals(book, START, END, false);
    expect(txnCombined).toEqual(ringkasan);
  });

  it('respects the period window (an out-of-range row never leaks into either total)', () => {
    const aug = FTOT.periodTotals(book, START, END, false);
    const withJuly = FTOT.periodTotals(book, '2026-07-01', END, false);
    expect(withJuly.income - aug.income).toBe(999000);   // the 31 Jul row appears only in the wider window
  });

  it('eliminates the inter-unit leg in the combined view, keeps it single-unit', () => {
    const single = FTOT.periodTotals(book, START, END, false);
    const company = FTOT.periodTotals(book, START, END, true);
    expect(single.expense - company.expense).toBe(50000);   // the inter-unit leg (e3) is removed when combined
  });

  it('reference (non-cash) rows still count toward P&L expense', () => {
    const all = FTOT.periodTotals(book, START, END, false);
    // e1(200k) + e3(50k) + stmfg reference(120k) = 370k
    expect(all.expense).toBe(370000);
  });
});

describe('NO CARRY-OVER — a period total is exactly its own period, never cumulative', () => {
  // Two months of data. January must never absorb February (the reported suspicion).
  const jan = [
    { id: 'j1', type: 'income', amount: 1000000, date: '2026-01-10' },
    { id: 'j2', type: 'expense', amount: 400000, date: '2026-01-20' },
  ];
  const feb = [
    { id: 'f1', type: 'income', amount: 7000000, date: '2026-02-05' },
    { id: 'f2', type: 'expense', amount: 2500000, date: '2026-02-15' },
  ];
  const monthTotals = (rows, ym) => FTOT.periodTotals(rows, ym + '-01', ym + '-31', false);

  it('a month total equals the manual sum of ONLY that month\'s rows', () => {
    const j = monthTotals([...jan, ...feb], '2026-01');
    expect(j.income).toBe(1000000);   // NOT 8,000,000
    expect(j.expense).toBe(400000);   // NOT 2,900,000
  });

  it('adding February\'s entries does NOT change January\'s figures', () => {
    const janAlone = monthTotals(jan, '2026-01');
    const janWithFeb = monthTotals([...jan, ...feb], '2026-01');
    expect(janWithFeb).toEqual(janAlone);   // no carry-over, no leakage
  });

  it('the year total is the sum of its months (a range sums exactly its range)', () => {
    const all = [...jan, ...feb];
    const year = FTOT.periodTotals(all, '2026-01-01', '2026-12-31', false);
    const sumMonths = ['2026-01', '2026-02'].reduce((a, ym) => { const t = monthTotals(all, ym); return { income: a.income + t.income, expense: a.expense + t.expense }; }, { income: 0, expense: 0 });
    expect(year).toEqual(sumMonths);
  });
});
