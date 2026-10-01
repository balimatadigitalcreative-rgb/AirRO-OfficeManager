# Mode Lapangan — Rencana 3A: Layar alur kerja harian

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Di Mode Lapangan, seorang sopir bisa menjalankan satu hari kerja penuh dari HP, baik di Mode latihan maupun Mode asli: melihat Pengiriman (kartu "Berikutnya", filter Menunggu/Terkirim/Tunda, peringatan data belum lengkap), membuka detail stop (Navigasi/Telepon/WA, tunda/batal dengan alasan), mencatat transaksi Lunas/Bon/Transfer dengan **foto wajib** lalu menandai terkirim, membuka rit dengan pengukur SOP/kapasitas (alasan wajib di bawah SOP), melihat rute rit di peta, menutup rit, dan menutup hari di layar Setoran.

**Architecture:** Logika murni (susunan papan, pengukur rit, pratinjau transaksi, alur "simpan lalu tandai terkirim tanpa transaksi ganda", cek tutup hari) ada di satu modul isomorfik `dist-field-logic.js` (`FIELDLOGIC`) yang dites di Node. Komponen kecil yang dipakai bersama (sheet, stepper, segmen, chip alasan, foto berstempel jam+GPS, tautan Navigasi/WA) ada di `dist-field-kit.jsx`; layar-layar harian di `dist-field-day.jsx`; `dist-field.jsx` tinggal menjadi shell yang merangkai tab dan layar. Semua baca/tulis tetap lewat adaptor `FIELDAPI` (asli atau latihan) dari Rencana 2.

**Tech Stack:** React 18 (UMD, tanpa framework, JSX digabung `build.mjs`), Leaflet + OSM yang sudah ada (`znLoadLeaflet`), Jest (server) untuk tes Node + tes statis/parse via `@babel/parser`.

**Spec:** `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md` — bagian 4 (baris Pengiriman, Detail stop, Transaksi, Rute rit/Peta, Buka rit, Setoran). Mockup: board Main, Stop, Transaksi, BukaRit, RuteRit, Selesai di https://claude.ai/artifact/VELPmw1GNUAFNQ5KXpxj8V. Rencana 3B (Pelanggan, Lengkapi, Atur titik, Tambah stop, Bayar bon, Penyesuaian, Ganti rugi, Pengeluaran, Koreksi, rilis) menyusul; `FLD_SCREENS_READY` tetap `false` di 3A.

## Global Constraints

- Tes dijalankan dari `server/`: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand <file>`. Jam 00:00–08:00 WITA, 9 file tes lama (correction-method, dash-history-report, dashboard-bon-baru, delivery-bulk-carry, delivery-outstanding, distribution, invoice, payment-not-received, view-window) gagal karena menghitung "hari ini" dalam UTC — buktikan dengan `APP_TZ=UTC`.
- Tes server TIDAK BOLEH `require` dari `node_modules` root (gerbang deploy GATE 3). File root murni tanpa dependensi boleh di-`require`. JSX hanya dicek dengan `@babel/parser`.
- Bundel menggabungkan semua file root dalam **satu cakupan**: setiap nama tingkat atas baru harus unik di seluruh bundel (awali `Fld`, `fld`, `FLD`). Kelas CSS baru berawalan `mlap-`. Tes anti-bentrok sudah ada dan diperluas di Task 4.
- **Tampilan baru selalu mengikuti aturan, apa pun saklarnya** (spec "Keputusan desain"): foto bukti wajib untuk setiap transaksi; alasan wajib untuk Tunda, Batal, muatan di bawah SOP, dan stop yang belum selesai saat tutup hari.
- Mode latihan tidak pernah menulis ke server: semua layar hanya memanggil adaptor `api` yang diberikan shell (tidak pernah `window.API` langsung, kecuali layar Aturan milik Rencana 2).
- Liquid Glass hanya di lapisan fungsional (dock, tombol bulat, sheet, menu Catat); kartu konten opak. Hormati `prefers-reduced-transparency`/`prefers-reduced-motion`. Target sentuh ≥ 44 px. Tampilan lapangan **terang saja** (aplikasi belum punya tema gelap; hanya `data-theme="dark"` yang menggelapkan).
- Semua teks lewat `window.t` dengan kunci `fld.*` di EN **dan** ID (`finance-i18n.js`). `window.t(k, vars)` mengganti `{nama}`.
- Edit dengan tool Edit/Write; skrip bantu ditulis ke scratchpad dengan Write (bukan heredoc). File bisa CRLF.
- Jangan ubah `distribution.jsx`. Commit lokal per tugas; push hanya atas permintaan pemilik. Jangan pernah `npx prisma format`.

## Review Focus

1. **Transaksi tersimpan tetapi tanda "terkirim" gagal** (sinyal hilang, atau server minta lokasi `POSITION_REQUIRED`) → mencoba lagi **tidak boleh** membuat transaksi kedua; hanya penandaan yang diulang. (Task 3: tes `recordSale` dengan mark yang gagal lalu berhasil; Task 6: tes statis `txnRef`.)
2. **Rit kemarin masih terbuka** → layar menjelaskan dan menawarkan "Tutup rit", bukan error 400 yang membingungkan saat membuka rit baru. (Task 1: `field-context.openRun`; Task 3: `runState().stale`; Task 7: tes statis cabang `rs.open`.)
3. **Tutup hari dengan stop yang belum punya alasan** → tombol mati dan jumlah yang kurang ditampilkan; tidak ada stop yang hilang diam-diam. (Task 3: tes `closeCheck`; Task 9: tes statis.)
4. **Peta gagal dimuat (offline)** → daftar rute tetap tampil dengan pesan, bukan layar kosong. (Task 8: tes statis `setMapErr` + daftar dirender di luar cabang peta.)
5. **Pindah mode di tengah layar** → tulisan berikutnya selalu memakai adaptor mode yang aktif, tidak pernah adaptor lama. (Task 10: tes statis `api.mode === mode`.)

---

### Task 1: Server — rit terbuka dari hari mana pun di konteks lapangan + `outstanding` di API lapangan

**Files:**
- Modify: `server/src/services/distribution.service.js` (fungsi `fieldContext`)
- Modify: `api.js` (namespace `distribusi.field`)
- Test: `server/tests/field-context.test.js` (tambah tes), `server/tests/api-client-field.test.js` (tambah nama + URL)

**Interfaces:**
- Produces: `GET /distribusi/field-context` → `data.openRun` = `runClient` rit **terbuka terakhir armada itu, tanggal berapa pun**, atau `null`. `API.distribusi.field.outstanding(fleet)` → `GET /distribusi/deliveries/outstanding?fleet=…` (bertanda `X-Airro-Ui`).

- [ ] **Step 1: Tes gagal** — tambahkan di akhir `server/tests/field-context.test.js`:

```js
it('an open rit from an earlier day is reported (it blocks opening a new one)', async () => {
  const { addDaysISO } = require('../src/config/permissions');
  const yesterday = addDaysISO(today, -1);
  await prisma.deliveryRun.deleteMany();
  expect((await request(app).post(`${D}/runs/open`).set(auth(gm)).send({ date: yesterday, fleet: 'DK 1', gallonsOut: 90 })).status).toBe(201);
  const c = (await request(app).get(`${D}/field-context`).set(auth(driver))).body.data;
  expect(c.openRun).toMatchObject({ date: yesterday, runNo: 1, gallonsOut: 90, status: 'open', sold: 0 });
  const none = (await request(app).get(`${D}/field-context?fleet=DK%202`).set(auth(gm))).body.data;
  expect(none.openRun).toBeNull();
});
```

Di `server/tests/api-client-field.test.js`, pada tes `'the field namespace covers every adaptor method'` tambahkan `'outstanding'` ke daftar nama, dan tambahkan tes:

```js
it('outstanding is a tagged read scoped to the armada', async () => {
  const { API, calls } = loadApi();
  await API.distribusi.field.outstanding('DK 1');
  expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://x/api/v1/distribusi/deliveries/outstanding?fleet=DK%201' });
  expect(calls[0].headers['X-Airro-Ui']).toBe('field');
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-context.test.js tests/api-client-field.test.js` → FAIL (`openRun` undefined; `outstanding` bukan fungsi).

- [ ] **Step 3: Implementasi** — di `fieldContext` (distribution.service.js), ganti baris `return { today, fleet, fleets, rules, depot, demand };` dengan:

```js
  // The armada's open rit, WHATEVER its date: a rit left open yesterday blocks opening a new one
  // (openRun refuses), so the phone must see it and offer "Tutup rit" first.
  let openRun = null;
  if (fleet) {
    const run = await prisma.deliveryRun.findFirst({ where: { fleetId: fleet, status: 'open' }, orderBy: [{ date: 'desc' }, { runNo: 'desc' }] });
    if (run) {
      const sold = (await soldForRuns([run.id]))[run.id] || 0;
      const corrs = (await correctionsForRuns([run.id]))[run.id] || [];
      openRun = runClient(run, sold, corrs);
    }
  }
  return { today, fleet, fleets, rules, depot, demand, openRun };
```

Di `api.js`, dalam objek `field: {`, setelah baris `daySummary: …` tambahkan:

```js
        outstanding: (fleet) => freq('GET', '/distribusi/deliveries/outstanding' + qd(null, fleet)),
```

- [ ] **Step 4: Jalankan** — `jest tests/field-context.test.js tests/api-client-field.test.js tests/run-sop-capacity.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add server/src/services/distribution.service.js api.js server/tests/field-context.test.js server/tests/api-client-field.test.js && git commit -m "feat(distribusi): field context reports the armada's open rit of any date; tagged outstanding read"`

---

### Task 2: Adaptor & mesin latihan — mengikuti server lebih rapat, foto disimpan terpisah, kegagalan simpan terlihat

**Files:**
- Modify: `dist-field-sandbox.js`, `dist-field-api.js`
- Test: `server/tests/field-sandbox.test.js`, `server/tests/field-api.test.js` (tambah tes)

**Interfaces:**
- Consumes: `context.openRun` (Task 1), `API.distribusi.field.outstanding` (Task 1).
- Produces:
  - `FIELDSANDBOX.VERSION = 2` (salinan lama dari versi 1 otomatis disalin ulang).
  - `markStop(id, { status:'pending'|'terkirim'|'ditunda'|'batal', reason?, transactionId?, noLocationReason? })` di latihan **sama dengan server** (alasan tunda wajib; alasan batal wajib bila `wajibAlasanBatal`; status lain → 400). `holdStop`/`cancelStop` = `markStop` dengan status itu.
  - `closeDay(body)` → objek closeout `{ id, date, fleetId, closedByName, closedAt, generalNote, delivered, pending }` (sama dengan respons server yang sudah di-unwrap).
  - `outstanding()` di kedua adaptor (asli: 403 → `[]`; latihan: salinan). `FIELDAPI.METHODS` jadi 29 nama.
  - `ritRoute()` latihan hanya memakai rit terbuka **hari ini** (seperti server); `openRun()` latihan menolak bila ada rit terbuka tanggal berapa pun (rit dari `context.openRun` ikut disalin).
  - Sisa bon pelanggan yang `null` di daftar pelanggan diambil dari papan (`board[].sisaBon`).
  - `createSandbox(state, { photoStore })` — bila ada, foto disimpan lewat `photoStore.put(id, data)` / `photoStore.get(id)`; state hanya menyimpan penanda `photos[id] = true`.
  - `openLatihan({ …, onPersist })` — foto latihan di kunci terpisah `<key>:photos` (disimpan hanya saat foto baru); simpanan yang gagal di tengah sesi membuat `a.persisted = false` dan memanggil `onPersist(false)`; `reset()` **menolak** (reject) bila penghapusan gagal.

- [ ] **Step 1: Tes gagal** — tambahkan di akhir `server/tests/field-sandbox.test.js`:

```js
describe('closer to the server', () => {
  it('markStop accepts the four statuses with the server\'s reason rules', async () => {
    const { api } = make();
    expect(await code(api.markStop('s1', { status: 'ditunda' }))).toBe('REASON_REQUIRED');
    expect(await code(api.markStop('s1', { status: 'batal' }))).toBe('REASON_REQUIRED');   // wajibAlasanBatal on in SNAP
    expect(await code(api.markStop('s1', { status: 'hilang' }))).toBe(400);
    expect((await api.markStop('s1', { status: 'ditunda', reason: 'Toko tutup' })).pendingReason).toBe('Toko tutup');
    expect((await api.markStop('s1', { status: 'pending' })).pendingReason).toBe('');
  });
  it('closeDay returns the closeout like the server', async () => {
    const { api } = make();
    const co = await api.closeDay({ reasons: { s1: 'tutup', s2: 'tutup' }, generalNote: 'hujan' });
    expect(co).toMatchObject({ date: '2026-10-01', fleetId: 'DK 1', pending: 2, delivered: 0, generalNote: 'hujan' });
  });
  it('an open rit from yesterday blocks a new one and is not today\'s route', async () => {
    const snap = SNAP(); snap.context.openRun = { id: 'r-old', date: '2026-09-30', fleetId: 'DK 1', runNo: 2, gallonsOut: 80, sold: 10, status: 'open' };
    const api = SB.createSandbox(SB.fromSnapshot(snap), { planRit });
    expect(await code(api.openRun({ gallonsOut: 90 }))).toBe(400);
    expect(await code(api.ritRoute())).toBe(400);
    expect((await api.closeRun('r-old', { gallonsFullReturned: 70, gallonsEmptyReturned: 0 })).status).toBe('closed');
    expect((await api.openRun({ gallonsOut: 90 })).runNo).toBe(1);
  });
  it('a customer\'s unknown sisa bon falls back to the board\'s', async () => {
    const snap = SNAP(); snap.customers[0].sisaBon = null; snap.board[0].sisaBon = 45000;
    const api = SB.createSandbox(SB.fromSnapshot(snap), { planRit });
    expect((await api.customers()).find((c) => c.id === 'c1').sisaBon).toBe(45000);
  });
  it('outstanding comes from the copy', async () => {
    const snap = SNAP(); snap.outstanding = [{ id: 'o1', date: '2026-09-29', customerName: 'Lama', umur: 2 }];
    const api = SB.createSandbox(SB.fromSnapshot(snap), { planRit });
    expect((await api.outstanding())[0].id).toBe('o1');
  });
  it('photos go to the photo store; the state keeps only a marker', async () => {
    const box = {};
    const api = SB.createSandbox(SB.fromSnapshot(SNAP()), { planRit, photoStore: { put: (id, d) => { box[id] = d; return Promise.resolve(); }, get: (id) => Promise.resolve(box[id] || null) } });
    const ph = await api.uploadPhoto({ data: 'data:image/jpeg;base64,AAA' });
    expect(api.exportState().photos[ph.id]).toBe(true);
    expect(box[ph.id]).toBe('data:image/jpeg;base64,AAA');
    expect(await api.photo(ph.id)).toBe('data:image/jpeg;base64,AAA');
    expect(SB.VERSION).toBe(2);
  });
});
```

Tambahkan di akhir `server/tests/field-api.test.js`:

```js
describe('Plan 3A adaptor hardening', () => {
  it('29 methods incl. outstanding; real outstanding 403 → []', async () => {
    expect(FA.METHODS).toContain('outstanding');
    expect(FA.METHODS.length).toBe(29);
    const denied = () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }));
    expect(await REAL({ outstanding: denied }).outstanding()).toEqual([]);
    expect(await REAL({ outstanding: () => Promise.resolve({ data: [{ id: 'o1' }], count: 1 }) }).outstanding()).toEqual([{ id: 'o1' }]);
  });
  it('the practice copy includes outstanding (403 → empty)', async () => {
    const denied = () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }));
    const a = await FA.openLatihan({ key: 'p1', real: REAL({ outstanding: denied }), storage: FA.memoryStorage(), sandbox: SB });
    expect(await a.outstanding()).toEqual([]);
  });
  it('practice photos live under their own key, saved only when a photo is added, and survive a reopen', async () => {
    const storage = FA.memoryStorage();
    const a = await FA.openLatihan({ key: 'p2', real: REAL(), storage, sandbox: SB });
    const ph = await a.uploadPhoto({ data: 'data:image/jpeg;base64,BBB' });
    await a.holdStop('s1', 'tutup');
    await new Promise((r) => setTimeout(r, 0));
    expect((await storage.get('p2')).photos[ph.id]).toBe(true);
    expect((await storage.get('p2:photos'))[ph.id]).toBe('data:image/jpeg;base64,BBB');
    const b = await FA.openLatihan({ key: 'p2', real: REAL({ board: () => Promise.reject(new Error('no re-copy')) }), storage, sandbox: SB });
    expect(await b.photo(ph.id)).toBe('data:image/jpeg;base64,BBB');
    await b.reset();
    expect(await storage.get('p2')).toBeUndefined();
    expect(await storage.get('p2:photos')).toBeUndefined();
  });
  it('a save failing mid-session flips persisted and tells the screen', async () => {
    const mem = FA.memoryStorage(); let fail = false; const seen = [];
    const storage = { get: mem.get, del: mem.del, set: (k, v) => (fail ? Promise.reject(new Error('QuotaExceeded')) : mem.set(k, v)) };
    const a = await FA.openLatihan({ key: 'p3', real: REAL(), storage, sandbox: SB, onPersist: (ok) => seen.push(ok) });
    expect(a.persisted).toBe(true);
    fail = true;
    await a.holdStop('s1', 'tutup');
    await new Promise((r) => setTimeout(r, 10));
    expect(a.persisted).toBe(false);
    expect(seen).toEqual([false]);
  });
  it('reset reports a failed delete instead of pretending', async () => {
    const mem = FA.memoryStorage();
    const storage = { get: mem.get, set: mem.set, del: () => Promise.reject(new Error('locked')) };
    const a = await FA.openLatihan({ key: 'p4', real: REAL(), storage, sandbox: SB });
    await expect(a.reset()).rejects.toThrow();
  });
  it('a version-1 copy (Plan 2) is re-copied', async () => {
    const storage = FA.memoryStorage();
    await storage.set('p5', { v: 1, date: '2026-10-01', stops: [], runs: [] });
    const a = await FA.openLatihan({ key: 'p5', real: REAL(), storage, sandbox: SB, today: '2026-10-01' });
    expect((await a.board())[0].id).toBe('s1');
  });
});
```

Ubah juga yang sudah ada di `field-api.test.js`:
- pada `'both adaptors expose exactly the same methods'` ganti `toBe(28)` menjadi `toBe(29)`;
- di `const FIELD_NAMES = [...]` tambahkan `'outstanding'`, dan di objek `F` dalam `fakeApi` tambahkan `outstanding: ok([]),` setelah `myChangeRequests: ok([]),` (tanpa ini salinan latihan di tes lama gagal karena `F.outstanding` hilang / mengembalikan `{}`).

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-sandbox.test.js tests/field-api.test.js` → FAIL (VERSION 1, `outstanding` hilang, `markStop` mengabaikan ditunda, dst).

- [ ] **Step 3: `dist-field-sandbox.js`**

a) `var VERSION = 1;` → `var VERSION = 2;   // 2: photos kept apart from the state (Plan 3A)`

b) Di `fromSnapshot`, sebelum `var customers = {};` tambahkan:

```js
    var boardBon = {}; (s.board || []).forEach(function (st) { if (st.sisaBon != null) boardBon[st.customerId] = st.sisaBon; });
```

dan pada objek pelanggan ganti `sisaBon: int(c.sisaBon),` dengan `sisaBon: c.sisaBon != null ? int(c.sisaBon) : int(boardBon[c.id]),` (sisa bon di luar jendela baca datang `null` dari daftar pelanggan).

c) Di `fromSnapshot`, ganti baris `runs: (s.runs || []).map(…)` dengan:

```js
      runs: (s.runs || []).concat(ctx.openRun && !(s.runs || []).some(function (r) { return r.id === ctx.openRun.id; }) ? [ctx.openRun] : []).map(function (r) { return { id: r.id, date: r.date, fleetId: r.fleetId, runNo: int(r.runNo), gallonsOut: int(r.gallonsOut), gallonsFullReturned: int(r.gallonsFullReturned), gallonsEmptyReturned: int(r.gallonsEmptyReturned), status: r.status || 'open', underSopReason: r.underSopReason || '', diffReason: r.diffReason || '', sold: int(r.sold) }; }),
      outstanding: clone(s.outstanding) || [],
```

d) Di `createSandbox`, setelah `var changed = o.onChange || function () {};` tambahkan `var photoStore = o.photoStore || null;`. Ganti `return {` (objek adaptor) menjadi `var api = {` dan tambahkan `return api;` setelah penutup objek `};` (sebelum `}` penutup `createSandbox`).

e) Ganti `markStop`, `holdStop`, `cancelStop` dengan:

```js
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
```

f) Di `ritRoute`, ganti baris pertama `var ru = openRunOf(); if (!ru) throw …` dengan:

```js
        // Like the server: the route belongs to TODAY's open rit; an older open rit must be closed first.
        var ru = s.runs.find(function (r) { return r.fleetId === s.fleet && r.status === 'open' && r.date === s.date; });
        if (!ru) throw fail(400, 'Buka rit dulu (isi galon yang dimuat) — rute rit dihitung dari muatan rit itu.');
```

g) Di `closeDay`, ganti tiga baris terakhir (`var co = …; s.closeouts.push(co); return W({ closeout: co, … });`) dengan:

```js
        var delivered = s.stops.filter(function (st) { return st.date === s.date && st.fleetId === s.fleet && st.status === 'terkirim'; }).length;
        var co = { id: nid('close'), date: s.date, fleetId: s.fleet, closedByName: null, closedAt: now().getTime(), generalNote: String(b.generalNote || '').slice(0, 500), delivered: delivered, pending: pend.length };
        s.closeouts.push(co);
        return W(co);   // the server's response, unwrapped, is the closeout itself
```

h) Ganti `uploadPhoto` dan `photo` dengan:

```js
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
```

- [ ] **Step 4: `dist-field-api.js`**

a) Di `METHODS`, tambahkan `'outstanding'` setelah `'myChangeRequests'`.

b) Di `real()`, setelah `myChangeRequests: …` tambahkan:

```js
      // "Belum terkirim" needs distribusiBelumTerkirim, which drivers do not hold → empty, not an error.
      outstanding: function () { return U(F.outstanding(c.fleet)).catch(function (e) { if (e && e.status === 403) return []; throw e; }); },
```

c) Di `snapshot()`, ganti seluruh fungsi dengan:

```js
  function snapshot(realAdapter) {
    var ok403 = function (p) { return p.catch(function (e) { if (e && e.status === 403) return []; throw e; }); };
    return Promise.all([realAdapter.context(), realAdapter.board(), realAdapter.customers(), realAdapter.runs(), ok403(realAdapter.myChangeRequests()), ok403(realAdapter.outstanding())])
      .then(function (r) { return { context: r[0], board: r[1] || [], customers: r[2] || [], runs: r[3] || [], myRequests: r[4] || [], outstanding: r[5] || [] }; });
  }
```

d) Ganti seluruh fungsi `openLatihan` dengan:

```js
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
```

- [ ] **Step 5: Jalankan** — `jest tests/field-sandbox.test.js tests/field-api.test.js` → PASS semua (tes lama ikut lulus: `closeDay` kini mengembalikan closeout yang tetap punya `pending`).

- [ ] **Step 6: Commit** — `git commit -am "feat(distribusi): practice engine follows the server closer; photos kept apart; failed saves and resets surface"` (tambahkan file tes yang berubah).

---

### Task 3: `dist-field-logic.js` — logika layar harian yang bisa dites

**Files:**
- Create: `dist-field-logic.js` (root, UMD `window.FIELDLOGIC`)
- Modify: `build.mjs` (FILES: `'dist-field-logic.js',` tepat setelah `'dist-field-api.js',`)
- Test: `server/tests/field-logic.test.js` (baru)

**Interfaces:**
- Produces `FIELDLOGIC`:
  - `fmtRp(n) → 'Rp 45.000'` (negatif `'−Rp 5.000'`); `fmtKm(n) → '0,4 km'`.
  - `gapsOf({lat,lng,phone,locationPhotoId}) → {titik,wa,foto,count}` (aturan sama dengan `FIELDAPI.dataGaps`).
  - `boardView({ board, customers, route, outstanding, demand }) → { stops, pending, done, held, next, counts:{pending,done,held}, outsideRoute, incomplete, outstanding }`; setiap stop diperkaya `{ gaps, gallonsHeld (null bila tak diketahui), address, planQty, routeIdx (null), legKm (null) }`.
  - `runState({ today, openRun, runs }) → { open, stale, nextNo, remaining, count }`.
  - `runGauge({ load, capacity, minLoad }) → { load, under, over, atCap, max, canOpen }`.
  - `loadPreview({ planRit, depot, stops:[{id,lat,lng,qty,pinned}], load }) → { fits, used, leftoverGallons, estRits, unlocated } | null`.
  - `salePreview({ qty, price, method, sisaBon }) → { subtotal, paidNow, sisaAfter, totalKey }`.
  - `saleBody({ customerId, qty, gallonIn, method, photo }) → body createSale`.
  - `canSaveSale({ qty, photo }) → '' | 'fld.needQty' | 'fld.needPhoto'`.
  - `recordSale(api, { stopId, body, txnId, noLocationReason }) → Promise<{ txnId, done, needReason? }>`; error yang dilempar membawa `e.txnId` bila transaksi sudah tersimpan.
  - `closeCheck(pending, reasons) → { missing:[id], ok }`.

- [ ] **Step 1: Tes gagal** — `server/tests/field-logic.test.js`:

```js
'use strict';
// FIELD SCREEN LOGIC — everything the day screens decide, as pure functions tested in Node.
const path = require('path');
const root = path.join(__dirname, '..', '..');
const L = require(path.join(root, 'dist-field-logic.js'));
const { planRit } = require(path.join(root, 'rit-plan.js'));
const FA = require(path.join(root, 'dist-field-api.js'));

const stop = (o) => Object.assign({ id: 's', date: '2026-10-01', fleetId: 'DK 1', customerId: 'c', seq: 0, status: 'pending', qty: null, pinned: false, source: 'jadwal', customerName: 'X', phone: '0812', lat: -8.6, lng: 115.2, locationPhotoId: 'p', sisaBon: 0, mapsLink: 'm' }, o);

describe('formatting + gaps', () => {
  it('rupiah and km in Indonesian style', () => {
    expect(L.fmtRp(45000)).toBe('Rp 45.000');
    expect(L.fmtRp(-5000)).toBe('−Rp 5.000');
    expect(L.fmtKm(0.43)).toBe('0,4 km');
    expect(L.fmtKm(11.4)).toBe('11,4 km');
  });
  it('gaps agree with the adaptor\'s rule', () => {
    [{ lat: null, lng: null, phone: '', locationPhotoId: null }, { lat: 1, lng: 2, phone: '08', locationPhotoId: 'p' }, { lat: 1, lng: 2, phone: '', locationPhotoId: null }]
      .forEach((c) => expect(L.gapsOf(c)).toEqual(FA.dataGaps(c)));
  });
});

describe('boardView', () => {
  const board = [
    stop({ id: 'a', customerId: 'ca', seq: 0, customerName: 'A' }),
    stop({ id: 'b', customerId: 'cb', seq: 1, customerName: 'B', lat: null, lng: null, mapsLink: '', phone: '' }),
    stop({ id: 'c', customerId: 'cc', seq: 2, customerName: 'C', status: 'terkirim' }),
    stop({ id: 'd', customerId: 'cd', seq: 3, customerName: 'D', status: 'ditunda', pendingReason: 'tutup' }),
    stop({ id: 'e', customerId: 'ce', seq: 4, customerName: 'E' }),
  ];
  const customers = [{ id: 'ca', gallonsHeld: 6, address: 'Jl. A' }, { id: 'ce', gallonsHeld: null }];
  it('splits, counts, flags gaps and stops outside the route', () => {
    const v = L.boardView({ board, customers, route: null, outstanding: [], demand: { a: 4 } });
    expect(v.counts).toEqual({ pending: 3, done: 1, held: 1 });
    expect(v.pending.map((s) => s.id)).toEqual(['a', 'b', 'e']);
    expect(v.outsideRoute).toBe(1);
    expect(v.incomplete).toBe(1);
    expect(v.next.id).toBe('a');
    const a = v.stops.find((s) => s.id === 'a');
    expect(a).toMatchObject({ gallonsHeld: 6, address: 'Jl. A', planQty: 4 });
    expect(v.stops.find((s) => s.id === 'e').gallonsHeld).toBeNull();
  });
  it('with an open route: route order first, next = first leg, plan qty and leg km from the route', () => {
    const route = { rit: [{ id: 'e', qty: 5, legKm: 0.4 }, { id: 'a', qty: 3, legKm: 1.2 }] };
    const v = L.boardView({ board, customers, route, outstanding: [], demand: {} });
    expect(v.pending.map((s) => s.id)).toEqual(['e', 'a', 'b']);
    expect(v.next).toMatchObject({ id: 'e', planQty: 5, legKm: 0.4, routeIdx: 0 });
  });
  it('nothing to deliver → no next', () => {
    expect(L.boardView({ board: [stop({ status: 'terkirim' })], customers: [] }).next).toBeNull();
  });
});

describe('rits', () => {
  it('runState: open today, stale from yesterday, next number', () => {
    const runs = [{ id: 'r1', date: '2026-10-01', runNo: 1, status: 'closed', gallonsOut: 80, sold: 80 }, { id: 'r2', date: '2026-10-01', runNo: 2, status: 'open', gallonsOut: 80, sold: 6 }];
    expect(L.runState({ today: '2026-10-01', openRun: null, runs })).toMatchObject({ stale: false, nextNo: 3, remaining: 74, count: 2 });
    expect(L.runState({ today: '2026-10-01', openRun: null, runs })).toHaveProperty('open.id', 'r2');
    const y = L.runState({ today: '2026-10-01', openRun: { id: 'r9', date: '2026-09-30', runNo: 2, status: 'open', gallonsOut: 80, sold: 70 }, runs: [] });
    expect(y).toMatchObject({ stale: true, nextNo: 1, remaining: 10 });
    expect(L.runState({ today: '2026-10-01', openRun: null, runs: [] })).toMatchObject({ open: null, stale: false, nextNo: 1 });
  });
  it('runGauge: under SOP needs a reason, over capacity cannot open', () => {
    expect(L.runGauge({ load: 64, capacity: 120, minLoad: 80 })).toMatchObject({ under: true, over: false, canOpen: true, max: 120 });
    expect(L.runGauge({ load: 121, capacity: 120, minLoad: 80 })).toMatchObject({ over: true, canOpen: false });
    expect(L.runGauge({ load: 120, capacity: 120, minLoad: 80 })).toMatchObject({ atCap: true, under: false });
    expect(L.runGauge({ load: 0, capacity: 0, minLoad: 80 })).toMatchObject({ canOpen: false, max: 160 });
  });
  it('loadPreview plans with the real rit planner; no depot → null', () => {
    const stops = [{ id: 'a', lat: -8.66, lng: 115.21, qty: 30 }, { id: 'b', lat: -8.64, lng: 115.19, qty: 40 }, { id: 'c', lat: null, lng: null, qty: 5 }];
    expect(L.loadPreview({ planRit, depot: { lat: -8.65, lng: 115.2 }, stops, load: 60 })).toMatchObject({ fits: 1, leftoverGallons: 40, estRits: 1, unlocated: 1 });
    expect(L.loadPreview({ planRit, depot: null, stops, load: 60 })).toBeNull();
  });
});

describe('sale', () => {
  it('preview per method', () => {
    expect(L.salePreview({ qty: 4, price: 18000, method: 'lunas', sisaBon: 45000 })).toEqual({ subtotal: 72000, paidNow: 72000, sisaAfter: 45000, totalKey: 'fld.cashIn' });
    expect(L.salePreview({ qty: 4, price: 18000, method: 'bon', sisaBon: 45000 })).toEqual({ subtotal: 72000, paidNow: 0, sisaAfter: 117000, totalKey: 'fld.paidNow' });
    expect(L.salePreview({ qty: 4, price: 18000, method: 'transfer', sisaBon: 0 }).totalKey).toBe('fld.transferred');
  });
  it('body per method, proof fields only when known', () => {
    const photo = { id: 'p1', takenAt: '2026-10-01T02:04:00.000Z', lat: -8.6, lng: 115.2 };
    expect(L.saleBody({ customerId: 'c', qty: 4, gallonIn: 6, method: 'transfer', photo })).toEqual({ customerId: 'c', qty: 4, gallonOut: 4, gallonIn: 6, method: 'lunas', payMethod: 'transfer', proofPhotoId: 'p1', proofTakenAt: '2026-10-01T02:04:00.000Z', proofLat: -8.6, proofLng: 115.2 });
    expect(L.saleBody({ customerId: 'c', qty: 1, gallonIn: 0, method: 'bon', photo: { id: 'p2', takenAt: 't', lat: null, lng: null } })).toEqual({ customerId: 'c', qty: 1, gallonOut: 1, gallonIn: 0, method: 'bon', proofPhotoId: 'p2', proofTakenAt: 't' });
    expect(L.saleBody({ customerId: 'c', qty: 1, gallonIn: 0, method: 'lunas', photo: null }).payMethod).toBe('tunai');
  });
  it('canSaveSale: a photo is always required in the new UI', () => {
    expect(L.canSaveSale({ qty: 0, photo: { id: 'p' } })).toBe('fld.needQty');
    expect(L.canSaveSale({ qty: 2, photo: null })).toBe('fld.needPhoto');
    expect(L.canSaveSale({ qty: 2, photo: { id: 'p' } })).toBe('');
  });
});

describe('recordSale never creates a sale twice', () => {
  const api = (markResults) => {
    const calls = { create: 0, mark: [] };
    return { calls, createSale: () => { calls.create += 1; return Promise.resolve({ id: 't' + calls.create }); },
      markStop: (id, b) => { calls.mark.push(b); const r = markResults.shift(); return r === 'ok' ? Promise.resolve({}) : Promise.reject(r); } };
  };
  const posErr = Object.assign(new Error('pos'), { body: { error: { message: 'Aktifkan lokasi', details: { code: 'POSITION_REQUIRED' } } } });
  it('POSITION_REQUIRED → ask for a reason, then retry only the marking', async () => {
    const a = api([posErr, 'ok']);
    const r1 = await L.recordSale(a, { stopId: 's1', body: { qty: 1 } });
    expect(r1).toEqual({ txnId: 't1', done: false, needReason: true });
    const r2 = await L.recordSale(a, { stopId: 's1', body: { qty: 1 }, txnId: r1.txnId, noLocationReason: 'GPS mati' });
    expect(r2).toEqual({ txnId: 't1', done: true });
    expect(a.calls.create).toBe(1);
    expect(a.calls.mark[1]).toEqual({ status: 'terkirim', transactionId: 't1', noLocationReason: 'GPS mati' });
  });
  it('a network error after the sale carries the saved id so the retry does not re-create it', async () => {
    const a = api([Object.assign(new Error('offline'), { offline: true }), 'ok']);
    let saved = null;
    await L.recordSale(a, { stopId: 's1', body: {} }).catch((e) => { saved = e.txnId; });
    expect(saved).toBe('t1');
    await L.recordSale(a, { stopId: 's1', body: {}, txnId: saved });
    expect(a.calls.create).toBe(1);
  });
});

it('closeCheck lists every pending stop still without a reason', () => {
  const pending = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  expect(L.closeCheck(pending, { a: 'Toko tutup', b: '  ' })).toEqual({ missing: ['b', 'c'], ok: false });
  expect(L.closeCheck([], {})).toEqual({ missing: [], ok: true });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-logic.test.js` → FAIL (`Cannot find module …dist-field-logic.js`).

- [ ] **Step 3: Tulis `dist-field-logic.js`**

```js
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
```

Tambahkan `'dist-field-logic.js',` di `build.mjs` `FILES` tepat setelah `'dist-field-api.js',`.

- [ ] **Step 4: Jalankan** — `jest tests/field-logic.test.js` → PASS. (Bila `fmtKm(0.43)` di Node mengeluarkan `0.4 km` karena ICU minimal, Node server sudah punya full-icu sejak Node 13 — kalau tetap gagal, ganti implementasi `fmtKm` menjadi `String(Math.round(num(n) * 10) / 10).replace('.', ',')` dengan penambahan `,0` saat bilangan bulat, dan catat ruling.)

- [ ] **Step 5: Commit** — `git add dist-field-logic.js build.mjs server/tests/field-logic.test.js && git commit -m "feat(distribusi): field screen logic (board, rit, sale, close-day) as tested pure functions"`

---

### Task 4: `dist-field-kit.jsx` — komponen bersama + foto bukti berstempel + tampilan terang

**Files:**
- Create: `dist-field-kit.jsx`
- Modify: `dist-field.jsx` (pindahkan helper bersama ke kit), `dist-field.css` (gaya kit + hapus blok `prefers-color-scheme`), `build.mjs` (FILES), `finance-i18n.js` (kunci), `server/tests/field-shell-static.test.js` (perluas ke semua file lapangan)
- Test: `server/tests/field-kit-static.test.js` (baru)

**Interfaces:**
- Produces (global bundel, dipakai `dist-field-day.jsx` dan `dist-field.jsx`):
  - hooks `uSfl`, `uEfl`, `uRfl`; `trFl(k, v)`; `fldPlates(list)`; `fldErrMsg(e)`; `FldIco(name, size)`; `FldSheet({title, body, confirmLabel, danger, onConfirm, onClose})` — **dipindah** dari `dist-field.jsx`.
  - `fldGeo(ms) → Promise<{lat,lng,accuracy}|null>`.
  - `fldLinks(stop) → { nav, tel, wa }` (string kosong bila tidak tersedia).
  - `FldTop({ title, sub, onBack })`, `FldStepper({ label, hint, value, onChange, min, max })`, `FldSeg({ label, options:[[key,text]], value, onChange })`, `FldChips({ options:[text], otherLabel, value, onChange })` (pilihan "Lainnya" membuka isian teks; `value` = teks akhir), `FldNotice({ tone:'warn'|'info'|'ok', title, sub, action, onAction })`.
  - `FldPhoto({ api, value, onChange, hintKey })` — kamera belakang (`capture="environment"`), diperkecil `shrinkToJpeg` (≤ 1024 px), diunggah lewat `api.uploadPhoto`, distempel jam + GPS; `value` = `{ id, takenAt, lat, lng, preview }`.
- Consumes (sudah ada di bundel, dimuat lebih dulu): `readDataURL`, `loadImage`, `shrinkToJpeg` (`ui-dropdown.jsx`), `waHref` (`distribution.jsx`).

- [ ] **Step 1: Tes gagal** — `server/tests/field-kit-static.test.js`:

```js
'use strict';
// FIELD KIT (static — no browser in the server run): parses, ships in the right order, reuses the
// app's photo shrinker and wa.me guard, and the proof photo opens the rear camera.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const kit = read('dist-field-kit.jsx'); const shell = read('dist-field.jsx'); const build = read('build.mjs'); const css = read('dist-field.css');

it('parses and ships between the old screens and the field shell', () => {
  expect(() => parse(kit, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  const order = ['ui-dropdown.jsx', 'distribution.jsx', 'dist-zones.jsx', 'dist-field-kit.jsx', 'dist-field.jsx'].map((f) => build.indexOf("'" + f + "'"));
  order.forEach((i) => expect(i).toBeGreaterThan(-1));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});
it('the shared helpers moved out of the shell (defined once)', () => {
  ['const trFl =', 'function FldSheet(', 'const fldErrMsg =', 'const FldIco =', 'const fldPlates ='].forEach((d) => {
    expect(kit).toContain(d);
    expect(shell).not.toContain(d);
  });
});
it('the globals it reuses really exist in the files loaded before it', () => {
  expect(read('ui-dropdown.jsx')).toMatch(/^function shrinkToJpeg\(/m);
  expect(read('ui-dropdown.jsx')).toMatch(/^const readDataURL = /m);
  expect(read('ui-dropdown.jsx')).toMatch(/^const loadImage = /m);
  expect(read('distribution.jsx')).toMatch(/^const waHref = /m);
});
it('proof photo: rear camera, shrunk, uploaded through the adaptor, stamped with time + GPS', () => {
  const ph = kit.slice(kit.indexOf('function FldPhoto('));
  expect(ph).toMatch(/capture="environment"/);
  expect(ph).toMatch(/accept="image\/\*"/);
  expect(ph).toMatch(/shrinkToJpeg\(/);
  expect(ph).toMatch(/api\.uploadPhoto\(/);
  expect(ph).toMatch(/takenAt: new Date\(\)\.toISOString\(\)/);
  expect(ph).not.toMatch(/window\.API/);
});
it('field screens are light-only (the app has no dark theme)', () => {
  expect(css).not.toMatch(/prefers-color-scheme/);
  expect(css).toMatch(/:root\[data-theme="dark"\] \.mlap-root/);
});
```

Perluas `server/tests/field-shell-static.test.js`:
- ganti baris `const jsx = read('dist-field.jsx');` (di deklarasi `const jsx = …; const css = …`) menjadi `const jsx = read('dist-field.jsx'); const allJsx = ['dist-field-kit.jsx', 'dist-field-day.jsx', 'dist-field.jsx'].filter((f) => fs.existsSync(path.join(root, f))).map(read).join('\n');`
- di tes `'its top-level names do not collide…'` ganti badan tes dengan versi yang memeriksa **setiap** file lapangan terhadap semua file bundel lain:

```js
it('top-level names in every field file are unique across the whole bundle (one shared scope)', () => {
  const fieldFiles = ['dist-field-kit.jsx', 'dist-field-day.jsx', 'dist-field.jsx'].filter((f) => fs.existsSync(path.join(root, f)));
  const namesOf = (src) => [...src.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
    .concat([...src.matchAll(/^const \{([^}]*)\} = React;/gm)].flatMap((m) => m[1].split(',').map((x) => x.split(':').pop().trim())));
  const bundled = [...build.matchAll(/'([\w.-]+\.jsx?)'/g)].map((m) => m[1]).filter((f) => fs.existsSync(path.join(root, f)));
  fieldFiles.forEach((ff) => {
    const mine = namesOf(read(ff)).filter(Boolean);
    bundled.filter((f) => f !== ff).forEach((f) => {
      const src = read(f);
      mine.forEach((n) => expect({ in: ff, other: f, name: n, clash: new RegExp('^(?:const|let|var|function)\\s+' + n.replace('$', '\\$') + '\\b|^const \\{[^}]*:\\s*' + n + '\\s*[,}]', 'm').test(src) }).toEqual({ in: ff, other: f, name: n, clash: false }));
    });
  });
});
```

- di tes `'every fld.* key used exists in EN and ID'` ganti `jsx.matchAll(` menjadi `allJsx.matchAll(`.
- di tes `'parses and ships'` ganti `expect(build).toMatch(/'dist-zones\.jsx',\s*'dist-field\.jsx',/);` dengan `expect(build.indexOf("'dist-zones.jsx'")).toBeLessThan(build.indexOf("'dist-field.jsx'"));` (kit dan layar kini berada di antara keduanya).

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-kit-static.test.js tests/field-shell-static.test.js` → FAIL (kit belum ada).

- [ ] **Step 3: Pindahkan helper bersama** — di `dist-field.jsx` hapus baris-baris ini (pindah ke kit, isinya sama): `const { useState: uSfl, useEffect: uEfl, useRef: uRfl } = React;`, `const trFl = …`, `const fldPlates = …`, `const fldErrMsg = …`, `const FldIco = …`, dan seluruh `function FldSheet(…) { … }`. Komentar kepala dan `const FLD_SCREENS_READY = false;` tetap di `dist-field.jsx`.

- [ ] **Step 4: Tulis `dist-field-kit.jsx`**

```jsx
/* MODE LAPANGAN — KIT: the small pieces every field screen shares (sheet, header, stepper, segmented
   control, reason chips, notice, the stamped proof photo, Navigasi/Telepon/WA links). The bundle shares
   one scope across files, so every top-level name here is unique (Fld*, fld*, *fl). */
const { useState: uSfl, useEffect: uEfl, useRef: uRfl } = React;
const trFl = (k, v) => window.t(k, v);
const fldPlates = (list) => (list || []).map((f) => (typeof f === 'string' ? f : (f && (f.plate || f.name || f.id)) || '')).map((s) => String(s).trim()).filter(Boolean);
const fldErrMsg = (e) => (e && e.body && e.body.error && e.body.error.message) || (e && e.message) || '';
const FldIco = (name, s) => { const C = window[name]; return C ? <C s={s || 20} /> : null; };

function FldSheet({ title, body, confirmLabel, danger, onConfirm, onClose }) {
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mlap-grab" />
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="mlap-actions">
          <button type="button" className="mlap-btn" onClick={onClose}>{trFl('fld.cancel')}</button>
          <button type="button" className={'mlap-btn ' + (danger ? 'danger' : 'primary')} onClick={onConfirm}>{confirmLabel || trFl('fld.confirm')}</button>
        </div>
      </div>
    </>
  );
}

// One position fix for a stamp; null when the phone has no location or the user said no.
const fldGeo = (ms) => new Promise((res) => {
  const geo = typeof navigator !== 'undefined' && navigator.geolocation;
  if (!(geo && geo.getCurrentPosition)) { res(null); return; }
  let done = false;
  const t = setTimeout(() => { if (!done) { done = true; res(null); } }, ms || 8000);
  geo.getCurrentPosition(
    (p) => { if (done) return; done = true; clearTimeout(t); res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
    () => { if (done) return; done = true; clearTimeout(t); res(null); },
    { enableHighAccuracy: true, timeout: ms || 8000, maximumAge: 60000 });
});

// Navigasi / Telepon / WhatsApp for a stop. WhatsApp goes through the app's ONE guarded wa.me gate.
const fldLinks = (s) => {
  const x = s || {};
  const hasPt = typeof x.lat === 'number' && typeof x.lng === 'number';
  const nav = x.mapsLink || (hasPt ? 'https://www.google.com/maps/dir/?api=1&destination=' + x.lat + ',' + x.lng : '');
  const digits = String(x.phone || '').replace(/[^0-9+]/g, '');
  return { nav, tel: digits ? 'tel:' + digits : '', wa: typeof waHref === 'function' ? waHref(x.phone) : '' };
};

function FldTop({ title, sub, onBack }) {
  return (
    <div className="mlap-top">
      {onBack && <button type="button" className="mlap-round" aria-label={trFl('fld.back')} onClick={onBack}><span aria-hidden="true" className="mlap-chev">‹</span></button>}
      <div className="mlap-top-t"><h1>{title}</h1>{sub && <div className="mlap-top-sub">{sub}</div>}</div>
    </div>
  );
}

function FldStepper({ label, hint, value, onChange, min, max }) {
  const lo = min == null ? 0 : min; const hi = max == null ? 999 : max;
  const set = (v) => onChange(Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))));
  return (
    <div className="mlap-stepper">
      <span className="lb">{label}{hint ? <span className="ht">{hint}</span> : null}</span>
      <button type="button" className="mlap-step" aria-label={trFl('fld.less') + ' — ' + label} disabled={value <= lo} onClick={() => set(value - 1)}>−</button>
      <input className="mlap-stepval" inputMode="numeric" aria-label={label} value={value} onChange={(e) => set(String(e.target.value).replace(/[^0-9]/g, ''))} />
      <button type="button" className="mlap-step" aria-label={trFl('fld.more') + ' — ' + label} disabled={value >= hi} onClick={() => set(value + 1)}>+</button>
    </div>
  );
}

function FldSeg({ label, options, value, onChange }) {
  return (
    <div className="mlap-seg" role="group" aria-label={label}>
      {options.map(([k, text]) => <button key={k} type="button" aria-pressed={value === k} className={'mlap-seg-b' + (value === k ? ' on' : '')} onClick={() => onChange(k)}>{text}</button>)}
    </div>
  );
}

// Single choice of a written reason; the "other" option opens a text field (value = the final text).
function FldChips({ options, otherLabel, value, onChange }) {
  const [other, setOther] = uSfl(false);
  const pick = (o) => { if (o === otherLabel) { setOther(true); onChange(''); } else { setOther(false); onChange(o); } };
  return (
    <div className="mlap-chips">
      {options.map((o) => {
        const on = o === otherLabel ? other : (!other && value === o);
        return <button key={o} type="button" aria-pressed={on} className={'mlap-chip-b' + (on ? ' on' : '')} onClick={() => pick(o)}>{o}</button>;
      })}
      {other && <input className="mlap-text" placeholder={trFl('fld.writeReason')} aria-label={trFl('fld.writeReason')} value={value} onChange={(e) => onChange(e.target.value.slice(0, 300))} />}
    </div>
  );
}

function FldNotice({ tone, title, sub, action, onAction }) {
  return (
    <div className={'mlap-notice ' + (tone || 'info')} role={tone === 'warn' ? 'alert' : 'status'}>
      <span className="mlap-grow"><b>{title}</b>{sub ? <span className="sb">{sub}</span> : null}</span>
      {action && onAction ? <button type="button" className="mlap-btn" onClick={onAction}>{action}</button> : null}
    </div>
  );
}

// PROOF PHOTO — rear camera, shrunk to ≤1024 px (the app's shrinkToJpeg), uploaded through the
// adaptor (practice photos stay on the phone), stamped with the time and, when the phone gives one,
// a GPS fix. Gallery photos can't be blocked on the web; the stamp records when/where it was attached.
function FldPhoto({ api, value, onChange, hintKey }) {
  const inputRef = uRfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const onPick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const geoP = fldGeo(8000);
      const src = await readDataURL(file);
      const img = await loadImage(src);
      const data = shrinkToJpeg(img);
      const up = await api.uploadPhoto({ name: 'bukti.jpg', mime: 'image/jpeg', isImg: true, data });
      const pos = await geoP;
      onChange({ id: up.id, takenAt: new Date().toISOString(), lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, preview: data });
    } catch (ex) {
      setErr(fldErrMsg(ex) || trFl('fld.photoErr'));
    }
    setBusy(false);
  };
  const stamp = value ? new Date(value.takenAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' · ' + (value.lat != null ? trFl('fld.gpsOk') : trFl('fld.gpsNo')) : '';
  return (
    <div className="mlap-card mlap-photo">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
      {value ? (
        <div className="mlap-photo-has">
          <img src={value.preview} alt={trFl('fld.proof')} />
          <span className="mlap-grow"><b>{trFl('fld.photoTaken')}</b><span className="sb">{stamp}</span></span>
          <button type="button" className="mlap-btn" disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>{trFl('fld.retake')}</button>
        </div>
      ) : (
        <button type="button" className="mlap-photo-btn" disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>
          {FldIco('IconPlus', 22)}<b>{busy ? trFl('fld.photoBusy') : trFl('fld.camera')}</b>
          <span className="sb">{trFl(hintKey || 'fld.proofHint')}</span>
        </button>
      )}
      {err && <div className="mlap-err" role="alert">{err}</div>}
    </div>
  );
}
```

Di `build.mjs` `FILES`, tambahkan `'dist-field-kit.jsx',` tepat sebelum `'dist-field.jsx',`.

- [ ] **Step 5: CSS kit + tampilan terang** — di `dist-field.css`: hapus seluruh blok `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .mlap-root { … } }` (blok `:root[data-theme="dark"] .mlap-root { … }` tetap). Tambahkan sebelum `@keyframes mlapFade`:

```css
/* ── KIT (Plan 3A) ── */
.mlap-screen { display: flex; flex-direction: column; }
.mlap-top { display: flex; align-items: center; gap: 10px; padding: 12px 16px 4px; }
.mlap-top-t { flex: 1; min-width: 0; }
.mlap-top h1 { margin: 0; font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: -.02em; }
.mlap-top-sub { font-size: 13px; color: var(--mlap-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mlap-chev { font-size: 28px; line-height: 1; margin-top: -3px; }
.mlap-grow { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mlap-grow .sb, .mlap-notice .sb { font-size: 12px; color: var(--mlap-sub); font-weight: 400; }
.mlap-stepper { min-height: 64px; display: flex; align-items: center; gap: 6px; padding: 0 12px; border-bottom: 1px solid var(--mlap-line); }
.mlap-stepper:last-child { border-bottom: 0; }
.mlap-stepper .lb { flex: 1; font-size: 15px; font-weight: 600; min-width: 0; }
.mlap-stepper .ht { display: block; font-size: 12px; font-weight: 400; color: var(--mlap-sub); }
input.mlap-stepval { border: 0; background: transparent; color: var(--mlap-ink); font: inherit; font-size: 22px; font-weight: 700; width: 56px; text-align: center; font-variant-numeric: tabular-nums; }
.mlap-step:disabled { opacity: .4; cursor: not-allowed; }
.mlap-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; padding: 3px; border-radius: 12px; background: #E3E9EE; }
.mlap-seg-b { min-height: 38px; border: 0; border-radius: 9px; background: transparent; font: inherit; font-size: 14px; font-weight: 600; color: var(--mlap-ink); cursor: pointer; }
.mlap-seg-b.on { background: var(--mlap-surface); box-shadow: 0 1px 3px rgba(14,27,36,.12); }
.mlap-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mlap-chip-b { min-height: 36px; padding: 0 12px; border-radius: 18px; border: 1px solid #D5DDE3; background: var(--mlap-surface); color: var(--mlap-ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.mlap-chip-b.on { border-color: #9A5B00; background: var(--mlap-bon-soft); color: var(--mlap-bon); }
.mlap-text { width: 100%; min-height: 44px; border-radius: 10px; border: 1px solid #D5DDE3; padding: 0 12px; font: inherit; font-size: 16px; background: var(--mlap-surface); color: var(--mlap-ink); box-sizing: border-box; }
.mlap-notice { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 14px; font-size: 14px; }
.mlap-notice.warn { background: var(--mlap-warn-soft); color: var(--mlap-warn); border: 1px solid var(--mlap-warn-line); }
.mlap-notice.info { background: var(--mlap-accent-soft); color: var(--mlap-accent); }
.mlap-notice.ok { background: var(--mlap-ok-soft); color: var(--mlap-ok); }
.mlap-hint { font-size: 13px; color: var(--mlap-sub); padding: 0 4px; }
.mlap-hint.ok { color: var(--mlap-ok); }
.mlap-wide { width: 100%; }
.mlap-photo { padding: 10px; }
.mlap-photo-btn { width: 100%; min-height: 96px; border: 1.5px dashed #9FB3C2; border-radius: 14px; background: var(--mlap-accent-soft); color: var(--mlap-accent); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font: inherit; cursor: pointer; padding: 10px; text-align: center; }
.mlap-photo-has { display: flex; align-items: center; gap: 10px; }
.mlap-photo-has img { width: 64px; height: 64px; object-fit: cover; border-radius: 10px; }
```

- [ ] **Step 6: Kunci i18n** — tulis skrip bantu ke scratchpad (tool Write), `<scratchpad>/fld-keys.js`:

```js
// Usage: node fld-keys.js <keys.json>   (run from the repo root). keys.json = { "en": {...}, "id": {...} }
const fs = require('fs');
const keys = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const p = 'finance-i18n.js'; let s = fs.readFileSync(p, 'utf8');
const q = (v) => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const line = (o) => ' ' + Object.keys(o).map((k) => q(k) + ': ' + q(o[k])).join(', ') + ',';
[["'fld.tryNew': 'Try the new view (demo)',", keys.en], ["'fld.tryNew': 'Coba tampilan baru (demo)',", keys.id]].forEach(([anchor, o]) => {
  if (s.split(anchor).length !== 2) throw new Error('anchor ' + anchor);
  Object.keys(o).forEach((k) => { if (s.includes(q(k) + ':')) throw new Error('key exists: ' + k); });
  s = s.replace(anchor, anchor + line(o));
});
fs.writeFileSync(p, s); console.log('ok', Object.keys(keys.en).length);
```

dan `<scratchpad>/keys-t4.json`:

```json
{
  "en": { "fld.back": "Back", "fld.camera": "Take photo", "fld.retake": "Retake", "fld.photoTaken": "Photo attached", "fld.photoBusy": "Processing photo…", "fld.photoErr": "The photo could not be processed. Try again.", "fld.gpsOk": "GPS ✓", "fld.gpsNo": "no GPS", "fld.proof": "Proof photo", "fld.proofHint": "Time and location are recorded automatically.", "fld.writeReason": "Write the reason" },
  "id": { "fld.back": "Kembali", "fld.camera": "Ambil foto", "fld.retake": "Ulangi", "fld.photoTaken": "Foto terlampir", "fld.photoBusy": "Memproses foto…", "fld.photoErr": "Foto tidak bisa diproses. Coba lagi.", "fld.gpsOk": "GPS ✓", "fld.gpsNo": "tanpa GPS", "fld.proof": "Foto bukti", "fld.proofHint": "Jam dan lokasi tercatat otomatis.", "fld.writeReason": "Tulis alasan" }
}
```

Jalankan dari root repo: `node <scratchpad>/fld-keys.js <scratchpad>/keys-t4.json` → `ok 11`.

- [ ] **Step 7: Jalankan** — `jest tests/field-kit-static.test.js tests/field-shell-static.test.js tests/field-shell-integration.test.js` → PASS; `node build.mjs --no-minify` → sukses.

- [ ] **Step 8: Commit** — `git add dist-field-kit.jsx dist-field.jsx dist-field.css build.mjs finance-i18n.js server/tests/field-kit-static.test.js server/tests/field-shell-static.test.js && git commit -m "feat(distribusi): field kit (sheet, stepper, chips, stamped proof photo, links); field screens light-only"`

---

### Task 5: Layar Pengiriman + sheet Detail stop

**Files:**
- Create: `dist-field-day.jsx` (bagian 1)
- Modify: `build.mjs` (FILES: `'dist-field-day.jsx',` tepat setelah `'dist-field-kit.jsx',`), `dist-field.css`, `finance-i18n.js`
- Test: `server/tests/field-day-static.test.js` (baru)

**Interfaces:**
- Consumes: kit (Task 4), `FIELDLOGIC.boardView/runState/fmtRp/fmtKm` (Task 3), adaptor `board/customers/runs/outstanding/ritRoute/holdStop/cancelStop/markStop` (Task 2).
- Produces (global bundel, dirangkai di Task 10):
  - `fldLoadDay(api, ctx) → Promise<{ board, customers, runs, outstanding, route, rs, view }>`.
  - `FldBoardScreen({ api, ctx, tick, onStop(stop), onSale(stop), onOpenRun(), onRoute() })`.
  - `FldStopSheet({ api, stop, onClose(), onSale(stop), onChanged(msg) })` — `stop` adalah stop yang sudah diperkaya `boardView`.
  - `ctx` = hasil `api.context()` = `{ today, fleet, fleets, rules, depot, demand, openRun }`.

- [ ] **Step 1: Tes gagal** — `server/tests/field-day-static.test.js`:

```js
'use strict';
// FIELD DAY SCREENS (static checks — the server test run has no browser): parse, ship in order, use
// only the adaptor they are given, and keep the owner's rules (reasons always asked).
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const day = read('dist-field-day.jsx'); const build = read('build.mjs');
const fn = (name) => { const i = day.indexOf('function ' + name + '('); expect(i).toBeGreaterThan(-1); const j = day.indexOf('\nfunction ', i + 10); return day.slice(i, j < 0 ? undefined : j); };

it('every fld.* key written literally in the kit and day screens exists in EN and ID (also keys held in arrays)', () => {
  const src = read('dist-field-kit.jsx') + '\n' + day; const i18n = read('finance-i18n.js');
  const keys = [...new Set([...src.matchAll(/["'](fld\.[A-Za-z0-9_]+)["']/g)].map((m) => m[1]))];
  expect(keys.length).toBeGreaterThan(20);
  keys.forEach((k) => expect({ k, n: (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length }).toEqual({ k, n: 2 }));
});
it('parses, ships after the kit and before the shell, never calls the server directly', () => {
  expect(() => parse(day, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build).toMatch(/'dist-field-kit\.jsx',\s*'dist-field-day\.jsx',\s*'dist-field\.jsx',/);
  expect(day).not.toMatch(/window\.API|fetch\(/);
});

describe('Pengiriman', () => {
  it('loads board, customers, runs, outstanding, and the route only for today\'s open rit', () => {
    const f = fn('fldLoadDay');
    expect(f).toMatch(/Promise\.all\(\[api\.board\(\), api\.customers\(\), api\.runs\(\), api\.outstanding\(\)\]\)/);
    expect(f).toMatch(/rs\.open && !rs\.stale \? api\.ritRoute\(\)\.catch\(\(\) => null\)/);
  });
  it('shows the next stop, the three filters, incomplete-data and outside-route warnings, and a stale rit', () => {
    const f = fn('FldBoardScreen');
    ['fld.segPending', 'fld.segDone', 'fld.segHeld', 'fld.incompleteT', 'fld.outsideT', 'fld.staleRunT', 'fld.openRunN'].forEach((k) => expect(f).toContain("'" + k + "'"));
    expect(f).toMatch(/<FldNextCard /);
  });
});
describe('Detail stop', () => {
  it('hold and cancel always need a written reason (whatever the owner\'s switch)', () => {
    const f = fn('FldStopSheet');
    expect(f).toMatch(/disabled=\{busy \|\| !reason\.trim\(\)\}/);
    expect(f).toMatch(/api\.holdStop\(s\.id, reason\)/);
    expect(f).toMatch(/api\.cancelStop\(s\.id, reason\)/);
    expect(f).toMatch(/fldLinks\(s\)/);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-day-static.test.js` → FAIL (file belum ada).

- [ ] **Step 3: Tulis `dist-field-day.jsx`**

```jsx
/* MODE LAPANGAN — DAY SCREENS: Pengiriman, Detail stop, Transaksi, Buka/Tutup rit, Rute rit, Setoran.
   Every read/write goes through the adaptor `api` the shell hands in (real server or this phone's
   practice copy) — never window.API. The rules the owner set are always followed here: a written reason
   for every hold, cancel, under-SOP load and unfinished stop, and a proof photo for every sale. */
const FLD_HOLD_REASONS = ['fld.r_tutup', 'fld.r_kosong', 'fld.r_besok', 'fld.r_habis'];

// Everything the Pengiriman screen shows, in one load. The route is asked only for TODAY's open rit
// (an older open rit must be closed first; the server would refuse its route).
function fldLoadDay(api, ctx) {
  return Promise.all([api.board(), api.customers(), api.runs(), api.outstanding()]).then(([board, customers, runs, outstanding]) => {
    const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs });
    return (rs.open && !rs.stale ? api.ritRoute().catch(() => null) : Promise.resolve(null)).then((route) => ({
      board, customers, runs, outstanding, route, rs,
      view: FIELDLOGIC.boardView({ board, customers, route, outstanding, demand: ctx.demand }),
    }));
  });
}

function fldStopTag(s) {
  if (s.status === 'terkirim') return ['ok', trFl('fld.st_terkirim')];
  if (s.status === 'ditunda') return ['held', trFl('fld.st_ditunda')];
  if (s.status === 'batal') return ['neg', trFl('fld.st_batal')];
  if (s.pinned) return ['pin', trFl('fld.tagPinned')];
  if (s.source === 'tambahan') return ['info', trFl('fld.tagExtra')];
  if (s.sisaBon > 0) return ['bon', trFl('fld.tagBon')];
  return null;
}

function FldStopRow({ s, n, onClick }) {
  const tag = fldStopTag(s);
  const sub = [s.customerCode, trFl('fld.nGalon', { n: s.planQty }), s.legKm != null ? FIELDLOGIC.fmtKm(s.legKm) : '', s.pendingReason].filter(Boolean).join(' · ');
  return (
    <button type="button" className="mlap-row mlap-rowbtn" onClick={onClick}>
      <span className="mlap-num">{n}</span>
      <span className="mlap-grow"><span className="nm">{s.customerName}{s.gaps.count > 0 ? <span className="mlap-warn-dot" aria-label={trFl('fld.incompleteB')}>!</span> : null}</span><span className="sb">{sub}</span></span>
      {tag && <span className={'mlap-tag ' + tag[0]}>{tag[1]}</span>}
    </button>
  );
}

function FldNextCard({ s, onSale, onOpen }) {
  const links = fldLinks(s);
  const chips = [trFl('fld.nGalon', { n: s.planQty })];
  if (s.sisaBon > 0) chips.push(trFl('fld.bonTag', { v: FIELDLOGIC.fmtRp(s.sisaBon) }));
  if (s.gallonsHeld != null) chips.push(trFl('fld.heldTag', { n: s.gallonsHeld }));
  if (s.gaps.wa) chips.push(trFl('fld.noWa'));
  return (
    <div className="mlap-card mlap-next">
      <button type="button" className="mlap-next-hd" onClick={onOpen}>
        <span className="mlap-eyebrow">{trFl('fld.next')}{s.legKm != null ? ' · ' + FIELDLOGIC.fmtKm(s.legKm) : ''}</span>
        <span className="mlap-next-nm">{s.customerName}</span>
        {s.address ? <span className="sb">{s.address}</span> : null}
      </button>
      <div className="mlap-chips">{chips.map((c) => <span key={c} className="mlap-chip-s">{c}</span>)}</div>
      <div className="mlap-actions">
        <a className={'mlap-btn' + (links.nav ? '' : ' off')} href={links.nav || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.nav}>{trFl('fld.navigate')}</a>
        <button type="button" className="mlap-btn primary" onClick={onSale}>{trFl('fld.deliverRecord')}</button>
      </div>
    </div>
  );
}

function FldBoardScreen({ api, ctx, tick, onStop, onSale, onOpenRun, onRoute }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [seg, setSeg] = uSfl('pending');
  uEfl(() => {
    let live = true; setErr(null);
    fldLoadDay(api, ctx).then((x) => { if (live) setD(x); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, ctx, tick]);
  if (err) return <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!d) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const v = d.view; const rs = d.rs; const r = d.route;
  const list = seg === 'pending' ? v.pending : seg === 'done' ? v.done : v.held;
  return (
    <>
      <div className="mlap-card mlap-run">
        {rs.open && rs.stale ? (
          <FldNotice tone="warn" title={trFl('fld.staleRunT', { n: rs.open.runNo, date: rs.open.date })} sub={trFl('fld.staleRunB')} action={trFl('fld.closeRun')} onAction={onOpenRun} />
        ) : rs.open ? (
          <>
            <div className="mlap-run-l"><b>{trFl('fld.ritN', { n: rs.open.runNo })}</b><span className="mlap-run-big">{rs.remaining}</span><span className="sb">{trFl('fld.ofLoadLeft', { n: rs.open.gallonsOut })}</span></div>
            {r ? <div className="sb">{trFl('fld.routeLine', { stops: r.rit.length, km: FIELDLOGIC.fmtKm(r.totalKm - r.returnKm), back: FIELDLOGIC.fmtKm(r.returnKm), rits: r.estRits })}</div> : null}
            <div className="mlap-actions"><button type="button" className="mlap-btn" onClick={onRoute}>{trFl('fld.seeRoute')}</button><button type="button" className="mlap-btn" onClick={onOpenRun}>{trFl('fld.closeRun')}</button></div>
          </>
        ) : (
          <>
            <div className="mlap-run-l"><b>{trFl('fld.noRunT')}</b></div>
            <div className="sb">{trFl('fld.noRunB')}</div>
            <button type="button" className="mlap-btn primary" onClick={onOpenRun}>{trFl('fld.openRunN', { n: rs.nextNo })}</button>
          </>
        )}
      </div>
      {v.incomplete > 0 && <FldNotice tone="warn" title={trFl('fld.incompleteT', { n: v.incomplete })} sub={trFl('fld.incompleteB')} />}
      {v.outsideRoute > 0 && <FldNotice tone="info" title={trFl('fld.outsideT', { n: v.outsideRoute })} sub={trFl('fld.outsideB')} />}
      {v.next && <FldNextCard s={v.next} onSale={() => onSale(v.next)} onOpen={() => onStop(v.next)} />}
      <FldSeg label={trFl('fld.filter')} value={seg} onChange={setSeg} options={[['pending', trFl('fld.segPending', { n: v.counts.pending })], ['done', trFl('fld.segDone', { n: v.counts.done })], ['held', trFl('fld.segHeld', { n: v.counts.held })]]} />
      <div className="mlap-card">
        {list.length ? list.map((s, i) => <FldStopRow key={s.id} s={s} n={i + 1} onClick={() => onStop(s)} />) : <div className="mlap-empty">{trFl('fld.emptySeg')}</div>}
      </div>
      {v.outstanding.length > 0 && (
        <>
          <div className="mlap-eyebrow">{trFl('fld.outstandingT', { n: v.outstanding.length })}</div>
          <div className="mlap-card">
            {v.outstanding.map((o) => (
              <div key={o.id} className="mlap-row">
                <span className="mlap-num">{o.umur}</span>
                <span className="mlap-grow"><span className="nm">{o.customerName}</span><span className="sb">{[o.customerCode, o.date, o.pendingReason].filter(Boolean).join(' · ')}</span></span>
              </div>
            ))}
          </div>
          <div className="mlap-hint">{trFl('fld.outstandingHint')}</div>
        </>
      )}
    </>
  );
}

function FldStopSheet({ api, stop: s, onClose, onSale, onChanged }) {
  const [mode, setMode] = uSfl('');   // '' | 'tunda' | 'batal'
  const [reason, setReason] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const links = fldLinks(s);
  const reasons = FLD_HOLD_REASONS.map((k) => trFl(k)).concat([trFl('fld.r_other')]);
  const doHold = () => {
    setBusy(true); setErr('');
    (mode === 'tunda' ? api.holdStop(s.id, reason) : api.cancelStop(s.id, reason))
      .then(() => onChanged(trFl(mode === 'tunda' ? 'fld.heldDone' : 'fld.cancelDone')))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  const reopen = () => {
    setBusy(true); setErr('');
    api.markStop(s.id, { status: 'pending' }).then(() => onChanged(trFl('fld.reopened'))).catch((e) => setErr(fldErrMsg(e))).finally(() => setBusy(false));
  };
  const checks = [['titik', 'fld.chkTitik'], ['wa', 'fld.chkWa'], ['foto', 'fld.chkFoto']];
  const sub = [s.customerCode, s.address, s.deliveryDays && s.deliveryDays.length ? trFl('fld.sendDays', { d: s.deliveryDays.join(', ') }) : ''].filter(Boolean).join(' · ');
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={s.customerName}>
        <div className="mlap-grab" />
        <h2>{s.customerName}</h2>
        {sub ? <p>{sub}</p> : null}
        {s.gaps.count > 0 && (
          <div className="mlap-card mlap-checks">
            <div className="mlap-check-hd">{trFl('fld.gapsT', { n: 3 - s.gaps.count })}</div>
            {checks.map(([k, key]) => (
              <div key={k} className="mlap-check">
                <span className={'mlap-dot ' + (s.gaps[k] ? 'miss' : 'ok')} aria-hidden="true">{s.gaps[k] ? '!' : '✓'}</span>
                <span className="mlap-grow">{trFl(key)}</span>
                {s.gaps[k] ? <span className="sb">{trFl('fld.fillLater')}</span> : null}
              </div>
            ))}
          </div>
        )}
        <div className="mlap-links">
          <a className={'mlap-btn' + (links.nav ? '' : ' off')} href={links.nav || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.nav}>{trFl('fld.navigate')}</a>
          <a className={'mlap-btn' + (links.tel ? '' : ' off')} href={links.tel || undefined} aria-disabled={!links.tel}>{trFl('fld.call')}</a>
          <a className={'mlap-btn' + (links.wa ? '' : ' off')} href={links.wa || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.wa}>{trFl('fld.wa')}</a>
        </div>
        <div className="mlap-card mlap-facts">
          <div><span className="sb">{trFl('fld.orderToday')}</span><b>{trFl('fld.nGalon', { n: s.planQty })}</b></div>
          <div><span className="sb">{trFl('fld.heldAt')}</span><b>{s.gallonsHeld == null ? '—' : s.gallonsHeld}</b></div>
          <div><span className="sb">{trFl('fld.bonNow')}</span><b>{FIELDLOGIC.fmtRp(s.sisaBon || 0)}</b></div>
        </div>
        {s.note ? <div className="mlap-note">{s.note}</div> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        {s.status === 'pending' && !mode && (
          <>
            <div className="mlap-actions">
              <button type="button" className="mlap-btn" onClick={() => { setMode('tunda'); setReason(''); }}>{trFl('fld.hold')}</button>
              <button type="button" className="mlap-btn danger" onClick={() => { setMode('batal'); setReason(''); }}>{trFl('fld.cancelStop')}</button>
            </div>
            <button type="button" className="mlap-btn primary mlap-wide" onClick={() => onSale(s)}>{trFl('fld.deliverRecord')}</button>
          </>
        )}
        {mode && (
          <div className="mlap-card mlap-reason">
            <b>{trFl(mode === 'tunda' ? 'fld.holdWhy' : 'fld.cancelWhy')}</b>
            <FldChips options={reasons} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} />
            <div className="mlap-actions">
              <button type="button" className="mlap-btn" onClick={() => setMode('')}>{trFl('fld.cancel')}</button>
              <button type="button" className={'mlap-btn ' + (mode === 'batal' ? 'danger' : 'primary')} disabled={busy || !reason.trim()} onClick={doHold}>{trFl(mode === 'tunda' ? 'fld.holdSave' : 'fld.cancelSave')}</button>
            </div>
          </div>
        )}
        {(s.status === 'ditunda' || s.status === 'batal') && <button type="button" className="mlap-btn mlap-wide" disabled={busy} onClick={reopen}>{trFl('fld.reopen')}</button>}
        {s.status === 'terkirim' && <div className="mlap-note">{trFl('fld.doneNote')}</div>}
      </div>
    </>
  );
}
```

Di `build.mjs` `FILES` tambahkan `'dist-field-day.jsx',` tepat setelah `'dist-field-kit.jsx',`.

- [ ] **Step 4: CSS** — tambahkan ke `dist-field.css` sebelum `@keyframes mlapFade`:

```css
/* ── PENGIRIMAN + DETAIL STOP ── */
.mlap-rowbtn { width: 100%; border: 0; border-bottom: 1px solid var(--mlap-line); background: transparent; text-align: left; font: inherit; color: inherit; cursor: pointer; }
.mlap-row .nm { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.mlap-warn-dot { width: 16px; height: 16px; border-radius: 50%; background: var(--mlap-warn-soft); color: var(--mlap-warn); font-size: 11px; font-weight: 800; display: inline-grid; place-items: center; border: 1px solid var(--mlap-warn-line); }
.mlap-tag.ok { background: var(--mlap-ok-soft); color: var(--mlap-ok); }
.mlap-tag.held { background: var(--mlap-bon-soft); color: var(--mlap-bon); }
.mlap-tag.neg { background: var(--mlap-neg-soft); color: var(--mlap-neg); }
.mlap-tag.pin { background: #EEE9F8; color: #4B3A8C; }
.mlap-tag.info { background: var(--mlap-accent-soft); color: var(--mlap-accent); }
.mlap-tag.bon { background: var(--mlap-bon-soft); color: var(--mlap-bon); }
.mlap-run { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.mlap-run-l { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 15px; }
.mlap-run-big { font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--mlap-accent); }
.mlap-next { padding: 12px; display: flex; flex-direction: column; gap: 10px; border: 1.5px solid #BFD6E8; }
.mlap-next-hd { border: 0; background: transparent; text-align: left; padding: 0; font: inherit; color: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.mlap-next-hd .mlap-eyebrow { padding: 0; color: var(--mlap-accent); }
.mlap-next-nm { font-size: 20px; font-weight: 700; }
.mlap-chip-s { height: 26px; display: inline-flex; align-items: center; padding: 0 10px; border-radius: 13px; background: var(--mlap-bg); font-size: 12px; font-weight: 600; }
.mlap-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
a.mlap-btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
.mlap-btn.off { opacity: .45; pointer-events: none; }
.mlap-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 10px; }
.mlap-facts > div { padding: 9px 12px; display: flex; flex-direction: column; gap: 1px; border-right: 1px solid var(--mlap-line); }
.mlap-facts > div:last-child { border-right: 0; }
.mlap-facts b { font-size: 16px; }
.mlap-checks { margin-bottom: 10px; }
.mlap-check-hd { padding: 10px 12px 4px; font-size: 13px; font-weight: 700; color: var(--mlap-warn); }
.mlap-check { display: flex; align-items: center; gap: 10px; padding: 8px 12px; font-size: 14px; }
.mlap-dot { width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; font-size: 12px; font-weight: 800; }
.mlap-dot.ok { background: var(--mlap-ok-soft); color: var(--mlap-ok); }
.mlap-dot.miss { background: var(--mlap-surface); color: var(--mlap-warn); border: 1.5px solid #E8A07A; box-sizing: border-box; }
.mlap-reason { padding: 12px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; }
.mlap-reason.warn { background: var(--mlap-warn-soft); border: 1px solid var(--mlap-warn-line); }
.mlap-sheet .mlap-note { margin-bottom: 10px; }
.mlap-sheet .mlap-actions { margin-bottom: 8px; }
```

- [ ] **Step 5: Kunci i18n** — `<scratchpad>/keys-t5.json` lalu `node <scratchpad>/fld-keys.js <scratchpad>/keys-t5.json` (helper dari Task 4; bila hilang, tulis ulang dengan kode di Task 4 Step 6):

```json
{
  "en": { "fld.ritN": "Trip {n}", "fld.ofLoadLeft": "of {n} gallons left", "fld.routeLine": "{stops} stops · {km} + {back} back · ±{rits} more trips", "fld.seeRoute": "See route", "fld.staleRunT": "Trip {n} from {date} is still open", "fld.staleRunB": "Close it first — a new trip can only be opened after that.", "fld.closeRun": "Close trip", "fld.noRunT": "No trip open yet", "fld.noRunB": "Load the truck and open a trip — the route is planned from the warehouse.", "fld.openRunN": "Open trip {n}", "fld.incompleteT": "{n} customers have incomplete data", "fld.incompleteB": "Location pin, WhatsApp, or location photo", "fld.outsideT": "{n} customers are outside the route", "fld.outsideB": "Scheduled today, but no location pin yet", "fld.next": "NEXT", "fld.navigate": "Navigate", "fld.deliverRecord": "Deliver & record", "fld.filter": "Filter", "fld.segPending": "Waiting {n}", "fld.segDone": "Delivered {n}", "fld.segHeld": "On hold {n}", "fld.emptySeg": "Nothing here.", "fld.outstandingT": "NOT DELIVERED ON EARLIER DAYS · {n}", "fld.outstandingHint": "Move or settle these from the old view (Belum terkirim).", "fld.nGalon": "{n} gallons", "fld.bonTag": "Bon {v}", "fld.heldTag": "{n} at customer", "fld.noWa": "No WhatsApp", "fld.tagPinned": "Fixed order", "fld.tagExtra": "Extra", "fld.tagBon": "Bon", "fld.sendDays": "delivery {d}", "fld.gapsT": "Customer data incomplete · {n}/3", "fld.chkTitik": "Location pin", "fld.chkWa": "WhatsApp number", "fld.chkFoto": "Location / landmark photo", "fld.fillLater": "Fill in via Customers (next step)", "fld.call": "Call", "fld.wa": "WhatsApp", "fld.orderToday": "Today's order", "fld.heldAt": "At customer", "fld.bonNow": "Bon", "fld.hold": "Hold", "fld.cancelStop": "Cancel stop", "fld.holdWhy": "Why is this stop on hold?", "fld.cancelWhy": "Why is this stop cancelled?", "fld.holdSave": "Hold the stop", "fld.cancelSave": "Cancel the stop", "fld.heldDone": "Stop on hold", "fld.cancelDone": "Stop cancelled", "fld.reopen": "Back to waiting", "fld.reopened": "The stop is waiting again", "fld.doneNote": "Delivered. Corrections arrive in the next step.", "fld.r_tutup": "Shop closed", "fld.r_kosong": "Nobody there", "fld.r_besok": "Asked for tomorrow", "fld.r_habis": "Ran out on this trip", "fld.r_other": "Other" },
  "id": { "fld.ritN": "Rit {n}", "fld.ofLoadLeft": "dari {n} galon tersisa", "fld.routeLine": "{stops} stop · {km} + {back} pulang · ±{rits} rit lagi", "fld.seeRoute": "Lihat rute", "fld.staleRunT": "Rit {n} tanggal {date} masih terbuka", "fld.staleRunB": "Tutup dulu — rit baru baru bisa dibuka setelah itu.", "fld.closeRun": "Tutup rit", "fld.noRunT": "Belum ada rit terbuka", "fld.noRunB": "Muat armada lalu buka rit — rute disusun dari gudang.", "fld.openRunN": "Buka rit {n}", "fld.incompleteT": "{n} pelanggan datanya belum lengkap", "fld.incompleteB": "Titik lokasi, WhatsApp, atau foto lokasi", "fld.outsideT": "{n} pelanggan di luar rute", "fld.outsideB": "Jadwal hari ini, tapi belum ada titik lokasi", "fld.next": "BERIKUTNYA", "fld.navigate": "Navigasi", "fld.deliverRecord": "Antar & catat", "fld.filter": "Saring", "fld.segPending": "Menunggu {n}", "fld.segDone": "Terkirim {n}", "fld.segHeld": "Tunda {n}", "fld.emptySeg": "Tidak ada.", "fld.outstandingT": "BELUM TERKIRIM DARI HARI SEBELUMNYA · {n}", "fld.outstandingHint": "Pindahkan atau selesaikan dari tampilan lama (Belum terkirim).", "fld.nGalon": "{n} galon", "fld.bonTag": "Bon {v}", "fld.heldTag": "{n} di pelanggan", "fld.noWa": "Tanpa WA", "fld.tagPinned": "Urutan tetap", "fld.tagExtra": "Tambahan", "fld.tagBon": "Bon", "fld.sendDays": "kirim {d}", "fld.gapsT": "Data pelanggan belum lengkap · {n}/3", "fld.chkTitik": "Titik lokasi", "fld.chkWa": "Nomor WhatsApp", "fld.chkFoto": "Foto lokasi / patokan", "fld.fillLater": "Lengkapi lewat Pelanggan (tahap berikutnya)", "fld.call": "Telepon", "fld.wa": "WhatsApp", "fld.orderToday": "Pesanan hari ini", "fld.heldAt": "Di pelanggan", "fld.bonNow": "Bon", "fld.hold": "Tunda", "fld.cancelStop": "Batalkan", "fld.holdWhy": "Kenapa ditunda?", "fld.cancelWhy": "Kenapa dibatalkan?", "fld.holdSave": "Tunda stop", "fld.cancelSave": "Batalkan stop", "fld.heldDone": "Stop ditunda", "fld.cancelDone": "Stop dibatalkan", "fld.reopen": "Kembalikan ke menunggu", "fld.reopened": "Stop kembali menunggu", "fld.doneNote": "Sudah terkirim. Koreksi tersedia di tahap berikutnya.", "fld.r_tutup": "Toko tutup", "fld.r_kosong": "Tidak ada orang", "fld.r_besok": "Minta besok", "fld.r_habis": "Galon habis di rit", "fld.r_other": "Lainnya" }
}
```

- [ ] **Step 6: Jalankan** — `jest tests/field-day-static.test.js tests/field-shell-static.test.js` → PASS (kunci `fld.*` lengkap; tak ada bentrok nama). `node build.mjs --no-minify` → sukses.

- [ ] **Step 7: Commit** — `git add dist-field-day.jsx build.mjs dist-field.css finance-i18n.js server/tests/field-day-static.test.js && git commit -m "feat(distribusi): field Pengiriman screen + stop detail sheet (hold/cancel always with a reason)"`

---

### Task 6: Layar Transaksi (foto wajib, simpan lalu tandai terkirim tanpa transaksi ganda)

**Files:**
- Modify: `dist-field-day.jsx` (tambah `FldSale`), `dist-field.css`, `finance-i18n.js`
- Test: `server/tests/field-day-static.test.js` (tambah)

**Interfaces:**
- Consumes: `FIELDLOGIC.salePreview/saleBody/canSaveSale/recordSale/fmtRp` (Task 3); kit `FldTop/FldStepper/FldSeg/FldPhoto` (Task 4).
- Produces: `FldSale({ api, stop, onDone(msg), onBack() })` — `stop` = stop yang diperkaya `boardView` (`planQty`, `gallonsHeld`, `sisaBon`, `masterPrice`, `customerId`, `id`).

- [ ] **Step 1: Tes gagal** — tambahkan ke `server/tests/field-day-static.test.js`:

```js
describe('Transaksi', () => {
  const f = () => fn('FldSale');
  it('a proof photo is always required; save is locked until then', () => {
    expect(f()).toMatch(/const why = FIELDLOGIC\.canSaveSale\(\{ qty, photo \}\);/);
    expect(f()).toMatch(/disabled=\{busy \|\| !!why \|\| \(needReason && !noLoc\.trim\(\)\)\}/);
    expect(f()).toMatch(/<FldPhoto api=\{api\} value=\{photo\} onChange=\{setPhoto\}/);
  });
  it('a saved sale is never created twice — only the marking is retried (also after a network error)', () => {
    expect(f()).toMatch(/const txnRef = uRfl\(null\);/);
    expect(f()).toMatch(/FIELDLOGIC\.recordSale\(api, \{ stopId: s\.id, body, txnId: txnRef\.current,/);
    expect(f()).toMatch(/if \(e && e\.txnId\) txnRef\.current = e\.txnId;/);
  });
  it('Lunas / Bon / Transfer', () => {
    expect(f()).toMatch(/\['lunas', trFl\('fld\.m_lunas'\)\], \['bon', trFl\('fld\.m_bon'\)\], \['transfer', trFl\('fld\.m_transfer'\)\]/);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-day-static.test.js` → FAIL (`FldSale` tidak ada).

- [ ] **Step 3: Tambahkan `FldSale` di akhir `dist-field-day.jsx`**

```jsx
// TRANSAKSI — gallons out/back, Lunas/Bon/Transfer, what the customer pays now and what their bon
// becomes, a proof photo (always required here), then "save & mark delivered". The sale is created
// ONCE: if marking fails (no signal, or the server asks for a position), only the marking is retried.
function FldSale({ api, stop: s, onDone, onBack }) {
  const held = s.gallonsHeld == null ? null : s.gallonsHeld;
  const [qty, setQty] = uSfl(Math.max(1, s.planQty || 1));
  const [back, setBack] = uSfl(held == null ? 0 : Math.min(held, 999));
  const [method, setMethod] = uSfl('lunas');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const [needReason, setNeedReason] = uSfl(false);
  const [noLoc, setNoLoc] = uSfl('');
  const txnRef = uRfl(null);
  const pv = FIELDLOGIC.salePreview({ qty, price: s.masterPrice, method, sisaBon: s.sisaBon || 0 });
  const why = FIELDLOGIC.canSaveSale({ qty, photo });
  const save = () => {
    setBusy(true); setErr('');
    const body = FIELDLOGIC.saleBody({ customerId: s.customerId, qty, gallonIn: back, method, photo });
    FIELDLOGIC.recordSale(api, { stopId: s.id, body, txnId: txnRef.current, noLocationReason: needReason ? noLoc.trim() : '' })
      .then((r) => { txnRef.current = r.txnId; if (r.done) onDone(trFl('fld.saleDone', { name: s.customerName })); else setNeedReason(true); })
      .catch((e) => { if (e && e.txnId) txnRef.current = e.txnId; setErr(fldErrMsg(e) || trFl('fld.loadErr')); })
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.saleTitle')} sub={[s.customerName, s.customerCode].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-card">
          <FldStepper label={trFl('fld.galOut')} hint={trFl('fld.galOutHint', { n: s.planQty })} value={qty} onChange={setQty} min={1} max={999} />
          <FldStepper label={trFl('fld.galBack')} hint={held == null ? '' : trFl('fld.galBackHint', { n: held })} value={back} onChange={setBack} min={0} max={999} />
        </div>
        <div className="mlap-eyebrow">{trFl('fld.payment')}</div>
        <FldSeg label={trFl('fld.payment')} value={method} onChange={setMethod} options={[['lunas', trFl('fld.m_lunas')], ['bon', trFl('fld.m_bon')], ['transfer', trFl('fld.m_transfer')]]} />
        <div className="mlap-card mlap-sum">
          <div className="mlap-sumrow"><span>{trFl('fld.qtyLine', { n: qty, p: FIELDLOGIC.fmtRp(s.masterPrice) })}</span><b>{FIELDLOGIC.fmtRp(pv.subtotal)}</b></div>
          {s.sisaBon > 0 ? <div className="mlap-sumrow"><span>{trFl('fld.oldBon')}</span><span>{FIELDLOGIC.fmtRp(s.sisaBon)}</span></div> : null}
          <div className="mlap-sumrow total"><span>{trFl(pv.totalKey)}</span><b>{FIELDLOGIC.fmtRp(pv.paidNow)}</b></div>
          <div className={'mlap-after' + (method === 'bon' ? ' bon' : '')}>{method === 'bon' ? trFl('fld.bonAfter', { v: FIELDLOGIC.fmtRp(pv.sisaAfter) }) : trFl('fld.bonStays', { v: FIELDLOGIC.fmtRp(pv.sisaAfter) })}</div>
        </div>
        <div className="mlap-eyebrow">{trFl('fld.proof')} · {trFl('fld.required')}</div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.proofHintSale" />
        {needReason && (
          <div className="mlap-card mlap-reason warn">
            <b>{trFl('fld.noLocT')}</b>
            <span className="sb">{trFl('fld.noLocB')}</span>
            <input className="mlap-text" value={noLoc} onChange={(e) => setNoLoc(e.target.value.slice(0, 300))} placeholder={trFl('fld.writeReason')} aria-label={trFl('fld.noLocT')} />
          </div>
        )}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        {why ? <div className="mlap-hint">{trFl(why)}</div> : null}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !!why || (needReason && !noLoc.trim())} onClick={save}>{trFl(txnRef.current ? 'fld.retryMark' : 'fld.saveDeliver')}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: CSS** — tambahkan ke `dist-field.css` sebelum `@keyframes mlapFade`:

```css
/* ── TRANSAKSI ── */
.mlap-sum { padding: 4px 12px 10px; }
.mlap-sumrow { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; font-size: 14px; border-bottom: 1px solid var(--mlap-line); font-variant-numeric: tabular-nums; }
.mlap-sumrow.total { font-size: 17px; border-bottom: 0; }
.mlap-after { font-size: 13px; font-weight: 600; color: var(--mlap-sub); }
.mlap-after.bon { color: var(--mlap-bon); }
```

- [ ] **Step 5: Kunci i18n** — `<scratchpad>/keys-t6.json` lalu `node <scratchpad>/fld-keys.js <scratchpad>/keys-t6.json`:

```json
{
  "en": { "fld.saleTitle": "Quick sale", "fld.galOut": "Gallons delivered", "fld.galOutHint": "Order {n}", "fld.galBack": "Empty gallons returned", "fld.galBackHint": "At customer: {n}", "fld.payment": "PAYMENT", "fld.m_lunas": "Paid", "fld.m_bon": "Bon", "fld.m_transfer": "Transfer", "fld.qtyLine": "{n} gallons × {p}", "fld.oldBon": "Previous bon", "fld.cashIn": "Received in cash", "fld.paidNow": "Paid now", "fld.transferred": "Transferred", "fld.bonAfter": "Bon becomes {v}", "fld.bonStays": "Bon stays {v}", "fld.required": "required", "fld.proofHintSale": "Gallons at the door, the receipt, or the transfer proof. Time and location are recorded automatically.", "fld.needQty": "Enter at least 1 gallon.", "fld.needPhoto": "Take the proof photo before saving.", "fld.noLocT": "Your location is not on", "fld.noLocB": "The sale is saved. Turn on location, or write why, to mark the stop delivered.", "fld.saveDeliver": "Save & mark delivered", "fld.retryMark": "Mark delivered", "fld.saleDone": "Saved · {name} delivered" },
  "id": { "fld.saleTitle": "Transaksi cepat", "fld.galOut": "Galon diantar", "fld.galOutHint": "Pesanan {n}", "fld.galBack": "Galon kosong kembali", "fld.galBackHint": "Di pelanggan: {n}", "fld.payment": "PEMBAYARAN", "fld.m_lunas": "Lunas", "fld.m_bon": "Bon", "fld.m_transfer": "Transfer", "fld.qtyLine": "{n} galon × {p}", "fld.oldBon": "Bon lama", "fld.cashIn": "Diterima tunai", "fld.paidNow": "Dibayar sekarang", "fld.transferred": "Ditransfer", "fld.bonAfter": "Sisa bon jadi {v}", "fld.bonStays": "Bon tetap {v}", "fld.required": "wajib", "fld.proofHintSale": "Galon di depan pintu, nota, atau bukti transfer. Jam dan lokasi tercatat otomatis.", "fld.needQty": "Isi minimal 1 galon.", "fld.needPhoto": "Ambil foto bukti dulu sebelum menyimpan.", "fld.noLocT": "Lokasi Anda belum aktif", "fld.noLocB": "Transaksi sudah tersimpan. Nyalakan lokasi, atau tulis alasannya, untuk menandai stop terkirim.", "fld.saveDeliver": "Simpan & tandai terkirim", "fld.retryMark": "Tandai terkirim", "fld.saleDone": "Tersimpan · {name} terkirim" }
}
```

- [ ] **Step 6: Jalankan** — `jest tests/field-day-static.test.js tests/field-shell-static.test.js tests/field-logic.test.js` → PASS.

- [ ] **Step 7: Commit** — `git add dist-field-day.jsx dist-field.css finance-i18n.js server/tests/field-day-static.test.js && git commit -m "feat(distribusi): field sale screen — Lunas/Bon/Transfer, proof photo always, never a double sale"`

---

### Task 7: Buka rit (pengukur SOP/kapasitas, alasan wajib) + Tutup rit

**Files:**
- Modify: `dist-field-day.jsx` (tambah `FldOpenRun`, `FldCloseRun`), `dist-field.css`, `finance-i18n.js`
- Test: `server/tests/field-day-static.test.js` (tambah)

**Interfaces:**
- Consumes: `FIELDLOGIC.runState/runGauge/loadPreview` (Task 3), `window.RITPLAN.planRit`, adaptor `board/runs/openRun/closeRun`, `ctx` (Task 5).
- Produces:
  - `FldOpenRun({ api, ctx, tick, onDone(msg), onBack() })` — bila ada rit terbuka (hari ini atau sebelumnya) langsung menampilkan `FldCloseRun`.
  - `FldCloseRun({ api, run, stale, onDone(msg), onBack() })` — body `closeRun`: `{ gallonsFullReturned, gallonsEmptyReturned, diffReason, resolution }` (resolution `kembali_besok|rusak|hilang|salah_hitung`, rusak/hilang hanya bila galon kurang).

- [ ] **Step 1: Tes gagal** — tambahkan ke `server/tests/field-day-static.test.js`:

```js
describe('Buka / Tutup rit', () => {
  it('an open rit (today or older) is closed first; otherwise the gauge', () => {
    const f = fn('FldOpenRun');
    expect(f).toMatch(/if \(rs\.open\) return <FldCloseRun api=\{api\} run=\{rs\.open\} stale=\{rs\.stale\}/);
    expect(f).toMatch(/FIELDLOGIC\.runGauge\(\{ load, capacity: cap, minLoad \}\)/);
  });
  it('below the SOP a reason is always required; above capacity it cannot open', () => {
    const f = fn('FldOpenRun');
    expect(f).toMatch(/disabled=\{busy \|\| !g\.canOpen \|\| \(g\.under && !reason\.trim\(\)\)\}/);
    expect(f).toMatch(/underSopReason: g\.under \? reason\.trim\(\) : ''/);
  });
  it('closing with a difference needs what happened; damaged/lost only when gallons are missing', () => {
    const f = fn('FldCloseRun');
    expect(f).toMatch(/disabled=\{busy \|\| \(diff !== 0 && !res\)\}/);
    expect(f).toMatch(/\(k === 'rusak' \|\| k === 'hilang'\) \? lost > 0 : true/);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-day-static.test.js` → FAIL.

- [ ] **Step 3: Tambahkan di akhir `dist-field-day.jsx`**

```jsx
const FLD_SOP_REASONS = ['fld.sop_sedikit', 'fld.sop_stok', 'fld.sop_armada', 'fld.sop_terakhir'];
const FLD_DIFF = [['kembali_besok', 'fld.d_besok'], ['rusak', 'fld.d_rusak'], ['hilang', 'fld.d_hilang'], ['salah_hitung', 'fld.d_salah']];

// BUKA RIT — how many gallons go on the truck. Capacity is a hard cap; below the owner's SOP the new
// UI always asks why (the server only insists once the switch is on). The preview plans the rit from
// the warehouse with the same planner the server uses.
function FldOpenRun({ api, ctx, tick, onDone, onBack }) {
  const rules = ctx.rules || {};
  const minLoad = (rules.ritSop && rules.ritSop.minLoad) || 80;
  const cap = (rules.fleetCapacity || {})[ctx.fleet] || 0;
  const [d, setD] = uSfl(null);
  const [load, setLoad] = uSfl(cap || minLoad);
  const [reason, setReason] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  uEfl(() => {
    let live = true;
    Promise.all([api.board(), api.runs()]).then(([board, runs]) => { if (live) setD({ board, runs }); }).catch((e) => { if (live) setErr(fldErrMsg(e)); });
    return () => { live = false; };
  }, [api, tick]);
  if (!d) return err ? <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={err} /> : <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs: d.runs });
  if (rs.open) return <FldCloseRun api={api} run={rs.open} stale={rs.stale} onDone={onDone} onBack={onBack} />;
  const g = FIELDLOGIC.runGauge({ load, capacity: cap, minLoad });
  const pend = d.board.filter((s) => s.status === 'pending');
  const pv = FIELDLOGIC.loadPreview({
    planRit: window.RITPLAN && window.RITPLAN.planRit, depot: ctx.depot, load,
    stops: pend.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, pinned: s.pinned, qty: s.qty > 0 ? s.qty : ((ctx.demand || {})[s.id] || 1) })),
  });
  const presets = [...new Set([60, minLoad, 100, cap].filter((v) => v > 0 && (!cap || v <= cap)))].sort((a, b) => a - b);
  const open = () => {
    setBusy(true); setErr('');
    api.openRun({ gallonsOut: g.load, underSopReason: g.under ? reason.trim() : '' })
      .then(() => onDone(trFl('fld.runOpened', { n: rs.nextNo })))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.openRunN', { n: rs.nextNo })} sub={[ctx.fleet, cap ? trFl('fld.capN', { n: cap }) : trFl('fld.capNone')].join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-card mlap-load">
          <span className="sb">{trFl('fld.loadQ')}</span>
          <div className={'mlap-loadval' + (g.under ? ' under' : '')}>{g.load}</div>
          <input type="range" className="mlap-range" min="0" max={g.max} value={g.load} onChange={(e) => setLoad(+e.target.value)} aria-label={trFl('fld.loadQ')} />
          <div className="mlap-scale"><span>0</span><span>{trFl('fld.sopN', { n: minLoad })}</span>{cap ? <span>{trFl('fld.capN', { n: cap })}</span> : <span />}</div>
          <FldStepper label={trFl('fld.loadQ')} value={g.load} onChange={setLoad} min={0} max={g.max} />
          <div className="mlap-chips">{presets.map((v) => <button key={v} type="button" className={'mlap-chip-b' + (g.load === v ? ' on' : '')} aria-pressed={g.load === v} onClick={() => setLoad(v)}>{v}</button>)}</div>
          {g.atCap ? <div className="mlap-hint ok">{trFl('fld.fullLoad')}</div> : null}
        </div>
        {g.under && (
          <div className="mlap-card mlap-reason warn">
            <b>{trFl('fld.underSopT', { n: g.load, min: minLoad })}</b>
            <FldChips options={FLD_SOP_REASONS.map((k) => trFl(k)).concat([trFl('fld.r_other')])} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} />
            <span className="sb">{trFl('fld.underSopB')}</span>
          </div>
        )}
        {pv ? (
          <div className="mlap-card mlap-preview">
            <b>{trFl('fld.previewT')}</b>
            <span>{trFl('fld.previewFits', { n: pv.fits, g: pv.used })}</span>
            {pv.leftoverGallons > 0 ? <span className="sb">{trFl('fld.previewLeft', { g: pv.leftoverGallons, r: pv.estRits })}</span> : null}
            {pv.unlocated > 0 ? <span className="sb">{trFl('fld.previewNoPin', { n: pv.unlocated })}</span> : null}
          </div>
        ) : !ctx.depot ? <FldNotice tone="info" title={trFl('fld.noDepotT')} sub={trFl('fld.noDepotB')} /> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !g.canOpen || (g.under && !reason.trim())} onClick={open}>{trFl('fld.openAndRoute')}</button>
      </div>
    </div>
  );
}

// TUTUP RIT — full and empty gallons brought back. A difference needs what happened; damaged/lost only
// make sense when gallons are missing (the server refuses them otherwise).
function FldCloseRun({ api, run, stale, onDone, onBack }) {
  const expected = Math.max(0, run.expectedRemaining != null ? run.expectedRemaining : ((run.gallonsOut || 0) - (run.sold || 0)));
  const [full, setFull] = uSfl(expected);
  const [empty, setEmpty] = uSfl(0);
  const [res, setRes] = uSfl('');
  const [note, setNote] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const diff = full - expected; const lost = expected - full;
  const allowed = FLD_DIFF.filter(([k]) => ((k === 'rusak' || k === 'hilang') ? lost > 0 : true));
  uEfl(() => { if (res && !allowed.some(([k]) => k === res)) setRes(''); }, [full]);
  const close = () => {
    setBusy(true); setErr('');
    const label = (FLD_DIFF.find(([k]) => k === res) || [null, ''])[1];
    const body = { gallonsFullReturned: full, gallonsEmptyReturned: empty };
    if (diff !== 0) { body.diffReason = trFl(label) + (note.trim() ? ' · ' + note.trim() : ''); body.resolution = res; }
    api.closeRun(run.id, body).then(() => onDone(trFl('fld.runClosed', { n: run.runNo }))).catch((e) => setErr(fldErrMsg(e))).finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.closeRunT', { n: run.runNo })} sub={trFl('fld.loadedSold', { out: run.gallonsOut, sold: run.sold || 0 })} onBack={onBack} />
      <div className="mlap-body">
        {stale ? <FldNotice tone="warn" title={trFl('fld.staleNote', { date: run.date })} sub={trFl('fld.staleRunB')} /> : null}
        <div className="mlap-card">
          <FldStepper label={trFl('fld.fullBack')} hint={trFl('fld.fullBackHint', { n: expected })} value={full} onChange={setFull} min={0} max={9999} />
          <FldStepper label={trFl('fld.emptyBack')} value={empty} onChange={setEmpty} min={0} max={9999} />
        </div>
        {diff !== 0 && (
          <div className="mlap-card mlap-reason warn">
            <b>{trFl('fld.diffT', { d: (diff > 0 ? '+' : '') + diff })}</b>
            <div className="mlap-chips">{allowed.map(([k, key]) => <button key={k} type="button" className={'mlap-chip-b' + (res === k ? ' on' : '')} aria-pressed={res === k} onClick={() => setRes(k)}>{trFl(key)}</button>)}</div>
            <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
          </div>
        )}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || (diff !== 0 && !res)} onClick={close}>{trFl('fld.closeRunSave')}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: CSS** — tambahkan ke `dist-field.css` sebelum `@keyframes mlapFade`:

```css
/* ── BUKA / TUTUP RIT ── */
.mlap-load { padding: 14px 12px; display: flex; flex-direction: column; gap: 8px; }
.mlap-loadval { font-size: 48px; line-height: 52px; font-weight: 800; text-align: center; font-variant-numeric: tabular-nums; color: var(--mlap-teal-ink); }
.mlap-loadval.under { color: var(--mlap-warn); }
.mlap-range { width: 100%; accent-color: var(--mlap-accent); min-height: 32px; }
.mlap-scale { display: flex; justify-content: space-between; font-size: 12px; color: var(--mlap-sub); }
.mlap-load .mlap-stepper { border: 0; padding: 0; min-height: 52px; }
.mlap-preview { padding: 12px; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.mlap-preview .sb { font-size: 13px; color: var(--mlap-sub); }
```

- [ ] **Step 5: Kunci i18n** — `<scratchpad>/keys-t7.json` lalu `node <scratchpad>/fld-keys.js <scratchpad>/keys-t7.json`:

```json
{
  "en": { "fld.capN": "capacity {n}", "fld.loadQ": "Gallons loaded on the truck", "fld.sopN": "SOP {n}", "fld.fullLoad": "Full load — matches the truck's capacity", "fld.underSopT": "{n} gallons is below the SOP ({min}) — why?", "fld.underSopB": "The reason is recorded and shown in office reports.", "fld.sop_sedikit": "Few orders left", "fld.sop_stok": "Not enough full gallons", "fld.sop_armada": "Small truck / load full", "fld.sop_terakhir": "Last trip today", "fld.previewT": "Route planned from the warehouse", "fld.previewFits": "{n} stops fit this trip ({g} gallons)", "fld.previewLeft": "{g} gallons wait · ±{r} more trips", "fld.previewNoPin": "{n} stops have no location pin", "fld.noDepotT": "Warehouse location not set", "fld.noDepotB": "Ask the office to set it on Peta Zona — the route is planned from it.", "fld.openAndRoute": "Open trip & plan route", "fld.runOpened": "Trip {n} opened", "fld.closeRunT": "Close trip {n}", "fld.loadedSold": "loaded {out} · sold {sold}", "fld.fullBack": "Full gallons brought back", "fld.fullBackHint": "Should be {n}", "fld.emptyBack": "Empty gallons brought back", "fld.diffT": "Difference {d} gallons — what happened?", "fld.d_besok": "Stays on the truck (tomorrow)", "fld.d_rusak": "Damaged", "fld.d_hilang": "Lost", "fld.d_salah": "Miscounted", "fld.noteOpt": "Note (optional)", "fld.closeRunSave": "Close trip", "fld.runClosed": "Trip {n} closed", "fld.staleNote": "This trip is from {date}." },
  "id": { "fld.capN": "kapasitas {n}", "fld.loadQ": "Galon dimuat ke armada", "fld.sopN": "SOP {n}", "fld.fullLoad": "Muatan penuh — sesuai kapasitas armada", "fld.underSopT": "{n} galon di bawah SOP ({min}) — kenapa?", "fld.underSopB": "Alasan dicatat dan terlihat di laporan kantor.", "fld.sop_sedikit": "Pesanan tersisa sedikit", "fld.sop_stok": "Stok galon isi kurang", "fld.sop_armada": "Armada kecil / muatan penuh", "fld.sop_terakhir": "Rit terakhir hari ini", "fld.previewT": "Rute disusun dari gudang", "fld.previewFits": "{n} stop masuk rit ini ({g} galon)", "fld.previewLeft": "{g} galon menunggu · ±{r} rit lagi", "fld.previewNoPin": "{n} stop belum punya titik lokasi", "fld.noDepotT": "Lokasi gudang belum diatur", "fld.noDepotB": "Minta kantor mengaturnya di Peta Zona — rute disusun dari sana.", "fld.openAndRoute": "Buka rit & susun rute", "fld.runOpened": "Rit {n} dibuka", "fld.closeRunT": "Tutup rit {n}", "fld.loadedSold": "dimuat {out} · terjual {sold}", "fld.fullBack": "Galon isi dibawa kembali", "fld.fullBackHint": "Seharusnya {n}", "fld.emptyBack": "Galon kosong dibawa kembali", "fld.diffT": "Selisih {d} galon — apa yang terjadi?", "fld.d_besok": "Tetap di armada (besok)", "fld.d_rusak": "Rusak", "fld.d_hilang": "Hilang", "fld.d_salah": "Salah hitung", "fld.noteOpt": "Catatan (opsional)", "fld.closeRunSave": "Tutup rit", "fld.runClosed": "Rit {n} ditutup", "fld.staleNote": "Rit ini dari tanggal {date}." }
}
```

- [ ] **Step 6: Jalankan** — `jest tests/field-day-static.test.js tests/field-shell-static.test.js` → PASS.

- [ ] **Step 7: Commit** — `git add dist-field-day.jsx dist-field.css finance-i18n.js server/tests/field-day-static.test.js && git commit -m "feat(distribusi): field open-rit gauge (reason below SOP, capacity cap, route preview) + close-rit"`

---

### Task 8: Rute rit / Peta

**Files:**
- Modify: `dist-field-day.jsx` (tambah `FldRoute`), `dist-field.css`, `finance-i18n.js`
- Test: `server/tests/field-day-static.test.js` (tambah)

**Interfaces:**
- Consumes: `znLoadLeaflet()` (`dist-zones.jsx`, dimuat lebih dulu), adaptor `ritRoute`, `FIELDLOGIC.runState/fmtKm`, `fldLinks`.
- Produces: `FldRoute({ api, ctx, tick, onOpenRun() })` — dipakai tab Peta.

- [ ] **Step 1: Tes gagal** — tambahkan ke `server/tests/field-day-static.test.js`:

```js
describe('Rute rit / Peta', () => {
  const f = () => fn('FldRoute');
  it('no open rit (or a stale one) → the button, not an error; the route only for today\'s rit', () => {
    expect(f()).toMatch(/if \(!rs\.open \|\| rs\.stale\) return/);
    expect(f()).toMatch(/api\.ritRoute\(\)/);
  });
  it('the map is optional: a Leaflet failure keeps the list', () => {
    expect(f()).toMatch(/znLoadLeaflet\(\)\.then\(/);
    expect(f()).toMatch(/\.catch\(\(\) => \{ if \(live\) setMapErr\(true\); \}\)/);
    const list = f().indexOf('className="mlap-card mlap-legs"'); const mapBranch = f().indexOf('mapErr ?');
    expect(list).toBeGreaterThan(-1); expect(mapBranch).toBeGreaterThan(-1);
    expect(f()).toMatch(/mapRef\.current\.remove\(\)/);   // no leaked map on unmount
  });
  it('uses the same OSM tiles + attribution as Peta Zona', () => {
    expect(f()).toMatch(/https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
    expect(f()).toMatch(/OpenStreetMap<\/a>/);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-day-static.test.js` → FAIL.

- [ ] **Step 3: Tambahkan di akhir `dist-field-day.jsx`**

```jsx
// RUTE RIT / PETA — today's open rit planned from the warehouse (the server's planner, or the phone's
// copy of it in practice): map with numbered stops + the list. The map is a bonus: when Leaflet or the
// tiles can't load (offline), the list still works.
function FldRoute({ api, ctx, tick, onOpenRun }) {
  const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs: [] });
  const [route, setRoute] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [mapErr, setMapErr] = uSfl(false);
  const [all, setAll] = uSfl(false);
  const mapEl = uRfl(null);
  const mapRef = uRfl(null);
  const routeOk = !!(rs.open && !rs.stale);
  uEfl(() => {
    if (!routeOk) return undefined;
    let live = true; setErr(null); setRoute(null);
    api.ritRoute().then((r) => { if (live) setRoute(r); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick, routeOk]);
  uEfl(() => {
    if (!route || !mapEl.current) return undefined;
    let live = true;
    znLoadLeaflet().then((L) => {
      if (!live || !mapEl.current) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true });
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      const depot = [route.origin.lat, route.origin.lng];
      const pts = [depot];
      L.marker(depot, { keyboard: false, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [30, 30], html: '<span class="mlap-pin depot">G</span>' }) }).addTo(map);
      route.rit.forEach((s) => {
        if (typeof s.lat !== 'number' || typeof s.lng !== 'number') return;
        pts.push([s.lat, s.lng]);
        L.marker([s.lat, s.lng], { keyboard: false, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [26, 26], html: '<span class="mlap-pin">' + Number(s.order) + '</span>' }) }).addTo(map);
      });
      L.polyline(pts.concat([depot]), { color: '#065489', weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(map);
      map.fitBounds(L.latLngBounds(pts).pad(0.2));
    }).catch(() => { if (live) setMapErr(true); });
    return () => { live = false; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [route]);
  if (!rs.open || rs.stale) return (
    <FldNotice tone={rs.stale ? 'warn' : 'info'} title={rs.stale ? trFl('fld.staleRunT', { n: rs.open.runNo, date: rs.open.date }) : trFl('fld.noRunT')} sub={rs.stale ? trFl('fld.staleRunB') : trFl('fld.noRunB')}
      action={rs.stale ? trFl('fld.closeRun') : trFl('fld.openRunN', { n: rs.nextNo })} onAction={onOpenRun} />
  );
  if (err) return <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!route) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const legs = all ? route.rit : route.rit.slice(0, 4);
  const first = route.rit[0];
  const firstNav = first ? fldLinks(first).nav : '';
  return (
    <>
      {mapErr ? <FldNotice tone="info" title={trFl('fld.mapOff')} /> : <div ref={mapEl} className="mlap-map" role="img" aria-label={trFl('fld.routeT', { n: route.run.runNo })} />}
      <div className="mlap-card mlap-routehd">
        <div><b>{trFl('fld.routeT', { n: route.run.runNo })}</b><span className="sb">{trFl('fld.fromDepot')}</span></div>
        <div className="mlap-routefig"><span><b>{route.used}/{route.capacity}</b><span className="sb">{trFl('fld.gallonsUsed')}</span></span><span><b>{FIELDLOGIC.fmtKm(route.totalKm - route.returnKm)}</b><span className="sb">{trFl('fld.kmBack', { km: FIELDLOGIC.fmtKm(route.returnKm) })}</span></span><span><b>{route.leftover.length}</b><span className="sb">{trFl('fld.toNextRun')}</span></span></div>
      </div>
      {route.unlocated.length > 0 ? <FldNotice tone="warn" title={trFl('fld.unlocatedT', { n: route.unlocated.length })} /> : null}
      {route.tooBig.length > 0 ? <FldNotice tone="warn" title={trFl('fld.tooBigT', { n: route.tooBig.length })} /> : null}
      <div className="mlap-card mlap-legs">
        {legs.length ? legs.map((s) => (
          <div key={s.id} className="mlap-row">
            <span className="mlap-num">{s.order}</span>
            <span className="mlap-grow"><span className="nm">{s.customerName}</span><span className="sb">{trFl('fld.legSub', { q: s.qty, km: FIELDLOGIC.fmtKm(s.legKm) })}</span></span>
            <span className="mlap-legleft"><b>{s.loadAfter}</b><span className="sb">{trFl('fld.loadLeft')}</span></span>
          </div>
        )) : <div className="mlap-empty">{trFl('fld.emptyRoute')}</div>}
        {route.rit.length > 4 && !all ? <button type="button" className="mlap-btn mlap-wide" onClick={() => setAll(true)}>{trFl('fld.showAll')}</button> : null}
        {route.rit.length ? <div className="mlap-row"><span className="mlap-num">G</span><span className="mlap-grow sb">{trFl('fld.backToDepot', { km: FIELDLOGIC.fmtKm(route.returnKm) })}</span></div> : null}
      </div>
      <div className="mlap-actions">
        <button type="button" className="mlap-btn" onClick={onOpenRun}>{trFl('fld.closeRun')}</button>
        <a className={'mlap-btn primary' + (firstNav ? '' : ' off')} href={firstNav || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!firstNav}>{first ? trFl('fld.navTo', { n: first.order }) : trFl('fld.navigate')}</a>
      </div>
    </>
  );
}
```

- [ ] **Step 4: CSS** — tambahkan ke `dist-field.css` sebelum `@keyframes mlapFade`:

```css
/* ── RUTE RIT / PETA ── */
.mlap-map { height: 280px; border-radius: 16px; overflow: hidden; background: #DCE5EC; }
.mlap-pin-wrap { background: transparent; border: 0; }
.mlap-pin { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--mlap-accent); color: #fff; font: 700 12px/1 -apple-system, system-ui, sans-serif; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(6,51,79,.35); box-sizing: border-box; }
.mlap-pin.depot { width: 30px; height: 30px; border-radius: 9px; background: #0E1B24; }
.mlap-routehd { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.mlap-routehd > div:first-child { display: flex; align-items: baseline; gap: 8px; }
.mlap-routefig { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.mlap-routefig > span { display: flex; flex-direction: column; }
.mlap-routefig b { font-size: 18px; font-variant-numeric: tabular-nums; }
.mlap-legleft { display: flex; flex-direction: column; align-items: flex-end; font-variant-numeric: tabular-nums; }
.mlap-legs .mlap-btn { margin: 8px 12px; width: calc(100% - 24px); }
```

- [ ] **Step 5: Kunci i18n** — `<scratchpad>/keys-t8.json` lalu `node <scratchpad>/fld-keys.js <scratchpad>/keys-t8.json`:

```json
{
  "en": { "fld.routeT": "Trip {n} route", "fld.fromDepot": "planned from the warehouse", "fld.gallonsUsed": "gallons used", "fld.kmBack": "+ {km} back", "fld.toNextRun": "to the next trip", "fld.unlocatedT": "{n} customers not in the route: no location pin", "fld.tooBigT": "{n} orders are bigger than this trip's load", "fld.loadLeft": "load left", "fld.backToDepot": "Back to the warehouse · {km}", "fld.navTo": "Navigate to stop {n}", "fld.mapOff": "The map could not load (offline?) — the list still works.", "fld.showAll": "Show all", "fld.legSub": "{q} gallons · {km}", "fld.emptyRoute": "No waiting stop fits this trip." },
  "id": { "fld.routeT": "Rute rit {n}", "fld.fromDepot": "disusun dari gudang", "fld.gallonsUsed": "galon terpakai", "fld.kmBack": "+ {km} pulang", "fld.toNextRun": "ke rit berikutnya", "fld.unlocatedT": "{n} pelanggan tidak masuk rute: belum ada titik", "fld.tooBigT": "{n} pesanan lebih besar dari muatan rit ini", "fld.loadLeft": "sisa muatan", "fld.backToDepot": "Kembali ke gudang · {km}", "fld.navTo": "Navigasi ke stop {n}", "fld.mapOff": "Peta tidak bisa dimuat (offline?) — daftar tetap bisa dipakai.", "fld.showAll": "Tampilkan semua", "fld.legSub": "{q} galon · {km}", "fld.emptyRoute": "Tidak ada stop menunggu yang masuk rit ini." }
}
```

- [ ] **Step 6: Jalankan** — `jest tests/field-day-static.test.js tests/field-shell-static.test.js` → PASS.

- [ ] **Step 7: Commit** — `git add dist-field-day.jsx dist-field.css finance-i18n.js server/tests/field-day-static.test.js && git commit -m "feat(distribusi): field rit route — map + list from the warehouse; list survives an offline map"`

---

### Task 9: Setoran / tutup hari

**Files:**
- Modify: `dist-field-day.jsx` (tambah `FldSetoran`), `dist-field.css`, `finance-i18n.js`
- Test: `server/tests/field-day-static.test.js` (tambah)

**Interfaces:**
- Consumes: adaptor `daySummary/board/closeDay`, `FIELDLOGIC.closeCheck/fmtRp/runState`.
- Produces: `FldSetoran({ api, ctx, tick, onChanged(msg) })`.

- [ ] **Step 1: Tes gagal** — tambahkan ke `server/tests/field-day-static.test.js`:

```js
describe('Setoran', () => {
  const f = () => fn('FldSetoran');
  it('figures come from the day summary; transfer is shown but not deposited', () => {
    expect(f()).toMatch(/Promise\.all\(\[api\.daySummary\(\), api\.board\(\)\]\)/);
    ['fld.s_tunai', 'fld.s_pelunasan', 'fld.s_transfer', 'fld.s_bon', 'fld.s_gantiRugi', 'fld.s_expense', 'fld.s_setor'].forEach((k) => expect(f()).toContain("'" + k + "'"));
    expect(f()).toMatch(/sum\.wajibSetor/);
  });
  it('closing the day needs a reason for every unfinished stop', () => {
    expect(f()).toMatch(/const chk = FIELDLOGIC\.closeCheck\(pending, reasons\);/);
    expect(f()).toMatch(/disabled=\{busy \|\| !chk\.ok\}/);
    expect(f()).toMatch(/api\.closeDay\(\{ reasons: picked, generalNote: note\.trim\(\) \}\)/);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-day-static.test.js` → FAIL.

- [ ] **Step 3: Tambahkan di akhir `dist-field-day.jsx`**

```jsx
// SETORAN / SELESAI KERJA — the day's money and gallons from the server's day summary (the same figures
// as the delivery report), then "close the day": every stop still waiting needs a reason (it moves to
// Tunda and carries over). Pending corrections never block closing.
function FldSetoran({ api, ctx, tick, onChanged }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [reasons, setReasons] = uSfl({});
  const [note, setNote] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  const [reload, setReload] = uSfl(0);
  uEfl(() => {
    let live = true; setErr(null);
    Promise.all([api.daySummary(), api.board()]).then(([sum, board]) => { if (live) setD({ sum, board }); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick, reload]);
  if (err) return <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!d) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const sum = d.sum;
  const pending = d.board.filter((s) => s.status === 'pending');
  const chk = FIELDLOGIC.closeCheck(pending, reasons);
  const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs: [] });
  const opts = FLD_HOLD_REASONS.map((k) => trFl(k));
  const rows = [['fld.s_tunai', sum.tunaiPenjualan], ['fld.s_pelunasan', sum.tunaiPelunasan], ['fld.s_transfer', sum.transfer], ['fld.s_bon', sum.bonBaru, 'bon'], ['fld.s_gantiRugi', sum.tunaiGantiRugi]];
  const close = () => {
    setBusy(true); setMsg('');
    const picked = {}; pending.forEach((s) => { picked[s.id] = String(reasons[s.id] || '').trim(); });
    api.closeDay({ reasons: picked, generalNote: note.trim() })
      .then(() => { setReasons({}); setReload((x) => x + 1); onChanged(trFl('fld.dayClosed')); })
      .catch((e) => setMsg(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <div className="mlap-card mlap-kpis">
        <span><b>{sum.stops.terkirim}</b><span className="sb">{trFl('fld.k_terkirim')}</span></span>
        <span><b>{sum.stops.ditunda}</b><span className="sb">{trFl('fld.k_tunda')}</span></span>
        <span><b>{sum.stops.batal}</b><span className="sb">{trFl('fld.k_batal')}</span></span>
      </div>
      {sum.koreksiMenunggu > 0 ? <FldNotice tone="info" title={trFl('fld.koreksiWait', { n: sum.koreksiMenunggu })} sub={trFl('fld.koreksiWaitB')} /> : null}
      {rs.open ? <FldNotice tone="warn" title={trFl('fld.openRunWarn', { n: rs.open.runNo })} /> : null}
      <div className="mlap-card mlap-sum">
        {rows.map(([k, v, tone]) => <div key={k} className="mlap-sumrow"><span>{trFl(k)}</span><span className={tone === 'bon' ? 'mlap-bontxt' : ''}>{FIELDLOGIC.fmtRp(v)}</span></div>)}
        <div className="mlap-sumrow"><span>{trFl('fld.s_expense')}</span><span>{FIELDLOGIC.fmtRp(-sum.pengeluaran)}</span></div>
        <div className="mlap-sumrow total"><span>{trFl('fld.s_setor')}</span><b>{FIELDLOGIC.fmtRp(sum.wajibSetor)}</b></div>
      </div>
      <div className="mlap-card mlap-kpis">
        <span><b>{sum.galon.keluar}</b><span className="sb">{trFl('fld.g_out')}</span></span>
        <span><b>{sum.galon.kembali}</b><span className="sb">{trFl('fld.g_back')}</span></span>
        <span><b>{sum.galon.rusak}</b><span className="sb">{trFl('fld.g_rusak')}</span></span>
      </div>
      {sum.ritDiBawahSop.length > 0 && (
        <>
          <div className="mlap-eyebrow">{trFl('fld.sopRuns')}</div>
          <div className="mlap-card">{sum.ritDiBawahSop.map((r) => <div key={r.runNo} className="mlap-row"><span className="mlap-grow sb">{trFl('fld.sopRunRow', { n: r.runNo, g: r.gallonsOut, r: r.reason })}</span></div>)}</div>
        </>
      )}
      {pending.length > 0 && (
        <>
          <div className="mlap-eyebrow">{trFl('fld.openStopsT')}</div>
          <div className="mlap-card">
            {pending.map((s) => (
              <div key={s.id} className="mlap-row mlap-closerow">
                <span className="mlap-grow"><span className="nm">{s.customerName}</span></span>
                <select className={'mlap-select' + (String(reasons[s.id] || '').trim() ? '' : ' miss')} value={reasons[s.id] || ''} onChange={(e) => setReasons(Object.assign({}, reasons, { [s.id]: e.target.value }))} aria-label={trFl('fld.pickReason') + ' — ' + s.customerName}>
                  <option value="">{trFl('fld.pickReason')}</option>
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          {!chk.ok ? <div className="mlap-hint">{trFl('fld.missingReasons', { n: chk.missing.length })}</div> : null}
        </>
      )}
      <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder={trFl('fld.generalNote')} aria-label={trFl('fld.generalNote')} />
      {msg && <div className="mlap-err" role="alert">{msg}</div>}
      <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !chk.ok} onClick={close}>{trFl('fld.closeDay')}</button>
    </>
  );
}
```

- [ ] **Step 4: CSS** — tambahkan ke `dist-field.css` sebelum `@keyframes mlapFade`:

```css
/* ── SETORAN ── */
.mlap-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.mlap-kpis > span { display: flex; flex-direction: column; align-items: center; padding: 10px 6px; border-right: 1px solid var(--mlap-line); }
.mlap-kpis > span:last-child { border-right: 0; }
.mlap-kpis b { font-size: 22px; font-variant-numeric: tabular-nums; }
.mlap-bontxt { color: var(--mlap-bon); font-weight: 600; }
.mlap-closerow { gap: 8px; }
.mlap-select { min-height: 40px; max-width: 55%; border-radius: 10px; border: 1px solid #D5DDE3; background: #F7F9FA; color: var(--mlap-ink); font: inherit; font-size: 13px; padding: 0 8px; }
.mlap-select.miss { border: 1.5px solid #C2410C; background: #FFF4EE; color: var(--mlap-warn); }
```

- [ ] **Step 5: Kunci i18n** — `<scratchpad>/keys-t9.json` lalu `node <scratchpad>/fld-keys.js <scratchpad>/keys-t9.json`:

```json
{
  "en": { "fld.k_terkirim": "Delivered", "fld.k_tunda": "On hold", "fld.k_batal": "Cancelled", "fld.koreksiWait": "{n} corrections waiting for approval", "fld.koreksiWaitB": "They don't block closing the day · figures change once approved", "fld.openRunWarn": "Trip {n} is still open — close it on the route screen.", "fld.s_tunai": "Cash from customers", "fld.s_pelunasan": "Bon payments (cash)", "fld.s_transfer": "Transfers (not deposited)", "fld.s_bon": "New bon", "fld.s_gantiRugi": "Gallon damage charges (cash)", "fld.s_expense": "Expenses", "fld.s_setor": "To deposit", "fld.g_out": "gallons out", "fld.g_back": "empties back", "fld.g_rusak": "damaged · charged", "fld.sopRuns": "TRIPS BELOW THE SOP", "fld.sopRunRow": "Trip {n} · {g} gallons · {r}", "fld.openStopsT": "STOPS NOT FINISHED · REASON REQUIRED", "fld.pickReason": "Choose a reason", "fld.missingReasons": "{n} stops still need a reason", "fld.generalNote": "Note for the office (optional)", "fld.closeDay": "Close the day & deposit", "fld.dayClosed": "Day closed" },
  "id": { "fld.k_terkirim": "Terkirim", "fld.k_tunda": "Tunda", "fld.k_batal": "Batal", "fld.koreksiWait": "{n} koreksi menunggu persetujuan", "fld.koreksiWaitB": "Tidak menahan tutup hari · angka ikut berubah setelah disetujui", "fld.openRunWarn": "Rit {n} masih terbuka — tutup di layar rute.", "fld.s_tunai": "Tunai dari pelanggan", "fld.s_pelunasan": "Pembayaran bon (tunai)", "fld.s_transfer": "Transfer (tidak disetor)", "fld.s_bon": "Bon baru", "fld.s_gantiRugi": "Ganti rugi galon (tunai)", "fld.s_expense": "Pengeluaran", "fld.s_setor": "Uang disetor", "fld.g_out": "galon keluar", "fld.g_back": "kosong kembali", "fld.g_rusak": "rusak · diganti", "fld.sopRuns": "RIT DI BAWAH SOP", "fld.sopRunRow": "Rit {n} · {g} galon · {r}", "fld.openStopsT": "STOP BELUM SELESAI · WAJIB ALASAN", "fld.pickReason": "Pilih alasan", "fld.missingReasons": "{n} stop masih perlu alasan", "fld.generalNote": "Catatan untuk kantor (opsional)", "fld.closeDay": "Tutup hari & setor", "fld.dayClosed": "Hari ditutup" }
}
```

- [ ] **Step 6: Jalankan** — `jest tests/field-day-static.test.js tests/field-shell-static.test.js` → PASS.

- [ ] **Step 7: Commit** — `git add dist-field-day.jsx dist-field.css finance-i18n.js server/tests/field-day-static.test.js && git commit -m "feat(distribusi): field deposit screen + close the day (reason for every unfinished stop)"`

---

### Task 10: Shell — merangkai tab dan layar, penjaga mode, armada, status simpan latihan

**Files:**
- Modify: `dist-field.jsx` (ganti `FldApp`, hapus `FldBoard` sementara), `finance-i18n.js`
- Test: `server/tests/field-shell-static.test.js` (tambah + sesuaikan pola `openLatihan`)

**Interfaces:**
- Consumes: semua layar Task 5–9, adaptor (`context`, `openLatihan({ …, onPersist })`).
- Produces: `FldApp` (props sama dengan Rencana 2). Tab: `kirim` → `FldBoardScreen`, `peta` → `FldRoute`, `setoran` → `FldSetoran`, `pelanggan` → "segera" (Rencana 3B). Tampilan penuh: `sale` → `FldSale`, `run` → `FldOpenRun`; sheet: `stop` → `FldStopSheet`.

- [ ] **Step 1: Tes gagal** — di `server/tests/field-shell-static.test.js`:
  - ganti pola lama `openLatihan\(\{ key, real, storage: storageRef\.current, today \}\)` menjadi `openLatihan\(\{ key, real, storage: storageRef\.current, today, onPersist: \(ok\) => \{ if \(live\) setPersistOk\(ok\); \} \}\)`;
  - tambahkan:

```js
describe('Plan 3A shell wiring', () => {
  it('screens only run on the adaptor of the ACTIVE mode (never the old one after a switch)', () => {
    expect(jsx).toMatch(/const ready = !!api && api\.mode === mode && !!ctx;/);
  });
  it('the armada follows the list when it arrives later', () => {
    expect(jsx).toMatch(/if \(!fleets\.includes\(fleet\)\) setFleet\(fleets\[0\] \|\| ''\);/);
  });
  it('tabs and views map to the day screens', () => {
    ['<FldBoardScreen ', '<FldRoute ', '<FldSetoran ', '<FldSale ', '<FldOpenRun ', '<FldStopSheet '].forEach((t) => expect(jsx).toContain(t));
    expect(jsx).not.toMatch(/function FldBoard\(/);   // the Plan 2 stub is gone
  });
  it('a lost practice save and a failed restart are shown', () => {
    expect(jsx).toMatch(/api\.persisted === false \|\| persistOk === false/);
    expect(jsx).toMatch(/\.catch\(\(e\) => flash\(trFl\('fld\.resetFail'\)/);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-shell-static.test.js` → FAIL.

- [ ] **Step 3: Ganti seluruh `function FldApp(…) { … }` dan hapus `function FldBoard(…) { … }` di `dist-field.jsx`** dengan:

```jsx
function FldApp({ user, pref, today, fleetList, fleetScope, refreshKey, onExit, onPref, onOpenRules }) {
  const mode = pref.mode;
  const scope = Array.isArray(fleetScope) ? fleetScope : null;
  const fleets = scope || fldPlates(fleetList);
  const [fleet, setFleet] = uSfl(fleets[0] || '');
  const [api, setApi] = uSfl(null);
  const [ctx, setCtx] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [tab, setTab] = uSfl('kirim');
  const [view, setView] = uSfl(null);   // { name: 'stop'|'sale'|'run', stop? }
  const [menu, setMenu] = uSfl(false);
  const [catat, setCatat] = uSfl(false);
  const [ask, setAsk] = uSfl(null);
  const [toast, setToast] = uSfl('');
  const [tick, setTick] = uSfl(0);           // bumped after every write → screens and context reload
  const [openTick, setOpenTick] = uSfl(0);   // bumped by "Coba lagi" / restart → the adaptor reopens
  const [persistOk, setPersistOk] = uSfl(true);
  const storageRef = uRfl(null);
  const key = 'latihan:' + ((user && user.id) || 'anon') + ':' + (fleet || '');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  // The glass dock IS the navigation here: the app's own phone bottom nav steps aside while this is
  // open (the topbar menu still reaches every other screen).
  uEfl(() => { document.body.classList.add('mlap-on'); return () => { document.body.classList.remove('mlap-on'); }; }, []);
  // The armada list can arrive after the first render (empty cache): follow it.
  uEfl(() => { if (!fleets.includes(fleet)) setFleet(fleets[0] || ''); }, [fleets.join('|')]);
  // Open the adaptor of the chosen mode (practice copy is per user + armada + day).
  uEfl(() => {
    let live = true; setApi(null); setCtx(null); setErr(null); setPersistOk(true); setView(null);
    const real = window.FIELDAPI.real(window.API, { date: today, fleet });
    if (mode === 'asli') { setApi(real); return () => { live = false; }; }
    if (!storageRef.current) storageRef.current = window.indexedDB ? window.FIELDAPI.idbStorage() : window.FIELDAPI.memoryStorage();
    window.FIELDAPI.openLatihan({ key, real, storage: storageRef.current, today, onPersist: (ok) => { if (live) setPersistOk(ok); } })
      .then((a) => { if (live) setApi(a); })
      .catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [mode, fleet, today, openTick]);
  // The day's context (rules, warehouse, open rit, expected gallons) — reloaded after every write and,
  // in Mode asli, when the office changes something (refreshKey).
  uEfl(() => {
    if (!api || api.mode !== mode) return undefined;
    let live = true;
    api.context().then((c) => { if (live) setCtx(c); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick, mode === 'asli' ? refreshKey : 0]);
  // Screens only ever run on the adaptor of the ACTIVE mode — never the previous one after a switch.
  const ready = !!api && api.mode === mode && !!ctx;
  const done = (m) => { setView(null); setTick((t) => t + 1); if (m) flash(m); };

  const askSwitch = (to) => setAsk({
    title: to === 'asli' ? trFl('fld.switchToAsliT') : trFl('fld.switchToLatihanT'),
    body: to === 'asli' ? trFl('fld.switchToAsliB') : trFl('fld.switchToLatihanB'),
    danger: to === 'asli',
    run: () => { onPref({ mode: to }); setMenu(false); },
  });
  const askReset = () => setAsk({
    title: trFl('fld.resetLatihanT'), body: trFl('fld.resetLatihanB'), danger: true,
    run: () => {
      Promise.resolve(api && api.reset ? api.reset() : null)
        .then(() => { setMenu(false); setOpenTick((t) => t + 1); flash(trFl('fld.resetDone')); })
        .catch((e) => flash(trFl('fld.resetFail') + (fldErrMsg(e) ? ' (' + fldErrMsg(e) + ')' : '')));
    },
  });

  const TABS = [['kirim', 'IconTruck'], ['peta', 'IconPin'], null, ['pelanggan', 'IconCustomers'], ['setoran', 'IconWallet']];
  const TAB_LABEL = { kirim: 'fld.tabKirim', peta: 'fld.tabPeta', pelanggan: 'fld.tabPelanggan', setoran: 'fld.tabSetoran' };
  const ACTIONS = ['catatSale', 'catatBon', 'catatExp', 'catatStop', 'catatAdj', 'catatDmg'];
  const full = view && (view.name === 'sale' || view.name === 'run');   // full-screen task: no tab header/dock

  let body = null;
  if (err) {
    body = (
      <div className="mlap-err" role="alert">
        <b>{err.offline ? trFl('fld.offline') : trFl('fld.loadErr')}</b>
        <span>{fldErrMsg(err)}</span>
        <button type="button" className="mlap-btn" onClick={() => setOpenTick((t) => t + 1)}>{trFl('fld.retry')}</button>
      </div>
    );
  } else if (!ready) {
    body = <div className="mlap-empty">{trFl('fld.loading')}</div>;
  } else if (tab === 'kirim') {
    body = <FldBoardScreen api={api} ctx={ctx} tick={tick} onStop={(s) => setView({ name: 'stop', stop: s })} onSale={(s) => setView({ name: 'sale', stop: s })} onOpenRun={() => setView({ name: 'run' })} onRoute={() => setTab('peta')} />;
  } else if (tab === 'peta') {
    body = <FldRoute api={api} ctx={ctx} tick={tick} onOpenRun={() => setView({ name: 'run' })} />;
  } else if (tab === 'setoran') {
    body = <FldSetoran api={api} ctx={ctx} tick={tick} onChanged={(m) => done(m)} />;
  } else {
    body = <div className="mlap-card"><div className="mlap-empty">{trFl('fld.soon')}</div></div>;
  }

  return (
    <div className="mlap-root">
      {mode === 'latihan' && <div className="mlap-ribbon" role="status">{trFl('fld.bannerLatihan')}</div>}
      {ready && full && view.name === 'sale' && <FldSale api={api} stop={view.stop} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'run' && <FldOpenRun api={api} ctx={ctx} tick={tick} onDone={done} onBack={() => setView(null)} />}
      {!full && (
        <>
          <div className="mlap-head">
            <h1>{trFl(TAB_LABEL[tab])}</h1>
            <button type="button" className="mlap-round" aria-label={trFl('fld.menu')} onClick={() => setMenu(true)}>{FldIco('IconDots', 20)}</button>
          </div>
          <div className="mlap-eyebrow mlap-meta">
            <span>{today}</span>
            <span className={'mlap-chip ' + mode}>{mode === 'latihan' ? trFl('fld.modeLatihan') : trFl('fld.modeAsli')}</span>
            {fleets.length > 1 ? (
              <span className="mlap-chip">
                <select value={fleet} onChange={(e) => setFleet(e.target.value)} aria-label={trFl('fld.pickFleet')}>
                  {fleets.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </span>
            ) : <span className="mlap-chip">{fleet || '—'}</span>}
          </div>
          <div className="mlap-body">
            {api && mode === 'latihan' && (api.persisted === false || persistOk === false) && <div className="mlap-err" role="status">{trFl('fld.noStore')}</div>}
            {body}
          </div>
          <nav className="mlap-dock" aria-label={trFl('fld.nav')}>
            {TABS.map((t, i) => (t ? (
              <button key={t[0]} type="button" className={'mlap-tab' + (tab === t[0] ? ' on' : '')} aria-current={tab === t[0] ? 'page' : undefined} onClick={() => { setTab(t[0]); setView(null); }}>
                {FldIco(t[1], 20)}<span>{trFl(TAB_LABEL[t[0]])}</span>
              </button>
            ) : <span key={'gap' + i} aria-hidden="true" />))}
          </nav>
          <button type="button" className={'mlap-catat' + (catat ? ' open' : '')} aria-label={trFl('fld.tabCatat')} aria-expanded={catat} onClick={() => setCatat(!catat)}>{FldIco('IconPlus', 24)}</button>
        </>
      )}
      {catat && !full && (
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
      {ready && view && view.name === 'stop' && <FldStopSheet api={api} stop={view.stop} onClose={() => setView(null)} onSale={(s) => setView({ name: 'sale', stop: s })} onChanged={done} />}
      {menu && (
        <>
          <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={() => setMenu(false)} />
          <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={trFl('fld.menu')}>
            <div className="mlap-grab" />
            <h2>{trFl('fld.menu')}</h2>
            {pref.canAsli && pref.canLatihan && (mode === 'latihan'
              ? <button type="button" className="mlap-menu-item" onClick={() => askSwitch('asli')}>{trFl('fld.useAsli')}</button>
              : <button type="button" className="mlap-menu-item" onClick={() => askSwitch('latihan')}>{trFl('fld.useLatihan')}</button>)}
            {mode === 'latihan' && api && <button type="button" className="mlap-menu-item" onClick={askReset}>{trFl('fld.resetLatihan')}</button>}
            {onOpenRules && <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); onOpenRules(); }}>{trFl('fld.rules')}</button>}
            <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); onExit(); }}>{trFl('fld.backOld')}</button>
          </div>
        </>
      )}
      {ask && <FldSheet title={ask.title} body={ask.body} danger={ask.danger} onClose={() => setAsk(null)} onConfirm={() => { const r = ask.run; setAsk(null); r(); }} />}
      {toast && <div className="mlap-toast" role="status">{toast}</div>}
    </div>
  );
}
```

Catatan: tes statis Rencana 2 yang mencari `{mode === 'latihan' && <div className="mlap-ribbon"…`, `askSwitch(`, `fld.switchToAsliB`, `fld.resetLatihanB`, pola tombol `onExit` "Kembali ke tampilan lama", dan `document.body.classList.add('mlap-on')` tetap terpenuhi oleh kode di atas.

- [ ] **Step 4: Kunci i18n** — `<scratchpad>/keys-t10.json` lalu `node <scratchpad>/fld-keys.js <scratchpad>/keys-t10.json`:

```json
{
  "en": { "fld.resetFail": "Restarting practice failed — try again." },
  "id": { "fld.resetFail": "Ulang latihan gagal — coba lagi." }
}
```

- [ ] **Step 5: Jalankan** — `jest tests/field-shell-static.test.js tests/field-shell-integration.test.js tests/field-day-static.test.js tests/field-kit-static.test.js` → PASS; `node build.mjs --no-minify` → sukses.

- [ ] **Step 6: Commit** — `git add dist-field.jsx finance-i18n.js server/tests/field-shell-static.test.js && git commit -m "feat(distribusi): field shell wires the day screens (mode guard, armada follow, practice save status)"`

---

### Task 11: Verifikasi menyeluruh + dokumentasi

- [ ] **Step 1: Uji tampilan headless (verifikasi lokal, bukan tes server).** Bangun `node build.mjs --no-minify`. Di scratchpad, buat harness HTML yang memuat `vendor/react*.js`, `dist/app.<hash>.js`, dan `dist-field.css` lewat server statis kecil di `localhost` (lihat resep Rencana 2: `serve.js` + Chrome `--headless=new --virtual-time-budget=8000 --dump-dom` / `--screenshot --window-size=500,900`). Mock `window.API.distribusi.field` dengan data contoh (board 3 stop: satu dengan bon, satu tanpa titik, satu terkirim; customers dengan `gallonsHeld`; runs kosong; context `{today, fleet:'DK 1', rules:{ritSop:{enabled:false,minLoad:80}, fleetCapacity:{'DK 1':120}}, depot:{lat:-8.65,lng:115.2}, demand:{}, openRun:null}`). Render `FIELD.App` dengan `pref` latihan dan periksa: (a) tab Pengiriman menampilkan kartu "Belum ada rit terbuka", kartu Berikutnya, peringatan data belum lengkap dan di luar rute; (b) klik "Antar & catat" → layar Transaksi, tombol simpan mati tanpa foto; (c) "Buka rit 1" → pengukur 120, turunkan ke 60 → kotak alasan muncul; (d) tab Setoran menampilkan angka 0 dan daftar stop menunggu. Ambil tangkapan layar 500 px tiap tahap dan lihat dengan tool Read. Catat temuan sebagai perbaikan (TDD) sebelum lanjut. Hentikan server statis setelahnya.
- [ ] **Step 2:** Jalankan seluruh suite server di latar belakang; ekspektasi: semua lulus kecuali 9 file lama yang rapuh tanggal bila dijalankan 00:00–08:00 WITA — buktikan dengan `APP_TZ=UTC` untuk 9 file itu.
- [ ] **Step 3:** `node build.mjs` (minify) → sukses tanpa peringatan file root yang tidak terdaftar.
- [ ] **Step 4:** Perbarui spec bagian 4: tambahkan catatan "Sesuai yang dibangun (Rencana 3A)" — file `dist-field-logic.js`/`dist-field-kit.jsx`/`dist-field-day.jsx`, layar Pengiriman menampilkan "Belum terkirim" baca-saja (penyelesaian tetap di tampilan lama), `field-context.openRun`, foto latihan di kunci terpisah, tampilan lapangan terang saja. Commit: `git commit -m "docs: mode lapangan spec aligned with the day screens (Plan 3A)"`.

## Setelah rencana ini

Rencana 3B: layar Pelanggan (filter Semua/Belum lengkap/Ada bon/Hari tetap), Lengkapi data (GPS, WA, foto lokasi), Atur titik lokasi (pin Leaflet yang bisa digeser + lingkaran akurasi + peringatan > 150 m), Tambah stop (pelanggan tanpa titik langsung ke Atur titik), Pembayaran bon (foto wajib), Penyesuaian galon (alasan sesuai enum server), Ganti rugi galon (cegah kirim ganda), Pengeluaran (selalu tunai, foto nota wajib), Koreksi (pelanggan/jumlah/cara bayar/batalkan, pratinjau dampak) + Koreksi saya, menu Catat aktif, sisa temuan kecil Rencana 2 (adaptor `addExpense` memaksa tunai, `setPhone` latihan menormalkan ke 08…, cek `reassign` dari/ke, enum alasan penyesuaian, `kind`/`payMethod`/`category` wajib di latihan, rilis tidak menimpa suntingan aturan, label kartu demo setelah rilis), lalu `FLD_SCREENS_READY = true`.
