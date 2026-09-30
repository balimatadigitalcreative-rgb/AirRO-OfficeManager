'use strict';
/*
 * LIVE REFRESH HELPERS for the Pengiriman board (PRESENTATION ONLY — no data is changed here).
 *
 * The board is refreshed by realtime events: every `distribusi` write by anyone in the company, plus
 * every tab focus and SSE reconnect. Handled naively that meant the list blanked to "Memuat…" and
 * came back several times a minute, and a route-sorted list snapped back to its saved order. These
 * three small pieces are what the screen uses to refresh IN PLACE instead:
 *   - orderByIds      re-apply a display order the user chose to freshly loaded rows;
 *   - createCoalescer collapse a burst of triggers into one run, without ever being starved;
 *   - createLatest    tag requests so a late response from an older one is dropped.
 *
 * Loaded as `window.DISTLIVE` in the browser bundle AND require()d by the server tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // tests (CommonJS)
  if (root) root.DISTLIVE = api;                                               // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  // Rows in the order of `ids`; rows the order does not know (added since it was computed) trail in
  // the order the server sent them. Never drops a row — the board must always show every stop.
  function orderByIds(rows, ids) {
    if (!ids || !ids.length || !rows) return rows;
    var byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    var seen = {};
    var out = [];
    ids.forEach(function (id) { if (byId[id] && !seen[id]) { seen[id] = true; out.push(byId[id]); } });
    rows.forEach(function (r) { if (!seen[r.id]) out.push(r); });
    return out;
  }

  // The first trigger schedules ONE run `waitMs` later; triggers before it fires join that run. The
  // timer is deliberately NOT reset by later triggers — a debounce would starve under a steady stream
  // of events (a busy office), and the driver would never see an update at all.
  function createCoalescer(fn, waitMs) {
    var timer = null;
    return {
      trigger: function () {
        if (timer) return;
        timer = setTimeout(function () { timer = null; fn(); }, waitMs);
      },
      cancel: function () { if (timer) { clearTimeout(timer); timer = null; } },
    };
  }

  function createLatest() {
    var seq = 0;
    return {
      next: function () { seq += 1; return seq; },
      isCurrent: function (token) { return token === seq; },
    };
  }

  return { orderByIds: orderByIds, createCoalescer: createCoalescer, createLatest: createLatest };
});
