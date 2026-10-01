# Mode Lapangan — Rencana 3B: Data pelanggan & input manual

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Di Mode Lapangan, sopir bisa:
- membuka tab **Pelanggan** (cari; filter Semua / Belum lengkap / Ada bon / Hari tetap);
- **melengkapi data** pelanggan: titik GPS, nomor WhatsApp, foto lokasi;
- **menggeser titik lokasi** di peta;
- **menambah stop manual**;
- memakai semua input manual dari tombol **Catat**: transaksi manual, pembayaran bon, penyesuaian galon, ganti rugi galon, dan pengeluaran.

Setiap uang masuk dan ganti rugi memakai **foto wajib**, mengikuti aturan pemilik. Setiap transaksi membawa **kunci idempotensi**, jadi tidak pernah tercatat ganda walaupun respons server hilang.

**Architecture:**
- **Server:** satu tambahan kecil, yaitu kolom unik `DistTransaction.clientRef`. Penjualan, pelunasan, atau ganti rugi yang dikirim ulang dengan `clientRef` yang sama mengembalikan baris yang sudah ada, bukan membuat baris baru.
- **Logika baru** (daftar pelanggan, bon tertua dulu, pratinjau bayar/penyesuaian/ganti rugi, body pengeluaran, jarak geser pin, kandidat tambah stop) masuk ke `FIELDLOGIC` dan dites di Node.
- **Layar:** komponen bersama baru di `dist-field-kit.jsx`, dan layar-layar baru di file baru `dist-field-cust.jsx`.
- **Shell:** menerima izin pengguna, dan setiap aksi hanya muncul bila izinnya ada.

**Tech Stack:** React 18 UMD (JSX digabung `build.mjs`), Leaflet + OSM (`znLoadLeaflet`, marker `draggable`), Prisma (SQLite, migrasi tulis-tangan), Jest (server) untuk tes Node + statis/parse via `@babel/parser`.

**Spec:** `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md`
- bagian 3.5 (geser titik), 3.6 (ganti rugi), dan 4 (baris Pelanggan, Lengkapi data, Atur titik lokasi, Tambah stop, Pembayaran bon, Penyesuaian galon, Ganti rugi galon, Pengeluaran);
- mockup: board Pelanggan, Lengkapi, AturTitik, TambahStop, BayarBon, Penyesuaian, GantiRugi, Pengeluaran.

Rencana 3C (Koreksi + Koreksi saya, sisa temuan kecil, rilis `FLD_SCREENS_READY`) menyusul.

## Global Constraints

- **Menjalankan tes:**
  - dari `server/`: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand <file>`;
  - jam 00:00–08:00 WITA, 9 file tes lama yang menghitung tanggal dalam UTC gagal; buktikan dengan `APP_TZ=UTC`;
  - **jangan pernah menjalankan jest lain selama suite penuh berjalan**, karena `globalSetup` me-reset `test.db`.
- **Ketergantungan tes:** tes server TIDAK BOLEH `require` dari `node_modules` root. JSX hanya dicek dengan `@babel/parser`.
- **Bundel satu cakupan:**
  - setiap nama tingkat atas baru harus unik di seluruh bundel, dengan awalan `Fld`, `fld`, atau `FLD`;
  - kelas CSS baru berawalan `mlap-`;
  - tes anti-bentrok di `field-shell-static.test.js` harus mencakup file baru `dist-field-cust.jsx`.
- **Aturan pemilik di tampilan baru:**
  - foto bukti wajib untuk transaksi manual, pembayaran bon, ganti rugi, dan pengeluaran;
  - pengeluaran **selalu tunai dari uang setoran**;
  - ganti rugi **tanpa persetujuan**;
  - penyesuaian galon **tetap dengan persetujuan kantor**;
  - geser titik lebih dari 150 m dari GPS HP harus dikonfirmasi.
- **Mode latihan tidak pernah menulis ke server.** Layar hanya memanggil adaptor `api` dari shell.
- **Tampilan:**
  - tampilan lapangan terang saja;
  - Liquid Glass hanya di lapisan fungsional;
  - target sentuh ≥ 44 px untuk tombol baru;
  - peta Leaflet di dalam `.mlap-map`, yang sudah ber-`isolation`.
- **Teks:** semua lewat `window.t` dengan kunci `fld.*` di EN **dan** ID. Tambahkan kunci dengan skrip bantu `fld-keys.js` (kode di Task 4).
- **Cara kerja:**
  - migrasi Prisma ditulis tangan; **jangan pernah** `npx prisma format`; setelah mengubah skema jalankan `npx prisma generate` dari `server/`;
  - edit dengan tool Edit/Write; skrip bantu ditulis ke scratchpad (bukan heredoc); file bisa CRLF;
  - commit lokal per tugas; push hanya atas permintaan pemilik.

## Review Focus

1. **Respons transaksi hilang di jaringan, lalu sopir menekan simpan lagi.** Server mengembalikan transaksi yang sama, bukan transaksi kedua. Ini berlaku untuk penjualan, pelunasan, dan ganti rugi, di Mode asli maupun latihan.
   - Dites di Task 1 (server, `clientRef` sama → satu baris) dan Task 2 (latihan).
2. **Pin digeser jauh dari posisi HP.** Penyimpanan meminta konfirmasi dan mencatat posisi HP. Saat GPS HP tidak tersedia, pin tetap bisa disimpan, dengan peringatan.
   - Dites di Task 3 (`pinMove`) dan Task 6 (tes statis).
3. **Sopir tanpa izin suatu aksi** tidak melihat tombolnya. Contoh: tanpa `distribusiExpense` tidak ada Pengeluaran; tanpa `distribusiOrder` tidak ada Tambah stop. Jadi tidak ada aksi yang berujung 403.
   - Dites di Task 4 (`fldCan`) dan Task 11 (tes statis menu Catat).
4. **Pembayaran bon melebihi sisa bon.** Tombol mati dan kelebihannya ditampilkan. Pelanggan tanpa bon tidak bisa dipilih untuk Pembayaran bon.
   - Dites di Task 3 (`payPreview`) dan Task 8.
5. **Ganti rugi saat harga belum diatur pemilik, atau galon di pelanggan 0.** Layar menjelaskan, bukan menampilkan error server.
   - Dites di Task 3 (`damagePreview`) dan Task 9.

---

### Task 1: Server — kunci idempotensi `clientRef` pada transaksi

**Files:**
- Modify: `server/prisma/schema.prisma` (model `DistTransaction`), `server/src/services/distribution.service.js` (`createTransaction`, `gallonDamageCharge`), `server/src/controllers/distribution.controller.js` (`txnSchema`, `gallonDamageSchema`)
- Create: `server/prisma/migrations/20261003100000_dist_txn_client_ref/migration.sql`
- Test: `server/tests/txn-client-ref.test.js` (baru)

**Interfaces:**
- Produces:
  - `POST /distribusi/transactions` dan `POST /distribusi/customers/:id/gallon-damage` menerima `clientRef` (string 8–64, opsional).
  - Bila `clientRef` sudah ada **untuk pelanggan yang sama**, server tidak membuat apa pun dan mengembalikan bentuk respons yang sama dengan pembuatan biasa, ditambah `replay: true`:
    - penjualan/pelunasan → `{ ...txn, gallonsHeld, sisaBon, replay: true }` (status 201);
    - ganti rugi → `{ transaction: txn, gallonsHeld, sisaBon, replay: true }`.
  - `clientRef` yang sama untuk pelanggan lain → 409.

- [ ] **Step 1: Tes gagal** — `server/tests/txn-client-ref.test.js`:

```js
'use strict';
// IDEMPOTENT FIELD WRITES — the phone sends a clientRef with every sale, bon payment and gallon damage
// charge. A retry after a lost response (same clientRef) returns the row already saved instead of
// recording it twice; the same ref for another customer is refused.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
const ALL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
let gm, cA, cB;

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'cr_gm', password: 'secret123', role: 'gm' })).body.token;
  cA = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'A', type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL })).body.data.id;
  cB = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'B', type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL })).body.data.id;
  await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ hargaGantiRugiGalon: 45000 });
});
afterAll(() => prisma.$disconnect());

it('a sale sent twice with the same clientRef is saved once', async () => {
  const body = { customerId: cA, qty: 3, method: 'bon', txnDate: today, clientRef: 'ref-sale-0001' };
  const r1 = await request(app).post(`${D}/transactions`).set(auth(gm)).send(body);
  const r2 = await request(app).post(`${D}/transactions`).set(auth(gm)).send(body);
  expect(r1.status).toBe(201); expect(r2.status).toBe(201);
  expect(r2.body.data.id).toBe(r1.body.data.id);
  expect(r2.body.data.replay).toBe(true);
  expect(await prisma.distTransaction.count({ where: { clientRef: 'ref-sale-0001' } })).toBe(1);
  expect(r2.body.data.sisaBon).toBe(18000);
});
it('a bon payment sent twice is saved once', async () => {
  const body = { customerId: cA, method: 'pelunasan', payAmount: 6000, payMethod: 'tunai', txnDate: today, clientRef: 'ref-pay-0001' };
  const r1 = await request(app).post(`${D}/transactions`).set(auth(gm)).send(body);
  const r2 = await request(app).post(`${D}/transactions`).set(auth(gm)).send(body);
  expect(r2.body.data.id).toBe(r1.body.data.id);
  expect(await prisma.distTransaction.count({ where: { customerId: cA, method: 'pelunasan' } })).toBe(1);
});
it('a gallon damage charge sent twice is saved once', async () => {
  const att = (await request(app).post('/api/v1/attachments').set(auth(gm)).send({ name: 'g.jpg', mime: 'image/jpeg', isImg: true, data: 'data:image/jpeg;base64,AAAA' })).body.data.id;
  const body = { qty: 1, kind: 'pecah', payMethod: 'tunai', photoId: att, clientRef: 'ref-dmg-0001' };
  const r1 = await request(app).post(`${D}/customers/${cA}/gallon-damage`).set(auth(gm)).send(body);
  const r2 = await request(app).post(`${D}/customers/${cA}/gallon-damage`).set(auth(gm)).send(body);
  expect(r1.status).toBe(201);
  expect(r2.body.data.transaction.id).toBe(r1.body.data.transaction.id);
  expect(r2.body.data.replay).toBe(true);
  expect(await prisma.distTransaction.count({ where: { kind: 'ganti_rugi' } })).toBe(1);
});
it('the same clientRef for another customer is refused; no ref keeps the old behaviour', async () => {
  const r = await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cB, qty: 1, method: 'lunas', txnDate: today, clientRef: 'ref-sale-0001' });
  expect(r.status).toBe(409);
  const a = await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cB, qty: 1, method: 'lunas', txnDate: today });
  const b = await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cB, qty: 1, method: 'lunas', txnDate: today });
  expect(a.body.data.id).not.toBe(b.body.data.id);
});
```

Catatan untuk implementer: tes ganti rugi memerlukan galon di pelanggan ≥ 1 — tes penjualan pertama mengirim 3 galon (gallonOut default = qty), jadi A memegang 3. Status 201 untuk gallon-damage: cek controller `gallonDamageCharge` (`res.status(201)`); bila controller mengirim 200, sesuaikan ekspektasi `r1.status` dengan controller dan catat ruling.

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/txn-client-ref.test.js` → FAIL (baris kedua tercipta; 409 tidak muncul).

- [ ] **Step 3: Skema + migrasi** — di `server/prisma/schema.prisma`, model `DistTransaction`, tepat setelah baris `proofLng        Float?` tambahkan:

```prisma
  // IDEMPOTENCY (field UI) — a random ref the phone sends with a sale / bon payment / damage charge; a
  // retry after a lost response returns the row already saved instead of recording it twice.
  clientRef       String?  @unique
```

Buat `server/prisma/migrations/20261003100000_dist_txn_client_ref/migration.sql`:

```sql
-- Idempotent field writes: a phone-generated ref per sale / payment / damage charge (nullable, unique).
ALTER TABLE "DistTransaction" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "DistTransaction_clientRef_key" ON "DistTransaction"("clientRef");
```

Jalankan dari `server/`: `npx prisma generate`.

- [ ] **Step 4: Controller** — di `txnSchema` tambahkan `clientRef: z.string().min(8).max(64).optional(),` setelah `proofLng: z.number().optional(),`; di `gallonDamageSchema` tambahkan `clientRef: z.string().min(8).max(64).optional()` setelah `txnDate: DATE.optional()`.

- [ ] **Step 5: Service** — tepat sebelum `async function createTransaction(body, actor) {` tambahkan:

```js
// IDEMPOTENCY: a field write retried with the same clientRef returns what was already saved. The same
// ref for another customer is a client bug and is refused (never silently attached to the wrong row).
async function replayByClientRef(ref, customerId) {
  if (!ref) return null;
  const prev = await prisma.distTransaction.findUnique({ where: { clientRef: String(ref) } });
  if (!prev) return null;
  if (prev.customerId !== customerId) throw ApiError.conflict('Kode transaksi ini sudah dipakai untuk pelanggan lain.');
  return { txn: prev, gallonsHeld: await gallonBalanceOf(customerId), sisaBon: await customerBonBalance(customerId) };
}
```

(`ApiError.conflict(message, details)` sudah ada di `server/src/utils/ApiError.js` → 409 `CONFLICT`.)

Di `createTransaction`, tepat setelah baris `if (!fleetAllows(actor, customer.armada)) throw …` tambahkan:

```js
  const replay = await replayByClientRef(body.clientRef, customer.id);
  if (replay) return { ...replay.txn, gallonsHeld: replay.gallonsHeld, sisaBon: replay.sisaBon, replay: true };
  const clientRef = body.clientRef ? String(body.clientRef) : null;
```

Lalu pada **setiap** `distTransaction.create({ data: { … } })` di dalam `createTransaction` (cabang pelunasan dan cabang penjualan; JANGAN cabang opening bon) tambahkan properti `clientRef,` di objek `data`.

Di `gallonDamageCharge`, tepat setelah pelanggan dimuat dan dicek cakupannya (sebelum validasi qty/foto), tambahkan:

```js
  const replay = await replayByClientRef(body && body.clientRef, customer.id);
  if (replay) return { transaction: replay.txn, gallonsHeld: replay.gallonsHeld, sisaBon: replay.sisaBon, replay: true };
```

dan `clientRef: body && body.clientRef ? String(body.clientRef) : null,` pada `data` dari `distTransaction.create` di fungsi itu.

- [ ] **Step 6: Jalankan** — `jest tests/txn-client-ref.test.js tests/gallon-damage-charge.test.js tests/txn-proof-transfer.test.js tests/distribution.test.js` → PASS (jam 00–08 WITA tambahkan `APP_TZ=UTC` untuk `distribution.test.js`).

- [ ] **Step 7: Commit** — `git add server/prisma server/src server/tests/txn-client-ref.test.js && git commit -m "feat(distribusi): idempotent field writes — clientRef on sales, bon payments and damage charges"`

---

### Task 2: Adaptor & mesin latihan — `clientRef`, detail pelanggan, aturan server lebih rapat

**Files:**
- Modify: `dist-field-api.js`, `dist-field-sandbox.js`, `api.js`
- Test: `server/tests/field-api.test.js`, `server/tests/field-sandbox.test.js`, `server/tests/api-client-field.test.js` (tambah)

**Interfaces:**
- Produces:
  - `API.distribusi.field.customer(id)` → `GET /distribusi/customers/:id` (bertanda).
  - Adaptor `customerDetail(id)` → `{ ...customer, transactions:[{ id, txnDate, method, kind, qty, amount, effectiveAmount, status, payMethod, createdAt }] }` (asli: server; latihan: transaksi latihan pelanggan itu, terbaru dulu). `FIELDAPI.METHODS` jadi 31.
  - `FIELDAPI.real.addExpense` **selalu** `method: 'tunai'` (tidak bisa ditimpa).
  - Latihan:
    - `createSale`, `payBon`, dan `gallonDamage` dengan `clientRef` yang sudah ada → kembalikan baris lama (`replay: true`) tanpa mengubah state;
    - `setPhone` menormalkan ke `08…` seperti server;
    - `adjustGallon` menolak `reason` di luar enum server;
    - `gallonDamage` menolak `kind`/`payMethod` yang kosong;
    - `addExpense` menolak `category` kosong.

- [ ] **Step 1: Tes gagal** — tambahkan di akhir `server/tests/field-sandbox.test.js`:

```js
describe('Plan 3B: practice follows the server on field inputs', () => {
  it('clientRef: a retried sale / payment / damage returns the saved row, state unchanged', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    const a = await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', proofPhotoId: ph.id, clientRef: 'ref-s-0001' });
    const b = await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', proofPhotoId: ph.id, clientRef: 'ref-s-0001' });
    expect(b).toMatchObject({ id: a.id, replay: true });
    const p1 = await api.payBon({ customerId: 'c1', payAmount: 5000, payMethod: 'tunai', proofPhotoId: ph.id, clientRef: 'ref-p-0001' });
    const p2 = await api.payBon({ customerId: 'c1', payAmount: 5000, payMethod: 'tunai', proofPhotoId: ph.id, clientRef: 'ref-p-0001' });
    expect(p2.id).toBe(p1.id);
    expect((await api.customers()).find((c) => c.id === 'c1').sisaBon).toBe(40000);
    const d1 = await api.gallonDamage('c2', { qty: 1, kind: 'pecah', payMethod: 'tunai', photoId: ph.id, clientRef: 'ref-d-0001' });
    const d2 = await api.gallonDamage('c2', { qty: 1, kind: 'pecah', payMethod: 'tunai', photoId: ph.id, clientRef: 'ref-d-0001' });
    expect(d2.transaction.id).toBe(d1.transaction.id);
    expect(api.exportState().txns.length).toBe(3);
    expect(await code(api.createSale({ customerId: 'c1', qty: 1, method: 'lunas', proofPhotoId: ph.id, clientRef: 'ref-s-0001' }))).toBe(409);
  });
  it('customerDetail lists the practice transactions, newest first', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    await api.createSale({ customerId: 'c1', qty: 1, method: 'bon', proofPhotoId: ph.id });
    await api.payBon({ customerId: 'c1', payAmount: 1000, payMethod: 'tunai', proofPhotoId: ph.id });
    const d = await api.customerDetail('c1');
    expect(d).toMatchObject({ id: 'c1', name: 'Pak Wayan' });
    expect(d.transactions.map((t) => t.method)).toEqual(['pelunasan', 'bon']);
  });
  it('phone stored as 08…, adjustment reason from the server list, damage/expense fields required', async () => {
    const { api } = make();
    expect((await api.setPhone('c1', '+62 812-3456-789')).phone).toBe('08123456789');
    expect((await api.setPhone('c1', '812 999')).phone).toBe('0812999');
    expect(await code(api.adjustGallon('c1', { value: 5, reason: 'Hitung ulang' }))).toBe(400);
    expect((await api.adjustGallon('c1', { value: 5, reason: 'rekonsiliasi_fisik' })).status).toBe('pending');
    const ph = await api.uploadPhoto({ data: 'x' });
    expect(await code(api.gallonDamage('c2', { qty: 1, payMethod: 'tunai', photoId: ph.id }))).toBe(400);
    expect(await code(api.gallonDamage('c2', { qty: 1, kind: 'pecah', photoId: ph.id }))).toBe(400);
    expect(await code(api.addExpense({ amount: 1000, photoId: ph.id }))).toBe(400);
  });
});
```

Tambahkan di akhir `server/tests/field-api.test.js`:

```js
describe('Plan 3B adaptor', () => {
  it('31 methods incl. customerDetail; real asks the server', async () => {
    expect(FA.METHODS).toContain('customerDetail');
    expect(FA.METHODS.length).toBe(31);
    const real = REAL({ customer: (id) => Promise.resolve({ data: { id, name: 'A', transactions: [] } }) });
    expect(await real.customerDetail('c1')).toEqual({ id: 'c1', name: 'A', transactions: [] });
  });
  it('expenses are always paid in cash from the deposit — a caller cannot change that', async () => {
    const calls = [];
    const real = REAL({ expense: (b) => { calls.push(b); return Promise.resolve({ data: {} }); } });
    await real.addExpense({ amount: 5000, category: 'bensin', method: 'transfer' });
    expect(calls[0].method).toBe('tunai');
  });
});
```

Ubah juga di `field-api.test.js`: `FIELD_NAMES` tambah `'customer'`; kedua `toBe(30)` (jumlah METHODS) menjadi `toBe(31)`. Di `server/tests/api-client-field.test.js`: daftar nama tambah `'customer'`, dan tambahkan:

```js
it('customer detail is a tagged read', async () => {
  const { API, calls } = loadApi();
  await API.distribusi.field.customer('c 1');
  expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://x/api/v1/distribusi/customers/c%201' });
  expect(calls[0].headers['X-Airro-Ui']).toBe('field');
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-sandbox.test.js tests/field-api.test.js tests/api-client-field.test.js` → FAIL.

- [ ] **Step 3: `api.js`** — di `field: {`, setelah `position: …` tambahkan:

```js
        customer: (id) => freq('GET', '/distribusi/customers/' + encodeURIComponent(id)),
```

- [ ] **Step 4: `dist-field-api.js`**
  - `METHODS`: tambah `'customerDetail'` setelah `'customers'`.
  - Di `real()`, setelah `customers: …` tambahkan `customerDetail: function (id) { return U(F.customer(id)); },`.
  - Ganti baris `addExpense` di `real()` dengan:

```js
      // Field expenses are ALWAYS paid in cash from the day's deposit (owner rule) — never overridable.
      addExpense: function (b) { return U(F.expense(A(A({ date: c.date, fleet: c.fleet }, b), { method: 'tunai' }))); },
```

- [ ] **Step 5: `dist-field-sandbox.js`**
  - Tambahkan setelah definisi `digits`:

```js
  // Same as the server's normalizePhone: stored as "08…".
  var phone08 = function (p) { var d = String(p || '').replace(/[^0-9]/g, ''); if (d.indexOf('62') === 0) d = '0' + d.slice(2); else if (d.charAt(0) === '8') d = '0' + d; return d; };
  var ADJ_REASONS = ['rekonsiliasi_fisik', 'salah_input', 'galon_pecah_hilang', 'penghapusan_piutang', 'selisih_staf', 'lainnya'];
```

  - Di `createSandbox`, setelah `var txnOf = …` tambahkan:

```js
    // IDEMPOTENCY (like the server): a write retried with the same clientRef returns the saved row.
    function replay(ref, customerId) {
      if (!ref) return null;
      var t = s.txns.find(function (x) { return x.clientRef === ref; });
      if (!t) return null;
      if (t.customerId !== customerId) throw fail(409, 'Kode transaksi ini sudah dipakai untuk pelanggan lain.');
      var c = s.customers[customerId];
      return { txn: t, gallonsHeld: c.gallonsHeld, sisaBon: c.sisaBon };
    }
```

  - Di `createSale`, tepat setelah `var b = body || {}; var c = cust(b.customerId);` tambahkan `var rp = replay(b.clientRef, c.id); if (rp) return Object.assign({}, rp.txn, { sisaBon: rp.sisaBon, gallonsHeld: rp.gallonsHeld, replay: true });` dan pada objek `pushTxn(Object.assign({ customerId: c.id, …` tambahkan `clientRef: b.clientRef || null,`.
  - Di `payBon`, sama: setelah `var b = body || {}; var c = cust(b.customerId);` tambahkan baris replay yang sama (dengan `isPayment: true` di objek kembalian) dan `clientRef: b.clientRef || null,` pada `pushTxn`.
  - Di `gallonDamage`, setelah `var c = cust(cid); var b = body || {}; var qty = int(b.qty);` tambahkan `var rp = replay(b.clientRef, c.id); if (rp) return { transaction: rp.txn, gallonsHeld: rp.gallonsHeld, sisaBon: rp.sisaBon, replay: true };`; ganti baris `var pay = … ? b.payMethod : 'tunai';` dan `var kind = … : 'pecah';` dengan:

```js
        if (['tunai', 'bon', 'transfer'].indexOf(b.payMethod) < 0) throw fail(400, 'Pilih cara bayar ganti rugi.');
        if (['pecah', 'bocor', 'retak', 'hilang'].indexOf(b.kind) < 0) throw fail(400, 'Pilih jenis kerusakan.');
        var pay = b.payMethod; var kind = b.kind;
```

    dan tambahkan `clientRef: b.clientRef || null,` pada `pushTxn` ganti rugi.
  - Di `setPhone`: ganti `c.phone = digits(phone);` dengan `c.phone = phone08(phone);`.
  - Di `adjustGallon`: ganti `if (!String(b.reason || '').trim()) throw fail(400, 'Alasan wajib diisi.');` dengan `if (ADJ_REASONS.indexOf(b.reason) < 0) throw fail(400, 'Pilih alasan penyesuaian.');`.
  - Di `addExpense`: setelah cek nominal tambahkan `if (!String(b.category || '').trim()) throw fail(400, 'Pilih kategori pengeluaran.');` dan ganti `category: String(b.category || 'lainnya')` dengan `category: String(b.category)`.
  - Tambahkan metode setelah `customers: run(…),`:

```js
      customerDetail: run(function (id) {
        var c = cust(id);
        // newest first by RECORDING order (two writes in the same millisecond must not swap)
        var txns = s.txns.filter(function (t) { return t.customerId === id; }).slice().reverse()
          .map(function (t) { return { id: t.id, txnDate: t.txnDate, method: t.method, kind: t.kind, qty: t.qty, amount: t.amount, effectiveAmount: t.amount, status: t.status, payMethod: t.payMethod, createdAt: t.createdAt }; });
        return Object.assign(custView(c), { transactions: txns });
      }),
```

  - Bila `digits` tidak lagi dipakai, hapus definisinya (tes anti-bentrok tidak terpengaruh; ini UMD tertutup).

- [ ] **Step 6: Jalankan** — `jest tests/field-sandbox.test.js tests/field-api.test.js tests/api-client-field.test.js` → PASS. Tes sandbox lama `'location, phone and location photo'` mengharapkan `'0812999'` dari `'0812 999'` → tetap `0812999` ✓; tes lama `'gallon adjustment waits for approval'` memakai `reason: 'rekonsiliasi_fisik'` ✓; tes lama ganti rugi mengirim `kind` dan `payMethod` ✓.

- [ ] **Step 7: Commit** — `git commit -am "feat(distribusi): field adaptor — clientRef replay in practice, customer detail, cash-only expenses, stricter practice rules"` (tambahkan file tes).

---

### Task 3: Logika data pelanggan & input (`FIELDLOGIC`)

**Files:**
- Modify: `dist-field-logic.js`
- Test: `server/tests/field-logic.test.js` (tambah)

**Interfaces:**
- Produces di `FIELDLOGIC`:
  - `newRef() → string` (≥ 16 karakter, unik).
  - `customerList(customers, { q, filter }) → { rows, counts:{ all, warn, bon, fixed } }` — `filter` ∈ `all|warn|bon|fixed`; pencarian nama/kode/angka HP; urut nama; baris diperkaya `gaps`.
  - `openBons(transactions) → [{ id, txnDate, qty, amount, partial }]` — bon tertua dulu setelah pelunasan dialokasikan ke bon tertua.
  - `payPreview({ sisaBon, pay }) → { rest, over, ok }`.
  - `ADJ_REASON_KEYS` = `[['fld.adj_hitung','rekonsiliasi_fisik'],['fld.adj_hilang','galon_pecah_hilang'],['fld.adj_kembali','rekonsiliasi_fisik'],['fld.adj_salah','salah_input'],['fld.r_other','lainnya']]`; `adjustBody({ counted, reasonKey, reasonLabel, note, photo }) → { value, reason, note, evidenceUrl? }`.
  - `damagePreview({ qty, price, held, payMethod }) → { total, heldAfter, blocked:''|'fld.dmgNoPrice'|'fld.dmgNoHeld', totalKey }`.
  - `expenseBody({ category, amount, liters, odometer, note, photo }) → { amount, category, note, photoId? }` (selalu tanpa `method` — adaptor memaksa tunai).
  - `pinMove({ device, pin }) → { meters|null, far }` (far = > 150 m).
  - `addStopCandidates({ board, customers, q }) → { noPin:[stop], others:[customer] }` — `noPin` = stop menunggu hari ini tanpa titik; `others` = pelanggan aktif yang belum ada di papan hari ini (dicari).
  - `recordSale(api, { stopId: null, … })` → hanya membuat transaksi (`{ txnId, done: true }`), tanpa menandai stop.
  - `saleBody({ …, clientRef })` → menyertakan `clientRef` bila ada.

- [ ] **Step 1: Tes gagal** — tambahkan di akhir `server/tests/field-logic.test.js`:

```js
describe('Plan 3B logic', () => {
  it('newRef is long and unique', () => {
    const a = L.newRef(); const b = L.newRef();
    expect(a.length).toBeGreaterThanOrEqual(16); expect(a).not.toBe(b);
  });
  const custs = [
    { id: '1', name: 'Warung Bu Sari', code: 'C-0516', phone: '0812', lat: 1, lng: 2, locationPhotoId: null, sisaBon: 126000, fixedDays: false, active: true },
    { id: '2', name: 'Hotel Sanur Asri', code: 'C-0402', phone: '0813', lat: 1, lng: 2, locationPhotoId: 'p', sisaBon: 0, fixedDays: true, active: true },
    { id: '3', name: 'Pak Wayan', code: 'C-0511', phone: '', lat: null, lng: null, locationPhotoId: null, sisaBon: 45000, fixedDays: false, active: true },
  ];
  it('customerList: counts, filters, search by name / code / phone digits, sorted by name', () => {
    const all = L.customerList(custs, { q: '', filter: 'all' });
    expect(all.counts).toEqual({ all: 3, warn: 2, bon: 2, fixed: 1 });
    expect(all.rows.map((r) => r.id)).toEqual(['2', '3', '1']);
    expect(L.customerList(custs, { filter: 'warn' }).rows.map((r) => r.id)).toEqual(['3', '1']);
    expect(L.customerList(custs, { filter: 'fixed' }).rows.map((r) => r.id)).toEqual(['2']);
    expect(L.customerList(custs, { q: 'c-0511' }).rows.map((r) => r.id)).toEqual(['3']);
    expect(L.customerList(custs, { q: '0813' }).rows.map((r) => r.id)).toEqual(['2']);
  });
  it('openBons: payments settle the oldest bon first', () => {
    const txns = [
      { id: 'p1', txnDate: '2026-09-25', method: 'pelunasan', amount: 9000, status: 'active' },
      { id: 'b2', txnDate: '2026-09-23', method: 'bon', qty: 3, effectiveAmount: 54000, status: 'active' },
      { id: 'b1', txnDate: '2026-09-16', method: 'bon', qty: 1, effectiveAmount: 18000, status: 'active' },
      { id: 'bv', txnDate: '2026-09-10', method: 'bon', qty: 9, effectiveAmount: 99000, status: 'void' },
    ];
    expect(L.openBons(txns)).toEqual([
      { id: 'b1', txnDate: '2026-09-16', qty: 1, amount: 9000, partial: true },
      { id: 'b2', txnDate: '2026-09-23', qty: 3, amount: 54000, partial: false },
    ]);
  });
  it('payPreview: never more than the bon', () => {
    expect(L.payPreview({ sisaBon: 45000, pay: 20000 })).toEqual({ rest: 25000, over: 0, ok: true });
    expect(L.payPreview({ sisaBon: 45000, pay: 50000 })).toEqual({ rest: 0, over: 5000, ok: false });
    expect(L.payPreview({ sisaBon: 45000, pay: 0 }).ok).toBe(false);
  });
  it('adjustBody maps the shown reason to the server list and keeps the shown words in the note', () => {
    expect(L.adjustBody({ counted: 8, reasonKey: 'fld.adj_kembali', reasonLabel: 'Dikembalikan pelanggan', note: '2 galon', photo: { id: 'p9' } }))
      .toEqual({ value: 8, reason: 'rekonsiliasi_fisik', note: 'Dikembalikan pelanggan · 2 galon', evidenceUrl: 'p9' });
    expect(L.adjustBody({ counted: 5, reasonKey: 'fld.adj_salah', reasonLabel: 'Salah input kemarin', note: '', photo: null }))
      .toEqual({ value: 5, reason: 'salah_input', note: 'Salah input kemarin' });
  });
  it('damagePreview explains instead of failing', () => {
    expect(L.damagePreview({ qty: 2, price: 45000, held: 6, payMethod: 'tunai' })).toEqual({ total: 90000, heldAfter: 4, blocked: '', totalKey: 'fld.cashIn' });
    expect(L.damagePreview({ qty: 1, price: 0, held: 6, payMethod: 'tunai' }).blocked).toBe('fld.dmgNoPrice');
    expect(L.damagePreview({ qty: 1, price: 45000, held: 0, payMethod: 'bon' }).blocked).toBe('fld.dmgNoHeld');
    expect(L.damagePreview({ qty: 1, price: 45000, held: 3, payMethod: 'bon' }).totalKey).toBe('fld.toBon');
  });
  it('expenseBody: cash is implied, fuel litres + odometer go into the note', () => {
    expect(L.expenseBody({ category: 'bensin', amount: 150000, liters: '15', odometer: '45210', note: 'Pertalite', photo: { id: 'p1' } }))
      .toEqual({ amount: 150000, category: 'bensin', note: '15 L · odometer 45210 km · Pertalite', photoId: 'p1' });
    expect(L.expenseBody({ category: 'parkir', amount: 5000, note: '', photo: null })).toEqual({ amount: 5000, category: 'parkir', note: '' });
  });
  it('pinMove: metres from the phone and the 150 m warning', () => {
    expect(L.pinMove({ device: null, pin: { lat: 1, lng: 1 } })).toEqual({ meters: null, far: false });
    const near = L.pinMove({ device: { lat: -8.65, lng: 115.2 }, pin: { lat: -8.6505, lng: 115.2 } });
    expect(near.meters).toBeGreaterThan(50); expect(near.meters).toBeLessThan(60); expect(near.far).toBe(false);
    expect(L.pinMove({ device: { lat: -8.65, lng: 115.2 }, pin: { lat: -8.652, lng: 115.2 } }).far).toBe(true);
  });
  it('addStopCandidates: today\'s stops without a pin + active customers not on today\'s board', () => {
    const board = [{ id: 's1', customerId: '3', status: 'pending', lat: null, lng: null }, { id: 's2', customerId: '1', status: 'pending', lat: 1, lng: 2 }];
    const r = L.addStopCandidates({ board, customers: custs.concat([{ id: '4', name: 'Nonaktif', active: false }]), q: '' });
    expect(r.noPin.map((s) => s.id)).toEqual(['s1']);
    expect(r.others.map((c) => c.id)).toEqual(['2']);
    expect(L.addStopCandidates({ board, customers: custs, q: 'zzz' }).others).toEqual([]);
  });
  it('a manual sale (no stop) is created once and never marks a stop', async () => {
    let marks = 0;
    const api = { createSale: () => Promise.resolve({ id: 't1' }), markStop: () => { marks += 1; return Promise.resolve(); } };
    expect(await L.recordSale(api, { stopId: null, body: {} })).toEqual({ txnId: 't1', done: true });
    expect(marks).toBe(0);
    expect(L.saleBody({ customerId: 'c', qty: 1, gallonIn: 0, method: 'lunas', photo: null, clientRef: 'r-123456789' }).clientRef).toBe('r-123456789');
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-logic.test.js` → FAIL.

- [ ] **Step 3: Implementasi** — di `dist-field-logic.js`:
  - di `saleBody`, sebelum `return b;` tambahkan `if (o.clientRef) b.clientRef = String(o.clientRef);`;
  - di `recordSale`, ganti baris pertama `var txnP = …` dengan:

```js
    var txnP = o.txnId ? Promise.resolve({ id: o.txnId }) : api.createSale(o.body);
    // A manual sale (from Catat, no stop): just create it — nothing to mark.
    if (!o.stopId) return txnP.then(function (t) { return { txnId: t.id, done: true }; });
```

  - tambahkan sebelum `// TUTUP HARI —`:

```js
  // ── PLAN 3B: customers + manual inputs ──
  function newRef() {
    var rnd = '';
    try { var a = new Uint32Array(2); (root.crypto || globalThis.crypto).getRandomValues(a); rnd = a[0].toString(36) + a[1].toString(36); } catch (e) { rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
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
  // the server computes the real balance).
  function openBons(transactions) {
    var live = (transactions || []).filter(function (t) { return t.status !== 'void' && t.kind !== 'ganti_rugi_x'; });
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
    var b = { amount: Math.max(0, Math.round(num(o.amount))), category: String(o.category || ''), note: parts.join(' · ').slice(0, 300) };
    if (o.photo && o.photo.id) b.photoId = o.photo.id;
    return b;
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
    var q = String(o.q || '').trim();
    var others = customerList((o.customers || []).filter(function (c) { return !onBoard[c.id]; }), { q: q, filter: 'all' }).rows;
    return { noPin: noPin, others: others };
  }
```

  - `factory()` saat ini tidak menerima `root`: ubah pembungkus agar meneruskannya — `var api = factory(root);` dan `function (root) {` pada factory (sama seperti `dist-field-api.js`).
  - tambahkan ke objek `return`: `newRef: newRef, customerList: customerList, openBons: openBons, payPreview: payPreview, ADJ_REASON_KEYS: ADJ_REASON_KEYS, adjustBody: adjustBody, damagePreview: damagePreview, expenseBody: expenseBody, pinMove: pinMove, addStopCandidates: addStopCandidates`.
  - Catatan: `openBons` memfilter `kind !== 'ganti_rugi_x'` hanya sebagai jaga-jaga nama; ganti rugi lewat bon **termasuk** bon pelanggan (spec 3.6: ikut Sisa Bon), jadi baris `ganti_rugi` ber-`method:'bon'` ikut dihitung. Hapus syarat `kind` itu bila mengganggu dan catat ruling.

- [ ] **Step 4: Jalankan** — `jest tests/field-logic.test.js` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(distribusi): field logic for customers, bon payments, adjustments, damage, expenses, pin moves, add-stop"`

---

### Task 4: Kit — uang, pemilih pelanggan, izin aksi, pelanggan dari stop; shell meneruskan izin

**Files:**
- Modify: `dist-field-kit.jsx`, `dist-field.css`, `finance-shell.jsx` (prop `perms`), `finance-i18n.js`
- Test: `server/tests/field-kit-static.test.js`, `server/tests/field-shell-integration.test.js` (tambah)

**Interfaces:**
- Produces (global bundel):
  - `fldCan(perms) → { sale, bon, damage, adjust, expense, addStop, location }` (boolean):
    - `sale`, `bon`, dan `damage` = `distribusiInput`;
    - `adjust` = `distribusiPenyesuaianGalon`;
    - `expense` = `distribusiExpense`;
    - `addStop` = `distribusiOrder`;
    - `location` = `distribusiLokasiSimpan`.
  - `fldCustFromStop(stop) → cust` dengan field `{ id, name, code, address, phone, lat, lng, locationPhotoId, masterPrice, sisaBon, gallonsHeld, armada }`.
  - `FldMoney({ label, value, onChange })`: nominal rupiah. Nilainya angka; tampilannya `45.000`; bisa dikosongkan.
  - `FldPickCustomer({ api, title, hint, accept(c)→''|key, onPick(c), onBack })`: layar pencarian pelanggan. `accept` mengembalikan kunci alasan bila pelanggan tidak bisa dipilih (misalnya belum ada bon). Baris tersebut tetap tampil tetapi mati, dengan alasannya.
  - Shell: `<window.FIELD.App … perms={p} />`.

- [ ] **Step 1: Tes gagal** — tambahkan di `server/tests/field-kit-static.test.js`:

```js
describe('Plan 3B kit', () => {
  it('actions follow the server caps (no button that ends in a 403)', () => {
    const f = kit.slice(kit.indexOf('const fldCan ='));
    expect(f).toMatch(/sale: !!p\.distribusiInput/);
    expect(f).toMatch(/bon: !!p\.distribusiInput/);
    expect(f).toMatch(/damage: !!p\.distribusiInput/);
    expect(f).toMatch(/adjust: !!p\.distribusiPenyesuaianGalon/);
    expect(f).toMatch(/expense: !!p\.distribusiExpense/);
    expect(f).toMatch(/addStop: !!p\.distribusiOrder/);
    expect(f).toMatch(/location: !!p\.distribusiLokasiSimpan/);
  });
  it('the customer picker searches with the shared list logic and explains disabled rows', () => {
    const f = kit.slice(kit.indexOf('function FldPickCustomer('));
    expect(f).toMatch(/FIELDLOGIC\.customerList\(/);
    expect(f).toMatch(/const why = accept \? accept\(c\) : '';/);
    expect(f).toMatch(/disabled=\{!!why\}/);
  });
  it('money input can be cleared and shows thousands', () => {
    const f = kit.slice(kit.indexOf('function FldMoney('));
    expect(f).toMatch(/toLocaleString\('id-ID'\)/);
    expect(f).toMatch(/inputMode="numeric"/);
  });
});
```

dan di `server/tests/field-shell-integration.test.js`:

```js
it('the field UI receives the user\'s caps (to show only the actions they may use)', () => {
  expect(shell).toMatch(/<window\.FIELD\.App user=\{user\} perms=\{p\} pref=\{fieldPref\}/);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-kit-static.test.js tests/field-shell-integration.test.js` → FAIL.

- [ ] **Step 3: Kit** — tambahkan di akhir `dist-field-kit.jsx`:

```jsx
// Which field actions this account may use — the same caps the server checks, so a button never ends
// in a 403.
const fldCan = (perms) => {
  const p = perms || {};
  return {
    sale: !!p.distribusiInput, bon: !!p.distribusiInput, damage: !!p.distribusiInput,
    adjust: !!p.distribusiPenyesuaianGalon, expense: !!p.distribusiExpense,
    addStop: !!p.distribusiOrder, location: !!p.distribusiLokasiSimpan,
  };
};
// The customer behind a board stop, in the shape the customer screens use.
const fldCustFromStop = (s) => ({
  id: s.customerId, name: s.customerName, code: s.customerCode || '', address: s.address || '', phone: s.phone || '',
  lat: s.lat, lng: s.lng, locationPhotoId: s.locationPhotoId || null, masterPrice: s.masterPrice || 0,
  sisaBon: s.sisaBon || 0, gallonsHeld: s.gallonsHeld, armada: s.fleetId || '',
});

// Rupiah amount: shows 45.000, can be cleared while typing (value null = nothing typed yet).
function FldMoney({ label, value, onChange }) {
  const shown = value == null ? '' : Number(value).toLocaleString('id-ID');
  return (
    <label className="mlap-field mlap-money">
      <span className="lb">{label}</span>
      <span className="mlap-money-in"><span className="sb">Rp</span>
        <input className="mlap-input" inputMode="numeric" aria-label={label} value={shown} onChange={(e) => { const d = String(e.target.value).replace(/[^0-9]/g, '').slice(0, 10); onChange(d === '' ? null : parseInt(d, 10)); }} />
      </span>
    </label>
  );
}

// PILIH PELANGGAN — search the armada's customers; `accept(c)` returns '' or the key saying why this
// customer can't be chosen for this action (the row stays visible, disabled, with the reason).
function FldPickCustomer({ api, title, hint, accept, onPick, onBack }) {
  const [list, setList] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  uEfl(() => { let live = true; api.customers().then((r) => { if (live) setList(r || []); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api]);
  const rows = list ? FIELDLOGIC.customerList(list, { q, filter: 'all' }).rows : [];
  return (
    <div className="mlap-screen">
      <FldTop title={title} sub={hint} onBack={onBack} />
      <div className="mlap-body">
        <input className="mlap-text mlap-search" type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} />
        {err ? <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /> : null}
        {!list && !err ? <div className="mlap-empty">{trFl('fld.loading')}</div> : null}
        {list ? (
          <div className="mlap-card">
            {rows.length ? rows.map((c) => {
              const why = accept ? accept(c) : '';
              return (
                <button key={c.id} type="button" className="mlap-row mlap-rowbtn" disabled={!!why} onClick={() => onPick(c)}>
                  <span className="mlap-grow"><span className="nm">{c.name}</span><span className="sb">{why ? trFl(why) : [c.code, c.sisaBon > 0 ? trFl('fld.bonTag', { v: FIELDLOGIC.fmtRp(c.sisaBon) }) : ''].filter(Boolean).join(' · ')}</span></span>
                </button>
              );
            }) : <div className="mlap-empty">{trFl('fld.emptySeg')}</div>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: CSS** — tambahkan ke `dist-field.css` sebelum `@keyframes mlapFade`:

```css
/* ── KIT 3B ── */
.mlap-money-in { display: inline-flex; align-items: center; gap: 6px; }
.mlap-money .mlap-input { width: 150px; }
.mlap-search { min-height: 48px; }
.mlap-rowbtn:disabled { opacity: .55; cursor: not-allowed; }
.mlap-step, .mlap-chip-b, .mlap-seg-b { min-height: 44px; }
```

- [ ] **Step 5: Shell** — di `finance-shell.jsx`, ganti `<window.FIELD.App user={user} pref={fieldPref}` dengan `<window.FIELD.App user={user} perms={p} pref={fieldPref}`.

- [ ] **Step 6: Kunci i18n** — tulis `<scratchpad>/fld-keys.js` (bila belum ada; isi persis):

```js
// Usage: node fld-keys.js <keys.json>   (run from the repo root). keys.json = { "en": {...}, "id": {...} }
const fs = require('fs');
const keys = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const p = 'finance-i18n.js'; let s = fs.readFileSync(p, 'utf8');
const q = (v) => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const line = (o) => ' ' + Object.keys(o).map((k) => q(k) + ': ' + q(o[k])).join(', ') + ',';
Object.keys(keys.en).concat(Object.keys(keys.id)).forEach((k) => { if (s.includes(q(k) + ':')) throw new Error('key exists: ' + k); });
if (Object.keys(keys.en).sort().join() !== Object.keys(keys.id).sort().join()) throw new Error('EN and ID key sets differ');
[["'fld.tryNew': 'Try the new view (demo)',", keys.en], ["'fld.tryNew': 'Coba tampilan baru (demo)',", keys.id]].forEach(([anchor, o]) => {
  if (s.split(anchor).length !== 2) throw new Error('anchor ' + anchor);
  s = s.replace(anchor, anchor + line(o));
});
fs.writeFileSync(p, s); console.log('ok', Object.keys(keys.en).length);
```

`<scratchpad>/keys-3b-t4.json`:

```json
{
  "en": { "fld.searchCust": "Search customer (name, code, number)" },
  "id": { "fld.searchCust": "Cari pelanggan (nama, kode, nomor)" }
}
```

Jalankan dari root: `node <scratchpad>/fld-keys.js <scratchpad>/keys-3b-t4.json`.

- [ ] **Step 7: Jalankan** — `jest tests/field-kit-static.test.js tests/field-shell-integration.test.js tests/field-shell-static.test.js` → PASS; `node build.mjs --no-minify` → sukses.

- [ ] **Step 8: Commit** — `git commit -am "feat(distribusi): field kit — caps per action, customer picker, money input; shell passes caps"` (tambahkan file tes).

---

### Task 5: Tab Pelanggan + sheet pelanggan (file baru `dist-field-cust.jsx`)

**Files:**
- Create: `dist-field-cust.jsx`
- Modify: `build.mjs` (FILES: `'dist-field-cust.jsx',` tepat setelah `'dist-field-day.jsx',`), `dist-field.css`, `finance-i18n.js`, `server/tests/field-shell-static.test.js` (daftar file lapangan di tes anti-bentrok + `allJsx`)
- Test: `server/tests/field-cust-static.test.js` (baru)

**Interfaces:**
- Produces:
  - `FldCustomers({ api, tick, onOpen(cust) })`: daftar, cari, filter.
  - `FldCustSheet({ cust, can, onClose, onAction(name, cust) })`: aksi `'sale' | 'bon' | 'adjust' | 'damage' | 'complete' | 'addStop'`, masing-masing hanya bila izinnya ada dan masuk akal:
    - `bon` hanya bila `sisaBon > 0`;
    - `damage` hanya bila `gallonsHeld > 0`;
    - `complete` hanya bila ada data yang belum lengkap.

- [ ] **Step 1: Tes gagal** — `server/tests/field-cust-static.test.js`:

```js
'use strict';
// FIELD CUSTOMER SCREENS (static): parse, ship after the day screens, use only the adaptor, keep the
// owner's rules, and every fld.* key literal exists in EN + ID.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const cust = read('dist-field-cust.jsx'); const build = read('build.mjs');
const fn = (name) => { const i = cust.indexOf('function ' + name + '('); expect(i).toBeGreaterThan(-1); const j = cust.indexOf('\nfunction ', i + 10); return cust.slice(i, j < 0 ? undefined : j); };

it('parses, ships after the day screens, never calls the server directly', () => {
  expect(() => parse(cust, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build).toMatch(/'dist-field-day\.jsx',\s*'dist-field-cust\.jsx',\s*'dist-field\.jsx',/);
  expect(cust).not.toMatch(/window\.API|fetch\(/);
});
it('every fld.* key written literally exists in EN and ID', () => {
  const i18n = read('finance-i18n.js');
  const keys = [...new Set([...cust.matchAll(/["'](fld\.[A-Za-z0-9_]+)["']/g)].map((m) => m[1]))];
  expect(keys.length).toBeGreaterThan(5);
  keys.forEach((k) => expect({ k, n: (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length }).toEqual({ k, n: 2 }));
});
describe('Pelanggan', () => {
  it('search + the four filters from the shared list logic', () => {
    const f = fn('FldCustomers');
    expect(f).toMatch(/FIELDLOGIC\.customerList\(list, \{ q, filter \}\)/);
    ['fld.f_all', 'fld.f_warn', 'fld.f_bon', 'fld.f_fixed'].forEach((k) => expect(f).toContain("'" + k + "'"));
  });
  it('the sheet only offers actions the account may use and that make sense', () => {
    const f = fn('FldCustSheet');
    expect(f).toMatch(/can\.bon && c\.sisaBon > 0/);
    expect(f).toMatch(/can\.damage && c\.gallonsHeld > 0/);
    expect(f).toMatch(/can\.location && c\.gaps\.count > 0/);
    expect(f).toMatch(/can\.addStop/);
  });
});
```

Di `server/tests/field-shell-static.test.js`, pada dua tempat yang mendaftar `['dist-field-kit.jsx', 'dist-field-day.jsx', 'dist-field.jsx']` (deklarasi `allJsx` dan tes anti-bentrok), tambahkan `'dist-field-cust.jsx'` setelah `'dist-field-day.jsx'`.

- [ ] **Step 2: Jalankan, pastikan gagal** — `jest tests/field-cust-static.test.js` → FAIL (file belum ada).

- [ ] **Step 3: Tulis `dist-field-cust.jsx`**

```jsx
/* MODE LAPANGAN — CUSTOMER SCREENS + MANUAL INPUTS: Pelanggan, customer sheet, Lengkapi data, Atur titik,
   Tambah stop, Pembayaran bon, Penyesuaian galon, Ganti rugi galon, Pengeluaran. Every read/write goes
   through the adaptor `api` the shell hands in (real server or this phone's practice copy) — never the
   server directly. Owner rules kept here: a proof photo for every money-in and damage charge and every
   expense; expenses always cash from the deposit; gallon adjustments wait for the office; a pin moved
   more than 150 m from the phone asks to confirm. */

function FldCustomers({ api, tick, onOpen }) {
  const [list, setList] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  const [filter, setFilter] = uSfl('all');
  uEfl(() => { let live = true; setErr(null); api.customers().then((r) => { if (live) setList(r || []); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api, tick]);
  if (err) return <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!list) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const v = FIELDLOGIC.customerList(list, { q, filter });
  return (
    <>
      <input className="mlap-text mlap-search" type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} />
      <FldSeg label={trFl('fld.filter')} value={filter} onChange={setFilter} options={[['all', trFl('fld.f_all', { n: v.counts.all })], ['warn', trFl('fld.f_warn', { n: v.counts.warn })], ['bon', trFl('fld.f_bon', { n: v.counts.bon })], ['fixed', trFl('fld.f_fixed', { n: v.counts.fixed })]]} />
      <div className="mlap-card">
        {v.rows.length ? v.rows.map((c) => (
          <button key={c.id} type="button" className="mlap-row mlap-rowbtn" onClick={() => onOpen(c)}>
            <span className="mlap-ava" aria-hidden="true">{String(c.name || '?').split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join('').toUpperCase()}</span>
            <span className="mlap-grow">
              <span className="nm">{c.name}</span>
              <span className="sb">{[c.code, (c.deliveryDays || []).join(' · ')].filter(Boolean).join(' · ')}</span>
              {c.gaps.count > 0 ? <span className="mlap-gapline">{[c.gaps.titik ? trFl('fld.gapTitik') : '', c.gaps.wa ? trFl('fld.gapWa') : '', c.gaps.foto ? trFl('fld.gapFoto') : ''].filter(Boolean).join(' · ')}</span> : null}
            </span>
            <span className="mlap-legleft">
              {c.sisaBon > 0 ? <b className="mlap-bontxt">{FIELDLOGIC.fmtRp(c.sisaBon)}</b> : <span className="sb">{trFl('fld.noBon')}</span>}
              <span className="sb">{trFl('fld.nGalon', { n: c.gallonsHeld || 0 })}</span>
            </span>
          </button>
        )) : <div className="mlap-empty">{trFl('fld.noCustFilter')}</div>}
      </div>
    </>
  );
}

function FldCustSheet({ cust: c0, can, onClose, onAction }) {
  const c = Object.assign({}, c0, { gaps: c0.gaps || FIELDLOGIC.gapsOf(c0) });
  const links = fldLinks(c);
  const acts = [];
  if (can.sale) acts.push(['sale', 'fld.catatSale', 'primary']);
  if (can.bon && c.sisaBon > 0) acts.push(['bon', 'fld.catatBon', '']);
  if (can.location && c.gaps.count > 0) acts.push(['complete', 'fld.completeData', '']);
  if (can.addStop) acts.push(['addStop', 'fld.addToday', '']);
  if (can.adjust) acts.push(['adjust', 'fld.catatAdj', '']);
  if (can.damage && c.gallonsHeld > 0) acts.push(['damage', 'fld.catatDmg', '']);
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={c.name}>
        <div className="mlap-grab" />
        <h2>{c.name}</h2>
        <p>{[c.code, c.address].filter(Boolean).join(' · ')}</p>
        <div className="mlap-links">
          <a className={'mlap-btn' + (links.nav ? '' : ' off')} href={links.nav || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.nav}>{trFl('fld.navigate')}</a>
          <a className={'mlap-btn' + (links.tel ? '' : ' off')} href={links.tel || undefined} aria-disabled={!links.tel}>{trFl('fld.call')}</a>
          <a className={'mlap-btn' + (links.wa ? '' : ' off')} href={links.wa || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.wa}>{trFl('fld.wa')}</a>
        </div>
        <div className="mlap-card mlap-facts">
          <div><span className="sb">{trFl('fld.bonNow')}</span><b>{FIELDLOGIC.fmtRp(c.sisaBon || 0)}</b></div>
          <div><span className="sb">{trFl('fld.heldAt')}</span><b>{c.gallonsHeld == null ? '—' : c.gallonsHeld}</b></div>
          <div><span className="sb">{trFl('fld.dataLabel')}</span><b>{trFl('fld.dataN', { n: 3 - c.gaps.count })}</b></div>
        </div>
        <div className="mlap-actlist">
          {acts.map(([k, key, tone]) => <button key={k} type="button" className={'mlap-btn mlap-wide ' + tone} onClick={() => onAction(k, c)}>{trFl(key)}</button>)}
        </div>
      </div>
    </>
  );
}
```

Di `build.mjs` `FILES`: `'dist-field-cust.jsx',` tepat setelah `'dist-field-day.jsx',`.

- [ ] **Step 4: CSS** — tambahkan ke `dist-field.css` sebelum `@keyframes mlapFade`:

```css
/* ── PELANGGAN ── */
.mlap-ava { width: 36px; height: 36px; border-radius: 12px; flex-shrink: 0; display: grid; place-items: center; background: var(--mlap-accent-soft); color: var(--mlap-accent); font-size: 13px; font-weight: 800; }
.mlap-gapline { font-size: 12px; font-weight: 600; color: var(--mlap-warn); }
.mlap-actlist { display: flex; flex-direction: column; gap: 8px; }
```

- [ ] **Step 5: Kunci i18n** — `<scratchpad>/keys-3b-t5.json` lalu `node <scratchpad>/fld-keys.js <scratchpad>/keys-3b-t5.json`:

```json
{
  "en": { "fld.f_all": "All {n}", "fld.f_warn": "Incomplete {n}", "fld.f_bon": "Has bon {n}", "fld.f_fixed": "Fixed days {n}", "fld.gapTitik": "no pin", "fld.gapWa": "no WhatsApp", "fld.gapFoto": "no location photo", "fld.noBon": "no bon", "fld.noCustFilter": "No customers for this filter.", "fld.completeData": "Complete the data", "fld.addToday": "Add to today's deliveries", "fld.dataLabel": "Data", "fld.dataN": "{n}/3 complete" },
  "id": { "fld.f_all": "Semua {n}", "fld.f_warn": "Belum lengkap {n}", "fld.f_bon": "Ada bon {n}", "fld.f_fixed": "Hari tetap {n}", "fld.gapTitik": "tanpa titik", "fld.gapWa": "tanpa WA", "fld.gapFoto": "tanpa foto lokasi", "fld.noBon": "tanpa bon", "fld.noCustFilter": "Tidak ada pelanggan untuk filter ini.", "fld.completeData": "Lengkapi data", "fld.addToday": "Tambah ke pengiriman hari ini", "fld.dataLabel": "Data", "fld.dataN": "{n}/3 lengkap" }
}
```

- [ ] **Step 6: Jalankan** — `jest tests/field-cust-static.test.js tests/field-shell-static.test.js` → PASS; `node build.mjs --no-minify` → sukses.

- [ ] **Step 7: Commit** — `git add dist-field-cust.jsx build.mjs dist-field.css finance-i18n.js server/tests/field-cust-static.test.js server/tests/field-shell-static.test.js && git commit -m "feat(distribusi): field Pelanggan tab (search, 4 filters) + customer sheet with cap-aware actions"`

---

### Task 6: Lengkapi data + Atur titik lokasi (pin bisa digeser)

**Files:**
- Modify: `dist-field-cust.jsx` (tambah `FldComplete`, `FldPinMap`), `dist-field.css`, `finance-i18n.js`
- Test: `server/tests/field-cust-static.test.js` (tambah)

**Interfaces:**
- Consumes: `fldGeo`, `FldPhoto`, `znLoadLeaflet`, `FIELDLOGIC.pinMove`, adaptor `setLocation/setPhone/setLocationPhoto`.
- Produces:
  - `FldComplete({ api, cust, can, onPin(cust), onDone(msg), onBack })`. Ada tiga bagian:
    - titik lokasi: "Pakai lokasi saya sekarang" atau "Geser di peta";
    - WA: input `08…`;
    - foto lokasi.
    
    Satu tombol "Simpan" menyimpan bagian yang berubah, urut: titik, WA, foto.
  - `FldPinMap({ api, cust, onDone(msg), onBack })`:
    - pin Leaflet `draggable` di titik lama, atau di GPS HP bila belum ada titik;
    - lingkaran akurasi GPS dan pin "titik lama";
    - jarak dari HP ditampilkan; lebih dari 150 m → konfirmasi;
    - simpan memanggil `setLocation(id, { lat, lng, method:'geser', deviceLat, deviceLng, deviceAccuracy, accuracy })`;
    - peta gagal dimuat → tombol "Pakai lokasi saya sekarang".

- [ ] **Step 1: Tes gagal** — tambahkan di `server/tests/field-cust-static.test.js`:

```js
describe('Lengkapi + Atur titik', () => {
  it('Lengkapi saves only what changed: GPS pin (method gps), WhatsApp, location photo', () => {
    const f = fn('FldComplete');
    expect(f).toMatch(/api\.setLocation\(c\.id, \{ lat: gps\.lat, lng: gps\.lng, accuracy: gps\.accuracy, method: 'gps' \}\)/);
    expect(f).toMatch(/api\.setPhone\(c\.id, wa\)/);
    expect(f).toMatch(/api\.setLocationPhoto\(c\.id, photo\.id\)/);
    expect(f).toMatch(/onPin\(c\)/);
  });
  it('Atur titik: draggable pin, device fix + accuracy circle, >150 m asks to confirm, saved as a drag with the device fix', () => {
    const f = fn('FldPinMap');
    expect(f).toMatch(/draggable: true/);
    expect(f).toMatch(/L\.circle\(/);
    expect(f).toMatch(/FIELDLOGIC\.pinMove\(\{ device: dev, pin \}\)/);
    expect(f).toMatch(/if \(mv\.far && !confirmFar\) \{ setAskFar\(true\); return; \}/);
    expect(f).toMatch(/method: 'geser', deviceLat: dev \? dev\.lat : undefined/);
    expect(f).toMatch(/\.catch\(\(\) => \{ if \(live\) setMapErr\(true\); \}\)/);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: Tambahkan di akhir `dist-field-cust.jsx`**

```jsx
// LENGKAPI DATA — the three things a route needs from a customer: a location pin (from this phone's
// GPS, or dragged on the map), a WhatsApp number, a location photo. "Simpan" saves only what changed.
function FldComplete({ api, cust: c, onPin, onDone, onBack }) {
  const g = FIELDLOGIC.gapsOf(c);
  const [gps, setGps] = uSfl(null);
  const [locBusy, setLocBusy] = uSfl(false);
  const [wa, setWa] = uSfl(c.phone || '');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const takeGps = () => { setLocBusy(true); setErr(''); fldGeo(12000).then((p) => { setLocBusy(false); if (p) setGps(p); else setErr(trFl('fld.noGps')); }); };
  const changed = !!gps || (wa.trim() !== String(c.phone || '').trim() && wa.trim() !== '') || !!photo;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (gps) await api.setLocation(c.id, { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy, method: 'gps' });
      if (wa.trim() && wa.trim() !== String(c.phone || '').trim()) await api.setPhone(c.id, wa);
      if (photo) await api.setLocationPhoto(c.id, photo.id);
      onDone(trFl('fld.dataSaved', { name: c.name }));
    } catch (e) { setErr(fldErrMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.completeT')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-card mlap-sec">
          <div className="mlap-check"><span className={'mlap-dot ' + (g.titik && !gps ? 'miss' : 'ok')} aria-hidden="true">{g.titik && !gps ? '!' : '✓'}</span><span className="mlap-grow"><b>{trFl('fld.chkTitik')}</b><span className="sb">{gps ? trFl('fld.gpsTaken', { m: Math.round(gps.accuracy || 0) }) : (g.titik ? trFl('fld.pinNeeded') : trFl('fld.pinHave'))}</span></span></div>
          <div className="mlap-actions">
            <button type="button" className="mlap-btn" disabled={locBusy} onClick={takeGps}>{locBusy ? trFl('fld.locating') : trFl('fld.useMyLoc')}</button>
            <button type="button" className="mlap-btn" onClick={() => onPin(c)}>{trFl('fld.dragOnMap')}</button>
          </div>
          <span className="sb">{trFl('fld.gpsDrift')}</span>
        </div>
        <div className="mlap-card mlap-sec">
          <div className="mlap-check"><span className={'mlap-dot ' + (g.wa && !wa.trim() ? 'miss' : 'ok')} aria-hidden="true">{g.wa && !wa.trim() ? '!' : '✓'}</span><span className="mlap-grow"><b>{trFl('fld.chkWa')}</b><span className="sb">{trFl('fld.waFor')}</span></span></div>
          <input className="mlap-text" type="tel" inputMode="tel" placeholder="08…" aria-label={trFl('fld.chkWa')} value={wa} onChange={(e) => setWa(e.target.value.slice(0, 20))} />
        </div>
        <div className="mlap-card mlap-sec">
          <div className="mlap-check"><span className={'mlap-dot ' + (g.foto && !photo ? 'miss' : 'ok')} aria-hidden="true">{g.foto && !photo ? '!' : '✓'}</span><span className="mlap-grow"><b>{trFl('fld.chkFoto')}</b></span></div>
          <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.locPhotoHint" />
        </div>
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !changed} onClick={save}>{trFl('fld.saveCust')}</button>
      </div>
    </div>
  );
}

// ATUR TITIK LOKASI — a draggable pin over the map. The phone's own GPS fix (with its accuracy circle)
// and the old pin are shown; a pin moved > 150 m from the phone asks to confirm. Saved as a "geser" with
// the device fix, so the history says how far it was moved from the phone's GPS.
function FldPinMap({ api, cust: c, onDone, onBack }) {
  const had = typeof c.lat === 'number' && typeof c.lng === 'number';
  const [dev, setDev] = uSfl(null);
  const [pin, setPin] = uSfl(had ? { lat: c.lat, lng: c.lng } : null);
  const [mapErr, setMapErr] = uSfl(false);
  const [askFar, setAskFar] = uSfl(false);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const [mapReady, setMapReady] = uSfl(false);   // the phone's fix may arrive before or after the map
  const mapEl = uRfl(null);
  const mapRef = uRfl(null);
  const markRef = uRfl(null);
  uEfl(() => { let live = true; fldGeo(12000).then((p) => { if (!live) return; setDev(p); if (p) setPin((cur) => cur || { lat: p.lat, lng: p.lng }); }); return () => { live = false; }; }, []);
  uEfl(() => {
    if (!pin || !mapEl.current || mapRef.current) return undefined;
    let live = true;
    znLoadLeaflet().then((L) => {
      if (!live || !mapEl.current) return;
      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true });
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      if (had) L.circleMarker([c.lat, c.lng], { radius: 7, color: '#5B6B75', weight: 2, fillOpacity: 0.15, interactive: false }).addTo(map);
      const m = L.marker([pin.lat, pin.lng], { draggable: true, keyboard: true, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [30, 30], html: '<span class="mlap-pin drag">●</span>' }) }).addTo(map);
      m.on('dragend', () => { const ll = m.getLatLng(); setPin({ lat: ll.lat, lng: ll.lng }); });
      markRef.current = m;
      map.setView([pin.lat, pin.lng], 18);
      setMapReady(true);
    }).catch(() => { if (live) setMapErr(true); });
    return () => { live = false; };
  }, [!!pin]);
  // the phone's fix + its accuracy circle, whichever of (fix, map) comes last
  uEfl(() => {
    if (!dev || !mapReady || !mapRef.current || !window.L) return undefined;
    const L = window.L;
    const circle = L.circle([dev.lat, dev.lng], { radius: Math.max(5, dev.accuracy || 0), color: '#065489', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(mapRef.current);
    const dot = L.circleMarker([dev.lat, dev.lng], { radius: 5, color: '#fff', weight: 2, fillColor: '#065489', fillOpacity: 1, interactive: false }).addTo(mapRef.current);
    return () => { circle.remove(); dot.remove(); };
  }, [dev, mapReady]);
  uEfl(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);
  const mv = FIELDLOGIC.pinMove({ device: dev, pin });
  const save = (confirmFar) => {
    if (!pin) return;
    if (mv.far && !confirmFar) { setAskFar(true); return; }
    setBusy(true); setErr('');
    api.setLocation(c.id, { lat: pin.lat, lng: pin.lng, accuracy: dev ? dev.accuracy : null, method: 'geser', deviceLat: dev ? dev.lat : undefined, deviceLng: dev ? dev.lng : undefined, deviceAccuracy: dev ? dev.accuracy : undefined })
      .then(() => onDone(trFl('fld.pinSaved', { name: c.name })))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.pinT')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        {mapErr ? <FldNotice tone="info" title={trFl('fld.mapOff')} sub={trFl('fld.pinNoMap')} /> : (pin ? <div ref={mapEl} className="mlap-map mlap-pinmap" role="application" aria-label={trFl('fld.pinT')} /> : <div className="mlap-empty">{trFl('fld.locating')}</div>)}
        <div className="mlap-hint">{trFl('fld.pinDrag')}</div>
        <div className="mlap-card mlap-sec">
          <div className="mlap-sumrow"><span>{trFl('fld.coords')}</span><b>{pin ? pin.lat.toFixed(6) + ', ' + pin.lng.toFixed(6) : '—'}</b></div>
          <div className="mlap-sumrow"><span>{dev ? trFl('fld.fromDevice', { m: Math.round(dev.accuracy || 0) }) : trFl('fld.noGps')}</span><b>{mv.meters == null ? '—' : trFl('fld.metersN', { m: mv.meters })}</b></div>
          {mv.far ? <div className="mlap-warnline">{trFl('fld.pinFar')}</div> : null}
        </div>
        {mapErr && dev ? <button type="button" className="mlap-btn mlap-wide" onClick={() => setPin({ lat: dev.lat, lng: dev.lng })}>{trFl('fld.useMyLoc')}</button> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !pin} onClick={() => save(false)}>{trFl('fld.savePin')}</button>
      </div>
      {askFar && <FldSheet title={trFl('fld.pinFarT', { m: mv.meters })} body={trFl('fld.pinFarB')} confirmLabel={trFl('fld.savePin')} onClose={() => setAskFar(false)} onConfirm={() => { setAskFar(false); save(true); }} />}
    </div>
  );
}
```

- [ ] **Step 4: CSS** — tambahkan ke `dist-field.css` sebelum `@keyframes mlapFade`:

```css
/* ── LENGKAPI + ATUR TITIK ── */
.mlap-sec { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.mlap-sec .mlap-check { padding: 0; }
.mlap-pinmap { height: 340px; }
.mlap-pin.drag { width: 30px; height: 30px; background: #C2410C; font-size: 14px; }
```

- [ ] **Step 5: Kunci i18n** — `<scratchpad>/keys-3b-t6.json` lalu jalankan helper:

```json
{
  "en": { "fld.completeT": "Complete customer data", "fld.noGps": "This phone gives no location (allow location access)", "fld.gpsTaken": "Taken from this phone (±{m} m)", "fld.pinNeeded": "Required for the route", "fld.pinHave": "Already set — you can correct it", "fld.locating": "Finding your location…", "fld.useMyLoc": "Use my location now", "fld.dragOnMap": "Drag on the map", "fld.gpsDrift": "Phone GPS can be off by tens of metres. Drag the pin onto the customer's house.", "fld.waFor": "for receipts and bills", "fld.locPhotoHint": "Front of the house, a landmark, or where gallons go.", "fld.saveCust": "Save customer data", "fld.dataSaved": "{name}: data saved", "fld.pinT": "Set location pin", "fld.pinNoMap": "Use the phone's location instead, then fine-tune later.", "fld.pinDrag": "Drag the pin onto the customer's roof or door.", "fld.coords": "Coordinates", "fld.fromDevice": "From this phone's GPS (±{m} m)", "fld.metersN": "{m} m away", "fld.pinFar": "More than 150 m from where this phone is — check before saving.", "fld.savePin": "Save this pin", "fld.pinFarT": "Pin is {m} m from your phone", "fld.pinFarB": "Is the customer really there? The distance is recorded in the location history.", "fld.pinSaved": "{name}: location pin saved" },
  "id": { "fld.completeT": "Lengkapi data pelanggan", "fld.noGps": "HP ini tidak memberi lokasi (izinkan akses lokasi)", "fld.gpsTaken": "Diambil dari HP ini (±{m} m)", "fld.pinNeeded": "Wajib untuk rute", "fld.pinHave": "Sudah ada — bisa dikoreksi", "fld.locating": "Mencari lokasi Anda…", "fld.useMyLoc": "Pakai lokasi saya sekarang", "fld.dragOnMap": "Geser di peta", "fld.gpsDrift": "GPS HP bisa meleset puluhan meter. Geser pin tepat ke rumah pelanggan.", "fld.waFor": "untuk nota & tagihan", "fld.locPhotoHint": "Tampak depan, patokan, atau tempat taruh galon.", "fld.saveCust": "Simpan data pelanggan", "fld.dataSaved": "{name}: data tersimpan", "fld.pinT": "Atur titik lokasi", "fld.pinNoMap": "Pakai lokasi HP dulu, lalu rapikan nanti.", "fld.pinDrag": "Seret pin ke atap / pintu rumah pelanggan.", "fld.coords": "Koordinat", "fld.fromDevice": "Dari GPS perangkat (±{m} m)", "fld.metersN": "{m} m", "fld.pinFar": "Lebih dari 150 m dari posisi HP ini — periksa dulu sebelum menyimpan.", "fld.savePin": "Simpan titik ini", "fld.pinFarT": "Pin berjarak {m} m dari HP Anda", "fld.pinFarB": "Benar pelanggan ada di sana? Jaraknya tercatat di riwayat lokasi.", "fld.pinSaved": "{name}: titik lokasi tersimpan" }
}
```

- [ ] **Step 6: Jalankan** — `jest tests/field-cust-static.test.js tests/field-shell-static.test.js` → PASS; build sukses.

- [ ] **Step 7: Commit** — `git commit -am "feat(distribusi): field Lengkapi data + draggable location pin (device fix, >150 m confirm)"` (tambahkan file tes).

---

### Task 7: Tambah stop manual

**Files:**
- Modify: `dist-field-cust.jsx` (tambah `FldAddStop`), `dist-field.css`, `finance-i18n.js`
- Test: `server/tests/field-cust-static.test.js` (tambah)

**Interfaces:**
- Consumes: `FIELDLOGIC.addStopCandidates`, adaptor `board/customers/addStop`.
- Produces: `FldAddStop({ api, preset, onPin(cust), onDone(msg), onBack })`.
  - `preset` = pelanggan yang sudah dipilih dari sheet pelanggan (opsional).
  - Daftar "jadwal hari ini tanpa titik" punya tombol "Isi titik lokasi".
  - Memilih pelanggan tanpa titik menampilkan pesan "ditaruh di akhir daftar" dan tombol "Isi titik lokasi sekarang".
  - Jumlah galon ≥ 1.

- [ ] **Step 1: Tes gagal** — tambahkan:

```js
describe('Tambah stop', () => {
  it('lists today\'s stops without a pin and other customers; a customer without a pin is prompted to set it', () => {
    const f = fn('FldAddStop');
    expect(f).toMatch(/FIELDLOGIC\.addStopCandidates\(\{ board: d\.board, customers: d\.customers, q \}\)/);
    expect(f).toMatch(/onPin\(fldCustFromStop\(s\)\)/);
    expect(f).toMatch(/!pickHasPin && <FldNotice tone="warn"/);
    expect(f).toMatch(/api\.addStop\(\{ customerId: pick\.id, qty \}\)/);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: Tambahkan di akhir `dist-field-cust.jsx`**

```jsx
// TAMBAH STOP — a customer outside today's schedule (or ordered via WhatsApp) as an extra stop. Today's
// stops that have no pin are listed first: they can't join the route until the pin is set. A customer
// picked without a pin goes to the end of the list (not on the route) with a prompt to set it.
function FldAddStop({ api, preset, onPin, onDone, onBack }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  const [pick, setPick] = uSfl(preset || null);
  const [qty, setQty] = uSfl(1);
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  uEfl(() => { let live = true; Promise.all([api.board(), api.customers()]).then(([board, customers]) => { if (live) setD({ board, customers }); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api]);
  if (err) return <div className="mlap-screen"><FldTop title={trFl('fld.addStopT')} onBack={onBack} /><div className="mlap-body"><FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /></div></div>;
  if (!d) return <div className="mlap-screen"><FldTop title={trFl('fld.addStopT')} onBack={onBack} /><div className="mlap-empty">{trFl('fld.loading')}</div></div>;
  const cand = FIELDLOGIC.addStopCandidates({ board: d.board, customers: d.customers, q });
  const pickHasPin = !!pick && typeof pick.lat === 'number' && typeof pick.lng === 'number';
  const save = () => {
    setBusy(true); setMsg('');
    api.addStop({ customerId: pick.id, qty }).then(() => onDone(trFl('fld.stopAdded', { name: pick.name }))).catch((e) => setMsg(fldErrMsg(e))).finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.addStopT')} onBack={onBack} />
      <div className="mlap-body">
        {!pick && (
          <>
            {cand.noPin.length > 0 && (
              <>
                <div className="mlap-eyebrow">{trFl('fld.noPinToday')}</div>
                <div className="mlap-card">
                  {cand.noPin.map((s) => (
                    <div key={s.id} className="mlap-row">
                      <span className="mlap-grow"><span className="nm">{s.customerName}</span><span className="sb">{s.customerCode}</span></span>
                      <button type="button" className="mlap-btn" onClick={() => onPin(fldCustFromStop(s))}>{trFl('fld.setPin')}</button>
                    </div>
                  ))}
                </div>
              </>
            )}
            <input className="mlap-text mlap-search" type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mlap-card">
              {cand.others.length ? cand.others.slice(0, 60).map((c) => (
                <button key={c.id} type="button" className="mlap-row mlap-rowbtn" onClick={() => setPick(c)}>
                  <span className="mlap-grow"><span className="nm">{c.name}</span><span className="sb">{[c.code, c.address].filter(Boolean).join(' · ')}</span></span>
                  {c.gaps.titik ? <span className="mlap-tag held">{trFl('fld.gapTitik')}</span> : null}
                </button>
              )) : <div className="mlap-empty">{trFl('fld.emptySeg')}</div>}
            </div>
          </>
        )}
        {pick && (
          <>
            <div className="mlap-card mlap-sec">
              <b>{pick.name}</b>
              <span className="sb">{[pick.code, pick.address].filter(Boolean).join(' · ')}</span>
              <button type="button" className="mlap-btn" onClick={() => setPick(null)}>{trFl('fld.changeCust')}</button>
            </div>
            {!pickHasPin && <FldNotice tone="warn" title={trFl('fld.pickNoPinT', { name: pick.name })} sub={trFl('fld.pickNoPinB')} action={trFl('fld.setPinNow')} onAction={() => onPin(pick)} />}
            <div className="mlap-card"><FldStepper label={trFl('fld.qtyGalon')} value={qty} onChange={setQty} min={1} max={999} /></div>
            {msg && <div className="mlap-err" role="alert">{msg}</div>}
            <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || qty < 1} onClick={save}>{trFl('fld.addStopCta')}</button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Kunci i18n** — `<scratchpad>/keys-3b-t7.json` lalu jalankan helper:

```json
{
  "en": { "fld.addStopT": "Add a stop", "fld.noPinToday": "SCHEDULED TODAY, NOT ON THE ROUTE (NO PIN)", "fld.setPin": "Set pin", "fld.changeCust": "Change customer", "fld.pickNoPinT": "{name} has no location pin yet", "fld.pickNoPinB": "This stop goes to the end of the list and is not on the route. Set the pin when you get there so it joins the route from tomorrow.", "fld.setPinNow": "Set the pin now", "fld.qtyGalon": "Gallons", "fld.addStopCta": "Add to today's deliveries", "fld.stopAdded": "{name} added to today" },
  "id": { "fld.addStopT": "Tambah stop manual", "fld.noPinToday": "JADWAL HARI INI, TIDAK MASUK RUTE (TANPA TITIK)", "fld.setPin": "Isi titik", "fld.changeCust": "Ganti pelanggan", "fld.pickNoPinT": "{name} belum punya titik lokasi", "fld.pickNoPinB": "Stop ini ditaruh di akhir daftar dan tidak dihitung di rute. Isi titiknya saat Anda sampai di lokasi, supaya besok otomatis masuk rute.", "fld.setPinNow": "Isi titik lokasi sekarang", "fld.qtyGalon": "Jumlah galon", "fld.addStopCta": "Tambah ke pengiriman hari ini", "fld.stopAdded": "{name} ditambahkan ke hari ini" }
}
```

- [ ] **Step 5: Jalankan** — `jest tests/field-cust-static.test.js` → PASS; build sukses.

- [ ] **Step 6: Commit** — `git commit -am "feat(distribusi): field Tambah stop — no-pin stops first, pin prompt, quantity"` (tambahkan file tes).

---

### Task 8: Transaksi manual + Pembayaran bon (foto wajib, `clientRef`, bon tertua dulu)

**Files:**
- Modify: `dist-field-day.jsx` (`FldSale`: `clientRef`, stop opsional), `dist-field-cust.jsx` (tambah `FldPayBon`), `dist-field.css`, `finance-i18n.js`
- Test: `server/tests/field-day-static.test.js`, `server/tests/field-cust-static.test.js` (tambah)

**Interfaces:**
- `FldSale({ api, stop, pending, onDone, onBack })`:
  - `stop.id` boleh `null` untuk transaksi manual (`fldSaleStopFromCust(cust)`), yang tidak menandai stop apa pun;
  - setiap kunjungan layar membawa satu `clientRef` (`FIELDLOGIC.newRef()`), dikirim di `saleBody`.
- Produces:
  - `fldSaleStopFromCust(cust)` → `{ id: null, customerId, customerName, customerCode, masterPrice, sisaBon, gallonsHeld, planQty: 1 }`.
  - `FldPayBon({ api, cust, onDone(msg), onBack })`:
    - memuat `customerDetail` lalu menampilkan `FIELDLOGIC.openBons` (bon tertua dulu);
    - nominal dengan pintasan "Lunas semua", 50.000, dan 100.000;
    - Tunai/Transfer, foto wajib, `clientRef`;
    - tombol mati bila `!payPreview.ok`.

- [ ] **Step 1: Tes gagal** — tambahkan ke `server/tests/field-day-static.test.js`:

```js
describe('Plan 3B: sale screen', () => {
  it('every visit carries one clientRef (a retry after a lost response is never a second sale); a manual sale has no stop', () => {
    const f = fn('FldSale');
    expect(f).toMatch(/const refRef = uRfl\(FIELDLOGIC\.newRef\(\)\);/);
    expect(f).toMatch(/clientRef: refRef\.current/);
    expect(f).toMatch(/s\.id \? pending\.get\(s\.id\) : null/);
    expect(day).toMatch(/const fldSaleStopFromCust = \(c\) => \(\{ id: null, customerId: c\.id,/);
  });
});
```

dan ke `server/tests/field-cust-static.test.js`:

```js
describe('Pembayaran bon', () => {
  it('oldest bons first, never more than the bon, photo required, one clientRef per visit, cash or transfer', () => {
    const f = fn('FldPayBon');
    expect(f).toMatch(/FIELDLOGIC\.openBons\(/);
    expect(f).toMatch(/const pv = FIELDLOGIC\.payPreview\(\{ sisaBon: bon, pay \}\);/);
    expect(f).toMatch(/disabled=\{busy \|\| !pv\.ok \|\| !photo\}/);
    expect(f).toMatch(/clientRef: refRef\.current/);
    expect(f).toMatch(/\['tunai', trFl\('fld\.m_tunai'\)\], \['transfer', trFl\('fld\.m_transfer'\)\]/);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: `FldSale`** — di `dist-field-day.jsx`:
  - di atas `function FldSale(`, tambahkan:

```jsx
// A manual sale from Catat: no stop to mark — the same screen, `id: null`.
const fldSaleStopFromCust = (c) => ({ id: null, customerId: c.id, customerName: c.name, customerCode: c.code || '', masterPrice: c.masterPrice || 0, sisaBon: c.sisaBon || 0, gallonsHeld: c.gallonsHeld, planQty: 1 });
```

  - di dalam `FldSale`, ganti `const [txnId, setTxnId] = uSfl(() => pending.get(s.id));` dengan:

```jsx
  const [txnId, setTxnId] = uSfl(() => (s.id ? pending.get(s.id) : null));
  const refRef = uRfl(FIELDLOGIC.newRef());   // one per visit: a retry after a lost response returns the saved sale
```

  - ganti `const keep = (id) => { setTxnId(id); pending.set(s.id, id); };` dengan `const keep = (id) => { setTxnId(id); if (s.id) pending.set(s.id, id); };`
  - ganti `const body = FIELDLOGIC.saleBody({ customerId: s.customerId, qty, gallonIn: back, method, photo });` dengan `const body = FIELDLOGIC.saleBody({ customerId: s.customerId, qty, gallonIn: back, method, photo, clientRef: refRef.current });`
  - ganti `if (r.done) { pending.clear(s.id); …` dengan `if (r.done) { if (s.id) pending.clear(s.id); …`.

  Catatan: tes statis Rencana 3A `'a saved sale is never created twice'` memeriksa pola `const [txnId, setTxnId] = uSfl\(\(\) => pending\.get\(s\.id\)\);` dan `const keep = (id) => { setTxnId(id); pending.set(s.id, id); };` — perbarui kedua pola itu ke bentuk baru di atas (bagian dari tes Task ini).

- [ ] **Step 4: `FldPayBon`** — tambahkan di akhir `dist-field-cust.jsx`:

```jsx
// PEMBAYARAN BON — collect a customer's bon (cash or transfer) with a proof photo. The open bons are
// listed oldest first, as the payment settles them (view only — the server keeps the real balance).
function FldPayBon({ api, cust: c, onDone, onBack }) {
  const [detail, setDetail] = uSfl(null);
  const [pay, setPay] = uSfl(null);
  const [via, setVia] = uSfl('tunai');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const refRef = uRfl(FIELDLOGIC.newRef());
  uEfl(() => { let live = true; api.customerDetail(c.id).then((x) => { if (live) setDetail(x); }).catch(() => { if (live) setDetail({ transactions: [] }); }); return () => { live = false; }; }, [api, c.id]);
  const bon = detail && detail.sisaBon != null ? detail.sisaBon : (c.sisaBon || 0);
  const pv = FIELDLOGIC.payPreview({ sisaBon: bon, pay });
  const open = detail ? FIELDLOGIC.openBons(detail.transactions || []) : [];
  const save = () => {
    setBusy(true); setErr('');
    const body = { customerId: c.id, payAmount: pay, payMethod: via, clientRef: refRef.current, proofPhotoId: photo.id, proofTakenAt: photo.takenAt };
    if (typeof photo.lat === 'number' && typeof photo.lng === 'number') { body.proofLat = photo.lat; body.proofLng = photo.lng; }
    api.payBon(body).then(() => onDone(trFl('fld.paidDone', { name: c.name, v: FIELDLOGIC.fmtRp(pay) }))).catch((e) => setErr(fldErrMsg(e))).finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatBon')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-card mlap-sec"><span className="sb">{trFl('fld.bonNow')}</span><b className="mlap-bigrp">{FIELDLOGIC.fmtRp(bon)}</b></div>
        {open.length > 0 && (
          <div className="mlap-card">
            {open.map((b) => <div key={b.id} className="mlap-row"><span className="mlap-grow"><span className="nm">{b.txnDate}</span><span className="sb">{trFl('fld.nGalon', { n: b.qty })}{b.partial ? ' · ' + trFl('fld.partPaid') : ''}</span></span><b>{FIELDLOGIC.fmtRp(b.amount)}</b></div>)}
            <div className="mlap-hint">{trFl('fld.oldestFirst')}</div>
          </div>
        )}
        <div className="mlap-card">
          <FldMoney label={trFl('fld.payAmount')} value={pay} onChange={setPay} />
          <div className="mlap-chips mlap-pad">{[[bon, trFl('fld.payAll')], [50000, '50.000'], [100000, '100.000']].filter(([v]) => v > 0 && v <= bon).map(([v, l]) => <button key={l} type="button" className={'mlap-chip-b' + (pay === v ? ' on' : '')} aria-pressed={pay === v} onClick={() => setPay(v)}>{l}</button>)}</div>
        </div>
        <FldSeg label={trFl('fld.payVia')} value={via} onChange={setVia} options={[['tunai', trFl('fld.m_tunai')], ['transfer', trFl('fld.m_transfer')]]} />
        <div className="mlap-eyebrow">{trFl('fld.proof')} · {trFl('fld.required')}</div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.proofHintPay" />
        <div className="mlap-card mlap-sec">
          <div className="mlap-sumrow total"><span>{trFl('fld.bonAfterPay')}</span><b>{FIELDLOGIC.fmtRp(pv.rest)}</b></div>
          {pv.over > 0 ? <div className="mlap-warnline">{trFl('fld.payOver', { v: FIELDLOGIC.fmtRp(pv.over) })}</div> : null}
        </div>
        {err && <div className="mlap-err" role="alert">{err}</div>}
        {!photo ? <div className="mlap-hint">{trFl('fld.needPhoto')}</div> : null}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !pv.ok || !photo} onClick={save}>{trFl('fld.payCta', { v: FIELDLOGIC.fmtRp(pay || 0) })}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: CSS** — tambahkan ke `dist-field.css` sebelum `@keyframes mlapFade`:

```css
/* ── BAYAR BON ── */
.mlap-bigrp { font-size: 26px; font-variant-numeric: tabular-nums; color: var(--mlap-bon); }
.mlap-pad { padding: 4px 12px 12px; }
```

- [ ] **Step 6: Kunci i18n** — `<scratchpad>/keys-3b-t8.json` lalu jalankan helper:

```json
{
  "en": { "fld.partPaid": "partly paid", "fld.oldestFirst": "A payment settles the oldest bon first.", "fld.payAmount": "Amount paid", "fld.payAll": "Pay it all", "fld.payVia": "Paid with", "fld.m_tunai": "Cash", "fld.proofHintPay": "The money or the transfer proof. Time and location are recorded automatically.", "fld.bonAfterPay": "Bon after this", "fld.payOver": "That is {v} more than the bon.", "fld.payCta": "Save payment {v}", "fld.paidDone": "{name}: {v} received" },
  "id": { "fld.partPaid": "sebagian dibayar", "fld.oldestFirst": "Pembayaran melunasi bon tertua lebih dulu.", "fld.payAmount": "Jumlah dibayar", "fld.payAll": "Lunas semua", "fld.payVia": "Dibayar dengan", "fld.m_tunai": "Tunai", "fld.proofHintPay": "Uangnya atau bukti transfer. Jam dan lokasi tercatat otomatis.", "fld.bonAfterPay": "Sisa bon setelah ini", "fld.payOver": "Lebih {v} dari sisa bon.", "fld.payCta": "Simpan pembayaran {v}", "fld.paidDone": "{name}: {v} diterima" }
}
```

- [ ] **Step 7: Jalankan** — `jest tests/field-day-static.test.js tests/field-cust-static.test.js tests/field-logic.test.js` → PASS; build sukses.

- [ ] **Step 8: Commit** — `git commit -am "feat(distribusi): field manual sale + bon payment (oldest first, photo, clientRef)"` (tambahkan file tes).

---

### Task 9: Penyesuaian galon + Ganti rugi galon

**Files:**
- Modify: `dist-field-cust.jsx` (tambah `FldAdjust`, `FldDamage`), `finance-i18n.js`
- Test: `server/tests/field-cust-static.test.js` (tambah)

**Interfaces:**
- `FldAdjust({ api, cust, onDone(msg), onBack })`:
  - tercatat vs hasil hitung, selisih, chip alasan (`FIELDLOGIC.ADJ_REASON_KEYS`), catatan, foto opsional;
  - `api.adjustGallon(c.id, FIELDLOGIC.adjustBody(...))`;
  - menampilkan bahwa penyesuaian menunggu persetujuan kantor.
- `FldDamage({ api, cust, rules, onDone(msg), onBack })`:
  - jumlah galon 1..galon di pelanggan, jenis (pecah/bocor/retak/hilang);
  - harga dari `rules.hargaGantiRugiGalon`;
  - Tunai/Bon/Transfer, foto wajib, `clientRef`;
  - `FIELDLOGIC.damagePreview` menjelaskan bila harga belum diatur atau galon di pelanggan 0.

- [ ] **Step 1: Tes gagal** — tambahkan:

```js
describe('Penyesuaian + Ganti rugi', () => {
  it('adjustment: reasons from the shared list, waits for the office', () => {
    const f = fn('FldAdjust');
    expect(f).toMatch(/FIELDLOGIC\.ADJ_REASON_KEYS/);
    expect(f).toMatch(/api\.adjustGallon\(c\.id, FIELDLOGIC\.adjustBody\(/);
    expect(f).toContain("'fld.adjWaits'");
    expect(f).toMatch(/disabled=\{busy \|\| !reasonKey \|\| diff === 0\}/);
  });
  it('damage: price from the owner\'s rules, explained when missing, photo required, clientRef, no approval', () => {
    const f = fn('FldDamage');
    expect(f).toMatch(/const pv = FIELDLOGIC\.damagePreview\(\{ qty, price: rules\.hargaGantiRugiGalon, held, payMethod: pay \}\);/);
    expect(f).toMatch(/pv\.blocked \? <FldNotice tone="warn" title=\{trFl\(pv\.blocked\)\}/);
    expect(f).toMatch(/disabled=\{busy \|\| !!pv\.blocked \|\| !kind \|\| !photo\}/);
    expect(f).toMatch(/clientRef: refRef\.current/);
    expect(f).toContain("'fld.dmgNoApproval'");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: Tambahkan di akhir `dist-field-cust.jsx`**

```jsx
// PENYESUAIAN GALON — the gallons counted at the customer vs the record. Sent to the office: the count
// changes only after approval (owner rule).
function FldAdjust({ api, cust: c, onDone, onBack }) {
  const rec = c.gallonsHeld == null ? 0 : c.gallonsHeld;
  const [counted, setCounted] = uSfl(rec);
  const [reasonKey, setReasonKey] = uSfl('');
  const [note, setNote] = uSfl('');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const diff = counted - rec;
  const send = () => {
    setBusy(true); setErr('');
    api.adjustGallon(c.id, FIELDLOGIC.adjustBody({ counted, reasonKey, reasonLabel: trFl(reasonKey), note, photo }))
      .then(() => onDone(trFl('fld.adjSent', { name: c.name })))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatAdj')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-card">
          <div className="mlap-field"><span className="lb">{trFl('fld.adjRecord')}</span><b>{trFl('fld.nGalon', { n: rec })}</b></div>
          <FldStepper label={trFl('fld.adjCounted')} hint={trFl('fld.adjCountedHint')} value={counted} onChange={setCounted} min={0} max={9999} />
          <div className="mlap-field"><span className="lb">{trFl('fld.adjDiff')}</span><b className={diff ? 'mlap-bontxt' : ''}>{(diff > 0 ? '+' : '') + diff}</b></div>
        </div>
        <div className="mlap-eyebrow">{trFl('fld.reasonT')}</div>
        <div className="mlap-chips">{FIELDLOGIC.ADJ_REASON_KEYS.map(([k]) => <button key={k} type="button" className={'mlap-chip-b' + (reasonKey === k ? ' on' : '')} aria-pressed={reasonKey === k} onClick={() => setReasonKey(k)}>{trFl(k)}</button>)}</div>
        <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
        <div className="mlap-eyebrow">{trFl('fld.proof')} · {trFl('fld.optional')}</div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.adjPhotoHint" />
        <FldNotice tone="info" title={trFl('fld.adjWaits')} />
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !reasonKey || diff === 0} onClick={send}>{trFl('fld.adjCta')}</button>
      </div>
    </div>
  );
}

const FLD_DMG_KINDS = [['pecah', 'fld.k_pecah'], ['bocor', 'fld.k_bocor'], ['retak', 'fld.k_retak'], ['hilang', 'fld.k_hilang']];
// GANTI RUGI GALON — a borrowed gallon broken or lost at the customer: recorded straight away (no
// approval — owner rule), priced by the owner's setting, paid cash / on bon / by transfer, photo required.
function FldDamage({ api, cust: c, rules, onDone, onBack }) {
  const held = c.gallonsHeld == null ? 0 : c.gallonsHeld;
  const [qty, setQty] = uSfl(Math.min(1, held) || 1);
  const [kind, setKind] = uSfl('');
  const [pay, setPay] = uSfl('tunai');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const refRef = uRfl(FIELDLOGIC.newRef());
  const pv = FIELDLOGIC.damagePreview({ qty, price: rules.hargaGantiRugiGalon, held, payMethod: pay });
  const save = () => {
    setBusy(true); setErr('');
    api.gallonDamage(c.id, { qty, kind, payMethod: pay, photoId: photo.id, clientRef: refRef.current })
      .then(() => onDone(trFl('fld.dmgDone', { name: c.name, n: qty })))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatDmg')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        {pv.blocked ? <FldNotice tone="warn" title={trFl(pv.blocked)} sub={trFl(pv.blocked + 'B')} /> : null}
        <div className="mlap-card"><FldStepper label={trFl('fld.dmgQty')} hint={trFl('fld.dmgFrom', { n: held })} value={qty} onChange={setQty} min={1} max={Math.max(1, held)} /></div>
        <div className="mlap-eyebrow">{trFl('fld.dmgKind')}</div>
        <div className="mlap-chips">{FLD_DMG_KINDS.map(([k, key]) => <button key={k} type="button" className={'mlap-chip-b' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>{trFl(key)}</button>)}</div>
        <div className="mlap-card"><div className="mlap-field"><span className="lb">{trFl('fld.dmgPrice')}</span><b>{FIELDLOGIC.fmtRp(rules.hargaGantiRugiGalon || 0)}</b></div></div>
        <div className="mlap-eyebrow">{trFl('fld.payVia')}</div>
        <FldSeg label={trFl('fld.payVia')} value={pay} onChange={setPay} options={[['tunai', trFl('fld.m_tunai')], ['bon', trFl('fld.m_bon')], ['transfer', trFl('fld.m_transfer')]]} />
        <div className="mlap-eyebrow">{trFl('fld.proof')} · {trFl('fld.required')}</div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.dmgPhotoHint" />
        <div className="mlap-card mlap-sum">
          <div className="mlap-sumrow"><span>{trFl('fld.heldAfter')}</span><b>{pv.heldAfter}</b></div>
          <div className="mlap-sumrow total"><span>{trFl(pv.totalKey)}</span><b>{FIELDLOGIC.fmtRp(pv.total)}</b></div>
        </div>
        <FldNotice tone="ok" title={trFl('fld.dmgNoApproval')} />
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !!pv.blocked || !kind || !photo} onClick={save}>{trFl('fld.dmgCta')}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Kunci i18n** — `<scratchpad>/keys-3b-t9.json` lalu jalankan helper:

```json
{
  "en": { "fld.adjRecord": "According to the records", "fld.adjCounted": "Counted at the customer", "fld.adjCountedHint": "Full + empty gallons there", "fld.adjDiff": "Difference", "fld.reasonT": "REASON", "fld.adj_hitung": "Recount", "fld.adj_hilang": "Gallon lost", "fld.adj_kembali": "Returned by the customer", "fld.adj_salah": "Wrong input earlier", "fld.optional": "optional", "fld.adjPhotoHint": "Photo of the gallons there — the office can check without calling.", "fld.adjWaits": "Sent to the office for approval. The customer's gallon count changes after approval.", "fld.adjCta": "Send the adjustment", "fld.adjSent": "{name}: adjustment sent for approval", "fld.k_pecah": "Broken", "fld.k_bocor": "Leaking", "fld.k_retak": "Cracked", "fld.k_hilang": "Lost", "fld.dmgQty": "Damaged gallons", "fld.dmgFrom": "Of {n} at the customer", "fld.dmgKind": "DAMAGE", "fld.dmgPrice": "Charge per gallon", "fld.dmgPhotoHint": "Photo of the damaged gallon. Time and location are recorded automatically.", "fld.heldAfter": "Gallons at the customer after this", "fld.toBon": "Added to the bon", "fld.dmgNoApproval": "Recorded right away, no office approval needed.", "fld.dmgCta": "Save the damage charge", "fld.dmgDone": "{name}: {n} gallons charged", "fld.dmgNoPrice": "The owner has not set the damage charge per gallon yet", "fld.dmgNoPriceB": "Ask the owner to set it in Aturan lapangan.", "fld.dmgNoHeld": "This customer holds no gallons", "fld.dmgNoHeldB": "There is nothing to charge for." },
  "id": { "fld.adjRecord": "Menurut catatan", "fld.adjCounted": "Hasil hitung di lokasi", "fld.adjCountedHint": "Isi + kosong yang ada", "fld.adjDiff": "Selisih", "fld.reasonT": "ALASAN", "fld.adj_hitung": "Hitung ulang", "fld.adj_hilang": "Galon hilang", "fld.adj_kembali": "Dikembalikan pelanggan", "fld.adj_salah": "Salah input kemarin", "fld.optional": "opsional", "fld.adjPhotoHint": "Foto galon di lokasi — kantor bisa cek tanpa menelepon.", "fld.adjWaits": "Dikirim ke kantor untuk disetujui. Jumlah galon pelanggan berubah setelah disetujui.", "fld.adjCta": "Kirim penyesuaian", "fld.adjSent": "{name}: penyesuaian dikirim untuk disetujui", "fld.k_pecah": "Pecah", "fld.k_bocor": "Bocor", "fld.k_retak": "Retak", "fld.k_hilang": "Hilang", "fld.dmgQty": "Galon rusak", "fld.dmgFrom": "Dari {n} galon di pelanggan", "fld.dmgKind": "KERUSAKAN", "fld.dmgPrice": "Ganti rugi / galon", "fld.dmgPhotoHint": "Foto galon rusak. Jam dan lokasi tercatat otomatis.", "fld.heldAfter": "Galon di pelanggan setelah ini", "fld.toBon": "Masuk bon", "fld.dmgNoApproval": "Langsung tercatat, tanpa persetujuan kantor.", "fld.dmgCta": "Simpan ganti rugi", "fld.dmgDone": "{name}: {n} galon diganti rugi", "fld.dmgNoPrice": "Harga ganti rugi per galon belum diatur pemilik", "fld.dmgNoPriceB": "Minta pemilik mengaturnya di Aturan lapangan.", "fld.dmgNoHeld": "Pelanggan ini tidak memegang galon", "fld.dmgNoHeldB": "Tidak ada yang bisa diganti rugi." }
}
```

- [ ] **Step 5: Jalankan** — `jest tests/field-cust-static.test.js` → PASS; build sukses.

- [ ] **Step 6: Commit** — `git commit -am "feat(distribusi): field gallon adjustment (office approval) + damage charge (photo, clientRef, explained blocks)"` (tambahkan file tes).

---

### Task 10: Pengeluaran (selalu tunai dari setoran, foto nota wajib)

**Files:**
- Modify: `dist-field-cust.jsx` (tambah `FldExpense`), `finance-i18n.js`
- Test: `server/tests/field-cust-static.test.js` (tambah)

**Interfaces:**
- `FldExpense({ api, onDone(msg), onBack })`:
  - kategori `bensin | parkir | servis | makan | lainnya` (sebagai chip);
  - nominal;
  - liter dan odometer hanya untuk bensin;
  - catatan, foto wajib;
  - pengeluaran hari ini dari `daySummary.pengeluaran`;
  - `api.addExpense(FIELDLOGIC.expenseBody(...))`; metode tunai dipaksa oleh adaptor.

- [ ] **Step 1: Tes gagal** — tambahkan:

```js
describe('Pengeluaran', () => {
  it('always cash from the deposit, receipt photo required, fuel asks litres + odometer', () => {
    const f = fn('FldExpense');
    expect(f).toMatch(/api\.addExpense\(FIELDLOGIC\.expenseBody\(/);
    expect(f).not.toMatch(/method:/);
    expect(f).toMatch(/disabled=\{busy \|\| !cat \|\| !\(amount > 0\) \|\| !photo\}/);
    expect(f).toMatch(/cat === 'bensin' &&/);
    expect(f).toContain("'fld.expFromDeposit'");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: Tambahkan di akhir `dist-field-cust.jsx`**

```jsx
const FLD_EXP_CATS = [['bensin', 'fld.c_bensin'], ['parkir', 'fld.c_parkir'], ['servis', 'fld.c_servis'], ['makan', 'fld.c_makan'], ['lainnya', 'fld.c_lainnya']];
// PENGELUARAN — paid from the day's deposit, always in cash (owner rule: never "uang pribadi"), with a
// photo of the receipt. Fuel asks litres + odometer (kept in the note).
function FldExpense({ api, onDone, onBack }) {
  const [cat, setCat] = uSfl('');
  const [amount, setAmount] = uSfl(null);
  const [liters, setLiters] = uSfl('');
  const [odo, setOdo] = uSfl('');
  const [note, setNote] = uSfl('');
  const [photo, setPhoto] = uSfl(null);
  const [today, setToday] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  uEfl(() => { let live = true; api.daySummary().then((s) => { if (live) setToday(s && s.pengeluaran != null ? s.pengeluaran : null); }).catch(() => {}); return () => { live = false; }; }, [api]);
  const save = () => {
    setBusy(true); setErr('');
    api.addExpense(FIELDLOGIC.expenseBody({ category: cat, amount, liters, odometer: odo, note, photo }))
      .then(() => onDone(trFl('fld.expDone', { v: FIELDLOGIC.fmtRp(amount) })))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatExp')} sub={today != null ? trFl('fld.expToday', { v: FIELDLOGIC.fmtRp(today) }) : ''} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-chips">{FLD_EXP_CATS.map(([k, key]) => <button key={k} type="button" className={'mlap-chip-b' + (cat === k ? ' on' : '')} aria-pressed={cat === k} onClick={() => setCat(k)}>{trFl(key)}</button>)}</div>
        <div className="mlap-card">
          <FldMoney label={trFl('fld.expAmount')} value={amount} onChange={setAmount} />
          {cat === 'bensin' && (
            <>
              <label className="mlap-field"><span className="lb">{trFl('fld.liters')}</span><input className="mlap-input" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 6))} aria-label={trFl('fld.liters')} /></label>
              <label className="mlap-field"><span className="lb">{trFl('fld.odometer')}</span><input className="mlap-input" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))} aria-label={trFl('fld.odometer')} /></label>
            </>
          )}
        </div>
        <FldNotice tone="info" title={trFl('fld.expFromDeposit')} sub={trFl('fld.expFromDepositB')} />
        <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
        <div className="mlap-eyebrow">{trFl('fld.receipt')} · {trFl('fld.required')}</div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.receiptHint" />
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !cat || !(amount > 0) || !photo} onClick={save}>{trFl('fld.expCta')}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Kunci i18n** — `<scratchpad>/keys-3b-t10.json` lalu jalankan helper:

```json
{
  "en": { "fld.c_bensin": "Fuel", "fld.c_parkir": "Parking/toll", "fld.c_servis": "Service", "fld.c_makan": "Meal", "fld.c_lainnya": "Other", "fld.expAmount": "Amount", "fld.liters": "Litres", "fld.odometer": "Odometer (km)", "fld.expFromDeposit": "Paid from today's deposit", "fld.expFromDepositB": "It lowers the money to deposit today. Never from personal money.", "fld.receipt": "RECEIPT PHOTO", "fld.receiptHint": "No receipt? Photograph the pump or the item and write a note.", "fld.expToday": "Expenses today: {v}", "fld.expCta": "Save the expense", "fld.expDone": "Expense {v} saved" },
  "id": { "fld.c_bensin": "Bensin", "fld.c_parkir": "Parkir/tol", "fld.c_servis": "Servis", "fld.c_makan": "Makan", "fld.c_lainnya": "Lainnya", "fld.expAmount": "Jumlah", "fld.liters": "Liter", "fld.odometer": "Odometer (km)", "fld.expFromDeposit": "Dibayar dari uang setoran hari ini", "fld.expFromDepositB": "Langsung mengurangi uang yang disetor. Tidak pernah dari uang pribadi.", "fld.receipt": "FOTO NOTA / STRUK", "fld.receiptHint": "Tidak ada nota? Foto pompa bensin atau barangnya, lalu tulis catatan.", "fld.expToday": "Pengeluaran hari ini: {v}", "fld.expCta": "Simpan pengeluaran", "fld.expDone": "Pengeluaran {v} tersimpan" }
}
```

- [ ] **Step 5: Jalankan** — `jest tests/field-cust-static.test.js` → PASS; build sukses.

- [ ] **Step 6: Commit** — `git commit -am "feat(distribusi): field expense — cash from the deposit, receipt photo, fuel litres + odometer"` (tambahkan file tes).

---

### Task 11: Shell — menu Catat aktif, tab Pelanggan, aksi detail stop, navigasi antar layar

**Files:**
- Modify: `dist-field.jsx` (`FldApp`), `dist-field-day.jsx` (`FldStopSheet`: aksi bon/penyesuaian/ganti rugi/lengkapi), `finance-i18n.js`
- Test: `server/tests/field-shell-static.test.js`, `server/tests/field-day-static.test.js` (tambah)

**Interfaces:**
- `FldApp` menerima `perms` dan menghitung `const can = fldCan(perms);`.
- Tampilan (view) baru:
  - **layar penuh:** `pick` (`{ act }`), `bon`, `adjust`, `damage`, `exp`, `addStop` (`{ preset? }`), `complete`, `pin` (`{ cust, back? }`);
  - **sheet:** `cust`.
- Menu Catat (setiap item hanya bila izinnya ada):
  - "Transaksi manual" → `pick` (`act: 'sale'`), lalu `sale` dengan stop dari `fldSaleStopFromCust`;
  - "Pembayaran bon" → `pick` (`act: 'bon'`, pelanggan tanpa bon dimatikan);
  - "Pengeluaran" → `exp`;
  - "Tambah stop" → `addStop`;
  - "Penyesuaian galon" → `pick` (`act: 'adjust'`);
  - "Ganti rugi galon" → `pick` (`act: 'damage'`, pelanggan tanpa galon dimatikan).
- `FldStopSheet({ …, can, onAction(name, cust) })`: aksi `bon`, `adjust`, `damage`, dan `complete` untuk pelanggan stop itu (lewat `fldCustFromStop`).

- [ ] **Step 1: Tes gagal** — tambahkan ke `server/tests/field-shell-static.test.js`:

```js
describe('Plan 3B shell', () => {
  it('Catat items appear only when the account may use them, and open their screens', () => {
    expect(jsx).toMatch(/const can = fldCan\(perms\);/);
    expect(jsx).toMatch(/\['catatSale', can\.sale\], \['catatBon', can\.bon\], \['catatExp', can\.expense\], \['catatStop', can\.addStop\], \['catatAdj', can\.adjust\], \['catatDmg', can\.damage\]\]\.filter\(\(a\) => a\[1\]\)/);
    expect(jsx).not.toMatch(/className="mlap-tile" disabled/);
  });
  it('the Pelanggan tab and every new screen are wired', () => {
    ['<FldCustomers ', '<FldCustSheet ', '<FldPickCustomer ', '<FldPayBon ', '<FldAdjust ', '<FldDamage ', '<FldExpense ', '<FldAddStop ', '<FldComplete ', '<FldPinMap '].forEach((t) => expect(jsx).toContain(t));
  });
  it('pickers disable customers an action cannot use (no bon → no bon payment; no gallons → no damage)', () => {
    expect(jsx).toMatch(/view\.act === 'bon' \? \(\(c\) => \(c\.sisaBon > 0 \? '' : 'fld\.pickNoBon'\)\)/);
    expect(jsx).toMatch(/view\.act === 'damage' \? \(\(c\) => \(c\.gallonsHeld > 0 \? '' : 'fld\.dmgNoHeld'\)\)/);
  });
});
```

dan ke `server/tests/field-day-static.test.js`:

```js
it('Plan 3B: the stop sheet offers bon / adjustment / damage / complete for the stop\'s customer, by cap', () => {
  const f = fn('FldStopSheet');
  expect(f).toMatch(/can\.bon && s\.sisaBon > 0/);
  expect(f).toMatch(/onAction\('adjust', fldCustFromStop\(s\)\)/);
  expect(f).toMatch(/can\.damage && s\.gallonsHeld > 0/);
  expect(f).toMatch(/can\.location && s\.gaps\.count > 0/);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: `FldStopSheet`** — di `dist-field-day.jsx`:
  - ubah tanda tangan menjadi `function FldStopSheet({ api, stop: s, can, onClose, onSale, onAction, onChanged })`;
  - ganti teks "lengkapi nanti" pada daftar cek (`{s.gaps[k] ? <span className="sb">{trFl('fld.fillLater')}</span> : null}`) dengan `null` (aksinya kini ada);
  - tepat sebelum `{s.note ? <div className="mlap-note">…` tambahkan:

```jsx
        <div className="mlap-actlist">
          {can.bon && s.sisaBon > 0 ? <button type="button" className="mlap-btn mlap-wide" onClick={() => onAction('bon', fldCustFromStop(s))}>{trFl('fld.catatBon')} · {FIELDLOGIC.fmtRp(s.sisaBon)}</button> : null}
          {can.location && s.gaps.count > 0 ? <button type="button" className="mlap-btn mlap-wide" onClick={() => onAction('complete', fldCustFromStop(s))}>{trFl('fld.completeData')}</button> : null}
          {can.adjust ? <button type="button" className="mlap-btn mlap-wide" onClick={() => onAction('adjust', fldCustFromStop(s))}>{trFl('fld.catatAdj')}</button> : null}
          {can.damage && s.gallonsHeld > 0 ? <button type="button" className="mlap-btn mlap-wide" onClick={() => onAction('damage', fldCustFromStop(s))}>{trFl('fld.catatDmg')}</button> : null}
        </div>
```

  - tombol "Antar & catat transaksi" di sheet hanya bila `can.sale`: bungkus `<button … onClick={() => onSale(s)}>` dengan `{can.sale ? … : null}`; sama untuk `onSale` di `FldNextCard` (prop `canSale`, tombol hanya bila true) dan `FldBoardScreen` meneruskan `canSale={can.sale}` — tambahkan prop `can` ke `FldBoardScreen({ api, ctx, tick, can, … })`.
  - kunci `fld.fillLater` kini tidak dipakai; biarkan di i18n (tidak merusak).

- [ ] **Step 4: `FldApp`** — di `dist-field.jsx`:
  - tanda tangan: tambahkan `perms` → `function FldApp({ user, perms, pref, … })`; setelah `const mode = pref.mode;` tambahkan `const can = fldCan(perms);`.
  - ganti `const ACTIONS = ['catatSale', 'catatBon', 'catatExp', 'catatStop', 'catatAdj', 'catatDmg'];` dengan:

```jsx
  const ACTIONS = [['catatSale', can.sale], ['catatBon', can.bon], ['catatExp', can.expense], ['catatStop', can.addStop], ['catatAdj', can.adjust], ['catatDmg', can.damage]].filter((a) => a[1]).map((a) => a[0]);
  const ACTION_VIEW = { catatSale: { name: 'pick', act: 'sale' }, catatBon: { name: 'pick', act: 'bon' }, catatExp: { name: 'exp' }, catatStop: { name: 'addStop' }, catatAdj: { name: 'pick', act: 'adjust' }, catatDmg: { name: 'pick', act: 'damage' } };
  // a customer chosen for an action → the action's screen
  const openFor = (act, c) => setView(act === 'sale' ? { name: 'sale', stop: fldSaleStopFromCust(c) } : act === 'addStop' ? { name: 'addStop', preset: c } : { name: act, cust: c });
```

  - `full` menjadi: `const full = view && ['sale', 'run', 'pick', 'bon', 'adjust', 'damage', 'exp', 'addStop', 'complete', 'pin'].includes(view.name);`
  - tab `pelanggan`: ganti cabang `else { body = <div className="mlap-card"><div className="mlap-empty">{trFl('fld.soon')}</div></div>; }` dengan `else { body = <FldCustomers api={api} tick={tick} onOpen={(c) => setView({ name: 'cust', cust: c })} />; }`
  - `FldBoardScreen` mendapat `can={can}`.
  - tile menu Catat: ganti baris `{ACTIONS.map((a, i) => <button key={a} type="button" role="menuitem" className="mlap-tile" disabled … >{trFl('fld.' + a)}</button>)}` dengan:

```jsx
              {ACTIONS.map((a, i) => <button key={a} type="button" role="menuitem" className="mlap-tile" style={{ animationDelay: (70 + i * 40) + 'ms' }} onClick={() => { setCatat(false); setView(ACTION_VIEW[a]); }}>{trFl('fld.' + a)}</button>)}
              {!ACTIONS.length ? <div className="mlap-empty">{trFl('fld.noActions')}</div> : null}
```

  - di bawah dua baris render layar penuh yang ada (`view.name === 'sale'` dan `'run'`), tambahkan:

```jsx
      {ready && full && view.name === 'pick' && (
        <FldPickCustomer api={api} title={trFl('fld.' + ({ sale: 'catatSale', bon: 'catatBon', adjust: 'catatAdj', damage: 'catatDmg' })[view.act])} hint={trFl('fld.pickHint')}
          accept={view.act === 'bon' ? ((c) => (c.sisaBon > 0 ? '' : 'fld.pickNoBon')) : view.act === 'damage' ? ((c) => (c.gallonsHeld > 0 ? '' : 'fld.dmgNoHeld')) : null}
          onPick={(c) => openFor(view.act, c)} onBack={() => setView(null)} />
      )}
      {ready && full && view.name === 'bon' && <FldPayBon api={api} cust={view.cust} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'adjust' && <FldAdjust api={api} cust={view.cust} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'damage' && <FldDamage api={api} cust={view.cust} rules={ctx.rules || {}} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'exp' && <FldExpense api={api} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'addStop' && <FldAddStop api={api} preset={view.preset} onPin={(c) => setView({ name: 'pin', cust: c, back: view })} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'complete' && <FldComplete api={api} cust={view.cust} onPin={(c) => setView({ name: 'pin', cust: c, back: view })} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'pin' && <FldPinMap api={api} cust={view.cust} onDone={(m) => { if (view.back) { setView(view.back); flash(m); setCtxTick((t) => t + 1); } else done(m); }} onBack={() => setView(view.back || null)} />}
```

  - setelah baris render `FldStopSheet`, tambahkan sheet pelanggan:

```jsx
      {ready && view && view.name === 'cust' && <FldCustSheet cust={view.cust} can={can} onClose={() => setView(null)} onAction={(a, c) => openFor(a, c)} />}
```

  - ubah render `FldStopSheet` agar meneruskan `can={can}` dan `onAction={(a, c) => openFor(a, c)}`.

- [ ] **Step 5: Kunci i18n** — `<scratchpad>/keys-3b-t11.json` lalu jalankan helper:

```json
{
  "en": { "fld.noActions": "No manual input is allowed for this account.", "fld.pickHint": "Choose the customer", "fld.pickNoBon": "No bon to pay" },
  "id": { "fld.noActions": "Akun ini tidak punya izin input manual.", "fld.pickHint": "Pilih pelanggannya", "fld.pickNoBon": "Tidak ada bon untuk dibayar" }
}
```

- [ ] **Step 6: Jalankan** — `jest tests/field-shell-static.test.js tests/field-day-static.test.js tests/field-cust-static.test.js tests/field-kit-static.test.js tests/field-shell-integration.test.js` → PASS; build sukses.

- [ ] **Step 7: Commit** — `git commit -am "feat(distribusi): field shell — Catat menu live (by cap), Pelanggan tab, stop sheet actions, screen navigation"` (tambahkan file tes).

---

### Task 12: Verifikasi menyeluruh + dokumentasi

- [ ] **Step 1: Uji tampilan headless (verifikasi lokal, bukan tes server).**
  1. Jalankan `node build.mjs --no-minify`.
  2. Pakai harness Rencana 3A: `<scratchpad>/serve.js` (`/app/` = repo, `/vendor/` = repo vendor, `/h/` = scratchpad) dan `day-harness.html`. Perbarui nama bundel di harness.
  3. Lengkapi mock:
     - `customers` diberi `code`, `address`, `deliveryDays`, dan `fixedDays`;
     - `F.customer` mengembalikan `{ data: { ...c, transactions: [...] } }`;
     - `F.daySummary` diisi;
     - `F.position` mengembalikan `ok`.
  4. Teruskan `perms` penuh:
     `{ distribusiPengiriman, distribusiInput, distribusiExpense, distribusiOrder, distribusiPenyesuaianGalon, distribusiLokasiSimpan, distribusiDemoPenuh, distribusiDemoLatihan }`.
  5. Tambahkan langkah `?step=`: `cust` (tab Pelanggan), `custsheet`, `catat` (menu terbuka), `bon`, `exp`, `dmg`, `adj`, `addstop`, `complete`, dan `pin`.
  6. Periksa:
     - setiap layar tampil;
     - tombol simpan mati tanpa foto;
     - pelanggan tanpa bon mati di pemilih Pembayaran bon;
     - peta Atur titik menampilkan pin.

  Ambil tangkapan layar 500 px tiap tahap dan lihat dengan tool Read. Temuan diperbaiki dengan TDD, lalu hentikan server statis.
- [ ] **Step 2: Suite penuh di latar belakang.** Jalankan tanpa jest lain bersamaan. Ekspektasi: semua lulus, kecuali 9 file lama yang rapuh tanggal bila dijalankan 00:00–08:00 WITA; buktikan dengan `APP_TZ=UTC`.
- [ ] **Step 3: Build minify.** `node build.mjs` harus sukses.
- [ ] **Step 4: Spesifikasi.** Tambahkan catatan "Sesuai yang dibangun (Rencana 3B)" di bagian 4. Isinya:
  - `dist-field-cust.jsx`;
  - `clientRef` (kolom unik; kirim ulang mengembalikan baris yang sama);
  - aksi yang disaring berdasarkan izin;
  - foto lokasi satu buah (kolom server tunggal);
  - liter/odometer di catatan pengeluaran;
  - alasan penyesuaian dipetakan ke enum server.

  Commit: `git commit -m "docs: mode lapangan spec aligned with customer screens + manual inputs (Plan 3B)"`.

## Setelah rencana ini

Rencana 3C:
- **Koreksi transaksi**, dari baris Terkirim dan riwayat pelanggan:
  - jenis koreksi: pelanggan, jumlah galon, cara bayar, batalkan;
  - pratinjau dampak (`/preview`);
  - alasan wajib, persetujuan kantor.
- **Koreksi saya:** Menunggu/Disetujui/Ditolak, catatan kantor, tarik kembali.
- **Sisa temuan kecil Rencana 3A:**
  - Peta `nextNo`;
  - status hari sudah ditutup;
  - target sentuh;
  - `mapErr` tidak di-reset;
  - bahasa alasan selisih rit;
  - "Berikutnya" ganda;
  - aksesibilitas;
  - komentar CSS mode gelap.
- **Pembersihan foto bukti yatim** (opsional).
- **Rilis:** `FLD_SCREENS_READY = true`, label kartu demo setelah rilis, dan rilis tidak menimpa suntingan aturan.
