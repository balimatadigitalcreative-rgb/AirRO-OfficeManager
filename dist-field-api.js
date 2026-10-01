/*
 * MODE LAPANGAN ADAPTOR — one interface for every field screen, two implementations:
 *   real(API, ctx)  → the server (API.distribusi.field.*, every request tagged X-Airro-Ui: field)
 *   openLatihan(…)  → FIELDSANDBOX on a copy of real data, persisted on this phone (IndexedDB) and
 *                     NEVER sent to the server.
 * Plus the pure rules for who sees the new UI in which mode (prefState) and the per-phone preference.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // tests (CommonJS)
  if (root) root.FIELDAPI = api;                                               // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (root) {
  'use strict';
  var METHODS = ['context', 'board', 'customers', 'customerDetail', 'runs', 'ritRoute', 'daySummary', 'myChangeRequests', 'outstanding', 'markStop', 'holdStop', 'cancelStop', 'createSale', 'payBon', 'openRun', 'closeRun', 'setLocation', 'setLocationPhoto', 'setPhone', 'addStop', 'adjustGallon', 'gallonDamage', 'addExpense', 'requestCorrection', 'requestVoid', 'requestReassign', 'previewCorrection', 'previewReassign', 'withdrawRequest', 'closeDay', 'uploadPhoto', 'photo', 'position'];
  var unwrap = function (r) { return r && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, 'data') ? r.data : r; };
  var U = function (p) { return Promise.resolve(p).then(unwrap); };
  var A = function (base, extra) { return Object.assign({}, base || {}, extra || {}); };

  // The server, through the tagged namespace. Results are unwrapped from { data } so both adaptors
  // hand screens the same shapes.
  function real(API, ctx) {
    var F = API.distribusi.field; var c = ctx || {};
    return {
      mode: 'asli',
      context: function () { return U(F.context(c.date, c.fleet)); },
      board: function () { return U(F.board(c.date, c.fleet)); },
      customers: function () { return U(F.customers(c.fleet)); },
      customerDetail: function (id) { return U(F.customer(id)); },
      runs: function () { return U(F.runs(c.date, c.fleet)); },
      ritRoute: function () { return U(F.ritRoute(c.date, c.fleet)); },
      daySummary: function () { return U(F.daySummary(c.date, c.fleet)); },
      // Koreksi saya needs distribusiKoreksi or distribusiVoid — without either it is an empty list.
      myChangeRequests: function () { return U(F.myChangeRequests()).catch(function (e) { if (e && e.status === 403) return []; throw e; }); },
      // "Belum terkirim" needs distribusiBelumTerkirim, which drivers do not hold → empty, not an error.
      outstanding: function () { return U(F.outstanding(c.fleet)).catch(function (e) { if (e && e.status === 403) return []; throw e; }); },
      markStop: function (id, b) { return U(F.mark(id, b)); },
      holdStop: function (id, reason) { return U(F.mark(id, { status: 'ditunda', reason: reason })); },
      cancelStop: function (id, reason) { return U(F.mark(id, { status: 'batal', reason: reason })); },
      createSale: function (b) { return U(F.sale(A({ txnDate: c.date }, b))); },
      payBon: function (b) { return U(F.sale(A(A({ txnDate: c.date }, b), { method: 'pelunasan' }))); },
      openRun: function (b) { return U(F.openRun(A({ date: c.date, fleet: c.fleet }, b))); },
      closeRun: function (id, b) { return U(F.closeRun(id, b)); },
      setLocation: function (cid, b) { return U(F.setLocation(cid, b)); },
      setLocationPhoto: function (cid, pid) { return U(F.setLocationPhoto(cid, pid)); },
      setPhone: function (cid, phone) { return U(F.setPhone(cid, phone)); },
      addStop: function (b) { return U(F.addOrder(A({ date: c.date }, b))); },
      adjustGallon: function (cid, b) { var x = b || {}; return U(F.adjust(cid, { kind: 'galon', mode: 'set', value: x.value, reason: x.reason, note: x.note, evidenceUrl: x.evidenceUrl })); },
      gallonDamage: function (cid, b) { return U(F.gallonDamage(cid, A({ txnDate: c.date }, b))); },
      // Field expenses are ALWAYS paid in cash from the day's deposit (owner rule) — never overridable.
      addExpense: function (b) { return U(F.expense(A(A({ date: c.date, fleet: c.fleet }, b), { method: 'tunai' }))); },
      requestCorrection: function (id, b) { return U(F.correct(id, b)); },
      requestVoid: function (id, b) { return U(F.void(id, b)); },
      requestReassign: function (b) { return U(F.reassign(b)); },
      previewCorrection: function (id, b) { return U(F.previewCorrect(id, b)); },
      previewReassign: function (b) { return U(F.previewReassign(b)); },
      withdrawRequest: function (id) { return U(F.withdraw(id)); },
      closeDay: function (b) { return U(F.closeDay(A({ date: c.date, fleet: c.fleet }, b))); },
      uploadPhoto: function (b) { return U(F.upload(b)); },
      photo: function (id) { return U(F.photo(id)).then(function (d) { return d && d.data ? d.data : null; }); },
      // The driver's live position (the owner's tracking map + "Selesai" needs a recent fix).
      position: function (b) { return U(F.position(b)); },
    };
  }

  // One read of everything Mode latihan copies (reads only — the demo fence lets them through).
  // "Koreksi saya" needs its own cap: a driver without it simply starts with an empty list.
  function snapshot(realAdapter) {
    var ok403 = function (p) { return p.catch(function (e) { if (e && e.status === 403) return []; throw e; }); };
    return Promise.all([realAdapter.context(), realAdapter.board(), realAdapter.customers(), realAdapter.runs(), ok403(realAdapter.myChangeRequests()), ok403(realAdapter.outstanding())])
      .then(function (r) { return { context: r[0], board: r[1] || [], customers: r[2] || [], runs: r[3] || [], myRequests: r[4] || [], outstanding: r[5] || [] }; });
  }

  function memoryStorage() {
    var m = {};
    return {
      get: function (k) { return Promise.resolve(m[k] ? JSON.parse(m[k]) : undefined); },
      set: function (k, v) { m[k] = JSON.stringify(v); return Promise.resolve(); },
      del: function (k) { delete m[k]; return Promise.resolve(); },
    };
  }
  // IndexedDB key-value store (practice photos make the state too large for localStorage).
  function idbStorage(dbName) {
    var name = dbName || 'airro-latihan'; var store = 'state'; var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        var req = root.indexedDB.open(name, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(store); };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { dbp = null; rej(req.error); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction(store, mode); var r = fn(t.objectStore(store));
          t.oncomplete = function () { res(r && r.result); };
          t.onerror = function () { rej(t.error); };
          t.onabort = function () { rej(t.error); };
        });
      });
    }
    return {
      get: function (k) { return tx('readonly', function (s) { return s.get(k); }); },
      set: function (k, v) { return tx('readwrite', function (s) { return s.put(v, k); }); },
      del: function (k) { return tx('readwrite', function (s) { return s.delete(k); }); },
    };
  }

  // A storage call that does not answer in time counts as failed (some Safari builds never fire
  // indexedDB.open's callbacks) — practice must never hang on "Memuat…".
  function timed(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(Object.assign(new Error('Penyimpanan HP tidak menjawab.'), { storageTimeout: true })); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }

  // Open practice: reuse this phone's saved copy, else copy the real data once and save it. A failed
  // COPY saves nothing and rejects (the screen shows the error + "Coba lagi"). Phone storage that fails
  // or does not answer → practice still opens, in memory only, flagged `persisted: false` (the screen
  // says the practice is lost when the page closes).
  function openLatihan(opts) {
    var o = opts || {}; var SB = o.sandbox || root.FIELDSANDBOX; var planRit = o.planRit || (root.RITPLAN && root.RITPLAN.planRit);
    var ms = o.storageTimeoutMs || 3000;
    var store = o.storage; var persisted = true; var a = null;
    var photosKey = o.key + ':photos';
    var chain = Promise.resolve();   // every save happens in order
    var lost = function () {         // a save failed or never answered: the practice is not being kept
      if (!persisted) return;
      persisted = false; if (a) a.persisted = false;
      if (o.onPersist) { try { o.onPersist(false); } catch (e) { /* screen gone */ } }
    };
    var save = function (k, v) { chain = chain.then(function () { return timed(store.set(k, v), ms); }).catch(lost); return chain; };
    var toMemory = function () { persisted = false; store = memoryStorage(); };
    var photoCache = null;
    var photoMap = function () {
      if (photoCache) return Promise.resolve(photoCache);
      return timed(store.get(photosKey), ms).catch(function () { return undefined; }).then(function (v) { photoCache = v || {}; return photoCache; });
    };
    var photoStore = {
      put: function (id, data) { return photoMap().then(function (m) { m[id] = data; return save(photosKey, Object.assign({}, m)); }); },
      get: function (id) { return photoMap().then(function (m) { return m[id] || null; }); },
    };
    return timed(store.get(o.key), ms).catch(function () { toMemory(); return undefined; }).then(function (saved) {
      // Reuse only today's copy of this version: an older one would teach on a stale board.
      if (saved && saved.v === SB.VERSION && (!o.today || saved.date === o.today)) return saved;
      return snapshot(o.real).then(function (snap) {
        var st = SB.fromSnapshot(snap, { key: o.key });
        photoCache = {};
        return timed(store.set(o.key, st), ms).then(function () { return timed(store.del(photosKey), ms).catch(function () {}); }).catch(function () { toMemory(); }).then(function () { return st; });
      });
    }).then(function (state) {
      a = SB.createSandbox(state, { planRit: planRit, photoStore: photoStore, onChange: function (st) { save(o.key, JSON.parse(JSON.stringify(st))); } });
      a.persisted = persisted;
      // Restart practice: wait for pending saves, then delete the copy and its photos. A failed delete
      // REJECTS — the screen must not say "restarted" while the old copy is still there.
      a.reset = function () {
        return chain.then(function () { return Promise.all([timed(store.del(o.key), ms), timed(store.del(photosKey), ms)]); }).then(function () { photoCache = {}; });
      };
      return a;
    });
  }

  // WHO SEES WHAT. Before release (rules.fieldUiDefault !== 'new') only demo holders may open the new UI;
  // Demo latihan alone never reaches Mode asli. After release everyone with the board opens it in Mode
  // asli; demo holders keep practice. Rules not loaded yet → treated as not released.
  function prefState(args) {
    var a = args || {}; var p = a.perms || {}; var rules = a.rules || {}; var prefs = a.prefs || {};
    var released = rules.fieldUiDefault === 'new';
    var board = !!p.distribusiPengiriman;
    var canLatihan = board && !!(p.distribusiDemoLatihan || p.distribusiDemoPenuh);
    var canAsli = board && (released || !!p.distribusiDemoPenuh);
    var eligible = board && (released || canLatihan);
    // An account that may use the field view lands in it (owner, 3D); "old" is a choice for this session.
    // owner/GM run the office: after release they are not forced into the phone view (they may open it);
    // a demo grant — the owner's own included — always lands in it
    var office = a.role === 'owner' || a.role === 'gm';
    var lands = canLatihan || (released && !office);
    var ui = !eligible ? 'old' : (prefs.ui === 'old' || prefs.ui === 'new' ? prefs.ui : (lands ? 'new' : 'old'));
    var mode = !canAsli ? 'latihan' : !canLatihan ? 'asli' : (prefs.mode === 'asli' || prefs.mode === 'latihan' ? prefs.mode : (released ? 'asli' : 'latihan'));
    return { eligible: eligible, released: released, canLatihan: canLatihan, canAsli: canAsli, ui: ui, mode: mode };
  }
  var KEY_UI = 'airro.dist.fieldUi', KEY_MODE = 'airro.dist.fieldMode';
  function loadPrefs() {
    try {
      var out = {}; var mode = root.localStorage.getItem(KEY_MODE);
      if (mode) out.mode = mode;
      return out;
    } catch (e) { return {}; }
  }
  // Only the practice/real choice is remembered; the old-view choice lasts until the next login (3D).
  function savePrefs(p) {
    try { if (p && p.mode) root.localStorage.setItem(KEY_MODE, p.mode); root.localStorage.removeItem(KEY_UI); } catch (e) { /* private window / blocked: preference just isn't remembered */ }
  }
  // A new login starts without the last session's "old view" choice (3D-1 M5): only Mode latihan/asli is kept.
  function sessionPrefs(prefs) { var p = prefs || {}; return p.mode ? { mode: p.mode } : {}; }
  // While the owner's rules load, a board account the release would move into the field view waits on a
  // blank field-coloured screen instead of flashing the finance app first (M13). A demo account lands in
  // the field view anyway; owner/GM stay in the old view; an "old" choice stays old.
  function bootWait(o) {
    var x = o || {}; var p = x.perms || {};
    var demo = !!(p.distribusiDemoLatihan || p.distribusiDemoPenuh);
    var office = x.role === 'owner' || x.role === 'gm';
    return !!p.distribusiPengiriman && !demo && !office && !x.rulesReady && (x.prefs || {}).ui !== 'old';
  }
  // Incomplete customer data the field screens warn about.
  function dataGaps(c) {
    var x = c || {};
    var titik = !(typeof x.lat === 'number' && typeof x.lng === 'number'); var wa = !String(x.phone || '').trim(); var foto = !x.locationPhotoId;
    return { titik: titik, wa: wa, foto: foto, count: (titik ? 1 : 0) + (wa ? 1 : 0) + (foto ? 1 : 0) };
  }

  return { METHODS: METHODS, real: real, snapshot: snapshot, openLatihan: openLatihan, memoryStorage: memoryStorage, idbStorage: idbStorage, prefState: prefState, loadPrefs: loadPrefs, savePrefs: savePrefs, sessionPrefs: sessionPrefs, bootWait: bootWait, dataGaps: dataGaps };
});
