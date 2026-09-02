'use strict';
// GROSS-PROFIT LADDER — the shared cost classifier (FCLS) that the Summary ladder, the 12-month trend
// and the Transaksi tabs all use. Asserts: Income is NEVER netted (Penjualan = gross revenue); the
// expense splits into Produksi + Operasional + Lain that sum to the old single Expense; and the ladder
// reconciles: Penjualan − Produksi − Operasional − Lain == Laba bersih. (The "Penjualan == P&L revenue"
// half is pinned server-side in pnl-month-isolation.test.js: cash-book income == incomeStatement.revenue.)
const FCLS = require('../../finance-cost-class.js');

// A representative period: setoran income + setoran mfg cost + hand-entered production + opex + an
// inter-unit expense leg (Lain).
const book = [
  { id: 'stinc-2026-08-01', type: 'income', amount: 52052000, setoranDay: '2026-08-01' },   // Penjualan
  { id: 'stmfg-2026-08-01', type: 'expense', amount: 30000000, setoranMfg: '2026-08-01' },   // Biaya produksi (auto)
  { id: 'e1', type: 'expense', amount: 600000, category: 'Supplies' },                        // production category → produksi
  { id: 'e2', type: 'expense', amount: 17248257, category: 'Fuel' },                          // operasional
  { id: 'e3', type: 'expense', amount: 250000, category: 'Utilities' },                       // operasional
  { id: 'e4', type: 'expense', amount: 100000, interUnit: true },                             // lain (inter-unit leg)
];
const prodCats = FCLS.buildProdCats({ expense: [{ key: 'Supplies', label: 'Supplies' }, { key: 'Fuel', label: 'Fuel' }, { key: 'Utilities', label: 'Utilities' }] });

describe('FCLS — gross-profit split', () => {
  it('classifies rows into penjualan / produksi / operasional / lain', () => {
    expect(FCLS.classify(book[0], prodCats)).toBe('penjualan');   // income
    expect(FCLS.classify(book[1], prodCats)).toBe('produksi');    // setoran mfg
    expect(FCLS.classify(book[2], prodCats)).toBe('produksi');    // Supplies (production category)
    expect(FCLS.classify(book[3], prodCats)).toBe('operasional'); // Fuel
    expect(FCLS.classify(book[4], prodCats)).toBe('operasional'); // Utilities
    expect(FCLS.classify(book[5], prodCats)).toBe('lain');        // inter-unit leg
  });

  it('Income stays GROSS — Penjualan is the full revenue, never netted', () => {
    const s = FCLS.split(book, prodCats);
    expect(s.penjualan).toBe(52052000);   // NOT revenue − COGS
  });

  it('the ladder reconciles: Penjualan − Produksi − Operasional − Lain == Laba bersih', () => {
    const s = FCLS.split(book, prodCats);
    expect(s.produksi).toBe(30600000);           // 30.000.000 + 600.000
    expect(s.operasional).toBe(17498257);        // 17.248.257 + 250.000
    expect(s.lain).toBe(100000);
    expect(s.labaKotor).toBe(s.penjualan - s.produksi);
    expect(s.labaBersih).toBe(s.penjualan - s.produksi - s.operasional - s.lain);
    expect(s.labaBersih).toBe(3853743);
  });

  it('the three expense components sum to the old single Expense figure', () => {
    const s = FCLS.split(book, prodCats);
    const oldExpense = book.filter((e) => e.type === 'expense').reduce((a, e) => a + e.amount, 0);
    expect(s.produksi + s.operasional + s.lain).toBe(oldExpense);
  });

  it('each line drill-down total equals the line (same classifier)', () => {
    const s = FCLS.split(book, prodCats);
    const of = (k) => book.filter((e) => FCLS.classify(e, prodCats) === k).reduce((a, e) => a + e.amount, 0);
    expect(of('penjualan')).toBe(s.penjualan);
    expect(of('produksi')).toBe(s.produksi);
    expect(of('operasional')).toBe(s.operasional);
    expect(of('lain')).toBe(s.lain);
  });
});
