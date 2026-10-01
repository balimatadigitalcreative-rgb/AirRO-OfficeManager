/*
 * MODE LAPANGAN — SCREEN LOGIC. Pure functions the day screens use (board order + warnings, rit
 * state/gauge/preview, sale preview + body, "save then mark delivered" without ever creating a sale
 * twice, close-day check). Isomorphic so every rule is tested in Node; no DOM, no server calls.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // tests (CommonJS)
  if (root) root.FIELDLOGIC = api;                                             // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';
  var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
  function fmtRp(n) { var v = Math.round(num(n)); return (v < 0 ? '−Rp ' : 'Rp ') + Math.abs(v).toLocaleString('id-ID'); }
  function fmtKm(n) { return (Math.round(num(n) * 10) / 10).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km'; }
  var hasPt = function (c) { return !!c && typeof c.lat === 'number' && typeof c.lng === 'number' && isFinite(c.lat) && isFinite(c.lng); };
  // Same rule as FIELDAPI.dataGaps (a test keeps them equal).
  function gapsOf(c) {
    var x = c || {};
    var titik = !(typeof x.lat === 'number' && typeof x.lng === 'number'); var wa = !String(x.phone || '').trim(); var foto = !x.locationPhotoId;
    return { titik: titik, wa: wa, foto: foto, count: (titik ? 1 : 0) + (wa ? 1 : 0) + (foto ? 1 : 0) };
  }

  // PENGIRIMAN — today's stops enriched for the screen. With an open rit's route, waiting stops follow
  // the route order (the "Berikutnya" card is its first leg); otherwise the board order.
  function boardView(input) {
    var i = input || {}; var custById = {}; var demand = i.demand || {};
    (i.customers || []).forEach(function (c) { custById[c.id] = c; });
    var legs = {}; ((i.route && i.route.rit) || []).forEach(function (l, idx) { legs[l.id] = { idx: idx, qty: l.qty, legKm: l.legKm }; });
    var stops = (i.board || []).map(function (s) {
      var c = custById[s.customerId] || {}; var leg = legs[s.id];
      return Object.assign({}, s, {
        gaps: gapsOf({ lat: s.lat, lng: s.lng, phone: s.phone, locationPhotoId: s.locationPhotoId }),
        gallonsHeld: c.gallonsHeld != null ? c.gallonsHeld : null,
        address: c.address || s.address || '',
        planQty: leg ? leg.qty : (s.qty > 0 ? s.qty : (demand[s.id] || 1)),
        routeIdx: leg ? leg.idx : null,
        legKm: leg ? leg.legKm : null,
      });
    });
    var bySeq = function (a, b) { return (a.seq || 0) - (b.seq || 0); };
    var pending = stops.filter(function (s) { return s.status === 'pending'; }).sort(function (a, b) {
      var ra = a.routeIdx == null ? Infinity : a.routeIdx; var rb = b.routeIdx == null ? Infinity : b.routeIdx;
      return ra !== rb ? ra - rb : bySeq(a, b);
    });
    var done = stops.filter(function (s) { return s.status === 'terkirim'; }).sort(bySeq);
    var held = stops.filter(function (s) { return s.status === 'ditunda' || s.status === 'batal'; }).sort(bySeq);
    var next = pending.find(function (s) { return hasPt(s) && (!i.route || s.routeIdx != null); }) || pending.find(hasPt) || null;
    var incompleteIds = {}; stops.forEach(function (s) { if (s.gaps.count > 0) incompleteIds[s.customerId] = true; });
    return {
      stops: stops, pending: pending, done: done, held: held, next: next,
      counts: { pending: pending.length, done: done.length, held: held.length },
      outsideRoute: pending.filter(function (s) { return !hasPt(s); }).length,
      incomplete: Object.keys(incompleteIds).length,
      outstanding: i.outstanding || [],
    };
  }

  // RIT — the armada's open rit (from the field context, any date, or today's list), whether it is a
  // stale one from an earlier day (must be closed first), and the number the next rit gets today.
  function runState(o) {
    var x = o || {}; var runs = x.runs || [];
    var open = x.openRun || runs.find(function (r) { return r.status === 'open'; }) || null;
    var todays = runs.filter(function (r) { return r.date === x.today; });
    var nextNo = todays.reduce(function (m, r) { return Math.max(m, r.runNo || 0); }, 0) + 1;
    return {
      open: open, stale: !!(open && open.date && open.date !== x.today), nextNo: nextNo,
      remaining: open ? Math.max(0, num(open.gallonsOut) - num(open.sold)) : 0, count: todays.length,
    };
  }
  // The new UI ALWAYS asks for a reason below the SOP (whatever the owner's switch); capacity is a hard cap.
  function runGauge(o) {
    var load = Math.max(0, Math.round(num(o.load))); var cap = Math.max(0, Math.round(num(o.capacity))); var min = Math.max(1, Math.round(num(o.minLoad) || 80));
    var over = cap > 0 && load > cap;
    return { load: load, under: load > 0 && load < min, over: over, atCap: cap > 0 && load === cap, max: cap || Math.max(min * 2, load), canOpen: load > 0 && !over };
  }
  function loadPreview(o) {
    if (!o || typeof o.planRit !== 'function' || !o.depot || !(o.load > 0)) return null;
    var p = o.planRit({ depot: o.depot, capacity: o.load, stops: o.stops || [] });
    return { fits: p.rit.length, used: p.used, leftoverGallons: p.leftoverGallons, estRits: p.estRits, unlocated: p.unlocated.length };
  }

  // TRANSAKSI — what the customer pays now and what their bon becomes.
  function salePreview(o) {
    var subtotal = Math.max(0, Math.round(num(o.qty))) * num(o.price); var bon = num(o.sisaBon);
    var isBon = o.method === 'bon';
    return { subtotal: subtotal, paidNow: isBon ? 0 : subtotal, sisaAfter: isBon ? bon + subtotal : bon, totalKey: isBon ? 'fld.paidNow' : (o.method === 'transfer' ? 'fld.transferred' : 'fld.cashIn') };
  }
  // A transfer sale is method 'lunas' + payMethod 'transfer' (server rule 3.3).
  function saleBody(o) {
    var qty = Math.max(0, Math.round(num(o.qty)));
    var b = { customerId: o.customerId, qty: qty, gallonOut: qty, gallonIn: Math.max(0, Math.round(num(o.gallonIn))), method: o.method === 'bon' ? 'bon' : 'lunas' };
    if (o.method === 'transfer') b.payMethod = 'transfer'; else if (o.method !== 'bon') b.payMethod = 'tunai';
    var ph = o.photo;
    if (ph && ph.id) {
      b.proofPhotoId = ph.id;
      if (ph.takenAt) b.proofTakenAt = String(ph.takenAt);
      if (typeof ph.lat === 'number' && isFinite(ph.lat) && typeof ph.lng === 'number' && isFinite(ph.lng)) { b.proofLat = ph.lat; b.proofLng = ph.lng; }
    }
    return b;
  }
  function canSaveSale(o) {
    if (!(num(o.qty) >= 1)) return 'fld.needQty';
    if (!o.photo || !o.photo.id) return 'fld.needPhoto';
    return '';
  }
  // Save the sale, then mark the stop delivered. A sale already saved (txnId) is NEVER created again:
  // only the marking is retried. POSITION_REQUIRED → { needReason } (the screen asks, then retries).
  function recordSale(api, o) {
    var txnP = o.txnId ? Promise.resolve({ id: o.txnId }) : api.createSale(o.body);
    return txnP.then(function (t) {
      var mark = { status: 'terkirim', transactionId: t.id };
      if (o.noLocationReason) mark.noLocationReason = o.noLocationReason;
      return api.markStop(o.stopId, mark).then(function () { return { txnId: t.id, done: true }; }, function (e) {
        var code = e && e.body && e.body.error && e.body.error.details && e.body.error.details.code;
        if (code === 'POSITION_REQUIRED') return { txnId: t.id, done: false, needReason: true };
        if (e && typeof e === 'object') e.txnId = t.id;
        throw e;
      });
    });
  }

  // TUTUP HARI — every stop still waiting needs a written reason.
  function closeCheck(pending, reasons) {
    var r = reasons || {};
    var missing = (pending || []).filter(function (s) { return !String(r[s.id] || '').trim(); }).map(function (s) { return s.id; });
    return { missing: missing, ok: missing.length === 0 };
  }

  return { fmtRp: fmtRp, fmtKm: fmtKm, gapsOf: gapsOf, boardView: boardView, runState: runState, runGauge: runGauge, loadPreview: loadPreview, salePreview: salePreview, saleBody: saleBody, canSaveSale: canSaveSale, recordSale: recordSale, closeCheck: closeCheck };
});
