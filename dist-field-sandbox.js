/*
 * MODE LATIHAN ENGINE — the new field UI's practice mode. It works on a COPY of real data taken once
 * (the field adaptor's snapshot) and mirrors the server's field rules (SOP muatan, kapasitas armada, foto wajib,
 * alasan tunda/batal, sisa bon, galon di pelanggan, ganti rugi, satu rit terbuka, satu pengajuan per
 * transaksi, tutup hari) so practice feels real — but it NEVER talks to the server: everything stays in
 * this object and is persisted by the caller (IndexedDB on the phone). Same method names and result
 * shapes as the real (server) adaptor so every screen works unchanged in both modes. Every result is a copy.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // tests (CommonJS)
  if (root) root.FIELDSANDBOX = api;                                           // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (root) {
  'use strict';
  var VERSION = 2;   // 2: photos kept apart from the state (Plan 3A)
  var clone = function (x) { return x == null ? x : JSON.parse(JSON.stringify(x)); };
  var int = function (v) { var n = Math.round(Number(v)); return isFinite(n) ? n : 0; };
  // Errors look like the server's: e.status + e.body.error.{message, details.code}.
  function fail(status, message, code, extra) {
    var e = new Error(message); e.status = status; e.latihan = true;
    e.body = { error: { message: message, details: Object.assign(code ? { code: code } : {}, extra || {}) } };
    return e;
  }
  var hasPt = function (c) { return !!c && typeof c.lat === 'number' && typeof c.lng === 'number' && isFinite(c.lat) && isFinite(c.lng); };
  // Same as the server's normalizePhone: stored as "08…".
  var phone08 = function (p) { var d = String(p || '').replace(/[^0-9]/g, ''); if (d.indexOf('62') === 0) d = '0' + d.slice(2); else if (d.charAt(0) === '8') d = '0' + d; return d; };
  var ADJ_REASONS = ['rekonsiliasi_fisik', 'salah_input', 'galon_pecah_hilang', 'penghapusan_piutang', 'selisih_staf', 'lainnya'];

  function fromSnapshot(snap, meta) {
    var s = snap || {}; var ctx = s.context || {};
    var boardBon = {}; (s.board || []).forEach(function (st) { if (st.sisaBon != null) boardBon[st.customerId] = st.sisaBon; });
    var customers = {};
    (s.customers || []).forEach(function (c) {
      customers[c.id] = {
        id: c.id, name: c.name || '', code: c.code || '', phone: c.phone || '', address: c.address || '', armada: c.armada || '',
        masterPrice: int(c.masterPrice), lat: c.lat != null ? c.lat : null, lng: c.lng != null ? c.lng : null,
        locationPhotoId: c.locationPhotoId || null, deliveryDays: c.deliveryDays || [], fixedDays: !!c.fixedDays,
        active: c.active !== false, sisaBon: c.sisaBon != null ? int(c.sisaBon) : int(boardBon[c.id]), gallonsHeld: int(c.gallonsHeld),   // null = outside the read window → the board's
      };
    });
    (s.board || []).forEach(function (st) {   // a board stop whose customer was not in the list still works
      if (!customers[st.customerId]) customers[st.customerId] = { id: st.customerId, name: st.customerName || '', code: st.customerCode || '', phone: st.phone || '', address: '', armada: st.fleetId || '', masterPrice: int(st.masterPrice), lat: st.lat != null ? st.lat : null, lng: st.lng != null ? st.lng : null, locationPhotoId: st.locationPhotoId || null, deliveryDays: st.deliveryDays || [], fixedDays: false, active: true, sisaBon: int(st.sisaBon), gallonsHeld: 0 };
    });
    return {
      v: VERSION, key: (meta && meta.key) || '', createdAt: new Date().toISOString(),
      date: ctx.today, fleet: ctx.fleet || '', fleets: ctx.fleets || [], rules: clone(ctx.rules) || {}, depot: ctx.depot || null, demand: clone(ctx.demand) || {},
      customers: customers,
      stops: (s.board || []).map(function (st) { return { id: st.id, date: st.date, fleetId: st.fleetId, customerId: st.customerId, source: st.source || 'jadwal', seq: int(st.seq), pinned: !!st.pinned, status: st.status || 'pending', qty: st.qty != null ? st.qty : null, note: st.note || '', pendingReason: st.pendingReason || '', transactionId: st.transactionId || null }; }),
      // The armada's open rit from an earlier day (field context) comes along: it blocks a new rit, as on the server.
      outstanding: clone(s.outstanding) || [],
      runs: (s.runs || []).concat(ctx.openRun && !(s.runs || []).some(function (r) { return r.id === ctx.openRun.id; }) ? [ctx.openRun] : []).map(function (r) { return { id: r.id, date: r.date, fleetId: r.fleetId, runNo: int(r.runNo), gallonsOut: int(r.gallonsOut), gallonsFullReturned: int(r.gallonsFullReturned), gallonsEmptyReturned: int(r.gallonsEmptyReturned), status: r.status || 'open', underSopReason: r.underSopReason || '', diffReason: r.diffReason || '', sold: int(r.sold) }; }),
      txns: [], expenses: [], requests: clone(s.myRequests) || [], adjustments: [], photos: {}, closeouts: [], seq: 1,
    };
  }

  function createSandbox(state, opts) {
    var s = state; var o = opts || {};
    var planRit = o.planRit || (root && root.RITPLAN && root.RITPLAN.planRit);
    var now = o.now || function () { return new Date(); };
    var changed = o.onChange || function () {};
    var photoStore = o.photoStore || null;
    var WROTE = {};   // sentinel: a method that changed the state returns { w: WROTE, v: result }
    var W = function (v) { return { w: WROTE, v: v }; };
    function run(fn) {
      return function () {
        try {
          var r = fn.apply(null, arguments);
          if (r && r.w === WROTE) { changed(s); r = r.v; }
          return Promise.resolve(clone(r));
        } catch (e) { return Promise.reject(e); }
      };
    }
    var nid = function (p) { return 'lat-' + p + '-' + (s.seq++); };
    var rules = function () { return s.rules || {}; };
    var cust = function (cid) { var c = s.customers[cid]; if (!c) throw fail(404, 'Pelanggan tidak ditemukan.'); return c; };
    var stopOf = function (id) { var st = s.stops.find(function (x) { return x.id === id; }); if (!st) throw fail(404, 'Pengiriman tidak ditemukan.'); return st; };
    var photoOk = function (id) { return !!(id && s.photos[id]); };
    var openRunOf = function () { return s.runs.find(function (r) { return r.fleetId === s.fleet && r.status === 'open'; }) || null; };
    function stopView(st) {
      var c = s.customers[st.customerId] || {};
      return Object.assign({}, st, { customerName: c.name || '', customerCode: c.code || '', phone: c.phone || '', masterPrice: c.masterPrice || 0, sisaBon: c.sisaBon || 0, lat: c.lat, lng: c.lng, hasLocation: hasPt(c), locationPhotoId: c.locationPhotoId || null, deliveryDays: c.deliveryDays || [], armada: c.armada || '' });
    }
    function custView(c) { return Object.assign({}, c, { hasLocation: hasPt(c) }); }
    // Same as the server's proofColumns: missing → PROOF_REQUIRED only when the rule is on; an id that
    // was never uploaded → PROOF_MISSING.
    function proof(body, ruleKey) {
      var id = body.proofPhotoId || '';
      if (!id) { if (rules()[ruleKey]) throw fail(400, 'Foto bukti wajib dilampirkan.', 'PROOF_REQUIRED'); return {}; }
      if (!photoOk(id)) throw fail(400, 'Foto bukti tidak ditemukan — unggah ulang fotonya.', 'PROOF_MISSING');
      return { proofPhotoId: id, proofTakenAt: body.proofTakenAt || null, proofLat: body.proofLat != null ? +body.proofLat : null, proofLng: body.proofLng != null ? +body.proofLng : null };
    }
    function pushTxn(t) { t.id = nid('txn'); t.status = 'active'; t.createdAt = now().getTime(); t.txnDate = t.txnDate || s.date; t.fleetId = t.fleetId || s.fleet; s.txns.push(t); return t; }
    function pushRequest(t, kind, body) {
      var b = body || {};
      if (!String(b.reason || '').trim()) throw fail(400, 'Alasan wajib diisi.');
      if (s.requests.some(function (r) { return r.transactionId === t.id && r.status === 'pending'; })) throw fail(400, 'Sudah ada pengajuan menunggu persetujuan untuk transaksi ini.');
      var payload = Object.assign({}, b); delete payload.reason;
      var r = { id: nid('req'), transactionId: t.id, kind: kind, status: 'pending', reason: String(b.reason), payload: payload, createdAt: now().getTime(), decisionNote: '' };
      s.requests.push(r); return r;
    }
    // IDEMPOTENCY (like the server): a write retried with the same clientRef returns the saved row.
    function replay(ref, customerId) {
      if (!ref) return null;
      var t = s.txns.find(function (x) { return x.clientRef === ref; });
      if (!t) return null;
      if (t.customerId !== customerId) throw fail(409, 'Kode transaksi ini sudah dipakai untuk pelanggan lain.');
      var c = s.customers[customerId];
      return { txn: t, gallonsHeld: c.gallonsHeld, sisaBon: c.sisaBon };
    }
    var txnOf = function (id) { var t = s.txns.find(function (x) { return x.id === id; }); if (!t) throw fail(404, 'Transaction not found'); if (t.status === 'void') throw fail(400, 'Transaksi ini sudah dibatalkan.'); return t; };

    var api = {
      mode: 'latihan',
      // Like the server's field context: the armada's open rit (any date) with what it has sold so far.
      context: run(function () {
        var ru = openRunOf();
        var openRun = ru ? Object.assign({}, ru, { expectedRemaining: ru.gallonsOut - ru.sold }) : null;
        return { today: s.date, fleet: s.fleet, fleets: s.fleets, rules: s.rules, depot: s.depot, demand: s.demand, openRun: openRun, galonNeedsApproval: true };   // practice adjustments always wait
      }),
      board: run(function () { return s.stops.filter(function (st) { return st.date === s.date; }).sort(function (a, b) { return a.seq - b.seq; }).map(stopView); }),
      customers: run(function () { return Object.keys(s.customers).map(function (k) { return custView(s.customers[k]); }); }),
      customerDetail: run(function (id) {
        var c = cust(id);
        // newest first by RECORDING order (two writes in the same millisecond must not swap)
        var txns = s.txns.filter(function (t) { return t.customerId === id; }).slice().reverse()
          .map(function (t) { return { id: t.id, txnDate: t.txnDate, method: t.method, kind: t.kind, qty: t.qty, amount: t.amount, effectiveAmount: t.amount, status: t.status, payMethod: t.payMethod, createdAt: t.createdAt }; });
        return Object.assign(custView(c), { transactions: txns });
      }),
      runs: run(function () { return s.runs.filter(function (r) { return r.date === s.date && r.fleetId === s.fleet; }); }),
      myChangeRequests: run(function () { return s.requests.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }); }),

      // Same rules as the server's markDelivery: four statuses; a hold always needs a reason, a
      // cancel needs one when the owner's switch is on; back to pending clears it.
      markStop: run(function (id, body) {
        var st = stopOf(id); var b = body || {};
        var status = ['pending', 'terkirim', 'ditunda', 'batal'].indexOf(b.status) >= 0 ? b.status : '';
        if (!status) throw fail(400, 'Status pengiriman tidak dikenal.');
        var reason = String(b.reason || '').trim().slice(0, 300);
        if (status === 'ditunda' && !reason) throw fail(400, 'Alasan tunda wajib diisi.', 'REASON_REQUIRED');
        if (status === 'batal' && !reason && rules().wajibAlasanBatal) throw fail(400, 'Alasan batal wajib diisi.', 'REASON_REQUIRED');
        st.status = status;
        if (status === 'pending') st.pendingReason = '';
        if (status === 'ditunda' || status === 'batal') st.pendingReason = reason;
        if (b.transactionId) st.transactionId = b.transactionId;
        return W(stopView(st));
      }),
      holdStop: function (id, reason) { return api.markStop(id, { status: 'ditunda', reason: reason }); },
      cancelStop: function (id, reason) { return api.markStop(id, { status: 'batal', reason: reason }); },
      outstanding: run(function () { return s.outstanding || []; }),

      createSale: run(function (body) {
        var b = body || {}; var c = cust(b.customerId);
        var rp = replay(b.clientRef, c.id); if (rp) return Object.assign({}, rp.txn, { sisaBon: rp.sisaBon, gallonsHeld: rp.gallonsHeld, replay: true });
        if (!c.active) throw fail(400, 'Pelanggan nonaktif — aktifkan kembali untuk transaksi baru.');
        var method = b.method === 'bon' ? 'bon' : 'lunas';
        var qty = int(b.qty); if (qty <= 0) throw fail(400, 'Jumlah galon harus lebih dari 0.');
        var pr = proof(b, 'wajibFotoTransaksi');
        var amount = qty * c.masterPrice;
        var out = b.gallonOut != null ? Math.max(0, int(b.gallonOut)) : qty; var inn = Math.max(0, int(b.gallonIn));
        var ro = openRunOf();
        var t = pushTxn(Object.assign({ clientRef: b.clientRef || null, customerId: c.id, qty: qty, unitPriceLocked: c.masterPrice, amount: amount, method: method, payMethod: method === 'bon' ? '' : (b.payMethod === 'transfer' ? 'transfer' : 'tunai'), kind: 'jual', gallonQty: 0, gallonOut: out, gallonIn: inn, deliveryRunId: ro ? ro.id : null, note: String(b.note || '') }, pr));
        if (ro) ro.sold += qty;
        c.gallonsHeld += out - inn; if (method === 'bon') c.sisaBon += amount;
        return W(Object.assign({}, t, { sisaBon: c.sisaBon, gallonsHeld: c.gallonsHeld }));
      }),
      payBon: run(function (body) {
        var b = body || {}; var c = cust(b.customerId);
        var rp = replay(b.clientRef, c.id); if (rp) return Object.assign({}, rp.txn, { sisaBon: rp.sisaBon, gallonsHeld: rp.gallonsHeld, isPayment: true, replay: true });
        var amt = int(b.payAmount); if (amt <= 0) throw fail(400, 'Jumlah pembayaran harus lebih dari 0.');
        if (c.sisaBon <= 0) throw fail(400, 'Pelanggan ini tidak punya sisa bon.');
        if (amt > c.sisaBon) throw fail(400, 'Pembayaran (' + amt + ') melebihi sisa bon (' + c.sisaBon + ').', null, { sisaBon: c.sisaBon });
        var pr = proof(b, 'wajibFotoTransaksi');
        var t = pushTxn(Object.assign({ clientRef: b.clientRef || null, customerId: c.id, qty: 0, unitPriceLocked: 0, amount: amt, method: 'pelunasan', payMethod: b.payMethod === 'transfer' ? 'transfer' : 'tunai', kind: 'jual', gallonQty: 0, gallonOut: 0, gallonIn: 0, note: String(b.note || '') }, pr));
        c.sisaBon -= amt;
        return W(Object.assign({}, t, { sisaBon: c.sisaBon, gallonsHeld: c.gallonsHeld, isPayment: true }));
      }),

      openRun: run(function (body) {
        var b = body || {}; var out = int(b.gallonsOut);
        if (out <= 0) throw fail(400, 'Jumlah galon dimuat harus lebih dari 0.');
        var r = rules(); var cap = int((r.fleetCapacity || {})[s.fleet]) || 0;
        if (cap && out > cap) throw fail(400, 'Muatan ' + out + ' galon melebihi kapasitas armada ' + s.fleet + ' (' + cap + ' galon).', 'OVER_CAPACITY', { capacity: cap });
        var sop = r.ritSop || {}; var minLoad = sop.minLoad || 80;
        var reason = String(b.underSopReason || '').trim().slice(0, 300);
        var under = !!sop.enabled && out < minLoad;
        if (under && !reason) throw fail(400, 'Muatan di bawah SOP (minimal ' + minLoad + ' galon) — isi alasannya.', 'UNDER_SOP', { minLoad: minLoad });
        var existing = openRunOf();
        if (existing) throw fail(400, 'Masih ada rit terbuka (rit-' + existing.runNo + ') untuk armada ini — tutup dulu.', null, { runId: existing.id });
        var runNo = s.runs.filter(function (x) { return x.date === s.date && x.fleetId === s.fleet; }).reduce(function (m, x) { return Math.max(m, x.runNo); }, 0) + 1;
        var ru = { id: nid('run'), date: s.date, fleetId: s.fleet, runNo: runNo, gallonsOut: out, gallonsFullReturned: 0, gallonsEmptyReturned: 0, status: 'open', underSopReason: under ? reason : '', diffReason: '', sold: 0, note: String(b.note || '') };
        s.runs.push(ru); return W(ru);
      }),
      closeRun: run(function (id, body) {
        var ru = s.runs.find(function (x) { return x.id === id; }); if (!ru) throw fail(404, 'Rit tidak ditemukan.');
        if (ru.status === 'closed') throw fail(400, 'Rit ini sudah ditutup.');
        var b = body || {}; var full = Math.max(0, int(b.gallonsFullReturned)); var empty = Math.max(0, int(b.gallonsEmptyReturned));
        var expected = ru.gallonsOut - ru.sold; var diff = full - expected;
        var reason = String(b.diffReason || '').trim();
        if (diff !== 0 && !reason) throw fail(400, 'Selisih ' + (diff > 0 ? '+' : '') + diff + ' galon (seharusnya ' + expected + ', dikembalikan ' + full + ') — alasan wajib diisi.', null, { diff: diff, expectedRemaining: expected, sold: ru.sold });
        ru.gallonsFullReturned = full; ru.gallonsEmptyReturned = empty; ru.diffReason = diff !== 0 ? reason : ''; ru.status = 'closed';
        return W(Object.assign({}, ru, { expectedRemaining: expected, diff: diff }));
      }),
      // Same plan + same response shape as GET /deliveries/rit-route, computed on the phone.
      ritRoute: run(function () {
        // Like the server: the route belongs to TODAY's open rit; an older open rit must be closed first.
        var ru = s.runs.find(function (r) { return r.fleetId === s.fleet && r.status === 'open' && r.date === s.date; });
        if (!ru) throw fail(400, 'Buka rit dulu (isi galon yang dimuat) — rute rit dihitung dari muatan rit itu.');
        if (!s.depot) throw fail(400, 'Lokasi gudang belum diatur. Atur di Peta Zona → "Atur lokasi gudang".');
        if (typeof planRit !== 'function') throw fail(500, 'Perencana rute tidak tersedia.');
        var pend = s.stops.filter(function (st) { return st.date === s.date && st.fleetId === s.fleet && st.status === 'pending'; }).sort(function (a, b) { return a.seq - b.seq; });
        var byId = {}; pend.forEach(function (st) { byId[st.id] = stopView(st); });
        var q = {}; pend.forEach(function (st) { q[st.id] = st.qty > 0 ? st.qty : (s.demand[st.id] || 1); });
        var plan = planRit({ depot: s.depot, capacity: ru.gallonsOut, stops: pend.map(function (st) { var v = byId[st.id]; return { id: st.id, lat: v.lat, lng: v.lng, qty: q[st.id], pinned: st.pinned }; }) });
        var withQty = function (x) { return Object.assign({}, byId[x.id], { qty: x.qty }); };
        return {
          date: s.date, fleet: s.fleet, run: { id: ru.id, runNo: ru.runNo, gallonsOut: ru.gallonsOut },
          origin: { lat: s.depot.lat, lng: s.depot.lng, source: 'depot' },
          capacity: plan.capacity, used: plan.used, returnKm: plan.returnKm, totalKm: plan.totalKm,
          rit: plan.rit.map(function (x, i) { return Object.assign(withQty(x), { order: i + 1, legKm: x.legKm, cumKm: x.cumKm, loadAfter: x.loadAfter }); }),
          leftover: plan.leftover.map(withQty), leftoverGallons: plan.leftoverGallons, estRits: plan.estRits,
          tooBig: plan.tooBig.map(withQty), unlocated: plan.unlocated.map(function (i) { return byId[i]; }),
        };
      }),

      setLocation: run(function (cid, body) {
        var c = cust(cid); var b = body || {}; var lat = Number(b.lat), lng = Number(b.lng);
        if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) throw fail(400, 'Koordinat tidak valid.');
        c.lat = lat; c.lng = lng; return W(custView(c));
      }),
      setLocationPhoto: run(function (cid, photoId) {
        var c = cust(cid); if (photoId && !photoOk(photoId)) throw fail(400, 'Foto tidak ditemukan — unggah ulang fotonya.');
        c.locationPhotoId = photoId || null; return W(custView(c));
      }),
      setPhone: run(function (cid, phone) { var c = cust(cid); c.phone = phone08(phone); return W(custView(c)); }),
      addStop: run(function (body) {
        var b = body || {}; var c = cust(b.customerId);
        if (!c.active) throw fail(400, 'Pelanggan nonaktif — aktifkan kembali untuk menambah orderan.');
        if (s.stops.some(function (x) { return x.date === s.date && x.customerId === c.id && x.source === 'tambahan'; })) throw fail(400, 'Pelanggan ini sudah punya orderan tambahan hari ini.');
        var seq = s.stops.filter(function (x) { return x.date === s.date; }).reduce(function (m, x) { return Math.max(m, x.seq); }, -1) + 1;
        var st = { id: nid('stop'), date: s.date, fleetId: c.armada || s.fleet, customerId: c.id, source: 'tambahan', seq: seq, pinned: false, status: 'pending', qty: b.qty != null ? int(b.qty) : null, note: String(b.note || ''), pendingReason: '', transactionId: null };
        s.stops.push(st); return W(stopView(st));
      }),
      // Penyesuaian galon keeps office approval: practice records the request, the count does not move.
      adjustGallon: run(function (cid, body) {
        var c = cust(cid); var b = body || {}; var v = int(b.value);
        if (v < 0) throw fail(400, 'Jumlah galon tidak valid.');
        if (ADJ_REASONS.indexOf(b.reason) < 0) throw fail(400, 'Pilih alasan penyesuaian.');
        var a = { id: nid('adj'), customerId: c.id, kind: 'galon', before: c.gallonsHeld, after: v, delta: v - c.gallonsHeld, reason: b.reason, note: String(b.note || ''), status: 'pending', createdAt: now().getTime() };
        s.adjustments.push(a); return W(a);
      }),
      gallonDamage: run(function (cid, body) {
        var c = cust(cid); var b = body || {}; var qty = int(b.qty);
        var rp = replay(b.clientRef, c.id); if (rp) return { transaction: rp.txn, gallonsHeld: rp.gallonsHeld, sisaBon: rp.sisaBon, replay: true };
        if (qty <= 0) throw fail(400, 'Jumlah galon harus lebih dari 0.');
        if (!b.photoId) throw fail(400, 'Foto galon rusak wajib dilampirkan.', 'PROOF_REQUIRED');
        if (!photoOk(b.photoId)) throw fail(400, 'Foto tidak ditemukan — unggah ulang fotonya.', 'PROOF_MISSING');
        if (qty > c.gallonsHeld) throw fail(400, 'Pelanggan hanya memegang ' + c.gallonsHeld + ' galon — tidak bisa mengganti rugi ' + qty + '.', null, { held: c.gallonsHeld });
        var price = int(rules().hargaGantiRugiGalon); if (!price) throw fail(400, 'Harga ganti rugi galon belum diatur pemilik.', 'NO_PRICE');
        if (['tunai', 'bon', 'transfer'].indexOf(b.payMethod) < 0) throw fail(400, 'Pilih cara bayar ganti rugi.');
        if (['pecah', 'bocor', 'retak', 'hilang'].indexOf(b.kind) < 0) throw fail(400, 'Pilih jenis kerusakan.');
        var pay = b.payMethod; var kind = b.kind;
        var t = pushTxn({ clientRef: b.clientRef || null, customerId: c.id, qty: 0, unitPriceLocked: price, amount: qty * price, method: pay === 'bon' ? 'bon' : 'lunas', payMethod: pay === 'bon' ? '' : pay, kind: 'ganti_rugi', gallonQty: qty, gallonOut: 0, gallonIn: 0, proofPhotoId: b.photoId, note: 'Ganti rugi ' + qty + ' galon ' + kind });
        c.gallonsHeld -= qty; if (pay === 'bon') c.sisaBon += qty * price;
        return W({ transaction: t, gallonsHeld: c.gallonsHeld, sisaBon: c.sisaBon });
      }),
      // Expenses are always paid from the day's cash (never "uang pribadi").
      addExpense: run(function (body) {
        var b = body || {}; var amt = int(b.amount);
        var prev = b.clientRef ? s.expenses.find(function (x) { return x.clientRef === b.clientRef; }) : null;
        if (prev) return Object.assign({}, prev, { replay: true });   // a retry after a lost response
        if (amt <= 0) throw fail(400, 'Nominal pengeluaran harus lebih dari 0.');
        if (!String(b.category || '').trim()) throw fail(400, 'Pilih kategori pengeluaran.');
        if (!b.photoId && rules().wajibFotoPengeluaran) throw fail(400, 'Foto nota wajib dilampirkan.', 'PROOF_REQUIRED');
        if (b.photoId && !photoOk(b.photoId)) throw fail(400, 'Foto nota tidak ditemukan — unggah ulang fotonya.', 'PROOF_MISSING');
        var x = { id: nid('exp'), clientRef: b.clientRef || null, date: s.date, fleetId: s.fleet, amount: amt, category: String(b.category), method: 'tunai', note: String(b.note || ''), photoId: b.photoId || null, status: 'active', createdAt: now().getTime() };
        s.expenses.push(x); return W(x);
      }),

      requestCorrection: run(function (txnId, body) {
        var t = txnOf(txnId);
        if (t.kind === 'ganti_rugi') throw fail(400, 'Ganti rugi galon tidak bisa dikoreksi — ajukan pembatalan lalu catat ulang.');
        return W(pushRequest(t, 'correction', body));
      }),
      requestVoid: run(function (txnId, body) { return W(pushRequest(txnOf(txnId), 'void', body)); }),
      requestReassign: run(function (body) {
        var b = body || {}; var ids = b.transactionIds || [];
        if (!ids.length) throw fail(400, 'Pilih transaksi yang dipindahkan.');
        var t = txnOf(ids[0]);
        if (ids.some(function (i) { var x = s.txns.find(function (y) { return y.id === i; }); return x && x.kind === 'ganti_rugi'; })) throw fail(400, 'Ganti rugi galon tidak bisa dipindahkan ke pelanggan lain — ajukan pembatalan lalu catat ulang.');
        if (!String(b.note || '').trim()) throw fail(400, 'Catatan wajib diisi.');
        return W(pushRequest(t, 'reassign', Object.assign({}, b, { reason: b.reason || b.note })));
      }),
      withdrawRequest: run(function (id) {
        var r = s.requests.find(function (x) { return x.id === id; }); if (!r) throw fail(404, 'Pengajuan tidak ditemukan.');
        if (r.status !== 'pending') throw fail(400, 'Pengajuan ini sudah diputuskan — tidak bisa ditarik.');
        r.status = 'withdrawn'; r.decisionNote = 'ditarik oleh pemohon'; r.decidedAt = now().getTime();
        return W(r);
      }),
      closeDay: run(function (body) {
        var b = body || {}; var reasons = b.reasons || {};
        var pend = s.stops.filter(function (st) { return st.date === s.date && st.fleetId === s.fleet && st.status === 'pending'; });
        if (pend.some(function (st) { return !String(reasons[st.id] || '').trim(); })) throw fail(400, 'Isi alasan untuk setiap pengiriman yang belum tuntas.');
        pend.forEach(function (st) { st.status = 'ditunda'; st.pendingReason = String(reasons[st.id]).slice(0, 300); });
        var delivered = s.stops.filter(function (st) { return st.date === s.date && st.fleetId === s.fleet && st.status === 'terkirim'; }).length;
        var co = { id: nid('close'), date: s.date, fleetId: s.fleet, closedByName: null, closedAt: now().getTime(), generalNote: String(b.generalNote || '').slice(0, 500), delivered: delivered, pending: pend.length };
        s.closeouts.push(co);
        return W(co);   // the server's response, unwrapped, is the closeout itself
      }),
      // Same buckets as GET /deliveries/day-summary.
      daySummary: run(function () {
        var out = { date: s.date, fleetId: s.fleet, clamped: false, tunaiPenjualan: 0, tunaiPelunasan: 0, tunaiGantiRugi: 0, transfer: 0, bonBaru: 0, pengeluaran: 0, wajibSetor: 0, galon: { keluar: 0, kembali: 0, rusak: 0 }, stops: { terkirim: 0, ditunda: 0, batal: 0, pending: 0 }, koreksiMenunggu: 0, ritDiBawahSop: [] };
        s.txns.filter(function (t) { return t.txnDate === s.date && t.fleetId === s.fleet && t.status !== 'void'; }).forEach(function (t) {
          if (t.kind === 'ganti_rugi') out.galon.rusak += t.gallonQty; else { out.galon.keluar += t.gallonOut || 0; out.galon.kembali += t.gallonIn || 0; }
          if (t.method === 'bon') { out.bonBaru += t.amount; return; }
          if (t.payMethod === 'transfer') { out.transfer += t.amount; return; }
          if (t.kind === 'ganti_rugi') out.tunaiGantiRugi += t.amount; else if (t.method === 'pelunasan') out.tunaiPelunasan += t.amount; else out.tunaiPenjualan += t.amount;
        });
        out.pengeluaran = s.expenses.filter(function (x) { return x.date === s.date && x.fleetId === s.fleet && x.status === 'active'; }).reduce(function (a, x) { return a + x.amount; }, 0);
        out.wajibSetor = out.tunaiPenjualan + out.tunaiPelunasan + out.tunaiGantiRugi - out.pengeluaran;
        s.stops.filter(function (st) { return st.date === s.date && st.fleetId === s.fleet; }).forEach(function (st) { if (out.stops[st.status] != null) out.stops[st.status] += 1; });
        out.koreksiMenunggu = s.requests.filter(function (r) { return r.status === 'pending'; }).length;
        out.ritDiBawahSop = s.runs.filter(function (r) { return r.date === s.date && r.fleetId === s.fleet && r.underSopReason; }).map(function (r) { return { runNo: r.runNo, gallonsOut: r.gallonsOut, reason: r.underSopReason }; });
        return out;
      }),
      // Practice photos stay on the phone. With a photo store (the phone's IndexedDB) the bytes live
      // apart from the state — the state only marks the id — so every practice write stays small.
      uploadPhoto: run(function (body) {
        var d = body && body.data; if (!d) throw fail(400, 'Foto kosong.');
        var id = nid('photo');
        if (photoStore) { s.photos[id] = true; photoStore.put(id, String(d)); } else s.photos[id] = String(d);
        return W({ id: id, name: (body && body.name) || 'foto.jpg', isImg: true, mime: (body && body.mime) || 'image/jpeg' });
      }),
      photo: function (id) {
        if (!s.photos[id]) return Promise.resolve(null);
        return Promise.resolve(photoStore ? photoStore.get(id) : s.photos[id]);
      },
      // Practice never reports a position: the live tracking map shows real drivers only.
      position: function () { return Promise.resolve({ ok: true, practice: true }); },
      exportState: function () { return clone(s); },
    };
    return api;
  }

  return { VERSION: VERSION, fromSnapshot: fromSnapshot, createSandbox: createSandbox };
});
