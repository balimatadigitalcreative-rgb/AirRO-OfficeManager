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
    // the route-fit bar of the board: every stop in plan order, coloured when it rides this rit
    var bar = p.rit.map(function (s) { return { qty: s.qty, fit: true }; }).concat(p.leftover.map(function (s) { return { qty: s.qty, fit: false }; }));
    return { fits: p.rit.length, used: p.used, leftoverGallons: p.leftoverGallons, estRits: p.estRits, unlocated: p.unlocated.length, bar: bar, total: bar.length };
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
    if (!o.stopId) return txnP.then(function (t) { return Object.assign({ txnId: t.id, done: true }, t.replay ? { replay: true } : {}); });
    return txnP.then(function (t) {
      var mark = { status: 'terkirim', transactionId: t.id };
      if (o.noLocationReason) mark.noLocationReason = o.noLocationReason;
      return api.markStop(o.stopId, mark).then(function () { return Object.assign({ txnId: t.id, done: true }, t.replay ? { replay: true } : {}); }, function (e) {
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
  // A write's clientRef, kept per action + target (stop / customer) until the save succeeds: leaving the
  // screen after a lost response (or reloading) and saving again sends the SAME ref, so the server
  // returns the row already saved instead of recording it twice. Same storage pattern as pendingSales.
  function refStore(storage, key) {
    var p = pendingSales(storage, key);
    return {
      take: function (slot) { var r = p.get(slot); if (!r) { r = newRef(); p.set(slot, r); } return r; },
      done: function (slot) { p.clear(slot); },
    };
  }
  // ATUR TITIK start: the old pin, else the phone's fix, else the warehouse (else central Bali) — a
  // fallback start is never a customer's place, so the screen asks for it to be moved before saving.
  function pinStart(o) {
    var x = o || {}; var c = x.cust || {}; var d = x.depot;
    if (typeof c.lat === 'number' && typeof c.lng === 'number') return { pin: { lat: c.lat, lng: c.lng }, fallback: false };
    if (x.device) return { pin: { lat: x.device.lat, lng: x.device.lng }, fallback: false };
    if (d && typeof d.lat === 'number' && typeof d.lng === 'number') return { pin: { lat: d.lat, lng: d.lng }, fallback: true };
    return { pin: { lat: -8.65, lng: 115.216 }, fallback: true };
  }
  // A sale for a customer who still has a pending stop today goes THROUGH that stop (so it is marked
  // delivered and not sold twice); null → a manual sale with no stop.
  function saleStopFor(o) {
    var x = o || {}; var c = x.customer || {};
    var v = boardView({ board: x.board, customers: [c], demand: x.demand });
    return v.pending.find(function (s) { return s.customerId === c.id; }) || null;
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
    var live = (transactions || []).filter(function (t) { return t.status !== 'void' && t.bonCounted !== false; });   // an archived (not counted) row is not part of Sisa Bon
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
  // BAYAR BON (3D-2): how this payment settles each open bon, oldest first (view only — the server keeps
  // the real balance).
  function settleBons(bons, pay) {
    var left = Math.max(0, Math.round(num(pay)));
    return (bons || []).map(function (b) { var a = Math.max(0, num(b.amount)); var paid = Math.min(left, a); left -= paid; return paid >= a && a > 0 ? 'lunas' : paid > 0 ? 'sebagian' : 'belum'; });
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
    var replace = o.payMethod === 'ganti_galon';   // a new gallon handed over (owner 2026-10-02): no money, no price needed
    var blocked = !replace && !price ? 'fld.dmgNoPrice' : (!held ? 'fld.dmgNoHeld' : '');
    return { total: replace ? 0 : qty * price, heldAfter: Math.max(0, held - qty), blocked: blocked, totalKey: replace ? 'fld.noMoney' : o.payMethod === 'bon' ? 'fld.toBon' : (o.payMethod === 'transfer' ? 'fld.transferred' : 'fld.cashIn') };
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
  function distM(a, b) {
    var R = 6371000, rad = function (x) { return (x * Math.PI) / 180; };
    var dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(dLng / 2), 2);
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }
  function pinMove(o) {
    var d = o && o.device; var p = o && o.pin;
    if (!hasPt(d) || !hasPt(p)) return { meters: null, far: false };
    var m = distM(d, p);
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

  // ── PLAN 3C: koreksi ──
  var PAY_ID = { lunas: 'Lunas', bon: 'Bon', transfer: 'Transfer', pelunasan: 'Pelunasan' };   // office records stay Indonesian
  function payOf(t) { var x = t || {}; if (x.method === 'pelunasan') return 'pelunasan'; if (x.method === 'bon') return 'bon'; return x.payMethod === 'transfer' ? 'transfer' : 'lunas'; }
  function isSaleRow(t) { return (t.kind || 'jual') === 'jual' && (t.method === 'lunas' || t.method === 'bon') && num(t.qty) > 0; }
  // What a driver may correct: a gallon sale (customer, count, pay method), a bon payment (its amount),
  // and — with the cancel right — any row. A damage charge can only be cancelled (spec 3.6).
  function koreksiOptions(t, can) {
    var c = can || {}; var x = t || {};
    if (!t || x.status === 'void' || x.voided) return [];
    var out = [];
    if (x.kind !== 'ganti_rugi' && c.correct) {
      if (isSaleRow(x)) out.push('pelanggan', 'jumlah', 'bayar');
      else if (x.method === 'pelunasan') out.push('nominal');
    }
    if (c.void) out.push('batal');
    return out;
  }
  // The FULL payload the server expects — it reads a missing gallon field as 0, so every field is sent,
  // with the one change applied. Gallons out follow the sold count (extra gallons out stay extra).
  function correctionBody(t, ch) {
    var x = ch || {};
    if (t.method === 'pelunasan') return { amount: Math.max(0, Math.round(num(x.amount))) };
    var b = { qty: num(t.qty), unitPrice: num(t.unitPriceLocked), gallonOut: num(t.gallonOut), gallonIn: num(t.gallonIn), method: t.method };
    if (x.qty != null) { var q = Math.max(0, Math.round(num(x.qty))); b.gallonOut = Math.max(0, b.gallonOut + (q - b.qty)); b.qty = q; }
    if (x.gallonIn != null) b.gallonIn = Math.max(0, Math.round(num(x.gallonIn)));
    if (x.pay) {
      b.method = x.pay === 'bon' ? 'bon' : 'lunas';
      b.payMethod = x.pay === 'bon' ? '' : x.pay === 'transfer' ? 'transfer' : 'tunai';
      if (x.pay === 'transfer' && x.photo && x.photo.id) b.proofPhotoId = x.photo.id;
    }
    return b;
  }
  function koreksiCheck(o) {
    var t = o.t || {}; var x = o.change || {};
    if (o.kind === 'jumlah') { var q = Math.round(num(x.qty)); if (q < 1) return 'fld.kQtyMin'; return q === num(t.qty) && Math.round(num(x.gallonIn)) === num(t.gallonIn) ? 'fld.kNoChange' : ''; }
    if (o.kind === 'bayar') { if (!x.pay || x.pay === payOf(t)) return 'fld.kNoChange'; return x.pay === 'transfer' && !o.preview && !(x.photo && x.photo.id) ? 'fld.kNeedTransferPhoto' : ''; }
    if (o.kind === 'nominal') { var a = Math.round(num(x.amount)); if (!(a > 0)) return 'fld.kAmountMin'; return a === num(t.amount) ? 'fld.kNoChange' : ''; }
    if (o.kind === 'pelanggan') return x.toId ? '' : 'fld.kPickCust';
    return '';
  }
  // The old approval inbox shows count and Lunas/Bon but not the pay method — a pay change is spelled out.
  function koreksiReason(kind, t, ch, text) {
    var s = String(text || '').trim();
    return kind === 'bayar' ? s + ' [cara bayar: ' + PAY_ID[payOf(t)] + ' → ' + PAY_ID[(ch || {}).pay] + ']' : s;
  }
  // KOREKSI (3D-2): the board's "struck-through → new" rows — gallon counts from the transaction itself,
  // money and both customers from the server's preview (the same calculation the approval applies).
  // Raw values; the screen words them.
  function koreksiImpact(o) {
    var x = o || {}; var t = x.t || {}; var ch = x.change || {}; var pv = x.pv; var rows = [];
    if (x.kind === 'batal') return [{ key: 'fld.ki_status', a: 'aktif', b: 'batal', type: 'status' }];
    if (x.kind === 'pelanggan') {
      if (!pv || !pv.fromCustomer || !pv.toCustomer) return [];
      [pv.fromCustomer, pv.toCustomer].forEach(function (c) {
        rows.push({ key: 'fld.ki_bonOf', name: c.name, a: num(c.sisaBonBefore), b: num(c.sisaBonAfter), type: 'rp' });
        rows.push({ key: 'fld.ki_galOf', name: c.name, a: num(c.gallonsBefore), b: num(c.gallonsAfter), type: 'n' });
      });
      return rows;
    }
    if (x.kind === 'jumlah') {
      if (num(ch.qty) !== num(t.qty)) rows.push({ key: 'fld.ki_out', a: num(t.qty), b: num(ch.qty), type: 'n' });
      if (num(ch.gallonIn) !== num(t.gallonIn)) rows.push({ key: 'fld.ki_back', a: num(t.gallonIn), b: num(ch.gallonIn), type: 'n' });
    }
    if (x.kind === 'bayar' && ch.pay && ch.pay !== payOf(t)) rows.push({ key: 'fld.ki_pay', a: payOf(t), b: ch.pay, type: 'pay' });
    if (pv && pv.oldAmount != null && num(pv.oldAmount) !== num(pv.newAmount)) rows.push({ key: 'fld.ki_bill', a: num(pv.oldAmount), b: num(pv.newAmount), type: 'rp' });
    if (pv && pv.oldSisaBon != null && num(pv.oldSisaBon) !== num(pv.newSisaBon)) rows.push({ key: 'fld.ki_bon', a: num(pv.oldSisaBon), b: num(pv.newSisaBon), type: 'rp' });
    return rows;
  }
  function nearCustomers(customers, pt, excludeId, n) {
    if (!hasPt(pt)) return [];
    return (customers || []).filter(function (c) { return c.id !== excludeId && hasPt(c); })
      .map(function (c) { return Object.assign({}, c, { meters: distM(pt, c) }); })
      .sort(function (a, b) { return a.meters - b.meters; }).slice(0, n || 5);
  }
  var RQ_STATUS = { pending: ['fld.rq_pending', 'info'], approved: ['fld.rq_approved', 'ok'], rejected: ['fld.rq_rejected', 'neg'], withdrawn: ['fld.rq_withdrawn', 'held'] };
  var RQ_KIND = { correction: 'fld.rk_correction', void: 'fld.rk_void', reassign: 'fld.rk_reassign' };
  function requestView(r) {
    var x = r || {}; var st = RQ_STATUS[x.status] || RQ_STATUS.pending; var lines = [];
    var cur = x.current || {}; var req = x.requested || {};
    if (x.kind === 'reassign') lines.push(['fld.rl_to', { name: x.toCustomerName || '—' }]);
    else if (x.kind === 'void') lines.push(['fld.rl_void', {}]);
    else {
      if (req.qty != null && cur.qty != null && num(req.qty) !== num(cur.qty)) lines.push(['fld.rl_qty', { a: num(cur.qty), b: num(req.qty) }]);
      var pa = payOf(cur); var pb = payOf({ method: req.method || cur.method, payMethod: req.payMethod != null ? req.payMethod : cur.payMethod });
      if (cur.method && cur.method !== 'pelunasan' && pa !== pb) lines.push(['fld.rl_pay', { a: pa, b: pb }]);
      if (req.amount != null && cur.amount != null && num(req.amount) !== num(cur.amount) && cur.method === 'pelunasan') lines.push(['fld.rl_amount', { a: num(cur.amount), b: num(req.amount) }]);
    }
    // the board's "from → to" box (3D-2): one row per change, raw values
    var changes = [];
    if (x.kind === 'reassign') changes.push({ key: 'fld.rc_cust', a: x.fromCustomerName || x.customerName || '—', b: x.toCustomerName || '—', type: 'text' });
    else if (x.kind === 'void') changes.push({ key: 'fld.rc_status', a: 'aktif', b: 'batal', type: 'status' });
    lines.forEach(function (l) {
      if (l[0] === 'fld.rl_qty') changes.push({ key: 'fld.rc_qty', a: l[1].a, b: l[1].b, type: 'n' });
      else if (l[0] === 'fld.rl_pay') changes.push({ key: 'fld.rc_pay', a: l[1].a, b: l[1].b, type: 'pay' });
      else if (l[0] === 'fld.rl_amount') changes.push({ key: 'fld.rc_amount', a: l[1].a, b: l[1].b, type: 'rp' });
    });
    return { statusKey: st[0], tone: st[1], kindKey: RQ_KIND[x.kind] || RQ_KIND.correction, lines: lines, changes: changes,
      canWithdraw: x.status === 'pending', canResubmit: x.status === 'rejected' || x.status === 'withdrawn',
      target: { transactionId: x.transactionId || (x.transactionIds || [])[0] || null, customerId: x.customerId || x.fromCustomerId || null } };
  }
  // KOREKSI SAYA (3D-2): the board's two segments.
  function koreksiTabs(list) { var l = list || []; return { wait: l.filter(function (r) { return r.status === 'pending'; }), done: l.filter(function (r) { return r.status !== 'pending'; }) }; }
  // After "Atur titik" was opened from another screen, that screen gets the customer's new point.
  function afterPin(back, custId, pt) {
    if (!back) return null;
    var withPt = function (c) { return c && c.id === custId ? Object.assign({}, c, { lat: pt.lat, lng: pt.lng }) : c; };
    var out = Object.assign({}, back);
    if (back.cust) out.cust = withPt(back.cust);
    if (back.preset) out.preset = withPt(back.preset);
    return out;
  }

  // SHEETS (3D): released after a pull — close past 120 px (or a quarter of a short sheet) or on a
  // flick (> 0.5 px/ms over at least 30 px); anything less springs back.
  function dragRelease(o) {
    var dy = Math.max(0, num(o.dy)); var ms = Math.max(1, num(o.ms)); var h = Math.max(1, num(o.height) || 600);
    if (dy >= Math.min(120, h * 0.25)) return 'close';
    return dy >= 30 && dy / ms > 0.5 ? 'close' : 'stay';
  }

  // TABS (3D, owner): a clear sideways swipe (≥ 60 px, 1.5× more sideways than up/down, under 700 ms)
  // moves one tab in the dock order; nothing past the first or last tab.
  function swipeTab(o) {
    var ax = Math.abs(num(o.dx)); var ay = Math.abs(num(o.dy));
    if (ax < 60 || ax < ay * 1.5 || num(o.ms) > 700) return null;
    var order = o.order || []; var i = order.indexOf(o.tab); if (i < 0) return null;
    var j = num(o.dx) < 0 ? i + 1 : i - 1;
    return j >= 0 && j < order.length ? order[j] : null;
  }
  // TABS (3D-2, M8): a swipe that starts within 20 px of the screen edge belongs to the phone (its own
  // back gesture) — never to the tab switch.
  function swipeStart(o) { var x = num((o || {}).x); var w = num((o || {}).width); return x >= 20 && (!(w > 0) || x <= w - 20); }
  // PENGIRIMAN (3D-2): share of the rit's load still on the truck, 0–100.
  function loadPct(remaining, out) { var o = num(out); if (!(o > 0)) return 0; return Math.max(0, Math.min(100, Math.round(100 * num(remaining) / o))); }

  return { fmtRp: fmtRp, fmtKm: fmtKm, gapsOf: gapsOf, boardView: boardView, runState: runState, runGauge: runGauge, loadPreview: loadPreview, salePreview: salePreview, saleBody: saleBody, canSaveSale: canSaveSale, recordSale: recordSale, closeCheck: closeCheck, newRef: newRef, customerList: customerList, openBons: openBons, payPreview: payPreview, ADJ_REASON_KEYS: ADJ_REASON_KEYS, adjustBody: adjustBody, damagePreview: damagePreview, expenseBody: expenseBody, pinMove: pinMove, addStopCandidates: addStopCandidates, pendingSales: pendingSales, stepInput: stepInput, refStore: refStore, pinStart: pinStart, saleStopFor: saleStopFor, payOf: payOf, koreksiOptions: koreksiOptions, correctionBody: correctionBody, koreksiCheck: koreksiCheck, koreksiReason: koreksiReason, nearCustomers: nearCustomers, requestView: requestView, afterPin: afterPin, distM: distM, dragRelease: dragRelease, settleBons: settleBons, koreksiImpact: koreksiImpact, koreksiTabs: koreksiTabs, swipeTab: swipeTab, swipeStart: swipeStart, loadPct: loadPct };
});
