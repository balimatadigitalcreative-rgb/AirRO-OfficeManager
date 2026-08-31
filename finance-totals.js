'use strict';
/*
 * SINGLE SOURCE OF TRUTH for period income/expense totals (Pemasukan / Pengeluaran).
 *
 * Both the Ringkasan (dashboard) KPIs and the Transaksi screen's summary derive their period totals
 * from THIS one reducer, so the two screens can never drift. It is a pure function — no I/O, no globals
 * — loaded as `window.FTOT` in the browser bundle AND require()d by the guard test, never duplicated.
 *
 * Semantics (identical to the long-standing computeStats P&L loop it replaced):
 *   • only rows whose business date falls in [start, end] count;
 *   • in the COMBINED ("Semua unit") view, inter-unit transfer legs are eliminated (internal trade is
 *     not company income/expense); a single-unit view keeps that unit's own leg;
 *   • "reference" rows (non-cash production-cost markers) DO count toward P&L income/expense — they are
 *     excluded only from CASH, which is a separate figure (see FS.cashOnHand).
 * Because the reducer is linear and the setoran/operasional split (FINSRC.entrySource) is total and
 * disjoint, periodTotals(all) === periodTotals(setoran) + periodTotals(operasional) — the exact
 * identity the Ringkasan-vs-Transaksi guard asserts.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // guard test (CommonJS)
  if (root) root.FTOT = api;                                                   // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  function periodTotals(entries, start, end, combined) {
    var income = 0, expense = 0;
    (entries || []).forEach(function (e) {
      if (!e || e.date < start || e.date > end) return;
      if (combined && e.interUnit) return;                 // internal leg — not company income/expense
      if (e.type === 'income') income += (+e.amount || 0);
      else expense += (+e.amount || 0);
    });
    return { income: income, expense: expense };
  }
  return { periodTotals: periodTotals };
});
