'use strict';
/*
 * SINGLE SOURCE OF TRUTH for the finance "Transaksi" split (PRESENTATION ONLY).
 *
 * The cash book the app reads is `[...setoranEntries, ...realEntries]` (see finance-shell.jsx):
 *   • SETORAN rows are DERIVED in-memory from the distribution deposit flow (the Setoran table).
 *     They are never persisted as Entry rows; they carry a setoranDay/setoranMfg tag and a reserved
 *     id prefix (stinc-/stmfg-<day>).
 *   • Everything else is OPERASIONAL — the owner's own bookkeeping (persisted Entry rows).
 *
 * This module is the ONE place that decides which side a row is on. It is loaded as `window.FINSRC`
 * in the browser bundle AND require()d by the server (entry.service classifies + guards with it), so
 * the predicate is never duplicated. Splitting is display-only: the same rows post the same journals
 * and feed the same reports and balances — `entrySource` is a TOTAL binary classifier, so the union
 * of setoran + operasional is ALWAYS exactly the full list (nothing is hidden or double-counted).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // server (CommonJS)
  if (root) root.FINSRC = api;                                                 // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  // A row is a setoran (distribution-deposit) row iff it carries a setoran tag or the reserved
  // derived id prefix. Persisted rows may (defensively) carry the tag inside their meta JSON.
  function isSetoranEntry(e) {
    if (!e) return false;
    if (e.setoranDay || e.setoranMfg) return true;
    if (typeof e.id === 'string' && /^st(inc|mfg)-/.test(e.id)) return true;
    if (e.meta) {
      try { var m = typeof e.meta === 'string' ? JSON.parse(e.meta) : e.meta; if (m && (m.setoranDay || m.setoranMfg)) return true; } catch (x) { /* opaque meta */ }
    }
    return false;
  }

  // TOTAL binary classifier → union(setoran, operasional) === all rows, unconditionally.
  function entrySource(e) { return isSetoranEntry(e) ? 'setoran' : 'operasional'; }

  // Orthogonal flag (does NOT change the tab bucket): an operasional row that is not the owner's own
  // hand-entered bookkeeping — currently an inter-unit transfer leg. It stays in Operasional/Semua and
  // in every total, but the UI badges it "sumber lain" so it is never SILENTLY mixed into bookkeeping.
  function isOtherSource(e) { return !!(e && e.interUnit); }

  var TABS = ['semua', 'setoran', 'operasional'];
  function normalizeTab(t) { t = String(t == null ? '' : t).toLowerCase(); return TABS.indexOf(t) >= 0 ? t : null; }
  function inTab(e, tab) { return tab === 'semua' || entrySource(e) === tab; }

  return { isSetoranEntry: isSetoranEntry, entrySource: entrySource, isOtherSource: isOtherSource, TABS: TABS, normalizeTab: normalizeTab, inTab: inTab };
});
