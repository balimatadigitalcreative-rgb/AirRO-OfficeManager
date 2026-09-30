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
  var METHODS = ['context', 'board', 'customers', 'runs', 'ritRoute', 'daySummary', 'myChangeRequests', 'markStop', 'holdStop', 'cancelStop', 'createSale', 'payBon', 'openRun', 'closeRun', 'setLocation', 'setLocationPhoto', 'setPhone', 'addStop', 'adjustGallon', 'gallonDamage', 'addExpense', 'requestCorrection', 'requestVoid', 'requestReassign', 'withdrawRequest', 'closeDay', 'uploadPhoto', 'photo'];
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
      runs: function () { return U(F.runs(c.date, c.fleet)); },
      ritRoute: function () { return U(F.ritRoute(c.date, c.fleet)); },
      daySummary: function () { return U(F.daySummary(c.date, c.fleet)); },
      myChangeRequests: function () { return U(F.myChangeRequests()); },
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
      addExpense: function (b) { return U(F.expense(A({ date: c.date, fleet: c.fleet, method: 'tunai' }, b))); },
      requestCorrection: function (id, b) { return U(F.correct(id, b)); },
      requestVoid: function (id, b) { return U(F.void(id, b)); },
      requestReassign: function (b) { return U(F.reassign(b)); },
      withdrawRequest: function (id) { return U(F.withdraw(id)); },
      closeDay: function (b) { return U(F.closeDay(A({ date: c.date, fleet: c.fleet }, b))); },
      uploadPhoto: function (b) { return U(F.upload(b)); },
      photo: function (id) { return U(F.photo(id)).then(function (d) { return d && d.data ? d.data : null; }); },
    };
  }

  // One read of everything Mode latihan copies (reads only — the demo fence lets them through).
  // "Koreksi saya" needs its own cap: a driver without it simply starts with an empty list.
  function snapshot(realAdapter) {
    var mine = realAdapter.myChangeRequests().catch(function (e) { if (e && e.status === 403) return []; throw e; });
    return Promise.all([realAdapter.context(), realAdapter.board(), realAdapter.customers(), realAdapter.runs(), mine])
      .then(function (r) { return { context: r[0], board: r[1] || [], customers: r[2] || [], runs: r[3] || [], myRequests: r[4] || [] }; });
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
    var store = o.storage; var persisted = true;
    var toMemory = function () { persisted = false; store = memoryStorage(); };
    return timed(store.get(o.key), ms).catch(function () { toMemory(); return undefined; }).then(function (saved) {
      // Reuse only today's copy: a practice board from yesterday under today's date would teach nothing.
      if (saved && saved.v === SB.VERSION && (!o.today || saved.date === o.today)) return saved;
      return snapshot(o.real).then(function (snap) {
        var st = SB.fromSnapshot(snap, { key: o.key });
        return timed(store.set(o.key, st), ms).catch(function () { toMemory(); }).then(function () { return st; });
      });
    }).then(function (state) {
      var chain = Promise.resolve();   // saves happen in order, each with the latest state
      var a = SB.createSandbox(state, { planRit: planRit, onChange: function (st) {
        var copy = JSON.parse(JSON.stringify(st));
        chain = chain.then(function () { return timed(store.set(o.key, copy), ms); }).catch(function () {});
      } });
      a.persisted = persisted;
      a.reset = function () { return chain.then(function () { return timed(store.del(o.key), ms); }).catch(function () {}); };
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
    var ui = !eligible ? 'old' : (prefs.ui === 'new' || prefs.ui === 'old' ? prefs.ui : (released ? 'new' : 'old'));
    var mode = !canAsli ? 'latihan' : !canLatihan ? 'asli' : (prefs.mode === 'asli' || prefs.mode === 'latihan' ? prefs.mode : (released ? 'asli' : 'latihan'));
    return { eligible: eligible, released: released, canLatihan: canLatihan, canAsli: canAsli, ui: ui, mode: mode };
  }
  var KEY_UI = 'airro.dist.fieldUi', KEY_MODE = 'airro.dist.fieldMode';
  function loadPrefs() {
    try {
      var out = {}; var ui = root.localStorage.getItem(KEY_UI); var mode = root.localStorage.getItem(KEY_MODE);
      if (ui) out.ui = ui; if (mode) out.mode = mode;
      return out;
    } catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { if (p && p.ui) root.localStorage.setItem(KEY_UI, p.ui); if (p && p.mode) root.localStorage.setItem(KEY_MODE, p.mode); } catch (e) { /* private window / blocked: preference just isn't remembered */ }
  }
  // Incomplete customer data the field screens warn about.
  function dataGaps(c) {
    var x = c || {};
    var titik = !(typeof x.lat === 'number' && typeof x.lng === 'number'); var wa = !String(x.phone || '').trim(); var foto = !x.locationPhotoId;
    return { titik: titik, wa: wa, foto: foto, count: (titik ? 1 : 0) + (wa ? 1 : 0) + (foto ? 1 : 0) };
  }

  return { METHODS: METHODS, real: real, snapshot: snapshot, openLatihan: openLatihan, memoryStorage: memoryStorage, idbStorage: idbStorage, prefState: prefState, loadPrefs: loadPrefs, savePrefs: savePrefs, dataGaps: dataGaps };
});
