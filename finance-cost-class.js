'use strict';
/*
 * SINGLE SOURCE OF TRUTH for the gross-profit split (Penjualan / Biaya produksi / Beban operasional).
 *
 * The Summary ladder, the 12-month trend and the Transaksi tabs all classify a cash-book row through
 * THIS one helper — never duplicated — so the two screens speak one language. It PARTITIONS the same
 * cash-book figures the Summary already shows (so nothing nets out of Income and the parts sum to the
 * old totals): Income stays gross Penjualan; Expense splits into Produksi (HPP) + Operasional + Lain.
 *
 *   penjualan   = every income row (revenue — gross, never reduced by cost). == P&L revenue by parity.
 *   produksi    = production cost (HPP): the auto-posted setoran manufacturing row (stmfg-/setoranMfg)
 *                 + expenses whose category is a production category (Bottling/Supplies/Produksi/…).
 *   operasional = everything else the owner enters (opex).
 *   lain        = an expense that fits neither cleanly (currently an inter-unit leg) — shown as its own
 *                 line, never forced into produksi or operasional.
 *
 * Loaded as window.FCLS in the browser bundle AND require()d by the guard test. `labaKotor` and
 * `labaBersih` are derived (Penjualan − Produksi; − Operasional − Lain), so the ladder always reconciles.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // guard test (CommonJS)
  if (root) root.FCLS = api;                                                    // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  // Production categories — the SAME regex the setoran manufacturing-cost row uses (finance-shell), so
  // the daily production cost and hand-entered production expenses classify identically.
  var PROD_CAT_RE = /supplies|produksi|pabrik|bottling|manufakt|hpp|penyusutan produksi|kerugian galon|galon\s*(pecah|hilang|rusak)/i;
  function isProdCatLabel(s) { return PROD_CAT_RE.test(String(s == null ? '' : s)); }
  // Build the production-category KEY set from the app's category definitions (cats.expense[]).
  function buildProdCats(cats) {
    var out = {}; var list = (cats && cats.expense) || [];
    for (var i = 0; i < list.length; i++) { var c = list[i]; if (isProdCatLabel((c.label || '') + ' ' + (c.key || ''))) out[c.key] = true; }
    return out;
  }
  function isSetoranMfg(e) { return !!(e && (e.setoranMfg || (typeof e.id === 'string' && e.id.indexOf('stmfg-') === 0))); }
  // TOTAL classifier over cash-book rows → penjualan | produksi | operasional | lain.
  function classify(e, prodCats) {
    if (!e) return 'operasional';
    if (e.type === 'income') return 'penjualan';
    if (isSetoranMfg(e)) return 'produksi';
    if (e.interUnit) return 'lain';
    if (e.category && prodCats && prodCats[e.category]) return 'produksi';
    if (isProdCatLabel(e.category)) return 'produksi';   // fallback when no cats set was supplied
    return 'operasional';
  }
  // Sum a set of rows into the ladder. `prodCats` optional (buildProdCats). Returns every ladder figure.
  function split(entries, prodCats) {
    var t = { penjualan: 0, produksi: 0, operasional: 0, lain: 0 };
    (entries || []).forEach(function (e) { t[classify(e, prodCats)] += (+e.amount || 0); });
    t.labaKotor = t.penjualan - t.produksi;
    t.labaBersih = t.penjualan - t.produksi - t.operasional - t.lain;
    return t;
  }
  return { classify: classify, split: split, buildProdCats: buildProdCats, isProdCatLabel: isProdCatLabel, PROD_CAT_RE: PROD_CAT_RE };
});
