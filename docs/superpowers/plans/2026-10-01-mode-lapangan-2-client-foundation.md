# Mode Lapangan — Rencana 2: Dasar klien (adaptor asli/latihan, shell, Armada & SOP)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Akun yang diberi izin demo bisa membuka "Tampilan baru (demo)" di layar Pengiriman: modul Mode Lapangan terbuka dengan pita MODE LATIHAN, bisa berpindah Mode latihan ↔ asli (sesuai izin), menampilkan daftar pengiriman nyata (asli) atau salinan latihan yang tersimpan di HP, dan Owner/GM bisa mengatur Aturan lapangan & kapasitas armada. Layar-layar lengkap sesuai mockup dibangun di Rencana 3 di atas dasar ini.

**Architecture:** Satu antarmuka adaptor (`FIELDAPI`) dengan dua implementasi yang metodenya identik: `real` (memanggil server lewat `API.distribusi.field.*`, semua permintaan diberi header `X-Airro-Ui: field`) dan `latihan` (mesin `FIELDSANDBOX` murni yang meniru aturan server di atas salinan data dan menyimpan ke IndexedDB — tidak pernah memanggil server). `rit-plan.js` dipindah ke root sebagai modul isomorfik (UMD) agar server dan Mode latihan memakai satu sumber. Shell memilih `FIELD.App` atau `DIST.Deliveries` lewat fungsi murni `FIELDAPI.prefState`.

**Tech Stack:** React 18 tanpa framework (JSX di root, digabung `build.mjs`/esbuild), UMD root modules, Express + Prisma untuk 2 endpoint kecil, Jest (server) untuk semua tes — termasuk tes modul klien (Node, tanpa DOM) dan tes statis/parse via `@babel/parser`.

**Spec:** `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md` (bagian 1, 2, 4 baris "Armada & SOP", 5). Rencana 1 (server) sudah di master `95aa66b`.

## Global Constraints

- Tes dijalankan dari `server/`: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand <file>`. Jam 00:00–08:00 WITA tambahkan `APP_TZ=UTC` (9 file tes lama menghitung "hari ini" dalam UTC).
- Tes server TIDAK BOLEH `require` apa pun dari `node_modules` root (gerbang deploy GATE 3 hanya memasang dependensi server). File root murni (`rit-plan.js`, `dist-field-sandbox.js`, `dist-field-api.js`, `api.js`) boleh di-`require` karena tanpa dependensi. JSX hanya dicek dengan `@babel/parser` (dependensi server).
- Semua file root baru didaftarkan di `build.mjs` `FILES` dengan urutan benar; CSS baru di `CSS_FILES` + `<link>` di `index.html`.
- `dist-field-sandbox.js` **tidak boleh** memuat `window.API`, `fetch(`, `XMLHttpRequest`, atau `API.` — dikunci tes statis.
- Mode latihan: pita **"MODE LATIHAN — tidak tersimpan"** selalu tampil; pindah mode selalu lewat konfirmasi.
- Liquid Glass hanya di lapisan fungsional (dock, tombol bulat, sheet, menu); konten tetap opak. Hormati `prefers-reduced-transparency` dan `prefers-reduced-motion`. Target sentuh ≥ 44 px.
- Bundel menggabungkan semua file root dalam SATU cakupan: nama `const`/fungsi tingkat atas harus unik di seluruh file (`trF`, `uRf` sudah dipakai — pakai `trFl`, `uSfl`, `uEfl`, `uRfl`, `Fld*`). Kelas CSS baru berawalan `mlap-` (awalan `fld`/`fld-label`/`fld-hint` sudah dipakai form lama).
- Semua teks lewat `window.t` dengan kunci `fld.*` di EN **dan** ID (`finance-i18n.js`); tipografi apostrof `’` (bukan `'` di dalam string satu-kutip).
- Edit dengan tool Edit/Write, jangan heredoc untuk kode berisi kutip/backslash. File bisa CRLF.
- Jangan ubah `distribution.jsx` selain perubahan kecil yang disebut (label status `withdrawn`).
- Commit lokal per tugas; push hanya atas permintaan pemilik.

## Review Focus

1. **Akun tanpa izin demo sama sekali** membuka Pengiriman → tampilan lama persis seperti sekarang, tanpa tombol demo. (Task 7: tes `prefState` "no demo caps → not eligible" + tes statis shell.)
2. **Demo latihan saja** → tidak pernah bisa masuk Mode asli, walau pref tersimpan `asli`. (Task 5: `prefState` memaksa `latihan`.)
3. **Latihan dibuka saat offline / server menolak salinan** → pesan jelas + tombol coba lagi, bukan layar kosong; tidak ada setengah-state tersimpan. (Task 5: `openLatihan` tidak menyimpan state bila snapshot gagal.)
4. **Aturan & kapasitas disimpan dari Mode latihan** → selalu menulis ke server asli dengan label jelas, tidak pernah ke sandbox, dan tidak ikut header `X-Airro-Ui` (owner tanpa Demo penuh tetap bisa menyimpan). (Task 3: `fieldRules.set` tanpa header; Task 6: RulesScreen memanggil `API.distribusi.fieldRules`.)
5. **Ulang latihan** → salinan lama dihapus dan data asli disalin ulang; foto latihan ikut hilang. (Task 5: tes `reset` + buka ulang.)

---

### Task 1: `rit-plan.js` isomorfik (satu sumber server + HP)

**Files:**
- Create: `rit-plan.js` (root)
- Modify: `server/src/lib/rit-plan.js` (jadi re-export)
- Modify: `build.mjs` (FILES)
- Test: `server/tests/rit-plan-isomorphic.test.js` (baru)

**Interfaces:**
- Produces: `window.RITPLAN = { planRit, haversineKm }` di browser; `require('../../rit-plan.js')` di Node; `server/src/lib/rit-plan.js` mengekspor objek yang sama (identitas fungsi sama).

- [ ] **Step 1: Tes gagal**

```js
'use strict';
// RUTE RIT is ONE module for the server and the phone (Mode latihan plans rits offline): the root UMD file
// is the source; the server lib re-exports it; the bundle loads it before the field modules.
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..', '..');

it('the server lib is the root module (same functions)', () => {
  const lib = require('../src/lib/rit-plan');
  const iso = require(path.join(root, 'rit-plan.js'));
  expect(lib.planRit).toBe(iso.planRit);
  expect(lib.haversineKm).toBe(iso.haversineKm);
});
it('in a browser it registers window.RITPLAN', () => {
  const src = fs.readFileSync(path.join(root, 'rit-plan.js'), 'utf8');
  const win = {};
  new Function('globalThis', 'window', 'module', src)(win, win, undefined);
  expect(typeof win.RITPLAN.planRit).toBe('function');
});
it('the bundle loads it before the field modules', () => {
  const b = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8');
  expect(b.indexOf("'rit-plan.js'")).toBeGreaterThan(-1);
  expect(b.indexOf("'rit-plan.js'")).toBeLessThan(b.indexOf("'api.js'"));
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/rit-plan-isomorphic.test.js` → FAIL (`Cannot find module …/rit-plan.js`).

- [ ] **Step 3: Buat `rit-plan.js` di root** — salin isi fungsi `haversineKm`, `km1`, `hasCoords`, `planRit` dan komentar kepala **persis** dari `server/src/lib/rit-plan.js` (baris 2–77), dibungkus UMD seperti `dist-zones.js`:

```js
/*
 * RUTE RIT — (komentar kepala dari server/src/lib/rit-plan.js, baris 2–22, disalin apa adanya)
 * ISOMORPHIC: one source for the server (require) and the phone (window.RITPLAN — Mode latihan).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // server (CommonJS)
  if (root) root.RITPLAN = api;                                               // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';
  function haversineKm(a, b) {
    var R = 6371, rad = function (d) { return (d * Math.PI) / 180; };
    var dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  var km1 = function (v) { return Math.round(v * 10) / 10; };
  var hasCoords = function (s) { return typeof s.lat === 'number' && typeof s.lng === 'number' && isFinite(s.lat) && isFinite(s.lng); };

  function planRit(opts) {
    var depot = opts.depot, capacity = opts.capacity, stops = opts.stops;
    var cap = Math.max(0, Math.floor(Number(capacity) || 0));
    var all = (stops || []).map(function (s, i) { return { id: s.id, lat: s.lat, lng: s.lng, qty: Math.max(1, Math.floor(Number(s.qty) || 1)), pinned: !!s.pinned, i: i }; });
    var unlocated = all.filter(function (s) { return !hasCoords(s); }).map(function (s) { return s.id; });
    var located = all.filter(hasCoords);
    var tooBig = located.filter(function (s) { return s.qty > cap; }).map(function (s) { return { id: s.id, qty: s.qty }; });
    var eligible = located.filter(function (s) { return s.qty <= cap; });
    var reserved = {}; var reservedQty = 0;
    eligible.filter(function (s) { return s.pinned; }).forEach(function (s) { if (reservedQty + s.qty <= cap) { reserved[s.id] = true; reservedQty += s.qty; } });
    var rit = []; var done = {};
    var pos = depot, load = cap, cum = 0;
    for (;;) {
      var room = load - reservedQty;
      var best = null, bestD = Infinity;
      eligible.forEach(function (s) {
        if (done[s.id]) return;
        var ok = reserved[s.id] || (!s.pinned && s.qty <= room);
        if (!ok) return;
        var d = haversineKm(pos, s);
        if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && s.i < best.i)) { best = s; bestD = d; }
      });
      if (!best) break;
      done[best.id] = true;
      if (reserved[best.id]) reservedQty -= best.qty;
      load -= best.qty;
      cum += bestD;
      rit.push({ id: best.id, qty: best.qty, legKm: km1(bestD), cumKm: km1(cum), loadAfter: load });
      pos = best;
    }
    var returnKm = rit.length ? km1(haversineKm(pos, depot)) : 0;
    var leftover = eligible.filter(function (s) { return !done[s.id]; }).map(function (s) { return { id: s.id, qty: s.qty }; });
    var leftoverGallons = leftover.reduce(function (t, s) { return t + s.qty; }, 0);
    return {
      rit: rit, used: cap - load, capacity: cap, returnKm: returnKm, totalKm: km1(cum + returnKm),
      leftover: leftover, leftoverGallons: leftoverGallons, estRits: cap > 0 && leftoverGallons > 0 ? Math.ceil(leftoverGallons / cap) : 0,
      tooBig: tooBig, unlocated: unlocated,
    };
  }
  return { planRit: planRit, haversineKm: haversineKm };
});
```

Ganti seluruh isi `server/src/lib/rit-plan.js` dengan:

```js
'use strict';
// RUTE RIT lives in the repo root as ONE isomorphic module (server + the phone's Mode latihan).
module.exports = require('../../../rit-plan.js');
```

Di `build.mjs` `FILES`, tambahkan `'rit-plan.js',` tepat setelah `'dist-zones.js',`.

- [ ] **Step 4: Jalankan** — `jest tests/rit-plan-isomorphic.test.js tests/rit-plan.test.js tests/rit-route.test.js` → PASS semua.

- [ ] **Step 5: Commit** — `git add rit-plan.js server/src/lib/rit-plan.js build.mjs server/tests/rit-plan-isomorphic.test.js && git commit -m "refactor(distribusi): rit-plan is one isomorphic root module (server + phone)"`

---

### Task 2: Server — konteks lapangan + ubah nomor WA oleh sopir

**Files:**
- Modify: `server/src/services/distribution.service.js` (fungsi baru `fieldContext`, `setCustomerPhone`; export)
- Modify: `server/src/controllers/distribution.controller.js` (schema, handler, export)
- Modify: `server/src/routes/distribution.routes.js`
- Test: `server/tests/field-context.test.js` (baru)

**Interfaces:**
- Produces:
  - `GET /api/v1/distribusi/field-context?date&fleet` (cap `distribusiPengiriman`) → `{ data: { today, fleet, fleets:[plate], rules:Rules, depot:{lat,lng}|null, demand:{ [deliveryId]: galon } } }`. `fleet` = pilihan (dalam cakupan) → armada tunggal cakupan → armada pertama daftar → `''`. `demand` untuk stop `pending` hari itu = `qty` stop bila > 0, selain itu rata-rata 5 penjualan terakhir (min 1) — sama dengan `ritRoute`.
  - `PATCH /api/v1/distribusi/customers/:id/phone` (cap `distribusiLokasiSimpan`) body `{ phone }` → `{ data: customerClient }`; nomor dinormalisasi (`normalizePhone`), diaudit "Ubah nomor WA". `''` menghapus.

- [ ] **Step 1: Tes gagal** — `server/tests/field-context.test.js`:

```js
'use strict';
// FIELD CONTEXT — what the phone needs once: today, the armada (and the armada list it may pick), the
// field rules, the warehouse, and each pending stop's expected gallons (for Mode latihan's offline rit
// plan). And a driver may fix a customer's WhatsApp number without holding customer-editing rights.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const D = '/api/v1/distribusi';
const today = todayISO();
const ALL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
let gm, driver, cA, cB;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'fc_gm', password: 'secret123', role: 'gm' })).token;
  await request(app).put('/api/v1/settings/airro_fleet').set(auth(gm)).send({ value: ['DK 1', 'DK 2'] });
  const d = await reg({ name: 'Sopir', username: 'fc_driver', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: d.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiPengiriman: true }), fleetScope: JSON.stringify(['DK 1']) } });
  driver = await login('fc_driver');
  cA = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'A', type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL, phone: '0812' })).body.data.id;
  cB = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'B', type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 100, reason: 'stok awal' });
  for (const q of [3, 5]) await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cA, qty: q, method: 'lunas', txnDate: today });
  await request(app).put(`${D}/depot`).set(auth(gm)).send({ lat: -8.65, lng: 115.2 });
  await request(app).get(`${D}/deliveries?date=${today}&fleet=DK%201`).set(auth(gm));
});
afterAll(() => prisma.$disconnect());

it('a scoped driver gets their armada, the rules, the warehouse and each stop\'s expected gallons', async () => {
  const r = await request(app).get(`${D}/field-context?date=${today}`).set(auth(driver));
  expect(r.status).toBe(200);
  const c = r.body.data;
  expect(c.today).toBe(today);
  expect(c.fleet).toBe('DK 1');
  expect(c.fleets).toEqual(['DK 1']);
  expect(c.rules.ritSop.minLoad).toBe(80);
  expect(c.depot).toEqual({ lat: -8.65, lng: 115.2 });
  const board = (await request(app).get(`${D}/deliveries?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
  const stopA = board.find((s) => s.customerId === cA); const stopB = board.find((s) => s.customerId === cB);
  expect(c.demand[stopA.id]).toBe(4);   // avg(3,5)
  expect(c.demand[stopB.id]).toBe(1);   // no history → 1
});
it('a full-access user without a choice gets the first armada of the list; a choice wins', async () => {
  expect((await request(app).get(`${D}/field-context`).set(auth(gm))).body.data.fleet).toBe('DK 1');
  expect((await request(app).get(`${D}/field-context?fleet=DK%202`).set(auth(gm))).body.data.fleet).toBe('DK 2');
  expect((await request(app).get(`${D}/field-context`).set(auth(gm))).body.data.fleets).toEqual(['DK 1', 'DK 2']);
});
it('a driver can set a customer\'s WhatsApp number (normalised, audited) without customer-editing rights', async () => {
  const r = await request(app).patch(`${D}/customers/${cB}/phone`).set(auth(driver)).send({ phone: '0812 3456 7890' });
  expect(r.status).toBe(200);
  expect(r.body.data.phone).toMatch(/812/);
  const audit = (await request(app).get(`${D}/audit`).set(auth(gm))).body.data;
  expect(audit.some((a) => /Ubah nomor WA/.test(a.title))).toBe(true);
  expect((await request(app).patch(`${D}/customers/${cB}`).set(auth(driver)).send({ phone: '1' })).status).toBe(403);
});
```

Catatan untuk implementer: bila `PUT /settings/airro_fleet` menyimpan dengan bentuk lain (baca `gps.service.js` baris 32–45 cara `airro_fleet` dibaca), ikuti bentuk itu di setup tes; bila `fleetScope` disimpan dengan format lain, lihat `normalize` di `user.service.js`.

- [ ] **Step 2: Jalankan, pastikan gagal** — 404 pada `/field-context`.

- [ ] **Step 3: Service** — setelah `setDepot` di `distribution.service.js`:

```js
// FIELD CONTEXT (Mode Lapangan) — everything the phone needs once per day/armada: the armada (and the
// ones it may pick), the owner's field rules, the warehouse and each pending stop's expected gallons
// (the same demand the rit plan uses), so Mode latihan can plan rits without the server.
async function fleetListFor(user) {
  let list = [];
  try { const v = await require('./settings.service').get('airro_fleet'); list = (Array.isArray(v) ? v : []).map((f) => (typeof f === 'string' ? f : (f && (f.plate || f.name || f.id)) || '')).map((s) => String(s).trim()).filter(Boolean); } catch (e) { list = []; }   // same reading as zone.service validArmada
  const scope = fleetScopeOf(user);
  return scope === null ? list : list.filter((p) => scope.includes(p)).concat(scope.filter((p) => !list.includes(p)));
}
async function fieldContext(user, query) {
  const q = query || {};
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || '')) ? q.date : todayISO();
  const fleets = await fleetListFor(user);
  const chosen = (q.fleet && q.fleet !== 'all') ? resolveWriteFleet(user, q.fleet) : '';
  const scope = fleetScopeOf(user);
  const fleet = chosen || (scope && scope.length === 1 ? scope[0] : '') || fleets[0] || '';
  const rules = await require('./fieldRules.service').getRules();
  const depot = await depotOrigin();
  let demand = {};
  if (fleet) {
    const rows = await prisma.delivery.findMany({ where: { date: today, fleetId: fleet, status: 'pending' }, select: { id: true, customerId: true, qty: true } });
    demand = await demandFor(rows);
  }
  return { today, fleet, fleets, rules, depot, demand };
}
// A driver fixing a customer's WhatsApp number in the field (Lengkapi data) — the same cap that lets
// them save the location; audited. '' clears it.
async function setCustomerPhone(id, body, actor) {
  const cur = await prisma.customer.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, cur.armada)) throw ApiError.forbidden('Pelanggan di luar akses Anda.');
  const phone = body && body.phone != null ? normalizePhone(body.phone) : '';
  const c = await prisma.customer.update({ where: { id }, data: { phone } });
  const snap = await actorSnap(actor);
  await logAudit('pelanggan', `Ubah nomor WA: ${c.name}`, `${cur.phone || '—'} → ${phone || '—'}`, snap, c.armada);
  return custClient(c);
}
```

Tambahkan `fieldContext, setCustomerPhone` ke `module.exports` (baris yang memuat `ritRoute`/`setDepot` — cari `setDepot,` di export). `demandFor` dan `depotOrigin` didefinisikan lebih bawah dalam file yang sama; fungsi deklarasi di-hoist, jadi urutan aman.

- [ ] **Step 4: Controller + rute**

Controller (dekat `depotSchema`): 
```js
const fieldContextQuery = z.object({ date: DATE.optional(), fleet: z.string().max(60).optional() });
const phoneSchema = z.object({ phone: z.string().max(40) });
```
Handler (dekat `getFieldRules`):
```js
const fieldContext = asyncHandler(async (req, res) => res.json({ data: await service.fieldContext(req.user, req.query) }));
const setCustomerPhone = asyncHandler(async (req, res) => { const c = await service.setCustomerPhone(req.params.id, req.body, req.user); bcast('update', c.id); res.json({ data: c }); });
```
Export keduanya; `schemas` + `fieldContextQuery, phoneSchema`.

Rute (setelah `/field-rules`):
```js
router.get('/field-context', requireCap('distribusiPengiriman'), validate({ query: ctrl.schemas.fieldContextQuery }), ctrl.fieldContext);
```
dan setelah rute `/customers/:id/location-photo`:
```js
// Lengkapi data (Mode Lapangan): a driver may fix the WhatsApp number with the location cap.
router.patch('/customers/:id/phone', requireCap('distribusiLokasiSimpan'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.phoneSchema }), ctrl.setCustomerPhone);
```

- [ ] **Step 5: Jalankan** — `jest tests/field-context.test.js tests/rit-route.test.js` → PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(distribusi): field context endpoint + driver can set a customer's WhatsApp number"`

---

### Task 3: `api.js` — permintaan bertanda `X-Airro-Ui: field` + namespace `field`

**Files:**
- Modify: `api.js` (fungsi `req`/`once`, namespace `distribusi.field`, `distribusi.fieldRules`)
- Test: `server/tests/api-client-field.test.js` (baru)

**Interfaces:**
- Produces di `window.API.distribusi`:
  - `fieldRules: { get(), set(patch) }` — **tanpa** header (aturan owner, bukan tulisan lapangan).
  - `field: { context(date, fleet), board(date, fleet), customers(fleet), runs(date, fleet), ritRoute(date, fleet), daySummary(date, fleet), myChangeRequests(), mark(id, body), sale(body), openRun(body), closeRun(id, body), setLocation(id, body), setLocationPhoto(id, photoId), setPhone(id, phone), addOrder(body), adjust(id, body), gallonDamage(id, body), expense(body), correct(id, body), void(id, body), reassign(body), withdraw(id), closeDay(body), upload(body), photo(id) }` — **semua** membawa `X-Airro-Ui: field`.

- [ ] **Step 1: Tes gagal** — `server/tests/api-client-field.test.js`:

```js
'use strict';
// The new field UI tags EVERY request it makes with X-Airro-Ui: field (the server's demo fence reads
// it); the old UI's calls stay untagged; the owner's rules screen is never tagged (an owner without Demo
// penuh must still be able to save the rules).
const path = require('path');

function loadApi() {
  const calls = [];
  const win = { AIRRO_API_BASE: 'http://x/api/v1', AIRRO_API_RETRY_MS: [0, 0] };
  global.window = win;
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.fetch = async (url, opts) => { calls.push({ url, method: opts.method, headers: opts.headers }); return { status: 200, ok: true, json: async () => ({ data: {} }), headers: { get: () => null } }; };
  jest.isolateModules(() => require(path.join(__dirname, '..', '..', 'api.js')));
  return { API: win.API, calls };
}
afterEach(() => { delete global.window; delete global.fetch; delete global.localStorage; });

it('every field call carries the header; the old calls do not', async () => {
  const { API, calls } = loadApi();
  const F = API.distribusi.field;
  await F.context('2026-10-01', 'DK 1');
  await F.board('2026-10-01', 'DK 1');
  await F.sale({ customerId: 'c', qty: 1 });
  await F.mark('d1', { status: 'terkirim' });
  await F.upload({ data: 'x' });
  await API.distribusi.deliveries.board('2026-10-01', 'DK 1');
  const tagged = calls.slice(0, 5); const old = calls[5];
  tagged.forEach((c) => expect(c.headers['X-Airro-Ui']).toBe('field'));
  expect(old.headers['X-Airro-Ui']).toBeUndefined();
  expect(calls[0].url).toBe('http://x/api/v1/distribusi/field-context?date=2026-10-01&fleet=DK%201');
});
it('the owner rules screen is never tagged', async () => {
  const { API, calls } = loadApi();
  await API.distribusi.fieldRules.get();
  await API.distribusi.fieldRules.set({ ritSop: { enabled: true } });
  calls.forEach((c) => expect(c.headers['X-Airro-Ui']).toBeUndefined());
  expect(calls[1]).toMatchObject({ method: 'PUT', url: 'http://x/api/v1/distribusi/field-rules' });
});
it('the field namespace covers every adaptor method', () => {
  const { API } = loadApi();
  ['context', 'board', 'customers', 'runs', 'ritRoute', 'daySummary', 'myChangeRequests', 'mark', 'sale', 'openRun', 'closeRun', 'setLocation', 'setLocationPhoto', 'setPhone', 'addOrder', 'adjust', 'gallonDamage', 'expense', 'correct', 'void', 'reassign', 'withdraw', 'closeDay', 'upload', 'photo']
    .forEach((m) => expect(typeof API.distribusi.field[m]).toBe('function'));
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `API.distribusi.field` undefined.

- [ ] **Step 3: `req`/`once` menerima header tambahan** — ubah tanda tangan:

```js
  async function req(method, path, body, extra) {
    if (method !== 'GET') return once(method, path, body, extra);
    const delays = retryDelays();
    for (let attempt = 0; ; attempt++) {
      try { return await once(method, path, body, extra); }
```
(sisa loop tidak berubah) dan
```js
  async function once(method, path, body, extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
```

Setelah deklarasi `acctQs` (baris 88) tambahkan:

```js
  // MODE LAPANGAN — every request the new phone UI makes is tagged, so the server's demo fence
  // (middleware/fieldUi.js) can tell it apart from the old UI. Reads are retried like any GET.
  const FIELD_UI = { 'X-Airro-Ui': 'field' };
  const freq = (method, path, body) => req(method, path, body, FIELD_UI);
  const qd = (date, fleet) => { const p = []; if (date) p.push('date=' + encodeURIComponent(date)); if (fleet && fleet !== 'all') p.push('fleet=' + encodeURIComponent(fleet)); return p.length ? '?' + p.join('&') : ''; };
```

Di objek `distribusi: {`, tepat setelah baris `setDepot: …,` tambahkan:

```js
      // ATURAN LAPANGAN (owner/GM). Never tagged: an owner without Demo penuh must still save them.
      fieldRules: {
        get: () => req('GET', '/distribusi/field-rules'),
        set: (patch) => req('PUT', '/distribusi/field-rules', patch),
      },
      // MODE LAPANGAN — the new phone UI's calls (all tagged X-Airro-Ui: field). FIELDAPI.real wraps these.
      field: {
        context: (date, fleet) => freq('GET', '/distribusi/field-context' + qd(date, fleet)),
        board: (date, fleet) => freq('GET', '/distribusi/deliveries' + qd(date, fleet)),
        customers: (fleet) => freq('GET', '/distribusi/customers' + qd(null, fleet)),
        runs: (date, fleet) => freq('GET', '/distribusi/runs' + qd(date, fleet)),
        ritRoute: (date, fleet) => freq('GET', '/distribusi/deliveries/rit-route' + qd(date, fleet)),
        daySummary: (date, fleet) => freq('GET', '/distribusi/deliveries/day-summary' + qd(date, fleet)),
        myChangeRequests: () => freq('GET', '/distribusi/change-requests/mine'),
        mark: (id, body) => freq('PATCH', '/distribusi/deliveries/' + id, body),
        sale: (body) => freq('POST', '/distribusi/transactions', body),
        openRun: (body) => freq('POST', '/distribusi/runs/open', body),
        closeRun: (id, body) => freq('POST', '/distribusi/runs/' + id + '/close', body),
        setLocation: (id, body) => freq('PATCH', '/distribusi/customers/' + id + '/location', body),
        setLocationPhoto: (id, photoId) => freq('PATCH', '/distribusi/customers/' + id + '/location-photo', { photoId: photoId || null }),
        setPhone: (id, phone) => freq('PATCH', '/distribusi/customers/' + id + '/phone', { phone: phone || '' }),
        addOrder: (body) => freq('POST', '/distribusi/deliveries/order', body),
        adjust: (id, body) => freq('POST', '/distribusi/customers/' + id + '/adjustments', body),
        gallonDamage: (id, body) => freq('POST', '/distribusi/customers/' + id + '/gallon-damage', body),
        expense: (body) => freq('POST', '/distribusi/expenses', body),
        correct: (id, body) => freq('POST', '/distribusi/transactions/' + id + '/corrections', body),
        void: (id, body) => freq('POST', '/distribusi/transactions/' + id + '/void', body),
        reassign: (body) => freq('POST', '/distribusi/change-requests/reassign', body),
        withdraw: (id) => freq('POST', '/distribusi/change-requests/' + id + '/withdraw', {}),
        closeDay: (body) => freq('POST', '/distribusi/deliveries/close', body),
        upload: (body) => freq('POST', '/attachments', body),
        photo: (id) => freq('GET', '/attachments/' + id),
      },
```

- [ ] **Step 4: Jalankan** — `jest tests/api-client-field.test.js tests/api-client-retry.test.js` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(api): tagged field namespace (X-Airro-Ui) + untagged field rules for the owner"`

---

### Task 4: `dist-field-sandbox.js` — mesin Mode latihan (tanpa server)

**Files:**
- Create: `dist-field-sandbox.js` (root, UMD `window.FIELDSANDBOX`)
- Modify: `build.mjs` (FILES, setelah `'rit-plan.js'`)
- Test: `server/tests/field-sandbox.test.js` (baru)

**Interfaces:**
- Consumes: `planRit` (Task 1) — diberikan lewat `opts.planRit` atau `globalThis.RITPLAN`.
- Produces: `FIELDSANDBOX = { VERSION, fromSnapshot(snapshot, meta) → State, createSandbox(state, opts) → Adapter }`.
  - `snapshot = { context:{today, fleet, fleets, rules, depot, demand}, board:[stop], customers:[customer], runs:[run], myRequests:[request] }` (bentuk respons server).
  - `opts = { planRit, now:() => Date, onChange:(state) => void }`.
  - **Adapter** (sama persis dengan `FIELDAPI.real`, Task 5): semua metode `async` → mengembalikan **data yang sudah di-unwrap** (bukan `{data}`), melempar `Error` dengan `status`, `body.error.message`, `body.error.details.code` seperti server:
    `context() board() customers() runs() ritRoute() daySummary() myChangeRequests() markStop(id,{status,transactionId?}) holdStop(id,reason) cancelStop(id,reason) createSale(body) payBon(body) openRun(body) closeRun(id,body) setLocation(cid,body) setLocationPhoto(cid,photoId) setPhone(cid,phone) addStop(body) adjustGallon(cid,{value,reason,note?}) gallonDamage(cid,body) addExpense(body) requestCorrection(txnId,body) requestVoid(txnId,body) requestReassign(body) withdrawRequest(id) closeDay(body) uploadPhoto({data,name?,mime?}) photo(id) exportState()`.

- [ ] **Step 1: Tes gagal** — `server/tests/field-sandbox.test.js`:

```js
'use strict';
// MODE LATIHAN ENGINE — mirrors the server's field rules on a copy of real data, entirely offline.
// Nothing here may ever reach the server: the file must not even mention the API, fetch or XHR.
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..', '..');
const SB = require(path.join(root, 'dist-field-sandbox.js'));
const { planRit } = require(path.join(root, 'rit-plan.js'));

const SNAP = () => ({
  context: { today: '2026-10-01', fleet: 'DK 1', fleets: ['DK 1'], depot: { lat: -8.65, lng: 115.2 },
    rules: { ritSop: { enabled: true, minLoad: 80 }, fleetCapacity: { 'DK 1': 120 }, wajibFotoTransaksi: true, wajibFotoPengeluaran: true, wajibAlasanBatal: true, hargaGantiRugiGalon: 45000, fieldUiDefault: 'old' },
    demand: { s1: 4, s2: 2 } },
  board: [
    { id: 's1', date: '2026-10-01', fleetId: 'DK 1', customerId: 'c1', seq: 0, pinned: false, status: 'pending', qty: null, pendingReason: '', customerName: 'Pak Wayan' },
    { id: 's2', date: '2026-10-01', fleetId: 'DK 1', customerId: 'c2', seq: 1, pinned: false, status: 'pending', qty: null, pendingReason: '', customerName: 'Bu Ketut' },
  ],
  customers: [
    { id: 'c1', name: 'Pak Wayan', armada: 'DK 1', masterPrice: 18000, phone: '', lat: -8.66, lng: 115.21, locationPhotoId: null, sisaBon: 45000, gallonsHeld: 6, active: true },
    { id: 'c2', name: 'Bu Ketut', armada: 'DK 1', masterPrice: 18000, phone: '0812', lat: -8.64, lng: 115.19, locationPhotoId: 'p', sisaBon: 0, gallonsHeld: 3, active: true },
  ],
  runs: [], myRequests: [],
});
const make = () => { const saved = []; const api = SB.createSandbox(SB.fromSnapshot(SNAP(), { key: 'u1' }), { planRit, onChange: (s) => saved.push(s) }); return { api, saved }; };
const code = async (p) => { try { await p; return 'OK'; } catch (e) { return (e.body && e.body.error && e.body.error.details && e.body.error.details.code) || e.status; } };

it('never mentions the server', () => {
  const src = fs.readFileSync(path.join(root, 'dist-field-sandbox.js'), 'utf8');
  ['window.API', 'fetch(', 'XMLHttpRequest', 'API.'].forEach((s) => expect(src.includes(s)).toBe(false));
});

describe('sales + bon payments', () => {
  it('a sale needs a photo (rule on), prices at the customer\'s master price, moves gallons and bon', async () => {
    const { api, saved } = make();
    expect(await code(api.createSale({ customerId: 'c1', qty: 4, method: 'bon', gallonOut: 4, gallonIn: 6 }))).toBe('PROOF_REQUIRED');
    const ph = await api.uploadPhoto({ data: 'data:image/jpeg;base64,xx' });
    const t = await api.createSale({ customerId: 'c1', qty: 4, method: 'bon', gallonOut: 4, gallonIn: 6, proofPhotoId: ph.id });
    expect(t.amount).toBe(72000);
    expect(t.sisaBon).toBe(45000 + 72000);
    expect(t.gallonsHeld).toBe(4);
    expect(saved.length).toBeGreaterThan(0);
    const c = (await api.customers()).find((x) => x.id === 'c1');
    expect(c.sisaBon).toBe(117000);
  });
  it('transfer sale is lunas + payMethod transfer and never adds bon', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    const t = await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', payMethod: 'transfer', gallonOut: 2, proofPhotoId: ph.id });
    expect(t.method).toBe('lunas'); expect(t.payMethod).toBe('transfer'); expect(t.sisaBon).toBe(0);
  });
  it('bon payment cannot exceed sisa bon and needs a photo', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    expect(await code(api.payBon({ customerId: 'c1', payAmount: 50000, payMethod: 'tunai', proofPhotoId: ph.id }))).toBe(400);
    const r = await api.payBon({ customerId: 'c1', payAmount: 45000, payMethod: 'tunai', proofPhotoId: ph.id });
    expect(r.sisaBon).toBe(0);
  });
});

describe('stops', () => {
  it('hold needs a reason; cancel needs one when the rule is on; pending clears it', async () => {
    const { api } = make();
    expect(await code(api.holdStop('s1', ''))).toBe('REASON_REQUIRED');
    await api.holdStop('s1', 'Toko tutup');
    expect((await api.board()).find((s) => s.id === 's1')).toMatchObject({ status: 'ditunda', pendingReason: 'Toko tutup' });
    expect(await code(api.cancelStop('s2', ''))).toBe('REASON_REQUIRED');
    await api.markStop('s1', { status: 'pending' });
    expect((await api.board()).find((s) => s.id === 's1').pendingReason).toBe('');
  });
});

describe('rit', () => {
  it('capacity and SOP like the server; the rit route is planned offline from the warehouse', async () => {
    const { api } = make();
    expect(await code(api.openRun({ gallonsOut: 121 }))).toBe('OVER_CAPACITY');
    expect(await code(api.openRun({ gallonsOut: 60 }))).toBe('UNDER_SOP');
    const run = await api.openRun({ gallonsOut: 60, underSopReason: 'Rit terakhir' });
    expect(run).toMatchObject({ runNo: 1, gallonsOut: 60, status: 'open', underSopReason: 'Rit terakhir' });
    expect(await code(api.openRun({ gallonsOut: 90 }))).toBe(400);   // one open rit per armada
    const route = await api.ritRoute();
    expect(route.run.runNo).toBe(1);
    expect(route.rit.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(route.used).toBe(6);
  });
  it('closing a rit with a difference needs a reason', async () => {
    const { api } = make();
    const run = await api.openRun({ gallonsOut: 80 });
    expect(await code(api.closeRun(run.id, { gallonsFullReturned: 70, gallonsEmptyReturned: 0 }))).toBe(400);
    const closed = await api.closeRun(run.id, { gallonsFullReturned: 70, gallonsEmptyReturned: 0, diffReason: 'hitung ulang' });
    expect(closed.status).toBe('closed');
  });
});

describe('customer data, stops, gallons, expenses', () => {
  it('location, phone and location photo', async () => {
    const { api } = make();
    await api.setLocation('c1', { lat: -8.67, lng: 115.22, method: 'geser' });
    await api.setPhone('c1', '0812 999');
    const ph = await api.uploadPhoto({ data: 'x' });
    await api.setLocationPhoto('c1', ph.id);
    const c = (await api.customers()).find((x) => x.id === 'c1');
    expect(c).toMatchObject({ lat: -8.67, lng: 115.22, phone: '0812999', locationPhotoId: ph.id });
    expect(await code(api.setLocationPhoto('c1', 'nope'))).toBe(400);
  });
  it('add a stop once per customer per day', async () => {
    const { api } = make();
    const st = await api.addStop({ customerId: 'c2', qty: 3 });
    expect(st).toMatchObject({ source: 'tambahan', status: 'pending', customerId: 'c2' });
    expect(await code(api.addStop({ customerId: 'c2' }))).toBe(400);
  });
  it('ganti rugi: photo, held limit, price rule, money-only row, bon raises sisa bon', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    expect(await code(api.gallonDamage('c2', { qty: 4, kind: 'pecah', payMethod: 'bon', photoId: ph.id }))).toBe(400);
    const r = await api.gallonDamage('c2', { qty: 1, kind: 'pecah', payMethod: 'bon', photoId: ph.id });
    expect(r.transaction).toMatchObject({ kind: 'ganti_rugi', qty: 0, gallonQty: 1, amount: 45000, method: 'bon' });
    expect(r.gallonsHeld).toBe(2);
    expect(r.sisaBon).toBe(45000);
  });
  it('gallon adjustment waits for approval; expenses need a receipt photo', async () => {
    const { api } = make();
    const a = await api.adjustGallon('c1', { value: 5, reason: 'rekonsiliasi_fisik' });
    expect(a.status).toBe('pending');
    expect(await code(api.addExpense({ amount: 150000, category: 'bensin' }))).toBe('PROOF_REQUIRED');
    const ph = await api.uploadPhoto({ data: 'x' });
    expect((await api.addExpense({ amount: 150000, category: 'bensin', photoId: ph.id })).amount).toBe(150000);
  });
});

describe('corrections + day', () => {
  it('request, list, withdraw; ganti rugi cannot be corrected', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    const t = await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', proofPhotoId: ph.id });
    const req = await api.requestCorrection(t.id, { reason: 'salah ketik', qty: 1 });
    expect(req.status).toBe('pending');
    expect(await code(api.requestCorrection(t.id, { reason: 'lagi', qty: 3 }))).toBe(400);   // one pending per txn
    expect((await api.myChangeRequests())[0].id).toBe(req.id);
    expect((await api.withdrawRequest(req.id)).status).toBe('withdrawn');
    const g = await api.gallonDamage('c2', { qty: 1, kind: 'pecah', payMethod: 'tunai', photoId: ph.id });
    expect(await code(api.requestCorrection(g.transaction.id, { reason: 'x', amount: 1 }))).toBe(400);
  });
  it('day summary mirrors the server and closing the day needs a reason per pending stop', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', gallonOut: 2, proofPhotoId: ph.id });                       // 36.000 tunai
    await api.createSale({ customerId: 'c2', qty: 1, method: 'lunas', payMethod: 'transfer', gallonOut: 1, proofPhotoId: ph.id }); // 18.000 transfer
    await api.payBon({ customerId: 'c1', payAmount: 10000, payMethod: 'tunai', proofPhotoId: ph.id });                             // 10.000 tunai
    await api.addExpense({ amount: 5000, category: 'parkir', photoId: ph.id });
    const s = await api.daySummary();
    expect(s).toMatchObject({ tunaiPenjualan: 36000, tunaiPelunasan: 10000, transfer: 18000, pengeluaran: 5000, wajibSetor: 41000 });
    expect(await code(api.closeDay({ reasons: {} }))).toBe(400);
    const r = await api.closeDay({ reasons: { s1: 'tutup', s2: 'tutup' } });
    expect(r.pending).toBe(2);
    expect((await api.board()).every((x) => x.status === 'ditunda')).toBe(true);
  });
  it('the state is JSON and round-trips', async () => {
    const { api } = make();
    await api.holdStop('s1', 'x');
    const st = api.exportState();
    const again = SB.createSandbox(JSON.parse(JSON.stringify(st)), { planRit });
    expect((await again.board()).find((x) => x.id === 's1').status).toBe('ditunda');
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `Cannot find module …/dist-field-sandbox.js`.

- [ ] **Step 3: Tulis `dist-field-sandbox.js`**

```js
/*
 * MODE LATIHAN ENGINE — the new field UI's practice mode. It works on a COPY of real data taken once
 * (FIELDAPI.snapshot) and mirrors the server's field rules (SOP muatan, kapasitas armada, foto wajib,
 * alasan tunda/batal, sisa bon, galon di pelanggan, ganti rugi, satu rit terbuka, satu pengajuan per
 * transaksi, tutup hari) so practice feels real — but it NEVER talks to the server: everything stays in
 * this object and is persisted by the caller (IndexedDB on the phone). Same method names and result
 * shapes as FIELDAPI.real so every screen works unchanged in both modes.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // tests (CommonJS)
  if (root) root.FIELDSANDBOX = api;                                           // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (root) {
  'use strict';
  var VERSION = 1;
  var clone = function (x) { return x == null ? x : JSON.parse(JSON.stringify(x)); };
  var int = function (v) { var n = Math.round(Number(v)); return isFinite(n) ? n : 0; };
  function fail(status, message, code, extra) {
    var e = new Error(message); e.status = status; e.latihan = true;
    e.body = { error: { message: message, details: Object.assign(code ? { code: code } : {}, extra || {}) } };
    return e;
  }
  var hasPt = function (c) { return c && typeof c.lat === 'number' && typeof c.lng === 'number' && isFinite(c.lat) && isFinite(c.lng); };
  var digits = function (p) { return String(p || '').replace(/[^0-9+]/g, ''); };

  function fromSnapshot(snap, meta) {
    var s = snap || {}; var ctx = s.context || {};
    var customers = {};
    (s.customers || []).forEach(function (c) {
      customers[c.id] = {
        id: c.id, name: c.name || '', code: c.code || '', phone: c.phone || '', address: c.address || '', armada: c.armada || '',
        masterPrice: int(c.masterPrice), lat: c.lat != null ? c.lat : null, lng: c.lng != null ? c.lng : null,
        locationPhotoId: c.locationPhotoId || null, deliveryDays: c.deliveryDays || [], fixedDays: !!c.fixedDays,
        active: c.active !== false, sisaBon: int(c.sisaBon), gallonsHeld: int(c.gallonsHeld),
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
      runs: (s.runs || []).map(function (r) { return { id: r.id, date: r.date, fleetId: r.fleetId, runNo: int(r.runNo), gallonsOut: int(r.gallonsOut), gallonsFullReturned: int(r.gallonsFullReturned), gallonsEmptyReturned: int(r.gallonsEmptyReturned), status: r.status || 'open', underSopReason: r.underSopReason || '', diffReason: r.diffReason || '', sold: int(r.sold) }; }),
      txns: [], expenses: [], requests: clone(s.myRequests) || [], adjustments: [], photos: {}, closeouts: [], seq: 1,
    };
  }

  function createSandbox(state, opts) {
    var s = state; var o = opts || {};
    var planRit = o.planRit || (root && root.RITPLAN && root.RITPLAN.planRit);
    var now = o.now || function () { return new Date(); };
    var changed = o.onChange || function () {};
    var nid = function (p) { return 'lat-' + p + '-' + (s.seq++); };
    var rules = function () { return s.rules || {}; };
    var cust = function (cid) { var c = s.customers[cid]; if (!c) throw fail(404, 'Pelanggan tidak ditemukan.'); return c; };
    var photoOk = function (id) { return !!(id && s.photos[id]); };
    var openRunOf = function () { return s.runs.find(function (r) { return r.fleetId === s.fleet && r.status === 'open'; }) || null; };
    function stopView(st) {
      var c = s.customers[st.customerId] || {};
      return Object.assign({}, st, { customerName: c.name || '', customerCode: c.code || '', phone: c.phone || '', masterPrice: c.masterPrice || 0, sisaBon: c.sisaBon || 0, lat: c.lat, lng: c.lng, hasLocation: hasPt(c), locationPhotoId: c.locationPhotoId || null, deliveryDays: c.deliveryDays || [], armada: c.armada || '' });
    }
    function custView(c) { return Object.assign({}, c, { hasLocation: hasPt(c) }); }
    function run(fn) { return function () { try { var r = fn.apply(null, arguments); if (r && r.__write) { delete r.__write; changed(s); } return Promise.resolve(clone(r && r.value !== undefined && r.__v ? r.value : r)); } catch (e) { return Promise.reject(e); } }; }
    var W = function (v) { return { __write: true, __v: true, value: v }; };
    function proof(body, ruleKey) {
      var id = body.proofPhotoId || '';
      if (!id) { if (rules()[ruleKey]) throw fail(400, 'Foto bukti wajib dilampirkan.', 'PROOF_REQUIRED'); return {}; }
      if (!photoOk(id)) throw fail(400, 'Foto bukti tidak ditemukan — unggah ulang fotonya.', 'PROOF_MISSING');
      return { proofPhotoId: id, proofTakenAt: body.proofTakenAt || null, proofLat: body.proofLat != null ? +body.proofLat : null, proofLng: body.proofLng != null ? +body.proofLng : null };
    }
    function pushTxn(t) { t.id = nid('txn'); t.status = 'active'; t.createdAt = now().getTime(); t.txnDate = t.txnDate || s.date; t.fleetId = t.fleetId || s.fleet; s.txns.push(t); return t; }

    var api = {
      mode: 'latihan',
      context: run(function () { return { today: s.date, fleet: s.fleet, fleets: s.fleets, rules: s.rules, depot: s.depot, demand: s.demand }; }),
      board: run(function () { return s.stops.filter(function (st) { return st.date === s.date; }).sort(function (a, b) { return a.seq - b.seq; }).map(stopView); }),
      customers: run(function () { return Object.keys(s.customers).map(function (k) { return custView(s.customers[k]); }); }),
      runs: run(function () { return s.runs.filter(function (r) { return r.date === s.date && r.fleetId === s.fleet; }); }),
      myChangeRequests: run(function () { return s.requests.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }); }),

      markStop: run(function (id, body) {
        var st = s.stops.find(function (x) { return x.id === id; }); if (!st) throw fail(404, 'Pengiriman tidak ditemukan.');
        var status = ['pending', 'terkirim'].indexOf(body && body.status) >= 0 ? body.status : st.status;
        st.status = status; if (status === 'pending') st.pendingReason = '';
        if (body && body.transactionId) st.transactionId = body.transactionId;
        return W(stopView(st));
      }),
      holdStop: run(function (id, reason) {
        var st = s.stops.find(function (x) { return x.id === id; }); if (!st) throw fail(404, 'Pengiriman tidak ditemukan.');
        var r = String(reason || '').trim(); if (!r) throw fail(400, 'Alasan tunda wajib diisi.', 'REASON_REQUIRED');
        st.status = 'ditunda'; st.pendingReason = r.slice(0, 300); return W(stopView(st));
      }),
      cancelStop: run(function (id, reason) {
        var st = s.stops.find(function (x) { return x.id === id; }); if (!st) throw fail(404, 'Pengiriman tidak ditemukan.');
        var r = String(reason || '').trim(); if (!r && rules().wajibAlasanBatal) throw fail(400, 'Alasan batal wajib diisi.', 'REASON_REQUIRED');
        st.status = 'batal'; st.pendingReason = r.slice(0, 300); return W(stopView(st));
      }),

      createSale: run(function (body) {
        var b = body || {}; var c = cust(b.customerId);
        if (!c.active) throw fail(400, 'Pelanggan nonaktif — aktifkan kembali untuk transaksi baru.');
        var method = b.method === 'bon' ? 'bon' : 'lunas';
        var qty = int(b.qty); if (qty <= 0) throw fail(400, 'qty must be a positive integer');
        var pr = proof(b, 'wajibFotoTransaksi');
        var amount = qty * c.masterPrice;
        var out = b.gallonOut != null ? Math.max(0, int(b.gallonOut)) : qty; var inn = Math.max(0, int(b.gallonIn));
        var ro = openRunOf();
        var t = pushTxn(Object.assign({ customerId: c.id, qty: qty, unitPriceLocked: c.masterPrice, amount: amount, method: method, payMethod: method === 'bon' ? '' : (b.payMethod === 'transfer' ? 'transfer' : 'tunai'), kind: 'jual', gallonQty: 0, gallonOut: out, gallonIn: inn, deliveryRunId: ro ? ro.id : null, note: String(b.note || '') }, pr));
        if (ro) ro.sold += qty;
        c.gallonsHeld += out - inn; if (method === 'bon') c.sisaBon += amount;
        return W(Object.assign({}, t, { sisaBon: c.sisaBon, gallonsHeld: c.gallonsHeld }));
      }),
      payBon: run(function (body) {
        var b = body || {}; var c = cust(b.customerId);
        var amt = int(b.payAmount); if (amt <= 0) throw fail(400, 'Jumlah pembayaran harus lebih dari 0.');
        if (c.sisaBon <= 0) throw fail(400, 'Pelanggan ini tidak punya sisa bon.');
        if (amt > c.sisaBon) throw fail(400, 'Pembayaran (' + amt + ') melebihi sisa bon (' + c.sisaBon + ').', null, { sisaBon: c.sisaBon });
        var pr = proof(b, 'wajibFotoTransaksi');
        var t = pushTxn(Object.assign({ customerId: c.id, qty: 0, unitPriceLocked: 0, amount: amt, method: 'pelunasan', payMethod: b.payMethod === 'transfer' ? 'transfer' : 'tunai', kind: 'jual', gallonQty: 0, note: String(b.note || '') }, pr));
        c.sisaBon -= amt;
        return W(Object.assign({}, t, { sisaBon: c.sisaBon, gallonsHeld: c.gallonsHeld, isPayment: true }));
      }),

      openRun: run(function (body) {
        var b = body || {}; var out = int(b.gallonsOut);
        if (out <= 0) throw fail(400, 'Jumlah galon dimuat harus lebih dari 0.');
        var r = rules(); var cap = (r.fleetCapacity || {})[s.fleet] || null;
        if (cap && out > cap) throw fail(400, 'Muatan ' + out + ' galon melebihi kapasitas armada ' + s.fleet + ' (' + cap + ' galon).', 'OVER_CAPACITY', { capacity: cap });
        var sop = r.ritSop || {}; var reason = String(b.underSopReason || '').trim().slice(0, 300);
        var under = !!sop.enabled && out < (sop.minLoad || 80);
        if (under && !reason) throw fail(400, 'Muatan di bawah SOP (minimal ' + (sop.minLoad || 80) + ' galon) — isi alasannya.', 'UNDER_SOP', { minLoad: sop.minLoad || 80 });
        if (openRunOf()) throw fail(400, 'Masih ada rit terbuka untuk armada ini — tutup dulu.');
        var runNo = s.runs.filter(function (x) { return x.date === s.date && x.fleetId === s.fleet; }).reduce(function (m, x) { return Math.max(m, x.runNo); }, 0) + 1;
        var ru = { id: nid('run'), date: s.date, fleetId: s.fleet, runNo: runNo, gallonsOut: out, gallonsFullReturned: 0, gallonsEmptyReturned: 0, status: 'open', underSopReason: under ? reason : '', diffReason: '', sold: 0, note: String(b.note || '') };
        s.runs.push(ru); return W(ru);
      }),
      closeRun: run(function (id, body) {
        var ru = s.runs.find(function (x) { return x.id === id; }); if (!ru) throw fail(404, 'Rit tidak ditemukan.');
        if (ru.status === 'closed') throw fail(400, 'Rit ini sudah ditutup.');
        var b = body || {}; var full = int(b.gallonsFullReturned); var empty = int(b.gallonsEmptyReturned);
        var expected = ru.gallonsOut - ru.sold; var diff = full - expected;
        var reason = String(b.diffReason || '').trim();
        if (diff !== 0 && !reason) throw fail(400, 'Selisih ' + (diff > 0 ? '+' : '') + diff + ' galon (seharusnya ' + expected + ', dikembalikan ' + full + ') — alasan wajib diisi.', null, { diff: diff, expectedRemaining: expected });
        ru.gallonsFullReturned = full; ru.gallonsEmptyReturned = empty; ru.diffReason = reason; ru.status = 'closed';
        return W(Object.assign({}, ru, { expectedRemaining: expected, diff: diff }));
      }),
      ritRoute: run(function () {
        var ru = openRunOf(); if (!ru) throw fail(400, 'Buka rit dulu (isi galon yang dimuat) — rute rit dihitung dari muatan rit itu.');
        if (!s.depot) throw fail(400, 'Lokasi gudang belum diatur. Atur di Peta Zona → "Atur lokasi gudang".');
        if (typeof planRit !== 'function') throw fail(500, 'Perencana rute tidak tersedia.');
        var pend = s.stops.filter(function (st) { return st.date === s.date && st.fleetId === s.fleet && st.status === 'pending'; }).sort(function (a, b) { return a.seq - b.seq; });
        var byId = {}; pend.forEach(function (st) { byId[st.id] = stopView(st); });
        var q = {}; pend.forEach(function (st) { q[st.id] = st.qty > 0 ? st.qty : (s.demand[st.id] || 1); });
        var plan = planRit({ depot: s.depot, capacity: ru.gallonsOut - ru.sold, stops: pend.map(function (st) { var v = byId[st.id]; return { id: st.id, lat: v.lat, lng: v.lng, qty: q[st.id], pinned: st.pinned }; }) });
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
        if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw fail(400, 'Koordinat tidak valid.');
        c.lat = lat; c.lng = lng; return W(custView(c));
      }),
      setLocationPhoto: run(function (cid, photoId) {
        var c = cust(cid); if (photoId && !photoOk(photoId)) throw fail(400, 'Foto tidak ditemukan — unggah ulang fotonya.');
        c.locationPhotoId = photoId || null; return W(custView(c));
      }),
      setPhone: run(function (cid, phone) { var c = cust(cid); c.phone = digits(phone); return W(custView(c)); }),
      addStop: run(function (body) {
        var b = body || {}; var c = cust(b.customerId);
        if (!c.active) throw fail(400, 'Pelanggan nonaktif — aktifkan kembali untuk menambah orderan.');
        if (s.stops.some(function (x) { return x.date === s.date && x.customerId === c.id && x.source === 'tambahan'; })) throw fail(400, 'Pelanggan ini sudah punya orderan tambahan hari ini.');
        var seq = s.stops.filter(function (x) { return x.date === s.date; }).reduce(function (m, x) { return Math.max(m, x.seq); }, -1) + 1;
        var st = { id: nid('stop'), date: s.date, fleetId: c.armada || s.fleet, customerId: c.id, source: 'tambahan', seq: seq, pinned: false, status: 'pending', qty: b.qty != null ? int(b.qty) : null, note: String(b.note || ''), pendingReason: '', transactionId: null };
        s.stops.push(st); return W(stopView(st));
      }),
      adjustGallon: run(function (cid, body) {
        var c = cust(cid); var b = body || {}; var v = int(b.value);
        if (v < 0) throw fail(400, 'Jumlah galon tidak valid.');
        if (!String(b.reason || '').trim()) throw fail(400, 'Alasan wajib diisi.');
        var a = { id: nid('adj'), customerId: c.id, kind: 'galon', before: c.gallonsHeld, after: v, delta: v - c.gallonsHeld, reason: b.reason, note: String(b.note || ''), status: 'pending', createdAt: now().getTime() };
        s.adjustments.push(a); return W(a);
      }),
      gallonDamage: run(function (cid, body) {
        var c = cust(cid); var b = body || {}; var qty = int(b.qty);
        if (qty <= 0) throw fail(400, 'Jumlah galon harus lebih dari 0.');
        if (!b.photoId) throw fail(400, 'Foto galon rusak wajib dilampirkan.', 'PROOF_REQUIRED');
        if (!photoOk(b.photoId)) throw fail(400, 'Foto tidak ditemukan — unggah ulang fotonya.', 'PROOF_MISSING');
        if (qty > c.gallonsHeld) throw fail(400, 'Pelanggan hanya memegang ' + c.gallonsHeld + ' galon — tidak bisa mengganti rugi ' + qty + '.', null, { held: c.gallonsHeld });
        var price = int(rules().hargaGantiRugiGalon); if (!price) throw fail(400, 'Harga ganti rugi galon belum diatur pemilik.', 'NO_PRICE');
        var pay = ['tunai', 'bon', 'transfer'].indexOf(b.payMethod) >= 0 ? b.payMethod : 'tunai';
        var kind = ['pecah', 'bocor', 'retak', 'hilang'].indexOf(b.kind) >= 0 ? b.kind : 'pecah';
        var t = pushTxn({ customerId: c.id, qty: 0, unitPriceLocked: price, amount: qty * price, method: pay === 'bon' ? 'bon' : 'lunas', payMethod: pay === 'bon' ? '' : pay, kind: 'ganti_rugi', gallonQty: qty, proofPhotoId: b.photoId, note: 'Ganti rugi ' + qty + ' galon ' + kind });
        c.gallonsHeld -= qty; if (pay === 'bon') c.sisaBon += qty * price;
        return W({ transaction: t, gallonsHeld: c.gallonsHeld, sisaBon: c.sisaBon });
      }),
      addExpense: run(function (body) {
        var b = body || {}; var amt = int(b.amount);
        if (amt <= 0) throw fail(400, 'Nominal pengeluaran harus lebih dari 0.');
        if (!b.photoId && rules().wajibFotoPengeluaran) throw fail(400, 'Foto nota wajib dilampirkan.', 'PROOF_REQUIRED');
        if (b.photoId && !photoOk(b.photoId)) throw fail(400, 'Foto nota tidak ditemukan — unggah ulang fotonya.', 'PROOF_MISSING');
        var x = { id: nid('exp'), date: s.date, fleetId: s.fleet, amount: amt, category: String(b.category || 'lainnya'), method: 'tunai', note: String(b.note || ''), photoId: b.photoId || null, status: 'active', createdAt: now().getTime() };
        s.expenses.push(x); return W(x);
      }),

      requestCorrection: run(function (txnId, body) {
        var t = s.txns.find(function (x) { return x.id === txnId; }); if (!t) throw fail(404, 'Transaction not found');
        if (t.status === 'void') throw fail(400, 'Transaksi ini sudah dibatalkan.');
        if (t.kind === 'ganti_rugi') throw fail(400, 'Ganti rugi galon tidak bisa dikoreksi — ajukan pembatalan lalu catat ulang.');
        return W(pushRequest(t, 'correction', body));
      }),
      requestVoid: run(function (txnId, body) {
        var t = s.txns.find(function (x) { return x.id === txnId; }); if (!t) throw fail(404, 'Transaction not found');
        if (t.status === 'void') throw fail(400, 'Transaksi ini sudah dibatalkan.');
        return W(pushRequest(t, 'void', body));
      }),
      requestReassign: run(function (body) {
        var b = body || {}; var ids = b.transactionIds || [];
        var t = s.txns.find(function (x) { return x.id === ids[0]; }); if (!t) throw fail(404, 'Transaction not found');
        if (ids.some(function (i) { var x = s.txns.find(function (y) { return y.id === i; }); return x && x.kind === 'ganti_rugi'; })) throw fail(400, 'Ganti rugi galon tidak bisa dipindahkan ke pelanggan lain — ajukan pembatalan lalu catat ulang.');
        if (!String(b.note || '').trim()) throw fail(400, 'Catatan wajib diisi.');
        return W(pushRequest(t, 'reassign', Object.assign({ reason: b.reason || b.note }, b)));
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
        var co = { id: nid('close'), date: s.date, fleetId: s.fleet, generalNote: String(b.generalNote || ''), pending: pend.length, closedAt: now().getTime() };
        s.closeouts.push(co);
        return W({ closeout: co, fleetId: s.fleet, pending: pend.length });
      }),
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
      uploadPhoto: run(function (body) {
        var d = body && body.data; if (!d) throw fail(400, 'Foto kosong.');
        var id = nid('photo'); s.photos[id] = String(d);
        return W({ id: id, name: (body && body.name) || 'foto.jpg', isImg: true, mime: (body && body.mime) || 'image/jpeg' });
      }),
      photo: run(function (id) { return s.photos[id] || null; }),
      exportState: function () { return clone(s); },
    };
    function pushRequest(t, kind, body) {
      var b = body || {};
      if (!String(b.reason || '').trim() && kind !== 'reassign') throw fail(400, 'Alasan wajib diisi.');
      if (s.requests.some(function (r) { return r.transactionId === t.id && r.status === 'pending'; })) throw fail(400, 'Sudah ada pengajuan menunggu persetujuan untuk transaksi ini.');
      var payload = Object.assign({}, b); delete payload.reason;
      var r = { id: nid('req'), transactionId: t.id, kind: kind, status: 'pending', reason: String(b.reason || ''), payload: payload, createdAt: now().getTime(), decisionNote: '' };
      s.requests.push(r); return r;
    }
    return api;
  }

  return { VERSION: VERSION, fromSnapshot: fromSnapshot, createSandbox: createSandbox };
});
```

Tambahkan `'dist-field-sandbox.js',` di `build.mjs` `FILES` tepat setelah `'rit-plan.js',`.

- [ ] **Step 4: Jalankan** — `jest tests/field-sandbox.test.js` → PASS (≈14). Bila satu tes gagal karena aturan yang berbeda dari server, **ikuti server** (baca fungsi server yang bersangkutan) dan catat ruling.

- [ ] **Step 5: Commit** — `git commit -m "feat(distribusi): Mode latihan engine — server field rules offline, never calls the server"`

---

### Task 5: `dist-field-api.js` — adaptor asli, salinan latihan, penyimpanan HP, preferensi

**Files:**
- Create: `dist-field-api.js` (root, UMD `window.FIELDAPI`)
- Modify: `build.mjs` (FILES, setelah `'api.js'` — butuh `window.API` saat dipanggil, bukan saat dimuat, tapi taruh setelahnya agar jelas)
- Test: `server/tests/field-api.test.js` (baru)

**Interfaces:**
- Consumes: `API.distribusi.field.*` (Task 3), `FIELDSANDBOX` (Task 4), `RITPLAN` (Task 1).
- Produces `window.FIELDAPI`:
  - `METHODS` — daftar nama metode adaptor (sama dengan Task 4).
  - `real(API, { date, fleet }) → Adapter` (mode `'asli'`, respons di-unwrap dari `{data}`).
  - `snapshot(realAdapter) → Promise<snapshot>`.
  - `openLatihan({ key, real, storage, planRit?, sandbox? }) → Promise<Adapter & { reset() }>` — memakai state tersimpan bila ada (versi sama), selain itu mengambil snapshot lalu menyimpan; **tidak menyimpan apa pun bila snapshot gagal** (error diteruskan).
  - `memoryStorage()` dan `idbStorage(dbName?)` — `{ get(key), set(key, value), del(key) }` (async).
  - `prefState({ perms, rules, prefs }) → { eligible, released, canLatihan, canAsli, ui:'old'|'new', mode:'latihan'|'asli' }`.
  - `loadPrefs() → { ui?, mode? }`, `savePrefs(p)` — `localStorage` kunci `airro.dist.fieldUi` / `airro.dist.fieldMode`, dibungkus try/catch.
  - `dataGaps(customer) → { titik:boolean, wa:boolean, foto:boolean, count:number }`.

- [ ] **Step 1: Tes gagal** — `server/tests/field-api.test.js`:

```js
'use strict';
// THE FIELD ADAPTOR — one interface, two implementations: real (server, tagged) and latihan (the phone).
const path = require('path');
const root = path.join(__dirname, '..', '..');
global.RITPLAN = require(path.join(root, 'rit-plan.js'));
const SB = require(path.join(root, 'dist-field-sandbox.js'));
const FA = require(path.join(root, 'dist-field-api.js'));

const fakeApi = (over) => {
  const calls = [];
  const ok = (v) => (...a) => { calls.push(a); return Promise.resolve({ data: v }); };
  const F = { context: ok({ today: '2026-10-01', fleet: 'DK 1', fleets: ['DK 1'], rules: { ritSop: { enabled: false, minLoad: 80 }, fleetCapacity: {}, hargaGantiRugiGalon: 0 }, depot: null, demand: {} }),
    board: ok([{ id: 's1', date: '2026-10-01', fleetId: 'DK 1', customerId: 'c1', status: 'pending', seq: 0 }]),
    customers: ok([{ id: 'c1', name: 'A', armada: 'DK 1', masterPrice: 6000, sisaBon: 0, gallonsHeld: 2 }]),
    runs: ok([]), myChangeRequests: ok([]), ...(over || {}) };
  FA.METHODS.forEach((m) => { if (!F[m]) F[m] = ok({}); });
  ['mark', 'sale', 'openRun', 'closeRun', 'setPhone', 'addOrder', 'adjust', 'gallonDamage', 'expense', 'correct', 'void', 'reassign', 'withdraw', 'closeDay', 'upload', 'photo', 'ritRoute', 'daySummary', 'setLocation', 'setLocationPhoto'].forEach((m) => { if (!F[m]) F[m] = ok({}); });
  return { API: { distribusi: { field: F } }, calls };
};

it('both adaptors expose exactly the same methods', () => {
  const { API } = fakeApi();
  const real = FA.real(API, { date: '2026-10-01', fleet: 'DK 1' });
  const lat = SB.createSandbox(SB.fromSnapshot({ context: {}, board: [], customers: [], runs: [], myRequests: [] }), {});
  FA.METHODS.forEach((m) => { expect(typeof real[m]).toBe('function'); expect(typeof lat[m]).toBe('function'); });
  expect(real.mode).toBe('asli'); expect(lat.mode).toBe('latihan');
});
it('real unwraps {data} and fills date/fleet', async () => {
  const { API } = fakeApi();
  const calls = [];
  API.distribusi.field.sale = (b) => { calls.push(b); return Promise.resolve({ data: { id: 't' } }); };
  const real = FA.real(API, { date: '2026-10-01', fleet: 'DK 1' });
  expect(await real.board()).toEqual([expect.objectContaining({ id: 's1' })]);
  await real.payBon({ customerId: 'c1', payAmount: 1000 });
  expect(calls[0]).toMatchObject({ method: 'pelunasan', txnDate: '2026-10-01', payAmount: 1000 });
});
it('latihan: snapshot once, persist, reopen from storage, reset re-copies', async () => {
  const { API } = fakeApi();
  const storage = FA.memoryStorage();
  const real = FA.real(API, { date: '2026-10-01', fleet: 'DK 1' });
  const a = await FA.openLatihan({ key: 'u1', real, storage, sandbox: SB });
  await a.holdStop('s1', 'tutup');
  await new Promise((r) => setTimeout(r, 0));
  const b = await FA.openLatihan({ key: 'u1', real: FA.real(fakeApi({ board: () => Promise.reject(new Error('should not re-copy')) }).API, { date: '2026-10-01', fleet: 'DK 1' }), storage, sandbox: SB });
  expect((await b.board())[0].status).toBe('ditunda');
  await b.reset();
  const c = await FA.openLatihan({ key: 'u1', real, storage, sandbox: SB });
  expect((await c.board())[0].status).toBe('pending');
});
it('latihan: a failed copy stores nothing and reports the error', async () => {
  const { API } = fakeApi({ board: () => Promise.reject(Object.assign(new Error('offline'), { offline: true })) });
  const storage = FA.memoryStorage();
  await expect(FA.openLatihan({ key: 'u2', real: FA.real(API, { date: '2026-10-01', fleet: 'DK 1' }), storage, sandbox: SB })).rejects.toMatchObject({ offline: true });
  expect(await storage.get('u2')).toBeUndefined();
});

describe('who sees what (prefState)', () => {
  const rulesOld = { fieldUiDefault: 'old' }; const rulesNew = { fieldUiDefault: 'new' };
  it('no demo caps → not eligible, old UI', () => {
    expect(FA.prefState({ perms: { distribusiPengiriman: true }, rules: rulesOld, prefs: { ui: 'new' } })).toMatchObject({ eligible: false, ui: 'old' });
  });
  it('Demo latihan only → never Mode asli, even with a stored preference', () => {
    expect(FA.prefState({ perms: { distribusiPengiriman: true, distribusiDemoLatihan: true }, rules: rulesOld, prefs: { ui: 'new', mode: 'asli' } })).toMatchObject({ eligible: true, ui: 'new', mode: 'latihan', canAsli: false });
  });
  it('Demo penuh → both modes; default latihan; old UI until chosen', () => {
    const r = FA.prefState({ perms: { distribusiPengiriman: true, distribusiDemoPenuh: true, distribusiDemoLatihan: true }, rules: rulesOld, prefs: {} });
    expect(r).toMatchObject({ eligible: true, ui: 'old', mode: 'latihan', canAsli: true, canLatihan: true });
  });
  it('after release: every field user opens the new UI in Mode asli; latihan stays for demo holders', () => {
    expect(FA.prefState({ perms: { distribusiPengiriman: true }, rules: rulesNew, prefs: {} })).toMatchObject({ eligible: true, ui: 'new', mode: 'asli', canLatihan: false });
    expect(FA.prefState({ perms: { distribusiPengiriman: true, distribusiDemoLatihan: true }, rules: rulesNew, prefs: { mode: 'latihan' } })).toMatchObject({ mode: 'latihan', canAsli: true });
  });
  it('no board cap → nothing', () => {
    expect(FA.prefState({ perms: { distribusiDemoPenuh: true }, rules: rulesNew, prefs: {} }).eligible).toBe(false);
  });
});
it('data gaps (titik, WA, foto)', () => {
  expect(FA.dataGaps({ lat: null, lng: null, phone: '', locationPhotoId: null })).toEqual({ titik: true, wa: true, foto: true, count: 3 });
  expect(FA.dataGaps({ lat: 1, lng: 2, phone: '08', locationPhotoId: 'p' }).count).toBe(0);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — modul belum ada.

- [ ] **Step 3: Tulis `dist-field-api.js`**

```js
/*
 * MODE LAPANGAN ADAPTOR — one interface for every field screen, two implementations:
 *   real(API, ctx)  → the server (API.distribusi.field.*, every request tagged X-Airro-Ui: field)
 *   openLatihan(…)  → FIELDSANDBOX on a copy of real data, persisted on this phone (IndexedDB) and
 *                     NEVER sent to the server.
 * Plus the pure rules for who sees the new UI in which mode (prefState) and the per-phone preference.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FIELDAPI = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (root) {
  'use strict';
  var METHODS = ['context', 'board', 'customers', 'runs', 'ritRoute', 'daySummary', 'myChangeRequests', 'markStop', 'holdStop', 'cancelStop', 'createSale', 'payBon', 'openRun', 'closeRun', 'setLocation', 'setLocationPhoto', 'setPhone', 'addStop', 'adjustGallon', 'gallonDamage', 'addExpense', 'requestCorrection', 'requestVoid', 'requestReassign', 'withdrawRequest', 'closeDay', 'uploadPhoto', 'photo'];
  var unwrap = function (r) { return r && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, 'data') ? r.data : r; };
  var U = function (p) { return Promise.resolve(p).then(unwrap); };
  var A = function (base, extra) { return Object.assign({}, base || {}, extra || {}); };

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
      payBon: function (b) { return U(F.sale(A({ txnDate: c.date }, A(b, { method: 'pelunasan' })))); },
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
  function snapshot(realAdapter) {
    return Promise.all([realAdapter.context(), realAdapter.board(), realAdapter.customers(), realAdapter.runs(), realAdapter.myChangeRequests()])
      .then(function (r) { return { context: r[0], board: r[1] || [], customers: r[2] || [], runs: r[3] || [], myRequests: r[4] || [] }; });
  }

  function memoryStorage() {
    var m = {};
    return { get: function (k) { return Promise.resolve(m[k] ? JSON.parse(m[k]) : undefined); }, set: function (k, v) { m[k] = JSON.stringify(v); return Promise.resolve(); }, del: function (k) { delete m[k]; return Promise.resolve(); } };
  }
  // IndexedDB key-value store (photos make practice state too large for localStorage).
  function idbStorage(dbName) {
    var name = dbName || 'airro-latihan'; var store = 'state'; var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        var req = root.indexedDB.open(name, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(store); };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      });
      return dbp;
    }
    function tx(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction(store, mode); var r = fn(t.objectStore(store)); t.oncomplete = function () { res(r && r.result); }; t.onerror = function () { rej(t.error); }; }); }); }
    return {
      get: function (k) { return tx('readonly', function (s) { return s.get(k); }); },
      set: function (k, v) { return tx('readwrite', function (s) { return s.put(v, k); }); },
      del: function (k) { return tx('readwrite', function (s) { return s.delete(k); }); },
    };
  }

  function openLatihan(opts) {
    var o = opts || {}; var SB = o.sandbox || root.FIELDSANDBOX; var planRit = o.planRit || (root.RITPLAN && root.RITPLAN.planRit);
    return Promise.resolve(o.storage.get(o.key)).then(function (saved) {
      if (saved && saved.v === SB.VERSION) return saved;
      return snapshot(o.real).then(function (snap) { var st = SB.fromSnapshot(snap, { key: o.key }); return Promise.resolve(o.storage.set(o.key, st)).then(function () { return st; }); });
    }).then(function (state) {
      var a = SB.createSandbox(state, { planRit: planRit, onChange: function (st) { Promise.resolve(o.storage.set(o.key, st)).catch(function () {}); } });
      a.reset = function () { return Promise.resolve(o.storage.del(o.key)); };
      return a;
    });
  }

  function prefState(args) {
    var a = args || {}; var p = a.perms || {}; var rules = a.rules || {}; var prefs = a.prefs || {};
    var released = rules.fieldUiDefault === 'new';
    var board = !!p.distribusiPengiriman;
    var canLatihan = board && !!(p.distribusiDemoLatihan || p.distribusiDemoPenuh);
    var canAsli = board && (released || !!p.distribusiDemoPenuh);
    var eligible = board && (released || canLatihan);
    var ui = !eligible ? 'old' : (prefs.ui === 'new' || prefs.ui === 'old' ? prefs.ui : (released ? 'new' : 'old'));
    var mode = !canAsli ? 'latihan' : !canLatihan ? 'asli' : (prefs.mode === 'asli' ? 'asli' : prefs.mode === 'latihan' ? 'latihan' : (released ? 'asli' : 'latihan'));
    return { eligible: eligible, released: released, canLatihan: canLatihan, canAsli: canAsli, ui: ui, mode: mode };
  }
  var KEY_UI = 'airro.dist.fieldUi', KEY_MODE = 'airro.dist.fieldMode';
  function loadPrefs() { try { return { ui: root.localStorage.getItem(KEY_UI) || undefined, mode: root.localStorage.getItem(KEY_MODE) || undefined }; } catch (e) { return {}; } }
  function savePrefs(p) { try { if (p.ui) root.localStorage.setItem(KEY_UI, p.ui); if (p.mode) root.localStorage.setItem(KEY_MODE, p.mode); } catch (e) {} }
  function dataGaps(c) {
    var x = c || {}; var titik = !(typeof x.lat === 'number' && typeof x.lng === 'number'); var wa = !String(x.phone || '').trim(); var foto = !x.locationPhotoId;
    return { titik: titik, wa: wa, foto: foto, count: (titik ? 1 : 0) + (wa ? 1 : 0) + (foto ? 1 : 0) };
  }

  return { METHODS: METHODS, real: real, snapshot: snapshot, openLatihan: openLatihan, memoryStorage: memoryStorage, idbStorage: idbStorage, prefState: prefState, loadPrefs: loadPrefs, savePrefs: savePrefs, dataGaps: dataGaps };
});
```

Tambahkan `'dist-field-api.js',` di `build.mjs` `FILES` tepat setelah `'api.js',`.

- [ ] **Step 4: Jalankan** — `jest tests/field-api.test.js tests/field-sandbox.test.js` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(distribusi): field adaptor (real/latihan), phone storage, who-sees-what rules"`

---

### Task 6: `dist-field.css` + `dist-field.jsx` — kerangka Mode Lapangan + layar Armada & SOP

**Files:**
- Create: `dist-field.css`, `dist-field.jsx`
- Modify: `build.mjs` (`FILES`: `'dist-field.jsx'` setelah `'dist-zones.jsx'`; `CSS_FILES`: tambah `'dist-field.css'`), `index.html` (link CSS), `finance-i18n.js` (kunci `fld.*` EN + ID)
- Test: `server/tests/field-shell-static.test.js` (baru)

**Interfaces:**
- Consumes: `FIELDAPI` (Task 5), `API.distribusi.fieldRules` (Task 3), ikon global (`IconTruck`, `IconPin`, `IconPlus`, `IconCustomers`, `IconWallet`, `IconDots`, `IconClose`, `IconCheck`, `IconRefresh`, `IconWarn`, `IconSettings`).
- Produces `window.FIELD = { App, RulesScreen }`:
  - `App` props: `{ user, perms, rules, pref, today, fleetList:string[], fleetScope, refreshKey, onExit():void, onPref(next):void, onOpenRules():void|null }` — `pref` = hasil `FIELDAPI.prefState`.
  - `RulesScreen` props: `{ fleetList:string[], canRelease:boolean, onSaved(rules):void }`.

- [ ] **Step 1: Tes statis gagal** — `server/tests/field-shell-static.test.js`:

```js
'use strict';
// Mode Lapangan UI shell (static checks — the server test run has no browser): files parse, are in the
// bundle, the MODE LATIHAN ribbon is unconditional in latihan, switching mode goes through a confirm,
// the rules screen writes through the UNTAGGED rules API, and every fld.* key exists in both languages.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const jsx = read('dist-field.jsx'); const css = read('dist-field.css'); const i18n = read('finance-i18n.js'); const build = read('build.mjs'); const html = read('index.html');

it('parses and ships', () => {
  expect(() => parse(jsx, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build).toMatch(/'dist-zones\.jsx',\s*'dist-field\.jsx',/);
  expect(build).toMatch(/CSS_FILES = \[[^\]]*'dist-field\.css'/);
  expect(html).toMatch(/dist-field\.css\?v=/);
  expect(jsx).toMatch(/window\.FIELD = \{ App: FldApp, RulesScreen: FldRules \}/);
});
it('latihan ribbon + confirmed mode switch + reset', () => {
  expect(jsx).toMatch(/\{mode === 'latihan' && <div className="mlap-ribbon"[^>]*>\{trFl\('fld\.bannerLatihan'\)\}/);
  expect(jsx).toMatch(/askSwitch\(/);
  expect(jsx).toMatch(/trFl\('fld\.switchToAsliB'\)/);
  expect(jsx).toMatch(/trFl\('fld\.resetLatihanB'\)/);
});
it('rules are saved through the untagged owner API, never the adaptor', () => {
  const rules = jsx.slice(jsx.indexOf('function FldRules('));
  expect(rules).toMatch(/window\.API\.distribusi\.fieldRules\.set\(/);
  expect(rules).not.toMatch(/api\.\w+\(/);
});
it('glass only on the functional layer + reduced transparency / motion honoured', () => {
  expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  expect(css).toMatch(/\.mlap-dock[^{]*\{[^}]*backdrop-filter/);
  expect(css).not.toMatch(/\.mlap-card[^{]*\{[^}]*backdrop-filter/);
});
it('every fld.* key used exists in EN and ID', () => {
  const used = [...new Set((jsx.match(/trFl\('(fld\.[A-Za-z0-9_]+)'/g) || []).map((m) => m.slice(6, -1)))];
  expect(used.length).toBeGreaterThan(20);
  used.forEach((k) => expect((i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length).toBe(2));
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — file belum ada.

- [ ] **Step 3: `dist-field.css`** — tulis file lengkap:

```css
/* MODE LAPANGAN — phone-first field UI (Liquid Glass on the FUNCTIONAL layer only: dock, round
   buttons, sheets, the Catat menu; content cards stay opaque). Tokens redefined for dark mode. */
.mlap-root {
  --mlap-bg: #EEF2F6; --mlap-surface: #FFFFFF; --mlap-ink: #0E1B24; --mlap-sub: #5B6B75; --mlap-line: #EDF1F4;
  --mlap-accent: #065489; --mlap-accent-soft: #E8F1F8; --mlap-teal: #1A8C87; --mlap-teal-ink: #0F6B66; --mlap-teal-soft: #DDF4F2;
  --mlap-warn: #9A3412; --mlap-warn-soft: #FFF1E8; --mlap-warn-line: #F4C7A8; --mlap-bon: #7A4B00; --mlap-bon-soft: #FCF1D6;
  --mlap-ok: #1E6B40; --mlap-ok-soft: #E3F3EA; --mlap-neg: #9B2C22; --mlap-neg-soft: #FDE8E6;
  --mlap-glass: rgba(255,255,255,.66); --mlap-glass-line: rgba(255,255,255,.85);
  position: relative; min-height: calc(100vh - 60px); max-width: 480px; margin: 0 auto; background: var(--mlap-bg); color: var(--mlap-ink);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif; padding: 0 0 120px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .mlap-root { --mlap-bg: #0C141A; --mlap-surface: #16222B; --mlap-ink: #E8EEF2; --mlap-sub: #9DB0BC; --mlap-line: #22313C; --mlap-accent: #5AA9E0; --mlap-accent-soft: #15324A; --mlap-glass: rgba(22,34,43,.7); --mlap-glass-line: rgba(255,255,255,.12); --mlap-warn: #F4A27A; --mlap-warn-soft: #3A2217; --mlap-warn-line: #6B3A22; --mlap-bon: #F2C46B; --mlap-bon-soft: #3A2E12; --mlap-ok: #7FD3A3; --mlap-ok-soft: #173326; --mlap-neg: #F19A8F; --mlap-neg-soft: #3A1B18; --mlap-teal-ink: #6ED3CC; --mlap-teal-soft: #123331; }
}
:root[data-theme="dark"] .mlap-root { --mlap-bg: #0C141A; --mlap-surface: #16222B; --mlap-ink: #E8EEF2; --mlap-sub: #9DB0BC; --mlap-line: #22313C; --mlap-accent: #5AA9E0; --mlap-accent-soft: #15324A; --mlap-glass: rgba(22,34,43,.7); --mlap-glass-line: rgba(255,255,255,.12); }
.mlap-glass { background: var(--mlap-glass); -webkit-backdrop-filter: blur(28px) saturate(1.6); backdrop-filter: blur(28px) saturate(1.6); border: 1px solid var(--mlap-glass-line); box-shadow: 0 10px 34px rgba(6,51,79,.18), inset 0 1px 0 rgba(255,255,255,.6); }
.mlap-ribbon { position: sticky; top: 0; z-index: 30; background: #C2410C; color: #fff; font-size: 12px; font-weight: 800; letter-spacing: .05em; text-align: center; padding: 6px 12px; }
.mlap-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px 6px; }
.mlap-head h1 { margin: 0; font-size: 28px; line-height: 34px; font-weight: 700; letter-spacing: -.02em; flex: 1; }
.mlap-eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .03em; color: var(--mlap-sub); text-transform: uppercase; padding: 0 16px; }
.mlap-round { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--mlap-ink); cursor: pointer; border: 1px solid var(--mlap-glass-line); background: var(--mlap-glass); -webkit-backdrop-filter: blur(24px) saturate(1.6); backdrop-filter: blur(24px) saturate(1.6); box-shadow: 0 6px 20px rgba(6,51,79,.14); }
.mlap-chip { height: 30px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border-radius: 15px; background: var(--mlap-surface); font-size: 13px; font-weight: 600; border: 0; color: var(--mlap-ink); }
.mlap-chip.latihan { background: var(--mlap-warn-soft); color: var(--mlap-warn); }
.mlap-chip.asli { background: var(--mlap-teal-soft); color: var(--mlap-teal-ink); }
.mlap-body { display: flex; flex-direction: column; gap: 10px; padding: 8px 16px; }
.mlap-card { background: var(--mlap-surface); border-radius: 16px; overflow: hidden; }
.mlap-row { min-height: 52px; display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-bottom: 1px solid var(--mlap-line); }
.mlap-row:last-child { border-bottom: 0; }
.mlap-row .nm { font-size: 15px; font-weight: 600; }
.mlap-row .sb { font-size: 12px; color: var(--mlap-sub); }
.mlap-num { width: 28px; height: 28px; border-radius: 9px; flex-shrink: 0; display: grid; place-items: center; font-size: 13px; font-weight: 700; background: var(--mlap-accent-soft); color: var(--mlap-accent); }
.mlap-tag { height: 22px; display: inline-flex; align-items: center; padding: 0 7px; border-radius: 6px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.mlap-tag.pending { background: var(--mlap-accent-soft); color: var(--mlap-accent); }
.mlap-tag.terkirim { background: var(--mlap-ok-soft); color: var(--mlap-ok); }
.mlap-tag.ditunda { background: var(--mlap-bon-soft); color: var(--mlap-bon); }
.mlap-tag.batal { background: var(--mlap-neg-soft); color: var(--mlap-neg); }
.mlap-empty, .mlap-soon { padding: 28px 16px; text-align: center; font-size: 14px; color: var(--mlap-sub); }
.mlap-err { background: var(--mlap-warn-soft); border: 1px solid var(--mlap-warn-line); color: var(--mlap-warn); border-radius: 14px; padding: 12px; font-size: 14px; display: flex; flex-direction: column; gap: 8px; }
.mlap-btn { min-height: 44px; border: 0; border-radius: 14px; padding: 0 16px; font-size: 15px; font-weight: 600; cursor: pointer; background: var(--mlap-accent-soft); color: var(--mlap-accent); }
.mlap-btn.primary { background: var(--mlap-accent); color: #fff; box-shadow: 0 8px 24px rgba(6,84,137,.3); }
.mlap-btn.danger { background: var(--mlap-neg-soft); color: var(--mlap-neg); }
.mlap-btn:disabled { opacity: .5; cursor: not-allowed; }
.mlap-dock { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(16px + env(safe-area-inset-bottom)); width: min(448px, calc(100vw - 32px)); height: 62px; border-radius: 31px; display: grid; grid-template-columns: 1fr 1fr 70px 1fr 1fr; gap: 2px; padding: 4px; box-sizing: border-box; z-index: 40;
  background: var(--mlap-glass); -webkit-backdrop-filter: blur(28px) saturate(1.6); backdrop-filter: blur(28px) saturate(1.6); border: 1px solid var(--mlap-glass-line); box-shadow: 0 10px 34px rgba(6,51,79,.18), inset 0 1px 0 rgba(255,255,255,.6); }
.mlap-tab { border: 0; background: transparent; border-radius: 27px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; color: var(--mlap-sub); font-size: 11px; font-weight: 600; cursor: pointer; transition: background .3s ease, color .3s ease; }
.mlap-tab.on { background: rgba(6,84,137,.12); color: var(--mlap-accent); }
.mlap-catat { position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); width: 62px; height: 62px; margin-left: -31px; border-radius: 50%; border: 1px solid rgba(255,255,255,.45); z-index: 41; cursor: pointer; display: grid; place-items: center; color: #fff;
  background: rgba(6,84,137,.9); -webkit-backdrop-filter: blur(28px) saturate(1.6); backdrop-filter: blur(28px) saturate(1.6); box-shadow: 0 10px 26px rgba(6,84,137,.42), inset 0 1px 0 rgba(255,255,255,.45); transition: transform .35s cubic-bezier(.34,1.56,.64,1); }
.mlap-catat:active { transform: scale(.9); }
.mlap-catat svg { transition: transform .45s cubic-bezier(.34,1.56,.64,1); }
.mlap-catat.open svg { transform: rotate(45deg); }
.mlap-scrim { position: fixed; inset: 0; background: rgba(14,27,36,.28); z-index: 45; border: 0; animation: fldFade .25s ease both; }
.mlap-sheet { position: fixed; left: 50%; transform: translateX(-50%); bottom: 0; width: min(480px, 100vw); max-height: 88vh; overflow: auto; z-index: 46; border-radius: 28px 28px 0 0; padding: 8px 16px calc(24px + env(safe-area-inset-bottom)); box-sizing: border-box; animation: fldUp .45s cubic-bezier(.34,1.3,.64,1) both;
  background: var(--mlap-glass); -webkit-backdrop-filter: blur(34px) saturate(1.5); backdrop-filter: blur(34px) saturate(1.5); border-top: 1px solid var(--mlap-glass-line); box-shadow: 0 -10px 40px rgba(6,51,79,.2); }
.mlap-grab { width: 36px; height: 5px; border-radius: 3px; background: #B9C4CC; margin: 0 auto 10px; }
.mlap-sheet h2 { margin: 4px 0 6px; font-size: 20px; }
.mlap-sheet p { margin: 0 0 12px; font-size: 14px; color: var(--mlap-sub); line-height: 1.4; }
.mlap-menu-item { width: 100%; min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 0; border-radius: 14px; background: var(--mlap-surface); color: var(--mlap-ink); font-size: 15px; cursor: pointer; margin-bottom: 6px; text-align: left; }
.mlap-menu-item:disabled { opacity: .55; cursor: not-allowed; }
.mlap-catat-menu { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(108px + env(safe-area-inset-bottom)); width: min(448px, calc(100vw - 32px)); z-index: 46; border-radius: 28px; padding: 10px; box-sizing: border-box; transform-origin: 50% 100%; animation: fldPop .55s cubic-bezier(.34,1.45,.64,1) both;
  background: var(--mlap-glass); -webkit-backdrop-filter: blur(28px) saturate(1.6); backdrop-filter: blur(28px) saturate(1.6); border: 1px solid var(--mlap-glass-line); box-shadow: 0 18px 50px rgba(6,51,79,.26); }
.mlap-catat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.mlap-tile { min-height: 84px; border-radius: 18px; background: var(--mlap-surface); border: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--mlap-ink); cursor: pointer; animation: fldItem .42s cubic-bezier(.34,1.56,.64,1) both; }
.mlap-tile:disabled { opacity: .55; cursor: not-allowed; }
.mlap-field { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 6px 12px; border-bottom: 1px solid var(--mlap-line); }
.mlap-field:last-child { border-bottom: 0; }
.mlap-field .lb { flex: 1; font-size: 15px; font-weight: 600; }
.mlap-field .ht { display: block; font-size: 12px; font-weight: 400; color: var(--mlap-sub); }
.mlap-step { width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--mlap-accent-soft); color: var(--mlap-accent); font-size: 20px; font-weight: 700; cursor: pointer; }
.mlap-stepval { width: 48px; text-align: center; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mlap-input { height: 40px; border-radius: 10px; border: 1px solid var(--mlap-line); padding: 0 10px; font-size: 16px; background: var(--mlap-surface); color: var(--mlap-ink); width: 130px; text-align: right; }
.mlap-warnline { font-size: 12px; font-weight: 600; color: var(--mlap-warn); padding: 0 12px 8px; }
.mlap-toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(96px + env(safe-area-inset-bottom)); z-index: 50; background: var(--mlap-ink); color: var(--mlap-bg); border-radius: 14px; padding: 10px 14px; font-size: 14px; }
@keyframes fldFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fldUp { from { transform: translate(-50%, 40px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
@keyframes fldPop { 0% { opacity: 0; transform: translate(-50%, 60px) scale(.22, .12); filter: blur(8px); } 55% { opacity: 1; filter: blur(0); } 100% { opacity: 1; transform: translate(-50%, 0); } }
@keyframes fldItem { 0% { opacity: 0; transform: translateY(14px) scale(.8); } 100% { opacity: 1; transform: none; } }
@media (prefers-reduced-transparency: reduce) {
  .mlap-glass, .mlap-round, .mlap-dock, .mlap-catat, .mlap-sheet, .mlap-catat-menu { background: var(--mlap-surface) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
  .mlap-catat { background: var(--mlap-accent) !important; }
}
@media (prefers-reduced-motion: reduce) {
  .mlap-root *, .mlap-dock, .mlap-catat, .mlap-sheet, .mlap-catat-menu, .mlap-tile, .mlap-scrim { animation: none !important; transition: none !important; }
}
```

Di `build.mjs`: `const CSS_FILES = ['styles.css', 'app.css', 'finance.css', 'desktop-scale.css', 'dist-field.css'];`. Di `index.html` setelah baris `finance.css`: `<link rel="stylesheet" href="dist-field.css?v=l222" />` (token `?v=` diganti otomatis oleh build).

- [ ] **Step 4: `dist-field.jsx`** — tulis file lengkap:

```jsx
/* MODE LAPANGAN — the new phone UI for delivery staff (demo until the owner releases it). This file
   holds the shell (header, MODE LATIHAN ribbon, mode switch, glass dock + Catat menu) and the owner's
   Aturan lapangan & armada screen. The full screens (mockup) arrive in the next plan; until then the
   Pengiriman tab lists the day's stops so both modes can be tried end to end. Every read/write goes
   through ONE adaptor (FIELDAPI): real = the server, latihan = this phone only. */
const { useState: uSfl, useEffect: uEfl, useRef: uRfl } = React;
const trFl = (k, v) => window.t(k, v);

function FldSheet({ title, body, confirmLabel, danger, onConfirm, onClose }) {
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mlap-grab" />
        <h2>{title}</h2>
        <p>{body}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="mlap-btn" style={{ flex: 1 }} onClick={onClose}>{trFl('fld.cancel')}</button>
          <button type="button" className={'mlap-btn ' + (danger ? 'danger' : 'primary')} style={{ flex: 1.3 }} onClick={onConfirm}>{confirmLabel || trFl('fld.confirm')}</button>
        </div>
      </div>
    </>
  );
}

function FldApp({ user, perms, rules, pref, today, fleetList, fleetScope, refreshKey, onExit, onPref, onOpenRules }) {
  const mode = pref.mode;
  const scope = Array.isArray(fleetScope) ? fleetScope : null;
  const fleets = scope || fleetList || [];
  const [fleet, setFleet] = uSfl(fleets.length === 1 ? fleets[0] : (fleets[0] || ''));
  const [api, setApi] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [tab, setTab] = uSfl('kirim');
  const [menu, setMenu] = uSfl(false);
  const [catat, setCatat] = uSfl(false);
  const [ask, setAsk] = uSfl(null);
  const [toast, setToast] = uSfl('');
  const [tick, setTick] = uSfl(0);
  const storageRef = uRfl(null);
  const key = 'latihan:' + ((user && user.id) || 'anon') + ':' + (fleet || '');

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2400); };
  uEfl(() => {
    let live = true; setApi(null); setErr(null);
    const real = window.FIELDAPI.real(window.API, { date: today, fleet });
    if (mode === 'asli') { setApi(real); return () => { live = false; }; }
    if (!storageRef.current) storageRef.current = (window.indexedDB ? window.FIELDAPI.idbStorage() : window.FIELDAPI.memoryStorage());
    window.FIELDAPI.openLatihan({ key, real, storage: storageRef.current })
      .then((a) => { if (live) setApi(a); })
      .catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [mode, fleet, today, tick]);

  const askSwitch = (to) => setAsk({
    title: to === 'asli' ? trFl('fld.switchToAsliT') : trFl('fld.switchToLatihanT'),
    body: to === 'asli' ? trFl('fld.switchToAsliB') : trFl('fld.switchToLatihanB'),
    danger: to === 'asli',
    run: () => { onPref({ mode: to }); setMenu(false); },
  });
  const askReset = () => setAsk({
    title: trFl('fld.resetLatihanT'), body: trFl('fld.resetLatihanB'), danger: true,
    run: () => { Promise.resolve(api && api.reset && api.reset()).then(() => { setTick((t) => t + 1); setMenu(false); flash(trFl('fld.resetDone')); }); },
  });

  const TABS = [['kirim', 'fld.tabKirim', 'IconTruck'], ['peta', 'fld.tabPeta', 'IconPin'], null, ['pelanggan', 'fld.tabPelanggan', 'IconCustomers'], ['setoran', 'fld.tabSetoran', 'IconWallet']];
  const ACTIONS = ['catatSale', 'catatBon', 'catatExp', 'catatStop', 'catatAdj', 'catatDmg'];
  const Ico = (n, s) => { const C = window[n]; return C ? <C s={s || 20} /> : null; };

  return (
    <div className="mlap-root">
      {mode === 'latihan' && <div className="mlap-ribbon" role="status">{trFl('fld.bannerLatihan')}</div>}
      <div className="mlap-head">
        <h1>{trFl('fld.tabKirim')}</h1>
        <button type="button" className="mlap-round" aria-label={trFl('fld.menu')} onClick={() => setMenu(true)}>{Ico('IconDots', 20)}</button>
      </div>
      <div className="mlap-eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{today}</span>
        <span className={'mlap-chip ' + mode}>{mode === 'latihan' ? trFl('fld.modeLatihan') : trFl('fld.modeAsli')}</span>
        {fleets.length > 1 ? (
          <label className="mlap-chip"><span className="sr-only">{trFl('fld.pickFleet')}</span>
            <select value={fleet} onChange={(e) => setFleet(e.target.value)} aria-label={trFl('fld.pickFleet')} style={{ border: 0, background: 'transparent', fontWeight: 600, color: 'inherit' }}>
              {fleets.map((f) => <option key={f} value={f}>{f}</option>)}
            </select></label>
        ) : <span className="mlap-chip">{fleet || '—'}</span>}
      </div>

      <div className="mlap-body">
        {err && (
          <div className="mlap-err" role="alert">
            <b>{err.offline ? trFl('fld.offline') : trFl('fld.loadErr')}</b>
            <span>{(err.body && err.body.error && err.body.error.message) || err.message || ''}</span>
            <button type="button" className="mlap-btn" onClick={() => setTick((t) => t + 1)}>{trFl('fld.retry')}</button>
          </div>
        )}
        {!err && !api && <div className="mlap-empty">{trFl('fld.loading')}</div>}
        {!err && api && tab === 'kirim' && <FldBoard api={api} refreshKey={mode === 'asli' ? refreshKey : 0} />}
        {!err && api && tab !== 'kirim' && <div className="mlap-card"><div className="mlap-soon">{trFl('fld.soon')}</div></div>}
      </div>

      <nav className="mlap-dock" aria-label={trFl('fld.nav')}>
        {TABS.map((t, i) => t ? (
          <button key={t[0]} type="button" className={'mlap-tab' + (tab === t[0] ? ' on' : '')} aria-current={tab === t[0] ? 'page' : undefined} onClick={() => setTab(t[0])}>
            {Ico(t[2], 20)}<span>{trFl(t[1])}</span>
          </button>
        ) : <span key={'gap' + i} aria-hidden="true" />)}
      </nav>
      <button type="button" className={'mlap-catat' + (catat ? ' open' : '')} aria-label={trFl('fld.tabCatat')} aria-expanded={catat} onClick={() => setCatat(!catat)}>{Ico('IconPlus', 24)}</button>
      {catat && (
        <>
          <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={() => setCatat(false)} />
          <div className="mlap-catat-menu" role="menu" aria-label={trFl('fld.catatTitle')}>
            <div className="mlap-eyebrow" style={{ padding: '2px 6px 8px' }}>{trFl('fld.catatTitle')}</div>
            <div className="mlap-catat-grid">
              {ACTIONS.map((a, i) => <button key={a} type="button" role="menuitem" className="mlap-tile" disabled style={{ animationDelay: (70 + i * 40) + 'ms' }} title={trFl('fld.soon')}>{trFl('fld.' + a)}</button>)}
            </div>
          </div>
        </>
      )}

      {menu && (
        <>
          <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={() => setMenu(false)} />
          <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={trFl('fld.menu')}>
            <div className="mlap-grab" />
            <h2>{trFl('fld.menu')}</h2>
            {pref.canAsli && pref.canLatihan && (mode === 'latihan'
              ? <button type="button" className="mlap-menu-item" onClick={() => askSwitch('asli')}>{trFl('fld.useAsli')}</button>
              : <button type="button" className="mlap-menu-item" onClick={() => askSwitch('latihan')}>{trFl('fld.useLatihan')}</button>)}
            {mode === 'latihan' && <button type="button" className="mlap-menu-item" onClick={askReset}>{trFl('fld.resetLatihan')}</button>}
            {onOpenRules && <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); onOpenRules(); }}>{trFl('fld.rules')}</button>}
            {!pref.released && <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); onExit(); }}>{trFl('fld.backOld')}</button>}
          </div>
        </>
      )}
      {ask && <FldSheet title={ask.title} body={ask.body} danger={ask.danger} onClose={() => setAsk(null)} onConfirm={() => { const r = ask.run; setAsk(null); r(); }} />}
      {toast && <div className="mlap-toast" role="status">{toast}</div>}
    </div>
  );
}

// Temporary Pengiriman list (both modes) — replaced by the full board in the next plan.
function FldBoard({ api, refreshKey }) {
  const [rows, setRows] = uSfl(null);
  const [err, setErr] = uSfl(null);
  uEfl(() => { let live = true; api.board().then((r) => { if (live) setRows(r || []); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api, refreshKey]);
  if (err) return <div className="mlap-err" role="alert">{(err.body && err.body.error && err.body.error.message) || trFl('fld.loadErr')}</div>;
  if (!rows) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  if (!rows.length) return <div className="mlap-card"><div className="mlap-empty">{trFl('fld.emptyBoard')}</div></div>;
  return (
    <div className="mlap-card">
      {rows.map((s, i) => (
        <div key={s.id} className="mlap-row">
          <span className="mlap-num">{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0 }}><span className="nm">{s.customerName}</span><br /><span className="sb">{(s.customerCode || '') + (s.pendingReason ? ' · ' + s.pendingReason : '')}</span></span>
          <span className={'mlap-tag ' + s.status}>{trFl('fld.st_' + s.status)}</span>
        </div>
      ))}
    </div>
  );
}

// ATURAN LAPANGAN & ARMADA (owner/GM). ALWAYS the real rules — never the practice copy — and through
// the untagged owner API, so an owner without Demo penuh can still save them.
function FldRules({ fleetList, canRelease, onSaved }) {
  const [r, setR] = uSfl(null);
  const [err, setErr] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [ask, setAsk] = uSfl(null);
  const [done, setDone] = uSfl('');
  uEfl(() => { window.API.distribusi.fieldRules.get().then((x) => setR(x.data)).catch((e) => setErr(e.message || trFl('fld.loadErr'))); }, []);
  if (err && !r) return <div className="mlap-root"><div className="mlap-body"><div className="mlap-err" role="alert">{err}</div></div></div>;
  if (!r) return <div className="mlap-root"><div className="mlap-body"><div className="mlap-empty">{trFl('fld.loading')}</div></div></div>;
  const set = (patch) => setR(Object.assign({}, r, patch));
  const setSop = (patch) => set({ ritSop: Object.assign({}, r.ritSop, patch) });
  const cap = (p) => r.fleetCapacity[p] || 0;
  const setCap = (p, v) => { const fc = Object.assign({}, r.fleetCapacity); const n = Math.max(0, Math.min(10000, Math.round(v))); if (n) fc[p] = n; else delete fc[p]; set({ fleetCapacity: fc }); };
  const save = (patch) => {
    setBusy(true); setErr('');
    const body = patch || { ritSop: r.ritSop, fleetCapacity: Object.assign({}, ...(fleetList || []).map((p) => ({ [p]: r.fleetCapacity[p] || 0 })), r.fleetCapacity), wajibFotoTransaksi: r.wajibFotoTransaksi, wajibFotoPengeluaran: r.wajibFotoPengeluaran, wajibAlasanBatal: r.wajibAlasanBatal, hargaGantiRugiGalon: r.hargaGantiRugiGalon };
    window.API.distribusi.fieldRules.set(body).then((x) => { setR(x.data); setDone(trFl('fld.saved')); setTimeout(() => setDone(''), 2400); if (onSaved) onSaved(x.data); })
      .catch((e) => setErr((e.body && e.body.error && e.body.error.message) || e.message)).finally(() => setBusy(false));
  };
  const Toggle = ({ k, label }) => (
    <label className="mlap-field"><span className="lb">{label}</span>
      <input type="checkbox" checked={!!r[k]} onChange={(e) => set({ [k]: e.target.checked })} style={{ width: 24, height: 24 }} /></label>
  );
  return (
    <div className="mlap-root">
      <div className="mlap-head"><h1>{trFl('fld.rulesTitle')}</h1></div>
      <div className="mlap-eyebrow">{trFl('fld.rulesSub')}</div>
      <div className="mlap-body">
        <div className="mlap-err" style={{ background: 'var(--mlap-accent-soft)', borderColor: 'transparent', color: 'var(--mlap-accent)' }}>{trFl('fld.rulesAsliNote')}</div>
        <div className="mlap-card">
          <label className="mlap-field"><span className="lb">{trFl('fld.sopEnabled')}</span><input type="checkbox" checked={!!r.ritSop.enabled} onChange={(e) => setSop({ enabled: e.target.checked })} style={{ width: 24, height: 24 }} /></label>
          <div className="mlap-field"><span className="lb">{trFl('fld.sopMin')}</span>
            <button type="button" className="mlap-step" aria-label={trFl('fld.less')} onClick={() => setSop({ minLoad: Math.max(1, r.ritSop.minLoad - 5) })}>−</button>
            <span className="mlap-stepval">{r.ritSop.minLoad}</span>
            <button type="button" className="mlap-step" aria-label={trFl('fld.more')} onClick={() => setSop({ minLoad: r.ritSop.minLoad + 5 })}>+</button></div>
        </div>
        <div className="mlap-eyebrow" style={{ padding: '4px 4px 0' }}>{trFl('fld.capTitle')}</div>
        <div className="mlap-card">
          {(fleetList || []).map((p) => (
            <div key={p}>
              <div className="mlap-field"><span className="lb">{p}<span className="ht">{cap(p) ? cap(p) + ' ' + trFl('fld.galon') : trFl('fld.capNone')}</span></span>
                <button type="button" className="mlap-step" aria-label={trFl('fld.less') + ' ' + p} onClick={() => setCap(p, cap(p) - 5)}>−</button>
                <span className="mlap-stepval">{cap(p) || '—'}</span>
                <button type="button" className="mlap-step" aria-label={trFl('fld.more') + ' ' + p} onClick={() => setCap(p, (cap(p) || r.ritSop.minLoad) + 5)}>+</button></div>
              {cap(p) > 0 && cap(p) < r.ritSop.minLoad && <div className="mlap-warnline">{trFl('fld.capBelowSop')}</div>}
            </div>
          ))}
          {!(fleetList || []).length && <div className="mlap-empty">{trFl('fld.noFleet')}</div>}
        </div>
        <div className="mlap-card">
          <Toggle k="wajibFotoTransaksi" label={trFl('fld.fotoTxn')} />
          <Toggle k="wajibFotoPengeluaran" label={trFl('fld.fotoExp')} />
          <Toggle k="wajibAlasanBatal" label={trFl('fld.alasanBatal')} />
          <label className="mlap-field"><span className="lb">{trFl('fld.hargaGR')}</span>
            <input className="mlap-input" inputMode="numeric" value={r.hargaGantiRugiGalon || ''} onChange={(e) => set({ hargaGantiRugiGalon: +String(e.target.value).replace(/[^0-9]/g, '') || 0 })} /></label>
        </div>
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary" disabled={busy} onClick={() => save()}>{trFl('fld.save')}</button>
        {canRelease && (
          <div className="mlap-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <b>{trFl('fld.releaseTitle')}</b>
            <span className="sb" style={{ fontSize: 13, color: 'var(--mlap-sub)' }}>{r.fieldUiDefault === 'new' ? trFl('fld.released') : trFl('fld.releaseSub')}</span>
            {r.fieldUiDefault === 'new'
              ? <button type="button" className="mlap-btn" disabled={busy} onClick={() => setAsk('old')}>{trFl('fld.unreleaseBtn')}</button>
              : <button type="button" className="mlap-btn danger" disabled={busy} onClick={() => setAsk('new')}>{trFl('fld.releaseBtn')}</button>}
          </div>
        )}
      </div>
      {ask && <FldSheet title={ask === 'new' ? trFl('fld.releaseT') : trFl('fld.unreleaseT')} body={ask === 'new' ? trFl('fld.releaseB') : trFl('fld.unreleaseB')} danger={ask === 'new'} onClose={() => setAsk(null)} onConfirm={() => { const v = ask; setAsk(null); save({ fieldUiDefault: v }); }} />}
      {done && <div className="mlap-toast" role="status">{done}</div>}
    </div>
  );
}

window.FIELD = { App: FldApp, RulesScreen: FldRules };
```

Tambahkan `'dist-field.jsx',` di `FILES` tepat setelah `'dist-zones.jsx',`.

- [ ] **Step 5: Kunci i18n** — di `finance-i18n.js`, pada blok EN (cari baris yang berisi `'zn.autoDone':` pertama) tambahkan di akhir baris itu (sebelum baris berikutnya) potongan berikut; lalu versi ID di blok ID (baris `'zn.autoDone':` kedua). Gunakan apostrof tipografi `’`.

EN:
```
      'fld.tryNew': 'Try the new view (demo)', 'fld.tryNewSub': 'The new phone view for deliveries — still a demo.', 'fld.bannerLatihan': 'PRACTICE MODE — not saved', 'fld.modeLatihan': 'Practice', 'fld.modeAsli': 'Live', 'fld.menu': 'Menu', 'fld.nav': 'Field navigation', 'fld.useAsli': 'Switch to live mode', 'fld.useLatihan': 'Switch to practice mode', 'fld.switchToAsliT': 'Switch to live mode?', 'fld.switchToAsliB': 'Everything you record from now on is saved for real and goes into the books.', 'fld.switchToLatihanT': 'Switch to practice mode?', 'fld.switchToLatihanB': 'Practice records stay on this phone only and never reach the books.', 'fld.resetLatihan': 'Restart practice', 'fld.resetLatihanT': 'Restart practice from scratch?', 'fld.resetLatihanB': 'All practice records on this phone are deleted and the real data is copied again.', 'fld.resetDone': 'Practice restarted', 'fld.backOld': 'Back to the old view', 'fld.rules': 'Field rules & fleet', 'fld.tabKirim': 'Deliveries', 'fld.tabPeta': 'Map', 'fld.tabCatat': 'Record', 'fld.tabPelanggan': 'Customers', 'fld.tabSetoran': 'Deposit', 'fld.soon': 'This screen is being built (next step).', 'fld.loading': 'Loading…', 'fld.loadErr': 'Could not load. Try again.', 'fld.offline': 'No connection', 'fld.retry': 'Try again', 'fld.emptyBoard': 'No deliveries today.', 'fld.pickFleet': 'Fleet', 'fld.st_pending': 'Waiting', 'fld.st_terkirim': 'Delivered', 'fld.st_ditunda': 'On hold', 'fld.st_batal': 'Cancelled', 'fld.catatTitle': 'Record manually', 'fld.catatSale': 'Manual sale', 'fld.catatBon': 'Credit payment', 'fld.catatExp': 'Expense', 'fld.catatStop': 'Add stop', 'fld.catatAdj': 'Gallon adjustment', 'fld.catatDmg': 'Gallon damage charge', 'fld.cancel': 'Cancel', 'fld.confirm': 'Yes, continue', 'fld.rulesTitle': 'Field rules & fleet', 'fld.rulesSub': 'Applies to every driver. Owner/GM only.', 'fld.rulesAsliNote': 'These are the real settings — practice mode never changes them.', 'fld.sopEnabled': 'Require a reason when a load is below the SOP', 'fld.sopMin': 'Minimum load per trip (gallons)', 'fld.capTitle': 'Maximum capacity per fleet (gallons)', 'fld.capNone': 'no limit', 'fld.capBelowSop': 'Below the SOP — every trip of this fleet will ask for a reason.', 'fld.noFleet': 'No fleets yet — set them in Setoran → Kelola Armada.', 'fld.galon': 'gallons', 'fld.less': 'Less', 'fld.more': 'More', 'fld.fotoTxn': 'Photo required for sales and credit payments', 'fld.fotoExp': 'Receipt photo required for expenses', 'fld.alasanBatal': 'Reason required when a stop is cancelled', 'fld.hargaGR': 'Damage charge per gallon (Rp)', 'fld.save': 'Save', 'fld.saved': 'Rules saved', 'fld.releaseTitle': 'Release the new view', 'fld.releaseSub': 'Make the new phone view the main view for every field account.', 'fld.releaseBtn': 'Make it the main view', 'fld.releaseT': 'Make the new view the main view?', 'fld.releaseB': 'Every field account will open the new view and record real data through it.', 'fld.unreleaseBtn': 'Make the old view the main view again', 'fld.unreleaseT': 'Go back to the old view as the main view?', 'fld.unreleaseB': 'Field accounts open the old view again; only demo accounts can try the new one.', 'fld.released': 'The new view is the main view.', 'nav.distFieldRules': 'Field Rules', 'cr.st_withdrawn': 'Withdrawn',
```

ID:
```
      'fld.tryNew': 'Coba tampilan baru (demo)', 'fld.tryNewSub': 'Tampilan HP baru untuk pengiriman — masih demo.', 'fld.bannerLatihan': 'MODE LATIHAN — tidak tersimpan', 'fld.modeLatihan': 'Mode latihan', 'fld.modeAsli': 'Mode asli', 'fld.menu': 'Menu', 'fld.nav': 'Navigasi lapangan', 'fld.useAsli': 'Pindah ke Mode asli', 'fld.useLatihan': 'Pindah ke Mode latihan', 'fld.switchToAsliT': 'Pindah ke Mode asli?', 'fld.switchToAsliB': 'Semua yang Anda catat setelah ini tersimpan sungguhan dan masuk pembukuan.', 'fld.switchToLatihanT': 'Pindah ke Mode latihan?', 'fld.switchToLatihanB': 'Catatan latihan hanya tersimpan di HP ini dan tidak masuk pembukuan.', 'fld.resetLatihan': 'Ulang latihan', 'fld.resetLatihanT': 'Ulang latihan dari awal?', 'fld.resetLatihanB': 'Semua catatan latihan di HP ini dihapus, lalu data asli disalin ulang.', 'fld.resetDone': 'Latihan diulang dari awal', 'fld.backOld': 'Kembali ke tampilan lama', 'fld.rules': 'Aturan lapangan & armada', 'fld.tabKirim': 'Pengiriman', 'fld.tabPeta': 'Peta', 'fld.tabCatat': 'Catat', 'fld.tabPelanggan': 'Pelanggan', 'fld.tabSetoran': 'Setoran', 'fld.soon': 'Layar ini sedang dibangun (tahap berikutnya).', 'fld.loading': 'Memuat…', 'fld.loadErr': 'Gagal memuat. Coba lagi.', 'fld.offline': 'Tidak ada koneksi', 'fld.retry': 'Coba lagi', 'fld.emptyBoard': 'Tidak ada pengiriman hari ini.', 'fld.pickFleet': 'Armada', 'fld.st_pending': 'Menunggu', 'fld.st_terkirim': 'Terkirim', 'fld.st_ditunda': 'Tunda', 'fld.st_batal': 'Batal', 'fld.catatTitle': 'Catat manual', 'fld.catatSale': 'Transaksi manual', 'fld.catatBon': 'Pembayaran bon', 'fld.catatExp': 'Pengeluaran', 'fld.catatStop': 'Tambah stop', 'fld.catatAdj': 'Penyesuaian galon', 'fld.catatDmg': 'Ganti rugi galon', 'fld.cancel': 'Batal', 'fld.confirm': 'Ya, lanjutkan', 'fld.rulesTitle': 'Aturan lapangan & armada', 'fld.rulesSub': 'Berlaku untuk semua sopir. Hanya Owner/GM.', 'fld.rulesAsliNote': 'Ini pengaturan asli — Mode latihan tidak pernah mengubahnya.', 'fld.sopEnabled': 'Wajib alasan kalau muatan di bawah SOP', 'fld.sopMin': 'Muatan minimal per rit (galon)', 'fld.capTitle': 'Kapasitas maksimal tiap armada (galon)', 'fld.capNone': 'tanpa batas', 'fld.capBelowSop': 'Di bawah SOP — setiap rit armada ini akan minta alasan.', 'fld.noFleet': 'Belum ada armada — atur di Setoran → Kelola Armada.', 'fld.galon': 'galon', 'fld.less': 'Kurangi', 'fld.more': 'Tambah', 'fld.fotoTxn': 'Foto wajib untuk transaksi & pembayaran bon', 'fld.fotoExp': 'Foto nota wajib untuk pengeluaran', 'fld.alasanBatal': 'Alasan wajib untuk stop yang dibatalkan', 'fld.hargaGR': 'Harga ganti rugi per galon (Rp)', 'fld.save': 'Simpan', 'fld.saved': 'Aturan disimpan', 'fld.releaseTitle': 'Rilis tampilan baru', 'fld.releaseSub': 'Jadikan tampilan HP baru sebagai tampilan utama untuk semua akun lapangan.', 'fld.releaseBtn': 'Jadikan tampilan utama', 'fld.releaseT': 'Jadikan tampilan baru tampilan utama?', 'fld.releaseB': 'Semua akun lapangan akan membuka tampilan baru dan mencatat data asli lewat tampilan itu.', 'fld.unreleaseBtn': 'Kembalikan tampilan lama sebagai utama', 'fld.unreleaseT': 'Kembalikan tampilan lama sebagai utama?', 'fld.unreleaseB': 'Akun lapangan kembali membuka tampilan lama; hanya akun demo yang bisa mencoba tampilan baru.', 'fld.released': 'Tampilan baru sudah menjadi tampilan utama.', 'nav.distFieldRules': 'Aturan Lapangan', 'cr.st_withdrawn': 'Ditarik',
```

- [ ] **Step 6: Jalankan** — `jest tests/field-shell-static.test.js` → PASS. Lalu `node build.mjs --no-minify` dari root → sukses tanpa error (kalau esbuild tidak terpasang di root, jalankan `npm ci` di root dulu — hanya untuk verifikasi lokal, bukan di tes).

- [ ] **Step 7: Commit** — `git commit -m "feat(distribusi): Mode Lapangan shell (ribbon, mode switch, glass dock + Catat) + Aturan lapangan screen"`

---

### Task 7: Integrasi shell + perbaikan kecil tampilan lama

**Files:**
- Modify: `finance-shell.jsx` (state aturan + pref; cabang `dist-deliveries`; nav `dist-field-rules`; layar `dist-field-rules`; daftar layar dist placeholder)
- Modify: `finance-users.jsx` (katalog izin `distribusiAturanLapangan`)
- Modify: `distribution.jsx` (label status `withdrawn` sudah lewat kunci `cr.st_withdrawn` — hanya tambah kelas CSS)
- Modify: `finance.css` (`.cr-status.withdrawn`, `.mlap-try` banner)
- Test: `server/tests/field-shell-integration.test.js` (baru)

**Interfaces:**
- Consumes: `FIELDAPI.prefState/loadPrefs/savePrefs` (Task 5), `FIELD.App/RulesScreen` (Task 6), `API.distribusi.fieldRules.get` (Task 3).
- Produces: layar `dist-deliveries` merender `FIELD.App` bila `pref.ui === 'new'`, selain itu `DIST.Deliveries` dengan kartu "Coba tampilan baru (demo)" di atasnya bila `pref.eligible`; nav baru `dist-field-rules` (cap `distribusiAturanLapangan`) → `FIELD.RulesScreen`.

- [ ] **Step 1: Tes statis gagal** — `server/tests/field-shell-integration.test.js`:

```js
'use strict';
// The shell decides old vs new with FIELDAPI.prefState only; an account without demo access sees the
// old board exactly as before (no card, no new UI); the rules screen has its own nav entry for owner/GM.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const shell = fs.readFileSync(path.join(root, 'finance-shell.jsx'), 'utf8');
const users = fs.readFileSync(path.join(root, 'finance-users.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'finance.css'), 'utf8');

it('parses', () => { expect(() => parse(shell, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow(); });
it('the board screen switches on prefState', () => {
  expect(shell).toMatch(/const fieldPref = window\.FIELDAPI \? window\.FIELDAPI\.prefState\(\{ perms: p, rules: fieldRules, prefs: fieldPrefs \}\)/);
  expect(shell).toMatch(/screen === 'dist-deliveries' && p\.distribusiPengiriman && fieldPref\.ui === 'new' && window\.FIELD && \(/);
  expect(shell).toMatch(/screen === 'dist-deliveries' && p\.distribusiPengiriman && fieldPref\.ui !== 'new' && \(/);
  expect(shell).toMatch(/\{fieldPref\.eligible && <div className="mlap-try"/);
});
it('rules nav + screen for owner/GM', () => {
  expect(shell).toMatch(/\{ id: 'dist-field-rules', label: tr\('nav\.distFieldRules'\), icon: 'IconSettings', caps: \['distribusiAturanLapangan'\] \}/);
  expect(shell).toMatch(/screen === 'dist-field-rules' && p\.distribusiAturanLapangan && window\.FIELD && <window\.FIELD\.RulesScreen/);
  expect(shell).toMatch(/'dist-zones', 'dist-field-rules'\]\.includes\(screen\)/);
});
it('the rules cap is in the permission editor; withdrawn has a badge colour', () => {
  expect(users).toMatch(/\['distribusiAturanLapangan', 'distribusi', /);
  expect(css).toMatch(/\.cr-status\.withdrawn \{/);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: `finance-shell.jsx`**

a) Nav — di `navForRole`, tepat setelah baris `{ id: 'dist-zones', … caps: ['distribusiZona'] },` tambahkan:
```js
    { id: 'dist-field-rules', label: tr('nav.distFieldRules'), icon: 'IconSettings', caps: ['distribusiAturanLapangan'] },
```

b) State — dekat `const [distFleet, setDistFleet] = uSh('all');` tambahkan:
```js
  // MODE LAPANGAN: the owner's field rules (release switch) + this phone's view/mode preference.
  const [fieldRules, setFieldRules] = uSh(null);
  const [fieldPrefs, setFieldPrefs] = uSh(() => (window.FIELDAPI ? window.FIELDAPI.loadPrefs() : {}));
```

c) Tepat setelah baris `const p = FS.normKasbon(...)` (baris 333) tambahkan:
```js
  const fieldPref = window.FIELDAPI ? window.FIELDAPI.prefState({ perms: p, rules: fieldRules, prefs: fieldPrefs }) : { eligible: false, ui: 'old', mode: 'latihan' };
  const setFieldPref = (next) => { const merged = Object.assign({}, fieldPrefs, next); setFieldPrefs(merged); if (window.FIELDAPI) window.FIELDAPI.savePrefs(merged); };
```

d) Efek muat aturan — di dekat efek lain yang bergantung pada `user` (misal setelah efek outstanding, baris ~662), tambahkan:
```js
  // Field rules (release switch + rules the new UI shows). Only fetched for accounts that run the board.
  uEh(() => {
    if (!user || !p.distribusiPengiriman || !window.API || !window.API.distribusi.fieldRules) { setFieldRules(null); return; }
    let live = true;
    window.API.distribusi.fieldRules.get().then((r) => { if (live) setFieldRules(r && r.data); }).catch(() => {});
    return () => { live = false; };
  }, [user, p.distribusiPengiriman, distTick]);
```
(Gunakan nama hook efek yang dipakai file ini — periksa definisi di kepala file, misal `uEh`; kalau namanya lain, pakai itu.)

e) Ganti blok `{screen === 'dist-deliveries' && p.distribusiPengiriman && ( <DIST.Deliveries … /> )}` menjadi:
```jsx
          {screen === 'dist-deliveries' && p.distribusiPengiriman && fieldPref.ui === 'new' && window.FIELD && (
            <window.FIELD.App user={user} perms={p} rules={fieldRules} pref={fieldPref} today={FIN.TODAY}
              fleetList={fleet} fleetScope={user && user.fleetScope} refreshKey={distTick}
              onExit={() => setFieldPref({ ui: 'old' })} onPref={setFieldPref}
              onOpenRules={p.distribusiAturanLapangan ? () => go('dist-field-rules') : null} />
          )}
          {screen === 'dist-deliveries' && p.distribusiPengiriman && fieldPref.ui !== 'new' && (
            <>
              {fieldPref.eligible && <div className="mlap-try" role="region" aria-label={tr('fld.tryNew')}>
                <span><b>{tr('fld.tryNew')}</b><br /><small>{tr('fld.tryNewSub')}</small></span>
                <button type="button" className="btn btn-primary" onClick={() => setFieldPref({ ui: 'new' })}>{tr('fld.tryNew')}</button>
              </div>}
              <DIST.Deliveries refreshKey={distTick} today={FIN.TODAY} canOrder={!!p.distribusiOrder} canRoute={!!p.distribusiRute} canClose={!!p.distribusiPengiriman} canKoreksi={!!p.distribusiKoreksi}
                canBelumTerkirim={!!p.distribusiBelumTerkirim}
                canGps={!!p.distribusiLacakArmada} canGpsMap={!!p.settings} canLoc={!!p.distribusiLokasiSimpan}
                fleetScope={user && user.fleetScope} fleet={fleet} distFleet={distFleet} setDistFleet={setDistFleet}
                onChanged={() => setDistTick((t) => t + 1)} />
            </>
          )}
          {screen === 'dist-field-rules' && p.distribusiAturanLapangan && window.FIELD && <window.FIELD.RulesScreen fleetList={fleet} canRelease={user && user.role === 'owner'} onSaved={(r) => setFieldRules(r)} />}
```
(Salin props `DIST.Deliveries` persis dari versi sekarang — termasuk komentar tentang dua hak GPS — tanpa perubahan.)

f) Pada baris daftar placeholder (baris ~1861) ubah `'dist-zones'].includes(screen)` menjadi `'dist-zones', 'dist-field-rules'].includes(screen)`.

Keputusan: **rilis (fieldUiDefault) hanya tombol untuk role `owner`** (`canRelease`); GM tetap bisa mengatur SOP/kapasitas/saklar. Server tetap menerima GM (cap `distribusiAturanLapangan`) — ini pembatasan UI sesuai spec "Owner menekan tombol rilis".

- [ ] **Step 4: Katalog izin + CSS**

`finance-users.jsx`, setelah baris `['distribusiDemoPenuh', …],` tambahkan:
```js
  ['distribusiAturanLapangan', 'distribusi', 'Aturan Lapangan & Armada', 'Mengatur SOP muatan, kapasitas armada, foto/alasan wajib, harga ganti rugi galon, dan rilis tampilan HP baru. Berlaku untuk semua sopir.', 3, { destructive: true }],
```

`finance.css`, setelah `.cr-status.rejected { … }` tambahkan:
```css
.cr-status.withdrawn { background: #eef2f6; color: #5b6b75; }
/* Mode Lapangan demo entry on the old board */
.mlap-try { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 12px; padding: 12px 14px; border-radius: 14px; background: #e8f1f8; color: #06334f; border: 1px solid #cfe2f1; }
.mlap-try small { color: #3e4e58; }
@media (max-width: 520px) { .mlap-try { flex-direction: column; align-items: stretch; } }
```

- [ ] **Step 5: Jalankan** — `jest tests/field-shell-integration.test.js tests/field-shell-static.test.js` → PASS; `node build.mjs --no-minify` sukses.

- [ ] **Step 6: Commit** — `git commit -m "feat(distribusi): shell opens Mode Lapangan per prefState + Aturan Lapangan nav; withdrawn badge"`

---

### Task 8: Suite penuh + dokumentasi

- [ ] **Step 1:** Jalankan seluruh suite server di background (lihat Global Constraints soal jam WITA). Ekspektasi: semua lulus kecuali 9 file lama yang rapuh tanggal bila dijalankan 00:00–08:00 WITA (bukti dengan `APP_TZ=UTC`).
- [ ] **Step 2:** `node build.mjs` (minify) dari root → sukses; tidak ada peringatan "root .js not in FILES" untuk `rit-plan.js`, `dist-field-sandbox.js`, `dist-field-api.js`.
- [ ] **Step 3:** Perbarui spec bagian 2 bila ada keputusan implementasi yang berbeda (mis. endpoint `field-context`, `PATCH /customers/:id/phone`, tombol rilis hanya Owner). Commit: `git commit -m "docs: mode lapangan spec aligned with the client foundation"`.

## Setelah rencana ini

Rencana 3 (layar Mode Lapangan penuh sesuai mockup: Pengiriman, Detail stop, Transaksi dengan foto wajib, Rute rit/Peta, Buka rit, Pelanggan, Lengkapi + Atur titik (Leaflet draggable), Tambah stop, Pembayaran bon, Penyesuaian, Ganti rugi (cegah kirim ganda), Pengeluaran, Koreksi + Koreksi saya, Setoran/tutup hari, animasi dock) dibangun di atas `FIELDAPI` adaptor, `FIELD.App` kerangka, token CSS, dan kunci `fld.*`.
