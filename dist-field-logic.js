/*
 * MODE LAPANGAN — SCREEN LOGIC. Pure functions the day screens use (board order + warnings, rit
 * state/gauge/preview, sale preview + body, "save then mark delivered" without ever creating a sale
 * twice, close-day check). Isomorphic so every rule is tested in Node; no DOM, no server calls.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // tests (CommonJS)
  if (root) root.FIELDLOGIC = api;                                             // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (root) {
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
    if (o.clientRef) b.clientRef = String(o.clientRef);
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
    // A manual sale (from Catat, no stop): just create it — nothing to mark.
    if (!o.stopId) return txnP.then(function (t) { return { txnId: t.id, done: true }; });
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

  // A sale saved on the server whose stop could not yet be marked delivered: remembered per stop
  // (sessionStorage, per mode + user) so coming back to the stop — even after leaving the sale screen —
  // retries ONLY the marking instead of creating the sale a second time. Blocked storage → memory.
  function pendingSales(storage, key) {
    var mem = {}; var k = function (stopId) { return key + ':' + stopId; };
    return {
      get: function (stopId) { try { var v = storage.getItem(k(stopId)); if (v) return v; } catch (e) { /* blocked */ } return mem[stopId] || null; },
      set: function (stopId, txnId) { mem[stopId] = txnId; try { storage.setItem(k(stopId), txnId); } catch (e) { /* memory only */ } },
      clear: function (stopId) { delete mem[stopId]; try { storage.removeItem(k(stopId)); } catch (e) { /* memory only */ } },
    };
  }
  // A number field the driver may clear while typing: digits only; empty (or below the minimum) → no
  // value yet (the field keeps what was typed and clamps on blur); above the maximum → the maximum.
  function stepInput(text, lo, hi) {
    var d = String(text == null ? '' : text).replace(/[^0-9]/g, '').slice(0, 5);
    if (d === '') return { draft: '', value: null };
    var n = parseInt(d, 10);
    if (n > hi) return { draft: String(hi), value: hi };
    if (n < lo) return { draft: d, value: null };
    return { draft: d, value: n };
  }

  // ── PLAN 3B: customers + manual inputs ──
  function newRef() {
    var rnd = '';
    try { var a = new Uint32Array(2); (root && root.crypto ? root.crypto : globalThis.crypto).getRandomValues(a); rnd = a[0].toString(36) + a[1].toString(36); } catch (e) { rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
    return 'f' + Date.now().toString(36) + rnd;
  }
  // PELANGGAN — search (name, code, phone digits) + filter; counts for the filter chips.
  function customerList(customers, opt) {
    var o = opt || {}; var q = String(o.q || '').trim().toLowerCase(); var qd = q.replace(/[^0-9]/g, '');
    var base = (customers || []).filter(function (c) { return c.active !== false; }).map(function (c) { return Object.assign({}, c, { gaps: gapsOf(c) }); });
    var counts = { all: base.length, warn: 0, bon: 0, fixed: 0 };
    base.forEach(function (c) { if (c.gaps.count > 0) counts.warn += 1; if (num(c.sisaBon) > 0) counts.bon += 1; if (c.fixedDays) counts.fixed += 1; });
    var f = o.filter || 'all';
    var rows = base.filter(function (c) {
      if (f === 'warn' && !(c.gaps.count > 0)) return false;
      if (f === 'bon' && !(num(c.sisaBon) > 0)) return false;
      if (f === 'fixed' && !c.fixedDays) return false;
      if (!q) return true;
      var hay = (String(c.name || '') + ' ' + String(c.code || '')).toLowerCase();
      return hay.indexOf(q) >= 0 || (qd.length >= 3 && String(c.phone || '').replace(/[^0-9]/g, '').indexOf(qd) >= 0);
    }).sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'id'); });
    return { rows: rows, counts: counts };
  }
  // PEMBAYARAN BON — the open bons, oldest first, after the payments are allocated to the oldest (view only;
  // the server computes the real balance). A damage charge put on bon is a bon too.
  function openBons(transactions) {
    var live = (transactions || []).filter(function (t) { return t.status !== 'void'; });
    var bons = live.filter(function (t) { return t.method === 'bon'; }).map(function (t) { var amt = num(t.effectiveAmount != null ? t.effectiveAmount : t.amount); return { id: t.id, txnDate: t.txnDate, qty: num(t.qty), full: amt, amount: amt }; })
      .sort(function (a, b) { return String(a.txnDate).localeCompare(String(b.txnDate)); });
    var paid = live.filter(function (t) { return t.method === 'pelunasan'; }).reduce(function (s, t) { return s + num(t.amount); }, 0);
    bons.forEach(function (b) { var use = Math.min(paid, b.amount); b.amount -= use; paid -= use; });
    return bons.filter(function (b) { return b.amount > 0; }).map(function (b) { return { id: b.id, txnDate: b.txnDate, qty: b.qty, amount: b.amount, partial: b.amount < b.full }; });
  }
  function payPreview(o) {
    var bon = Math.max(0, num(o.sisaBon)); var pay = Math.max(0, Math.round(num(o.pay)));
    return { rest: Math.max(0, bon - pay), over: Math.max(0, pay - bon), ok: pay > 0 && pay <= bon };
  }
  // PENYESUAIAN — the words the driver picked map to the server's reason list; the words stay in the note.
  var ADJ_REASON_KEYS = [['fld.adj_hitung', 'rekonsiliasi_fisik'], ['fld.adj_hilang', 'galon_pecah_hilang'], ['fld.adj_kembali', 'rekonsiliasi_fisik'], ['fld.adj_salah', 'salah_input'], ['fld.r_other', 'lainnya']];
  function adjustBody(o) {
    var map = {}; ADJ_REASON_KEYS.forEach(function (p) { map[p[0]] = p[1]; });
    var note = [String(o.reasonLabel || '').trim(), String(o.note || '').trim()].filter(Boolean).join(' · ');
    var b = { value: Math.max(0, Math.round(num(o.counted))), reason: map[o.reasonKey] || 'lainnya', note: note };
    if (o.photo && o.photo.id) b.evidenceUrl = o.photo.id;
    return b;
  }
  // GANTI RUGI — explain (no price yet / no gallons at the customer) instead of failing on the server.
  function damagePreview(o) {
    var qty = Math.max(0, Math.round(num(o.qty))); var price = Math.max(0, num(o.price)); var held = Math.max(0, Math.round(num(o.held)));
    var blocked = !price ? 'fld.dmgNoPrice' : (!held ? 'fld.dmgNoHeld' : '');
    return { total: qty * price, heldAfter: Math.max(0, held - qty), blocked: blocked, totalKey: o.payMethod === 'bon' ? 'fld.toBon' : (o.payMethod === 'transfer' ? 'fld.transferred' : 'fld.cashIn') };
  }
  // PENGELUARAN — always cash from the deposit (the adaptor forces it); fuel litres + odometer into the note.
  function expenseBody(o) {
    var parts = [];
    if (o.category === 'bensin') {
      if (String(o.liters || '').trim()) parts.push(String(o.liters).trim() + ' L');
      if (String(o.odometer || '').trim()) parts.push('odometer ' + String(o.odometer).trim() + ' km');
    }
    if (String(o.note || '').trim()) parts.push(String(o.note).trim());
    var e = { amount: Math.max(0, Math.round(num(o.amount))), category: String(o.category || ''), note: parts.join(' · ').slice(0, 300) };
    if (o.photo && o.photo.id) e.photoId = o.photo.id;
    return e;
  }
  // ATUR TITIK — how far the pin is from where the phone is; > 150 m asks the driver to confirm.
  function pinMove(o) {
    var d = o && o.device; var p = o && o.pin;
    if (!hasPt(d) || !hasPt(p)) return { meters: null, far: false };
    var R = 6371000, rad = function (x) { return (x * Math.PI) / 180; };
    var dLat = rad(p.lat - d.lat), dLng = rad(p.lng - d.lng);
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(rad(d.lat)) * Math.cos(rad(p.lat)) * Math.pow(Math.sin(dLng / 2), 2);
    var m = Math.round(2 * R * Math.asin(Math.sqrt(h)));
    return { meters: m, far: m > 150 };
  }
  // TAMBAH STOP — today's stops that have no pin (fill it to put them on the route), and the active
  // customers not on today's board yet (searchable) to add as an extra stop.
  function addStopCandidates(o) {
    var board = o.board || []; var onBoard = {}; board.forEach(function (s) { onBoard[s.customerId] = true; });
    var noPin = board.filter(function (s) { return s.status === 'pending' && !hasPt(s); });
    var others = customerList((o.customers || []).filter(function (c) { return !onBoard[c.id]; }), { q: o.q, filter: 'all' }).rows;
    return { noPin: noPin, others: others };
  }

  // TUTUP HARI — every stop still waiting needs a written reason.
  function closeCheck(pending, reasons) {
    var r = reasons || {};
    var missing = (pending || []).filter(function (s) { return !String(r[s.id] || '').trim(); }).map(function (s) { return s.id; });
    return { missing: missing, ok: missing.length === 0 };
  }

  return { fmtRp: fmtRp, fmtKm: fmtKm, gapsOf: gapsOf, boardView: boardView, runState: runState, runGauge: runGauge, loadPreview: loadPreview, salePreview: salePreview, saleBody: saleBody, canSaveSale: canSaveSale, recordSale: recordSale, closeCheck: closeCheck, newRef: newRef, customerList: customerList, openBons: openBons, payPreview: payPreview, ADJ_REASON_KEYS: ADJ_REASON_KEYS, adjustBody: adjustBody, damagePreview: damagePreview, expenseBody: expenseBody, pinMove: pinMove, addStopCandidates: addStopCandidates, pendingSales: pendingSales, stepInput: stepInput };
});
