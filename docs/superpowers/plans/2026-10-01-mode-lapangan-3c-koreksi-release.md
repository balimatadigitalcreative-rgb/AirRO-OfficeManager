# Mode Lapangan 3C — Koreksi, Koreksi saya, perbaikan kecil, rilis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selesaikan Mode Lapangan:
- Sopir bisa mengajukan koreksi transaksi yang sudah terkirim:
  - pelanggan salah;
  - jumlah galon;
  - cara bayar Lunas/Bon/Transfer;
  - nominal pelunasan;
  - batalkan.
- Sopir melihat dan menarik pengajuannya di "Koreksi saya".
- Perbaikan kecil yang tertunda dari Rencana 1/2/3A/3B ditutup.
- Kunci rilis (`FLD_SCREENS_READY`) dibuka.

**Architecture:**
- **Server:** mesin persetujuan yang sudah ada (`DistChangeRequest`: correction / void / reassign) dipakai apa adanya. Ada tiga tambahan:
  - koreksi bisa mengganti `payMethod` tunai↔transfer, dengan foto bukti transfer;
  - "Koreksi saya" juga terbuka untuk pemegang `distribusiVoid`;
  - beberapa perbaikan idempotensi dan setoran.
- **Klien:**
  - file baru `dist-field-koreksi.jsx` (layar Koreksi + Koreksi saya);
  - logika murni di `FIELDLOGIC`;
  - adaptor asli dan latihan mendapat `previewCorrection` / `previewReassign`.
- **Rilis:** `FLD_SCREENS_READY = true`. Layar aturan dan kartu "Coba tampilan baru" ikut keadaan rilis.

**Tech Stack:**
- Express + Prisma (SQLite) + zod.
- Jest + supertest.
- React 18 UMD dibundel `build.mjs` (satu cakupan global).
- Modul isomorfik UMD diuji di Node.
- `@babel/parser` untuk tes statis.

**Spec:** `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md`. Bagian yang relevan:
- §1 aturan pemilik ("Semua koreksi transaksi wajib disetujui");
- §3.6 (ganti rugi hanya bisa dibatalkan);
- §3.7 (Koreksi saya);
- §4 (tabel layar: Koreksi, Koreksi saya);
- §5 (Rilis).

Mockup papan 14–17: https://claude.ai/artifact/VELPmw1GNUAFNQ5KXpxj8V

## Global Constraints

- Semua koreksi transaksi wajib disetujui kantor atau akun yang punya izin menyetujui. Tidak ada koreksi kecil yang langsung berlaku (spec §1).
- Transaksi asli tetap berlaku sampai pengajuan disetujui. Koreksi yang menunggu tidak menghalangi tutup hari (mockup 14–17).
- Ganti rugi galon tidak bisa dikoreksi atau dipindah. Satu-satunya jalan: batal, lalu catat ulang (spec §3.6).
- Koreksi ke Transfer wajib menyertakan foto bukti transfer (keputusan mockup).
- File lama `distribution.jsx` tidak diubah (spec, "Keputusan desain").
- Bundel satu cakupan:
  - setiap nama tingkat atas di file `dist-field*` harus unik (awalan `Fld*` / `fld*` / `FLD*`);
  - kelas CSS berawalan `mlap-`;
  - teks memakai `finance-i18n.js` (EN + ID) dengan kunci `fld.*`.
- Teks yang tersimpan di catatan kantor (alasan, ringkasan) memakai bahasa Indonesia tetap, bukan bahasa tampilan.
- Tes server tidak boleh memerlukan `node_modules` root/frontend (gerbang deploy): pakai `@babel/parser`, bukan esbuild.
- Jangan menjalankan dua jest bersamaan. `globalSetup` mereset `test.db`.
- Perintah tes dijalankan dari `server/`:
  `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand <files>`

## Review Focus

1. **Koreksi ke Transfer.**
   - Tanpa foto: tombol mati di HP, dan server menolak dengan `PROOF_REQUIRED`.
   - Setelah disetujui: uang pindah Kas → Bank, dan setoran hari itu turun sebesar nominalnya.
   - Dites di Task 1 (server, jurnal + day-summary), Task 4 (latihan), Task 5 (`koreksiCheck`).
2. **Transaksi yang sudah punya pengajuan menunggu.** Layar Koreksi menjelaskan dan menawarkan "Koreksi saya", bukan menampilkan error 400 dari server.
   - Dites di Task 6 (statis: `t.pendingRequest ? <FldNotice …`), Task 4 (latihan `pendingRequest`).
3. **Akun yang hanya punya izin Batal (`distribusiVoid`).** Hanya pilihan "Batalkan transaksi" yang muncul, dan "Koreksi saya" tetap terbuka.
   - Dites di Task 2 (server any-of), Task 5 (`koreksiOptions`), Task 8 (menu).
4. **Tarik pengajuan bersamaan dengan persetujuan kantor.** Hanya satu yang menang. Pengajuan yang sudah disetujui tidak pernah menjadi "ditarik".
   - Dites di Task 2 (`withdrawWhere` + perilaku 400).
5. **Koreksi jumlah atau cara bayar mengirim nilai lengkap.** Galon kembali dan galon keluar tidak pernah tak sengaja menjadi 0, karena server membaca field yang hilang sebagai 0.
   - Dites di Task 5 (`correctionBody`).

---

## Task 1: Server — koreksi cara bayar (tunai↔transfer), bentuk pengajuan, lokasi foto

**Files:**
- Modify: `server/src/controllers/distribution.controller.js` (`correctionSchema`)
- Modify: `server/src/services/distribution.service.js`:
  - `normalizeCorrection`
  - `previewCorrection`
  - `decideChangeRequest` (apply sale)
  - `changeRequestClient`
  - customer detail txn shape
- Test: `server/tests/field-koreksi-bayar.test.js` (new)

**Interfaces:**
- Produces:
  - **Correction payload (sale)** accepts `payMethod: 'tunai'|'transfer'|''` and `proofPhotoId`.
  - **`normalizeCorrection(txn, payload, { canPrice, preview })`**:
    - `fields.payMethod` is set only when asked for or when the method changes;
    - `fields.proofPhotoId` is set when switching to transfer;
    - the photo is required unless `preview`.
  - **Preview** returns `payMethod`, `requestedPayMethod`.
  - **`changeRequestClient`** returns:
    - `customerId`;
    - `current.method`, `current.payMethod`;
    - `requested.payMethod` (sale).
  - **Customer detail transactions** carry `proofLat`, `proofLng`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
process.env.ACCOUNTING_V2 = 'true';
// KOREKSI CARA BAYAR (Mode Lapangan 3C): a delivered sale's "Cara bayar" can be corrected to Transfer
// (or back) through the SAME approval flow as every correction. Switching TO transfer needs the transfer
// receipt photo; on approval the cash leaves Kas for Bank and the day's deposit drops by the amount.
// An untouched pay method is never rewritten (a legacy '' row keeps its note-based meaning).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const bal = async (code) => { const lines = await prisma.journalLine.findMany({ where: { chartAccount: { code } } }); return lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0); };
const photo = async (t) => (await request(app).post('/api/v1/attachments').set(auth(t)).send({ name: 't.jpg', mime: 'image/jpeg', isImg: true, data: 'data:image/jpeg;base64,AAAA' })).body.data.id;
const SALE = { qty: 3, unitPrice: 6000, gallonOut: 3, gallonIn: 0 };
let gm, staff, cid, saleId;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'kb_gm', password: 'secret123', role: 'gm' })).token;
  const s = await reg({ name: 'Sopir', username: 'kb_staff', password: 'secret123', role: 'finance' });
  await request(app).patch(`/api/v1/users/${s.user.id}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiPengiriman: true } });
  staff = await login('kb_staff');
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko KB', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 100, reason: 'stok awal', fleet: 'DK 1' });
  saleId = (await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 3, method: 'lunas', payMethod: 'tunai', txnDate: today, gallonOut: 3, proofPhotoId: await photo(gm), proofLat: -8.6, proofLng: 115.2 })).body.data.id;
});
afterAll(() => prisma.$disconnect());

it('switching to transfer needs the transfer receipt photo; an unknown pay method is refused', async () => {
  const r = await request(app).post(`${D}/transactions/${saleId}/corrections`).set(auth(staff)).send({ reason: 'dibayar transfer', ...SALE, method: 'lunas', payMethod: 'transfer' });
  expect(r.status).toBe(400);
  expect(r.body.error.details.code).toBe('PROOF_REQUIRED');
  const bad = await request(app).post(`${D}/transactions/${saleId}/corrections`).set(auth(staff)).send({ reason: 'x', ...SALE, payMethod: 'kartu' });
  expect(bad.status).toBe(400);
});

it('the preview shows the pay method change without needing the photo yet', async () => {
  const r = await request(app).post(`${D}/transactions/${saleId}/corrections/preview`).set(auth(staff)).send({ ...SALE, method: 'lunas', payMethod: 'transfer' });
  expect(r.status).toBe(200);
  expect(r.body.data).toMatchObject({ payMethod: 'tunai', requestedPayMethod: 'transfer', oldAmount: 18000, newAmount: 18000 });
});

it('the request names the customer and the pay change; approval moves the cash from Kas to Bank', async () => {
  const pid = await photo(staff);
  const r = await request(app).post(`${D}/transactions/${saleId}/corrections`).set(auth(staff)).send({ reason: 'dibayar transfer', ...SALE, method: 'lunas', payMethod: 'transfer', proofPhotoId: pid });
  expect(r.status).toBe(201);
  expect(r.body.data).toMatchObject({ customerId: cid, current: { method: 'lunas', payMethod: 'tunai' }, requested: { payMethod: 'transfer' } });
  const kas0 = await bal('1-1000'); const bank0 = await bal('1-1100');
  const a = await request(app).post(`${D}/change-requests/${r.body.data.id}/approve`).set(auth(gm)).send({});
  expect(a.status).toBe(200);
  const t = await prisma.distTransaction.findUnique({ where: { id: saleId } });
  expect(t.payMethod).toBe('transfer'); expect(t.proofPhotoId).toBe(pid);
  expect(kas0 - (await bal('1-1000'))).toBe(18000);
  expect((await bal('1-1100')) - bank0).toBe(18000);
  const sum = (await request(app).get(`${D}/deliveries/day-summary?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
  expect(sum.transfer).toBe(18000); expect(sum.tunaiPenjualan).toBe(0);
});

it('lunas → bon clears the pay method; a qty-only correction never rewrites it', async () => {
  const r = await request(app).post(`${D}/transactions/${saleId}/corrections`).set(auth(staff)).send({ reason: 'ternyata bon', ...SALE, method: 'bon' });
  await request(app).post(`${D}/change-requests/${r.body.data.id}/approve`).set(auth(gm)).send({});
  expect((await prisma.distTransaction.findUnique({ where: { id: saleId } })).payMethod).toBe('');
  const legacy = (await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 2, method: 'lunas', txnDate: today, gallonOut: 2 })).body.data.id;
  await prisma.distTransaction.update({ where: { id: legacy }, data: { payMethod: '' } });   // an old row
  const q = await request(app).post(`${D}/transactions/${legacy}/corrections`).set(auth(staff)).send({ reason: 'salah hitung', qty: 3, unitPrice: 6000, gallonOut: 3, gallonIn: 0, method: 'lunas' });
  await request(app).post(`${D}/change-requests/${q.body.data.id}/approve`).set(auth(gm)).send({});
  expect((await prisma.distTransaction.findUnique({ where: { id: legacy } })).payMethod).toBe('');
});

it('the customer detail carries each transaction\'s photo location (for "which customer was it?")', async () => {
  const d = (await request(app).get(`${D}/customers/${cid}`).set(auth(staff))).body.data;
  expect(d.transactions.find((x) => x.id === saleId)).toMatchObject({ proofLat: -8.6, proofLng: 115.2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-koreksi-bayar.test.js`

Expected: FAIL.
- The first test: `bad.status` 400 passes, but `PROOF_REQUIRED` is missing (it gets 201).
- The others: `requestedPayMethod` / `customerId` / `proofLat` are undefined.

- [ ] **Step 3: Implement**

In `distribution.controller.js` `correctionSchema`, after the `method:` line add:

```js
  // PAY METHOD of a lunas sale (tunai ↔ transfer) — the field screens' "Cara bayar". A switch to
  // transfer carries the transfer receipt photo.
  payMethod: z.enum(['tunai', 'transfer', '']).optional(),
  proofPhotoId: z.string().min(1).max(60).optional(),
```

In `distribution.service.js` `normalizeCorrection`, replace the sale branch's final line

```js
    return { fields: { qty, unitPrice, gallonOut, gallonIn, method, ...meta }, newAmount };
```

with:

```js
    // PAY METHOD (tunai ↔ transfer) — written only when asked for or when the method itself changes, so
    // an untouched legacy '' row keeps its note-based meaning. A bon carries none. A switch TO transfer
    // needs the transfer receipt photo (not for a preview); it becomes the row's proof on approval (the
    // old photo id stays in the correction trail).
    const pm = {};
    if (p.payMethod != null || method !== txn.method) {
      pm.payMethod = method === 'bon' ? '' : (p.payMethod === 'transfer' ? 'transfer' : p.payMethod === 'tunai' ? 'tunai' : (txn.method === 'lunas' && txn.payMethod ? txn.payMethod : 'tunai'));
      if (pm.payMethod === 'transfer' && !(txn.method === 'lunas' && txn.payMethod === 'transfer')) {
        const pid = p.proofPhotoId ? String(p.proofPhotoId) : '';
        if (!pid && !(opts && opts.preview)) throw ApiError.badRequest('Foto bukti transfer wajib dilampirkan.', { code: 'PROOF_REQUIRED' });
        if (pid) {
          const att = await prisma.attachment.findUnique({ where: { id: pid }, select: { id: true } });
          if (!att) throw ApiError.badRequest('Foto bukti transfer tidak ditemukan — unggah ulang fotonya.', { code: 'PROOF_MISSING' });
          pm.proofPhotoId = pid;
        }
      }
    }
    return { fields: { qty, unitPrice, gallonOut, gallonIn, method, ...pm, ...meta }, newAmount };
```

In `previewCorrection` change

```js
  const norm = await normalizeCorrection(txn, body.payload || body, { canPrice: snap.canPrice });   // SAME fn apply uses
```

to

```js
  const norm = await normalizeCorrection(txn, body.payload || body, { canPrice: snap.canPrice, preview: true });   // SAME fn apply uses
```

In the same function's `return {`, after `methodChanged: …,` add:

```js
    payMethod: txn.payMethod || '', requestedPayMethod: norm.fields.payMethod !== undefined ? norm.fields.payMethod : (txn.payMethod || ''),
```

In `decideChangeRequest`, change

```js
    oldVals = { qty: txn.qty, unitPrice: txn.unitPriceLocked, amount: txn.amount, method: txn.method, ...oldG };
```

to

```js
    oldVals = { qty: txn.qty, unitPrice: txn.unitPriceLocked, amount: txn.amount, method: txn.method, payMethod: txn.payMethod || '', proofPhotoId: txn.proofPhotoId || null, ...oldG };
```

In the sale `db.distTransaction.update` data, after `method: norm.fields.method, bonCounted: norm.fields.method === 'bon',`, add:

```js
        ...(norm.fields.payMethod !== undefined ? { payMethod: norm.fields.payMethod } : {}), ...(norm.fields.proofPhotoId ? { proofPhotoId: norm.fields.proofPhotoId } : {}),
```

After the `methodLine` const add:

```js
  const payLine = (req.kind === 'correction' && oldVals && newVals && newVals.payMethod !== undefined && oldVals.payMethod !== newVals.payMethod)
    ? ` · CARA BAYAR ${oldVals.payMethod || 'tunai'} → ${newVals.payMethod || 'bon'}` : '';
```

In the `detail` string append `${payLine}` after `${methodLine}`.

In `changeRequestClient`:
- change `const current = txn ? { qty: txn.qty, unitPrice: txn.unitPriceLocked, amount: txn.amount, ...curG } : null;` to `const current = txn ? { qty: txn.qty, unitPrice: txn.unitPriceLocked, amount: txn.amount, method: txn.method, payMethod: txn.payMethod || '', ...curG } : null;`;
- change `requested = { qty: payload.qty, unitPrice: payload.unitPrice, gallonOut: payload.gallonOut, gallonIn: payload.gallonIn, method: requestedMethod };` to `requested = { qty: payload.qty, unitPrice: payload.unitPrice, gallonOut: payload.gallonOut, gallonIn: payload.gallonIn, method: requestedMethod, payMethod: payload.payMethod };`;
- in the returned object, after `id: req.id, transactionId: req.transactionId,`, add `customerId: txn ? txn.customerId : null,`.

In the customer-detail transaction map, change `proofPhotoId: t.proofPhotoId || null, txnDate: t.txnDate` to `proofPhotoId: t.proofPhotoId || null, proofLat: t.proofLat != null ? t.proofLat : null, proofLng: t.proofLng != null ? t.proofLng : null, txnDate: t.txnDate`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-koreksi-bayar.test.js tests/correction-method.test.js tests/change-request.test.js`

Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add server/tests/field-koreksi-bayar.test.js server/src/controllers/distribution.controller.js server/src/services/distribution.service.js
git commit -m "feat(distribusi): correct a sale's pay method (tunai <-> transfer, with transfer photo) through the approval flow"
```

---

## Task 2: Server — Koreksi saya: tarik aman dari balapan, terbuka untuk pemegang izin Batal

**Files:**
- Modify: `server/src/services/distribution.service.js` (`withdrawChangeRequest`, exports)
- Modify: `server/src/routes/distribution.routes.js` (`/change-requests/mine`, `/:id/withdraw`)
- Test: `server/tests/field-koreksi-saya.test.js` (new)

**Interfaces:**
- Produces:
  - `withdrawWhere(id, actorId)` → `{ id, requestedById: actorId, status: 'pending' }` (exported).
  - GET `/change-requests/mine` and POST `/change-requests/:id/withdraw` need `distribusiKoreksi` **or** `distribusiVoid`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// KOREKSI SAYA (Mode Lapangan 3C): an account that may only CANCEL (distribusiVoid) sees and withdraws
// its own requests too; a withdraw can never overwrite a decision (one conditional write).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');
const svc = require('../src/services/distribution.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const as = async (gm, username, permissions) => { const u = await reg({ name: username, username, password: 'secret123', role: 'finance' }); await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ permissions }); return login(username); };
let gm, voider, koreksi, nobody, cid;
const sale = async () => (await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 1, method: 'lunas', txnDate: todayISO() })).body.data.id;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'ks_gm', password: 'secret123', role: 'gm' })).token;
  voider = await as(gm, 'ks_void', { distribusi: true, distribusiVoid: true });
  koreksi = await as(gm, 'ks_kor', { distribusi: true, distribusiKoreksi: true });
  nobody = await as(gm, 'ks_none', { distribusi: true });
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko KS', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

it('a cancel-only account sees its own request and can withdraw it; an account with neither right cannot', async () => {
  const v = await request(app).post(`${D}/transactions/${await sale()}/void`).set(auth(voider)).send({ reason: 'dobel' });
  expect(v.status).toBe(201);
  const mine = await request(app).get(`${D}/change-requests/mine`).set(auth(voider));
  expect(mine.status).toBe(200);
  expect(mine.body.data.map((r) => r.id)).toContain(v.body.data.id);
  const w = await request(app).post(`${D}/change-requests/${v.body.data.id}/withdraw`).set(auth(voider)).send({});
  expect(w.status).toBe(200); expect(w.body.data.status).toBe('withdrawn');
  expect((await request(app).get(`${D}/change-requests/mine`).set(auth(nobody))).status).toBe(403);
});

it('a decided request cannot be withdrawn and keeps its decision', async () => {
  const id = await sale();
  const r = await request(app).post(`${D}/transactions/${id}/corrections`).set(auth(koreksi)).send({ reason: 'salah', qty: 2, unitPrice: 6000, gallonOut: 2, gallonIn: 0 });
  await request(app).post(`${D}/change-requests/${r.body.data.id}/approve`).set(auth(gm)).send({});
  const w = await request(app).post(`${D}/change-requests/${r.body.data.id}/withdraw`).set(auth(koreksi)).send({});
  expect(w.status).toBe(400);
  expect((await prisma.distChangeRequest.findUnique({ where: { id: r.body.data.id } })).status).toBe('approved');
});

it('the withdraw is ONE conditional write: only the requester\'s own still-pending row', () => {
  expect(svc.withdrawWhere('r1', 'u1')).toEqual({ id: 'r1', requestedById: 'u1', status: 'pending' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-koreksi-saya.test.js`

Expected: FAIL.
- `mine.status` is 403 for the cancel-only account.
- `svc.withdrawWhere is not a function`.

- [ ] **Step 3: Implement**

`distribution.routes.js`:

```js
router.get('/change-requests/mine', requireAnyCap(['distribusiKoreksi', 'distribusiVoid']), ctrl.listMyChangeRequests);
router.post('/change-requests/:id/withdraw', requireAnyCap(['distribusiKoreksi', 'distribusiVoid']), validate({ params: ctrl.schemas.idParams }), ctrl.withdrawChangeRequest);
```

(Replace the two existing lines, which use `requireCap('distribusiKoreksi')`.)

`distribution.service.js`: replace `withdrawChangeRequest` with:

```js
// Withdraw a request the caller submitted, while it is still pending. ONE conditional write (own +
// pending), so an approval landing between the read and the write can never be turned into 'withdrawn'.
const withdrawWhere = (id, actorId) => ({ id, requestedById: actorId, status: 'pending' });
async function withdrawChangeRequest(id, actor) {
  const req = await prisma.distChangeRequest.findUnique({ where: { id } });
  if (!req || !actor || req.requestedById !== actor.id) throw ApiError.notFound('Pengajuan tidak ditemukan.');
  if (req.status !== 'pending') throw ApiError.badRequest('Pengajuan ini sudah diputuskan — tidak bisa ditarik.');
  const snap = await actorSnap(actor);
  const res = await prisma.distChangeRequest.updateMany({ where: withdrawWhere(id, actor.id), data: { status: 'withdrawn', decidedById: snap.actorId, decidedByName: snap.actorName, decidedByRole: snap.actorRole, decisionNote: 'ditarik oleh pemohon', decidedAt: new Date() } });
  if (!res.count) throw ApiError.badRequest('Pengajuan ini sudah diputuskan — tidak bisa ditarik.');
  const updated = await prisma.distChangeRequest.findUnique({ where: { id } });
  await logAudit('koreksi', 'Tarik pengajuan', `${req.kind} · ${shortRefServer(req.transactionId)}`, snap, req.fleetId);
  return changeRequestClient(updated);
}
```

Add `withdrawWhere,` to `module.exports` next to `withdrawChangeRequest`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-koreksi-saya.test.js tests/change-request.test.js tests/authz-identity-lint.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tests/field-koreksi-saya.test.js server/src/services/distribution.service.js server/src/routes/distribution.routes.js
git commit -m "fix(distribusi): Koreksi saya for cancel-only accounts; withdraw can never overwrite a decision"
```

---

## Task 3: Server — balapan clientRef, balasan ulang lengkap, setoran yang sudah ditutup

**Files:**
- Modify: `server/src/services/distribution.service.js`:
  - `createTransaction`
  - `gallonDamageCharge`
  - `createExpense`
  - `daySummary`
  - `closeDay`
  - exports
- Test: `server/tests/txn-client-ref.test.js` (append)
- Test: `server/tests/field-day-closeout.test.js` (new)

**Interfaces:**
- Produces:
  - `onClientRefClash(err, again)` (exported). It resolves `again()` when `err` is a P2002 on `clientRef` and `again()` finds the row; otherwise it re-throws `err`.
  - A replayed sale carries `gallonOut` / `gallonIn`.
  - `daySummary` returns `closeout: { closedAt, closedByName, generalNote, … } | null`.
  - `closeDay` keeps the earlier note when the new one is empty.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/txn-client-ref.test.js`:

```js
describe('Final 3C: replay shape + simultaneous requests', () => {
  const svc = require('../src/services/distribution.service');
  it('a replayed sale reports its gallons like a fresh one', async () => {
    const body = { customerId: cA, qty: 3, gallonOut: 3, gallonIn: 1, method: 'lunas', txnDate: today, clientRef: 'ref-gal-0001' };
    const r1 = await request(app).post(`${D}/transactions`).set(auth(gm)).send(body);
    const r2 = await request(app).post(`${D}/transactions`).set(auth(gm)).send(body);
    expect(r2.body.data).toMatchObject({ id: r1.body.data.id, replay: true, gallonOut: 3, gallonIn: 1 });
  });
  it('a unique clash on clientRef (two requests at once) answers with the saved row', async () => {
    const clash = Object.assign(new Error('Unique constraint'), { code: 'P2002', meta: { target: ['clientRef'] } });
    await expect(svc.onClientRefClash(clash, async () => ({ id: 'saved', replay: true }))).resolves.toEqual({ id: 'saved', replay: true });
    await expect(svc.onClientRefClash(clash, async () => null)).rejects.toBe(clash);
    const other = Object.assign(new Error('x'), { code: 'P2002', meta: { target: ['code'] } });
    await expect(svc.onClientRefClash(other, async () => ({ id: 'x' }))).rejects.toBe(other);
  });
});
```

Create `server/tests/field-day-closeout.test.js`:

```js
'use strict';
// SETORAN (Mode Lapangan 3C): the day summary says when the day was already closed, and closing again
// keeps the earlier note unless a new one is written.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
let gm;
const sum = async () => (await request(app).get(`${D}/deliveries/day-summary?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
const close = (generalNote) => request(app).post(`${D}/deliveries/close`).set(auth(gm)).send({ date: today, fleet: 'DK 1', reasons: {}, generalNote });

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'dc_gm', password: 'secret123', role: 'gm' })).body.token;
});
afterAll(() => prisma.$disconnect());

it('not closed yet → closeout null; closed → when, who, the note', async () => {
  expect((await sum()).closeout).toBeNull();
  expect((await close('setor lengkap')).status).toBe(200);
  expect((await sum()).closeout).toMatchObject({ closedByName: 'Boss', generalNote: 'setor lengkap' });
});
it('closing again with no note keeps the earlier note; a new note replaces it', async () => {
  await close('');
  expect((await sum()).closeout.generalNote).toBe('setor lengkap');
  await close('kurang 1 galon');
  expect((await sum()).closeout.generalNote).toBe('kurang 1 galon');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/txn-client-ref.test.js tests/field-day-closeout.test.js`

Expected: FAIL.
- `gallonOut` is undefined on the replay.
- `svc.onClientRefClash is not a function`.
- `closeout` is undefined.
- The note is overwritten with ''.

If the close route answers other than 200, read `closeDay`'s controller and use its real status in both tests before going on.

- [ ] **Step 3: Implement**

In `distribution.service.js`, right after `replayByClientRef`, add:

```js
// The answer to a retried sale / bon payment: the saved row with its gallons, exactly like a fresh one.
async function saleReplay(ref, customerId) {
  const rp = await replayByClientRef(ref, customerId);
  if (!rp) return null;
  const g = isGallonSale(rp.txn) ? await currentGallonsOf(rp.txn.id) : { gallonOut: 0, gallonIn: 0 };
  return { ...rp.txn, ...g, gallonsHeld: rp.gallonsHeld, sisaBon: rp.sisaBon, replay: true, ...(rp.txn.method === 'pelunasan' ? { isPayment: true } : {}) };
}
// Two requests with the same clientRef at once: both pass the replay check, the second create hits the
// unique index. Answer it with the row the first one saved (never a generic 409).
async function onClientRefClash(err, again) {
  const target = JSON.stringify((err && err.meta && err.meta.target) || '');
  if (err && err.code === 'P2002' && target.includes('clientRef')) {
    const row = await again();
    if (row) return row;
  }
  throw err;
}
```

In `createTransaction`:
- replace `const replay = await replayByClientRef(body.clientRef, customer.id);` and the next line with:

  ```js
  const replay = await saleReplay(body.clientRef, customer.id);
  if (replay) return replay;
  ```

- For BOTH `const txn = await prisma.$transaction(async (tx) => {` blocks (pelunasan and sale), change the opening to `let clash = null;` + `const txn = await prisma.$transaction(async (tx) => {`.
- Change the closing `});` of that `$transaction` to:

  ```js
  }).catch(async (e) => { clash = await onClientRefClash(e, () => saleReplay(clientRef, customer.id)); return null; });
  if (clash) return clash;
  ```

In `gallonDamageCharge`:
- wrap its `$transaction` the same way;
- set `clash` to `onClientRefClash(e, async () => { const rp = await replayByClientRef(body.clientRef, customer.id); return rp && { transaction: rp.txn, gallonsHeld: rp.gallonsHeld, sisaBon: rp.sisaBon, replay: true }; })`;
- add `if (clash) return clash;` right after it.

In `createExpense`:
- replace the `if (body.clientRef) { … }` replay block with:

  ```js
  // A retry after a lost response (same clientRef) returns the expense already saved.
  const expenseReplay = async () => {
    if (!body.clientRef) return null;
    const prev = await prisma.distExpense.findUnique({ where: { clientRef: String(body.clientRef) } });
    if (!prev) return null;
    if (prev.fleetId !== fleetId) throw ApiError.conflict('Kode pengeluaran ini sudah dipakai untuk armada lain.');
    return { ...expenseClient(prev), replay: true };
  };
  const again = await expenseReplay();
  if (again) return again;
  ```

- Wrap the expense `$transaction` with `let clash = null;` … `.catch(async (e) => { clash = await onClientRefClash(e, expenseReplay); return null; });` and add `if (clash) return clash;` after it.

In `daySummary`, after `out.koreksiMenunggu = await prisma.distChangeRequest.count({ where: { fleetId, status: 'pending' } });` add:

```js
  // Already closed today? The phone says so (and asks before closing again).
  const co = await prisma.deliveryCloseout.findUnique({ where: { date_fleetId: { date, fleetId } } });
  out.closeout = co ? closeoutClient(co) : null;
```

In `closeDay`'s upsert `update:` replace `generalNote: String(body.generalNote || '').slice(0, 500),` with:

```js
...(String(body.generalNote || '').trim() ? { generalNote: String(body.generalNote).slice(0, 500) } : {}),
```

(Only in `update`; `create` keeps its line.)

Add `onClientRefClash,` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/txn-client-ref.test.js tests/field-day-closeout.test.js tests/field-day-summary.test.js tests/carry-over.test.js`

Expected: PASS. If a listed file does not exist, drop it from the command. Run instead `npx jest --runInBand -t "close"`, scoped to any file whose name contains `closeout`.

- [ ] **Step 5: Commit**

```bash
git add server/tests/txn-client-ref.test.js server/tests/field-day-closeout.test.js server/src/services/distribution.service.js
git commit -m "fix(distribusi): clientRef clash answers with the saved row; replay carries gallons; day summary knows the day is closed"
```

---

## Task 4: Adaptor + Mode latihan — pratinjau koreksi/pindah, pengajuan berbentuk server, setoran tertutup

**Files:**
- Modify: `api.js` (`API.distribusi.field`)
- Modify: `dist-field-api.js` (`METHODS`, `real`)
- Modify: `dist-field-sandbox.js`:
  - `pushRequest`
  - `customerDetail`
  - `requestCorrection`
  - new `previewCorrection`, `previewReassign`
  - `daySummary`
  - `closeDay`
- Test: `server/tests/field-sandbox.test.js` (append)
- Test: `server/tests/field-api.test.js` (update counts + append)
- Test: `server/tests/api-client-field.test.js` (update names + append)

**Interfaces:**
- Consumes (Task 1): server preview `{ oldAmount, newAmount, oldSisaBon, newSisaBon, wouldGoNegative, payMethod, requestedPayMethod }`.
- Consumes (Task 1): request `{ id, kind, status, customerId, customerName, txnRef, current, requested, decisionNote, createdAt }`.
- Consumes (Task 1): reassign preview `{ fromCustomer, toCustomer, count, blocks }`.
- Produces:
  - `api.previewCorrection(txnId, body)` and `api.previewReassign(body)` in both adaptors. `METHODS.length === 33`.
  - Practice `customerDetail(id).transactions[]` carries:
    - `unitPriceLocked`, `gallonOut`, `gallonIn`;
    - `proofPhotoId`, `proofLat`, `proofLng`;
    - `payMethod`;
    - `pendingRequest`.
  - Practice requests have the server shape.
  - Practice `daySummary().closeout`.
  - Real `myChangeRequests` turns 403 into `[]`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/field-sandbox.test.js`:

```js
describe('Plan 3C: corrections in practice follow the server', () => {
  const sale = async (api, cid, method, extra) => { const ph = await api.uploadPhoto({ data: 'x' }); return api.createSale(Object.assign({ customerId: cid, qty: 2, gallonOut: 2, method, payMethod: 'tunai', proofPhotoId: ph.id, proofLat: -8.6, proofLng: 115.2 }, extra || {})); };
  it('preview + transfer needs a photo + the request has the server shape + it shows as pending on the transaction', async () => {
    const { api } = make();
    const t = await sale(api, 'c2', 'lunas');
    const body = { qty: 2, unitPrice: 18000, gallonOut: 2, gallonIn: 0, method: 'lunas', payMethod: 'transfer' };
    expect(await api.previewCorrection(t.id, body)).toMatchObject({ oldAmount: 36000, newAmount: 36000, payMethod: 'tunai', requestedPayMethod: 'transfer' });
    expect(await code(api.requestCorrection(t.id, Object.assign({ reason: 'transfer' }, body)))).toBe('PROOF_REQUIRED');
    const ph = await api.uploadPhoto({ data: 'y' });
    await api.requestCorrection(t.id, Object.assign({ reason: 'transfer', proofPhotoId: ph.id }, body));
    const r = (await api.myChangeRequests())[0];
    expect(r).toMatchObject({ kind: 'correction', status: 'pending', customerId: 'c2', customerName: 'Bu Ketut', transactionId: t.id, current: { method: 'lunas', payMethod: 'tunai' }, requested: { payMethod: 'transfer' } });
    const d = await api.customerDetail('c2');
    expect(d.transactions[0]).toMatchObject({ id: t.id, unitPriceLocked: 18000, gallonOut: 2, gallonIn: 0, proofLat: -8.6, pendingRequest: { id: r.id } });
    expect((await api.withdrawRequest(r.id)).status).toBe('withdrawn');
  });
  it('moving a bon sale to another customer previews both customers\' bon and gallons', async () => {
    const { api } = make();
    const t = await sale(api, 'c1', 'bon', { qty: 1, gallonOut: 1 });
    const p = await api.previewReassign({ fromCustomerId: 'c1', toCustomerId: 'c2', transactionIds: [t.id] });
    expect(p.fromCustomer).toMatchObject({ id: 'c1', sisaBonBefore: 63000, sisaBonAfter: 45000, gallonsBefore: 7, gallonsAfter: 6 });
    expect(p.toCustomer).toMatchObject({ id: 'c2', sisaBonBefore: 0, sisaBonAfter: 18000, gallonsBefore: 3, gallonsAfter: 4 });
  });
  it('the day summary knows the day is closed; closing again keeps one closeout and the earlier note', async () => {
    const { api } = make();
    expect((await api.daySummary()).closeout).toBeNull();
    await api.closeDay({ reasons: { s1: 'tutup', s2: 'tutup' }, generalNote: 'n1' });
    expect((await api.daySummary()).closeout).toMatchObject({ generalNote: 'n1' });
    await api.closeDay({ reasons: {}, generalNote: '' });
    expect((await api.daySummary()).closeout.generalNote).toBe('n1');
    expect(api.exportState().closeouts.length).toBe(1);
  });
});
```

In `server/tests/field-api.test.js`:
- add `'previewCorrect', 'previewReassign'` to the end of `FIELD_NAMES`;
- change every `toBe(31)` to `toBe(33)`;
- append:

```js
describe('Plan 3C adaptor', () => {
  it('the previews reach the tagged endpoints; Koreksi saya without the right is an empty list', async () => {
    const calls = [];
    const F = {}; FIELD_NAMES.forEach((m) => { F[m] = (...a) => { calls.push([m, a]); return Promise.resolve({ data: { ok: m } }); }; });
    F.myChangeRequests = () => Promise.reject(Object.assign(new Error('no'), { status: 403 }));
    const real = FA.real({ distribusi: { field: F } }, { date: '2026-10-01', fleet: 'DK 1' });
    expect(await real.previewCorrection('t1', { qty: 1 })).toEqual({ ok: 'previewCorrect' });
    expect(calls.pop()).toEqual(['previewCorrect', ['t1', { qty: 1 }]]);
    expect(await real.previewReassign({ fromCustomerId: 'a' })).toEqual({ ok: 'previewReassign' });
    expect(await real.myChangeRequests()).toEqual([]);
    expect(FA.METHODS).toEqual(expect.arrayContaining(['previewCorrection', 'previewReassign']));
  });
});
```

In `server/tests/api-client-field.test.js`, add `'previewCorrect', 'previewReassign'` to the names list (line 42) and append:

```js
it('Plan 3C: the correction previews are field calls (tagged)', async () => {
  const { API, calls } = loadApi();
  await API.distribusi.field.previewCorrect('t1', { qty: 1 });
  await API.distribusi.field.previewReassign({ fromCustomerId: 'a' });
  expect(calls[0].url).toBe('http://x/api/v1/distribusi/transactions/t1/corrections/preview');
  expect(calls[1].url).toBe('http://x/api/v1/distribusi/change-requests/reassign/preview');
  calls.forEach((c) => { expect(c.method).toBe('POST'); expect(c.headers['X-Airro-Ui']).toBe('field'); });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-sandbox.test.js tests/field-api.test.js tests/api-client-field.test.js`

Expected: FAIL.
- `api.previewCorrection is not a function`.
- `METHODS.length` is 31.
- `API.distribusi.field.previewCorrect is not a function`.

- [ ] **Step 3: Implement**

`api.js`, in the `field: {` block, after the `correct:` line:

```js
        previewCorrect: (id, body) => freq('POST', '/distribusi/transactions/' + id + '/corrections/preview', body),
        previewReassign: (body) => freq('POST', '/distribusi/change-requests/reassign/preview', body),
```

`dist-field-api.js`:
- `METHODS`: add `'previewCorrection', 'previewReassign'` after `'requestReassign'`.
- In `real`, replace the `myChangeRequests` line with:

```js
      // Koreksi saya needs distribusiKoreksi or distribusiVoid — without either it is an empty list.
      myChangeRequests: function () { return U(F.myChangeRequests()).catch(function (e) { if (e && e.status === 403) return []; throw e; }); },
```

- Also in `real`, after `requestReassign`, add:

```js
      previewCorrection: function (id, b) { return U(F.previewCorrect(id, b)); },
      previewReassign: function (b) { return U(F.previewReassign(b)); },
```

`dist-field-sandbox.js`:

(a) Replace `pushRequest` with a server-shaped request:

```js
    function refOf(id) { return String(id || '').slice(-6).toUpperCase(); }
    function pushRequest(t, kind, body) {
      var b = body || {};
      if (!String(b.reason || '').trim()) throw fail(400, 'Alasan wajib diisi.');
      if (s.requests.some(function (r) { return r.transactionId === t.id && r.status === 'pending'; })) throw fail(400, 'Sudah ada pengajuan menunggu persetujuan untuk transaksi ini.');
      var payload = Object.assign({}, b); delete payload.reason;
      var c = s.customers[t.customerId] || {};
      var r = { id: nid('req'), transactionId: t.id, customerId: t.customerId, customerName: c.name || '', customerCode: c.code || '', txnRef: refOf(t.id), txnDate: t.txnDate,
        kind: kind, status: 'pending', reason: String(b.reason), payload: payload, createdAt: now().getTime(), decisionNote: '',
        current: { qty: t.qty, amount: t.amount, method: t.method, payMethod: t.payMethod || '' },
        requested: kind === 'correction' ? { qty: payload.qty, amount: payload.amount, method: payload.method || t.method, payMethod: payload.payMethod } : null };
      if (kind === 'reassign') { var to = s.customers[payload.toCustomerId] || {}; r.fromCustomerId = t.customerId; r.toCustomerId = payload.toCustomerId; r.toCustomerName = to.name || ''; r.transactionIds = payload.transactionIds || [t.id]; }
      s.requests.push(r); return r;
    }
    function pendingOf(txnId) { var r = s.requests.find(function (x) { return x.status === 'pending' && (x.transactionId === txnId || (x.transactionIds || []).indexOf(txnId) >= 0); }); return r ? { id: r.id, kind: r.kind } : null; }
```

(b) In `customerDetail`, replace the `.map(function (t) { return { … }; })` with:

```js
          .map(function (t) { return { id: t.id, txnDate: t.txnDate, method: t.method, kind: t.kind, qty: t.qty, unitPriceLocked: t.unitPriceLocked, amount: t.amount, effectiveAmount: t.amount, status: t.status, payMethod: t.payMethod || '', gallonOut: t.gallonOut || 0, gallonIn: t.gallonIn || 0, proofPhotoId: t.proofPhotoId || null, proofLat: t.proofLat != null ? t.proofLat : null, proofLng: t.proofLng != null ? t.proofLng : null, createdAt: t.createdAt, pendingRequest: pendingOf(t.id) }; });
```

(c) Add a shared correction check and the two previews next to `requestCorrection`. Then replace `requestCorrection` itself:

```js
    // Same rules as the server's normalizeCorrection (preview skips the transfer photo).
    function correctionPlan(t, b, preview) {
      if (t.kind === 'ganti_rugi') throw fail(400, 'Ganti rugi galon tidak bisa dikoreksi — ajukan pembatalan lalu catat ulang.');
      var c = s.customers[t.customerId] || {};
      if (t.method === 'pelunasan') {
        var amt = int(b.amount); if (amt <= 0) throw fail(400, 'Jumlah harus lebih dari 0.');
        return { newAmount: amt, method: 'pelunasan', payMethod: t.payMethod || '', bonDelta: t.amount - amt, sisaBon: c.sisaBon };
      }
      var qty = int(b.qty); if (qty <= 0) throw fail(400, 'Jumlah galon harus lebih dari 0.');
      var method = b.method === 'bon' || b.method === 'lunas' ? b.method : t.method;
      var payMethod = method === 'bon' ? '' : (b.payMethod === 'transfer' ? 'transfer' : b.payMethod === 'tunai' ? 'tunai' : (t.payMethod || 'tunai'));
      if (payMethod === 'transfer' && !(t.method === 'lunas' && t.payMethod === 'transfer') && !preview) {
        if (!b.proofPhotoId) throw fail(400, 'Foto bukti transfer wajib dilampirkan.', 'PROOF_REQUIRED');
        if (!photoOk(b.proofPhotoId)) throw fail(400, 'Foto bukti transfer tidak ditemukan — unggah ulang fotonya.', 'PROOF_MISSING');
      }
      var newAmount = qty * t.unitPriceLocked;
      return { newAmount: newAmount, method: method, payMethod: payMethod, bonDelta: (method === 'bon' ? newAmount : 0) - (t.method === 'bon' ? t.amount : 0), sisaBon: c.sisaBon };
    }
```

```js
      previewCorrection: run(function (txnId, body) {
        var t = txnOf(txnId); var p = correctionPlan(t, body || {}, true);
        return { oldAmount: t.amount, newAmount: p.newAmount, delta: p.newAmount - t.amount, method: t.method, requestedMethod: p.method, methodChanged: p.method !== t.method,
          payMethod: t.payMethod || '', requestedPayMethod: p.payMethod, oldSisaBon: p.sisaBon, newSisaBon: Math.max(0, p.sisaBon + p.bonDelta), bonDelta: p.bonDelta, wouldGoNegative: p.sisaBon + p.bonDelta < 0 };
      }),
      previewReassign: run(function (body) {
        var b = body || {}; var ids = b.transactionIds || [];
        if (!ids.length) throw fail(400, 'Pilih transaksi yang dipindahkan.');
        var from = cust(b.fromCustomerId); var to = cust(b.toCustomerId);
        if (from.id === to.id) throw fail(400, 'Pelanggan tujuan harus berbeda dari pelanggan asal.');
        var bon = 0; var gal = 0;
        ids.forEach(function (i) { var t = txnOf(i); if (t.kind === 'ganti_rugi') throw fail(400, 'Ganti rugi galon tidak bisa dipindahkan ke pelanggan lain — ajukan pembatalan lalu catat ulang.'); if (t.method === 'bon') bon += t.amount; gal += (t.gallonOut || 0) - (t.gallonIn || 0); });
        return { fromCustomer: { id: from.id, name: from.name, code: from.code || '', sisaBonBefore: from.sisaBon, sisaBonAfter: Math.max(0, from.sisaBon - bon), gallonsBefore: from.gallonsHeld, gallonsAfter: from.gallonsHeld - gal },
          toCustomer: { id: to.id, name: to.name, code: to.code || '', sisaBonBefore: to.sisaBon, sisaBonAfter: to.sisaBon + bon, gallonsBefore: to.gallonsHeld, gallonsAfter: to.gallonsHeld + gal }, count: ids.length, blocks: [] };
      }),
      requestCorrection: run(function (txnId, body) {
        var t = txnOf(txnId); correctionPlan(t, body || {}, false);
        return W(pushRequest(t, 'correction', body));
      }),
```

(d) In `daySummary`, before `return out;` add:

```js
        var co = s.closeouts.filter(function (x) { return x.date === s.date && x.fleetId === s.fleet; })[0];
        out.closeout = co ? { closedAt: co.closedAt, closedByName: co.closedByName, generalNote: co.generalNote } : null;
```

(e) In `closeDay`, keep one closeout and the earlier note. Replace the line that builds `co` and the `s.closeouts.push(co);` with:

```js
        var prev = s.closeouts.filter(function (x) { return x.date === s.date && x.fleetId === s.fleet; })[0];
        var note = String(b.generalNote || '').trim() ? String(b.generalNote).slice(0, 500) : (prev ? prev.generalNote : '');
        var co = { id: prev ? prev.id : nid('close'), date: s.date, fleetId: s.fleet, closedByName: null, closedAt: now().getTime(), generalNote: note, delivered: delivered, pending: pend.length };
        s.closeouts = s.closeouts.filter(function (x) { return x !== prev; }).concat([co]);
```

(Keep whatever `closeDay` returns after that, using this `co`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-sandbox.test.js tests/field-api.test.js tests/api-client-field.test.js tests/field-logic.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api.js dist-field-api.js dist-field-sandbox.js server/tests/field-sandbox.test.js server/tests/field-api.test.js server/tests/api-client-field.test.js
git commit -m "feat(distribusi): field adaptors preview corrections and moves; practice requests take the server's shape; closed-day summary"
```

---

## Task 5: FIELDLOGIC — koreksi, Koreksi saya, titik setelah atur pin, bon tertua

**Files:**
- Modify: `dist-field-logic.js`
- Test: `server/tests/field-logic.test.js` (append)

**Interfaces:**
- Produces (all on `FIELDLOGIC`):
  - **`payOf(t)`** → `'lunas'|'bon'|'transfer'|'pelunasan'`.
  - **`koreksiOptions(t, can)`** → ordered subset of `['pelanggan','jumlah','bayar','nominal','batal']`. `can = { correct, void }`.
  - **`koreksiCheck({ t, kind, change, preview })`** → `''` or a `fld.*` key.
  - **`correctionBody(t, change)`** → the FULL server payload:
    - sale: `{ qty, unitPrice, gallonOut, gallonIn, method, payMethod?, proofPhotoId? }`;
    - pelunasan: `{ amount }`.
  - **`koreksiReason(kind, t, change, text)`** → the reason string (Indonesian pay summary appended for `bayar`).
  - **`nearCustomers(customers, pt, excludeId, n)`** → `[{ …customer, meters }]`, nearest first.
  - **`requestView(r)`** → `{ statusKey, tone, kindKey, lines: [[key, vars]], canWithdraw, canResubmit, target: { transactionId, customerId } }`.
  - **`afterPin(back, custId, pt)`** → the back view with the customer's new point merged.
  - **`openBons`** ignores `bonCounted === false`.
  - `pinMove` now uses the shared `distM(a, b)`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/field-logic.test.js`:

```js
describe('Plan 3C: koreksi logic', () => {
  const sale = (o) => Object.assign({ id: 't1', kind: 'jual', method: 'lunas', payMethod: 'tunai', qty: 3, unitPriceLocked: 18000, amount: 54000, gallonOut: 3, gallonIn: 1, status: 'active' }, o);
  it('pay method of a row', () => {
    expect(L.payOf(sale())).toBe('lunas');
    expect(L.payOf(sale({ payMethod: 'transfer' }))).toBe('transfer');
    expect(L.payOf(sale({ method: 'bon', payMethod: '' }))).toBe('bon');
    expect(L.payOf({ method: 'pelunasan' })).toBe('pelunasan');
  });
  it('what may be corrected, by kind of row and by right', () => {
    const both = { correct: true, void: true };
    expect(L.koreksiOptions(sale(), both)).toEqual(['pelanggan', 'jumlah', 'bayar', 'batal']);
    expect(L.koreksiOptions(sale(), { void: true })).toEqual(['batal']);
    expect(L.koreksiOptions(sale(), { correct: true })).toEqual(['pelanggan', 'jumlah', 'bayar']);
    expect(L.koreksiOptions({ id: 'p', method: 'pelunasan', kind: 'jual', qty: 0, amount: 5000, status: 'active' }, both)).toEqual(['nominal', 'batal']);
    expect(L.koreksiOptions(sale({ kind: 'ganti_rugi', qty: 0 }), both)).toEqual(['batal']);
    expect(L.koreksiOptions(sale({ status: 'void' }), both)).toEqual([]);
  });
  it('the payload is always complete (missing gallon fields would become 0 on the server)', () => {
    expect(L.correctionBody(sale(), { pay: 'transfer', photo: { id: 'ph' } })).toEqual({ qty: 3, unitPrice: 18000, gallonOut: 3, gallonIn: 1, method: 'lunas', payMethod: 'transfer', proofPhotoId: 'ph' });
    expect(L.correctionBody(sale(), { pay: 'bon' })).toEqual({ qty: 3, unitPrice: 18000, gallonOut: 3, gallonIn: 1, method: 'bon', payMethod: '' });
    expect(L.correctionBody(sale(), { qty: 4, gallonIn: 2 })).toEqual({ qty: 4, unitPrice: 18000, gallonOut: 4, gallonIn: 2, method: 'lunas' });
    expect(L.correctionBody(sale({ gallonOut: 5 }), { qty: 2 })).toMatchObject({ qty: 2, gallonOut: 4 });   // extra gallons out stay extra
    expect(L.correctionBody({ method: 'pelunasan', amount: 5000 }, { amount: 7000 })).toEqual({ amount: 7000 });
  });
  it('what still blocks sending', () => {
    const t = sale();
    expect(L.koreksiCheck({ t, kind: 'jumlah', change: { qty: 3, gallonIn: 1 } })).toBe('fld.kNoChange');
    expect(L.koreksiCheck({ t, kind: 'jumlah', change: { qty: 0, gallonIn: 1 } })).toBe('fld.kQtyMin');
    expect(L.koreksiCheck({ t, kind: 'jumlah', change: { qty: 4, gallonIn: 1 } })).toBe('');
    expect(L.koreksiCheck({ t, kind: 'bayar', change: { pay: 'lunas' } })).toBe('fld.kNoChange');
    expect(L.koreksiCheck({ t, kind: 'bayar', change: { pay: 'transfer' } })).toBe('fld.kNeedTransferPhoto');
    expect(L.koreksiCheck({ t, kind: 'bayar', change: { pay: 'transfer' }, preview: true })).toBe('');
    expect(L.koreksiCheck({ t, kind: 'bayar', change: { pay: 'transfer', photo: { id: 'p' } } })).toBe('');
    expect(L.koreksiCheck({ t: { method: 'pelunasan', amount: 5000 }, kind: 'nominal', change: { amount: 5000 } })).toBe('fld.kNoChange');
    expect(L.koreksiCheck({ t: { method: 'pelunasan', amount: 5000 }, kind: 'nominal', change: { amount: null } })).toBe('fld.kAmountMin');
    expect(L.koreksiCheck({ t, kind: 'pelanggan', change: {} })).toBe('fld.kPickCust');
    expect(L.koreksiCheck({ t, kind: 'batal', change: {} })).toBe('');
  });
  it('the reason tells the office a pay change in Indonesian (the old inbox shows no pay method)', () => {
    expect(L.koreksiReason('bayar', sale(), { pay: 'transfer' }, ' dibayar transfer ')).toBe('dibayar transfer [cara bayar: Lunas → Transfer]');
    expect(L.koreksiReason('jumlah', sale(), { qty: 4 }, 'salah hitung')).toBe('salah hitung');
  });
  it('customers nearest to where the photo was taken', () => {
    const cs = [{ id: 'a', lat: -8.6001, lng: 115.2 }, { id: 'b', lat: -8.7, lng: 115.3 }, { id: 'c' }, { id: 'me', lat: -8.6, lng: 115.2 }];
    const n = L.nearCustomers(cs, { lat: -8.6, lng: 115.2 }, 'me', 2);
    expect(n.map((c) => c.id)).toEqual(['a', 'b']);
    expect(n[0].meters).toBeLessThan(20);
  });
  it('Koreksi saya rows', () => {
    const v = L.requestView({ id: 'r', kind: 'correction', status: 'rejected', transactionId: 't1', customerId: 'c1', current: { qty: 3, method: 'lunas', payMethod: 'tunai', amount: 54000 }, requested: { qty: 4, method: 'lunas', payMethod: 'transfer' } });
    expect(v).toMatchObject({ statusKey: 'fld.rq_rejected', tone: 'neg', kindKey: 'fld.rk_correction', canWithdraw: false, canResubmit: true, target: { transactionId: 't1', customerId: 'c1' } });
    expect(v.lines).toEqual([['fld.rl_qty', { a: 3, b: 4 }], ['fld.rl_pay', { a: 'lunas', b: 'transfer' }]]);
    const m = L.requestView({ kind: 'reassign', status: 'pending', transactionIds: ['t9'], fromCustomerId: 'c1', toCustomerName: 'Bu Ketut' });
    expect(m).toMatchObject({ canWithdraw: true, canResubmit: false, target: { transactionId: 't9', customerId: 'c1' }, lines: [['fld.rl_to', { name: 'Bu Ketut' }]] });
  });
  it('after a pin is saved, the screen we go back to has the new point', () => {
    expect(L.afterPin({ name: 'complete', cust: { id: 'c1', lat: null } }, 'c1', { lat: 1, lng: 2 })).toEqual({ name: 'complete', cust: { id: 'c1', lat: 1, lng: 2 } });
    expect(L.afterPin({ name: 'addStop', preset: { id: 'c1' } }, 'c1', { lat: 1, lng: 2 }).preset).toEqual({ id: 'c1', lat: 1, lng: 2 });
    expect(L.afterPin({ name: 'addStop' }, 'c1', { lat: 1, lng: 2 })).toEqual({ name: 'addStop' });
  });
  it('archived (not counted) bons are not listed as open', () => {
    expect(L.openBons([{ id: 'a', method: 'bon', amount: 1000, txnDate: '2026-09-01', bonCounted: false }, { id: 'b', method: 'bon', amount: 2000, txnDate: '2026-09-02' }]).map((b) => b.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js`

Expected: FAIL. The new FIELDLOGIC functions do not exist yet, and `openBons` lists `a`.

- [ ] **Step 3: Implement**

In `dist-field-logic.js`, replace the body of `pinMove` with a shared helper:

```js
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
```

In `openBons`, change the first line to:

```js
    var live = (transactions || []).filter(function (t) { return t.status !== 'void' && t.bonCounted !== false; });   // an archived (not counted) row is not part of Sisa Bon
```

Add before `return {` (the export object):

```js
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
    return { statusKey: st[0], tone: st[1], kindKey: RQ_KIND[x.kind] || RQ_KIND.correction, lines: lines,
      canWithdraw: x.status === 'pending', canResubmit: x.status === 'rejected' || x.status === 'withdrawn',
      target: { transactionId: x.transactionId || (x.transactionIds || [])[0] || null, customerId: x.customerId || x.fromCustomerId || null } };
  }
  // After "Atur titik" was opened from another screen, that screen gets the customer's new point.
  function afterPin(back, custId, pt) {
    if (!back) return null;
    var withPt = function (c) { return c && c.id === custId ? Object.assign({}, c, { lat: pt.lat, lng: pt.lng }) : c; };
    var out = Object.assign({}, back);
    if (back.cust) out.cust = withPt(back.cust);
    if (back.preset) out.preset = withPt(back.preset);
    return out;
  }
```

Add to the export object: `payOf: payOf, koreksiOptions: koreksiOptions, correctionBody: correctionBody, koreksiCheck: koreksiCheck, koreksiReason: koreksiReason, nearCustomers: nearCustomers, requestView: requestView, afterPin: afterPin, distM: distM`.

Note on the `requestView` qty line: `requested.qty` is present on every sale correction (the payload is complete). The line shows only when the count really changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dist-field-logic.js server/tests/field-logic.test.js
git commit -m "feat(distribusi): field koreksi logic (options, full payload, checks, nearest customers, request rows) + archived bons not open"
```

---

## Task 6: Layar Koreksi transaksi (jumlah, cara bayar, nominal, batalkan)

**Files:**
- Create: `dist-field-koreksi.jsx`
- Modify: `build.mjs` (FILES: `'dist-field-koreksi.jsx'` right after `'dist-field-cust.jsx'`)
- Modify: `dist-field-kit.jsx` (`fldCan`: `correct`, `void`)
- Modify: `finance-i18n.js` (keys below, EN + ID)
- Modify: `server/tests/field-cust-static.test.js` (build-order assertion becomes an order check)
- Test: `server/tests/field-koreksi-static.test.js` (new)

**Interfaces:**
- Consumes (Task 4): `api.customerDetail`, `api.previewCorrection`, `api.requestCorrection`, `api.requestVoid`.
- Consumes (Task 5): `FIELDLOGIC.koreksiOptions`, `payOf`, `correctionBody`, `koreksiCheck`, `koreksiReason`, `fmtRp`.
- Produces:
  - `FldKoreksi({ api, target: { transactionId, customerId }, can, onDone(msg), onBack, onSaya })`.
  - `fldCan(perms).correct` (`distribusiKoreksi`) and `.void` (`distribusiVoid`).
  - The marker comment `{/* KOREKSI-PELANGGAN */}` where Task 7 inserts the customer step.

- [ ] **Step 1: Write the failing test**

Create `server/tests/field-koreksi-static.test.js`:

```js
'use strict';
// KOREKSI (static — no browser in the server run): parses, ships between the customer screens and the
// shell, only uses its adaptor, keeps the owner's rules (reason always, approval always, transfer photo),
// and every fld.* key it writes exists in EN and ID.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('dist-field-koreksi.jsx'); const build = read('build.mjs'); const i18n = read('finance-i18n.js'); const kit = read('dist-field-kit.jsx');
const fn = (name) => { const i = src.indexOf('function ' + name + '('); expect(i).toBeGreaterThan(-1); const j = src.indexOf('\nfunction ', i + 10); return src.slice(i, j < 0 ? undefined : j); };

it('parses, ships after the customer screens and before the shell, never calls the server directly', () => {
  expect(() => parse(src, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build).toMatch(/'dist-field-cust\.jsx',\s*'dist-field-koreksi\.jsx',/);
  expect(build.indexOf("'dist-field-koreksi.jsx'")).toBeLessThan(build.indexOf("'dist-field.jsx'"));
  expect(src).not.toMatch(/window\.API|fetch\(/);
});
it('every fld.* key written literally exists in EN and ID', () => {
  const keys = [...new Set([...src.matchAll(/["'](fld\.[A-Za-z0-9_]+)["']/g)].map((m) => m[1]))];
  expect(keys.length).toBeGreaterThan(15);
  keys.forEach((k) => expect({ k, n: (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length }).toEqual({ k, n: 2 }));
  // the option labels are built as 'fld.k_' + kind
  ['pelanggan', 'jumlah', 'bayar', 'nominal', 'batal'].forEach((k) => expect((i18n.match(new RegExp("'fld\\.k_" + k + "':", 'g')) || []).length).toBe(2));
});
it('the rights decide the options (cancel needs distribusiVoid, the rest distribusiKoreksi)', () => {
  const f = kit.slice(kit.indexOf('const fldCan ='));
  expect(f).toMatch(/correct: !!p\.distribusiKoreksi/);
  expect(f).toMatch(/void: !!p\.distribusiVoid/);
  expect(fn('FldKoreksi')).toMatch(/const opts = FIELDLOGIC\.koreksiOptions\(t, can\);/);
});
describe('FldKoreksi', () => {
  const f = () => fn('FldKoreksi');
  it('a transaction with a request already waiting explains it and offers Koreksi saya (no server 400)', () => {
    expect(f()).toMatch(/t\.pendingRequest \? \(\s*<FldNotice tone="warn" title=\{trFl\('fld\.kPendingT'\)\}/);
  });
  it('the server previews the effect; sending needs a reason and nothing blocking', () => {
    expect(f()).toMatch(/api\.previewCorrection\(t\.id, FIELDLOGIC\.correctionBody\(t, change\)\)/);
    expect(f()).toMatch(/disabled=\{busy \|\| !!why \|\| !!pvErr \|\| !reason\.trim\(\)\}/);
    expect(f()).toMatch(/const why = t && kind \? FIELDLOGIC\.koreksiCheck\(\{ t, kind, change \}\) : '';/);
  });
  it('correction, cancel: the existing approval requests; the reason spells out a pay change', () => {
    expect(f()).toMatch(/api\.requestVoid\(t\.id, \{ reason: text \}\)/);
    expect(f()).toMatch(/api\.requestCorrection\(t\.id, Object\.assign\(FIELDLOGIC\.correctionBody\(t, change\), \{ reason: FIELDLOGIC\.koreksiReason\(kind, t, change, text\) \}\)\)/);
  });
  it('switching to transfer asks for the transfer receipt photo', () => {
    expect(f()).toMatch(/const needPhoto = kind === 'bayar' && pay === 'transfer' && payNow !== 'transfer';/);
    expect(f()).toMatch(/needPhoto && \(/);
    expect(f()).toMatch(/<FldPhoto api=\{api\} value=\{photo\} onChange=\{setPhoto\}/);
  });
  it('the original stays valid until approved (said on screen)', () => {
    expect(f()).toContain("'fld.kStaysValid'");
    expect(f()).toContain("'fld.kVoidNote'");
  });
});
```

In `server/tests/field-cust-static.test.js`, change

```js
  expect(build).toMatch(/'dist-field-day\.jsx',\s*'dist-field-cust\.jsx',\s*'dist-field\.jsx',/);
```

to

```js
  expect(build).toMatch(/'dist-field-day\.jsx',\s*'dist-field-cust\.jsx',/);
  expect(build.indexOf("'dist-field-cust.jsx'")).toBeLessThan(build.indexOf("'dist-field.jsx'"));   // koreksi may sit between
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-koreksi-static.test.js tests/field-cust-static.test.js`

Expected: FAIL with `ENOENT … dist-field-koreksi.jsx`.

- [ ] **Step 3: Implement**

`dist-field-kit.jsx` `fldCan`: add a line after `addStop: …, location: …,`:

```js
    correct: !!p.distribusiKoreksi, void: !!p.distribusiVoid,
```

`build.mjs`: insert `'dist-field-koreksi.jsx',` right after `'dist-field-cust.jsx',`.

Create `dist-field-koreksi.jsx`:

```jsx
// MODE LAPANGAN — KOREKSI. The driver says what is wrong with a delivered transaction; the request goes
// to the office through the existing approval engine (correction / void / reassign) and the original
// stays valid until it is approved (owner rule: every correction needs approval). "Koreksi saya" lists
// the driver's own requests. Built into the one bundle scope: top-level names start with Fld/FLD.

const FLD_KOREKSI_REASONS = ['fld.kr_salahInput', 'fld.kr_pelangganMinta', 'fld.kr_salahPelanggan'];

// KOREKSI TRANSAKSI — pick what is wrong (customer, gallon count, pay method, bon-payment amount, or
// cancel); the server previews the effect with the same calculation the approval applies; a reason is
// always asked. Switching to Transfer needs the transfer receipt photo.
function FldKoreksi({ api, target, can, onDone, onBack, onSaya }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [kind, setKind] = uSfl('');
  const [qty, setQty] = uSfl(1);
  const [gIn, setGIn] = uSfl(0);
  const [pay, setPay] = uSfl('');
  const [photo, setPhoto] = uSfl(null);
  const [amount, setAmount] = uSfl(null);
  const [toCust, setToCust] = uSfl(null);
  const [pv, setPv] = uSfl(null);
  const [pvErr, setPvErr] = uSfl('');
  const [reason, setReason] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  uEfl(() => {
    let live = true;
    api.customerDetail(target.customerId).then((x) => { if (live) setD(x); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, target.customerId]);
  const t = d ? (d.transactions || []).find((x) => x.id === target.transactionId) || null : null;
  // each kind starts from the transaction's own values
  const choose = (k) => {
    setKind(k); setPv(null); setPvErr(''); setMsg(''); setPhoto(null); setToCust(null);
    if (t) { setQty(t.qty || 1); setGIn(t.gallonIn || 0); setPay(FIELDLOGIC.payOf(t)); setAmount(t.amount); }
  };
  const change = kind === 'jumlah' ? { qty, gallonIn: gIn } : kind === 'bayar' ? { pay, photo } : kind === 'nominal' ? { amount } : kind === 'pelanggan' ? { toId: toCust ? toCust.id : null } : {};
  const why = t && kind ? FIELDLOGIC.koreksiCheck({ t, kind, change }) : '';
  const pvWhy = t && kind ? FIELDLOGIC.koreksiCheck({ t, kind, change, preview: true }) : '';
  // the server's preview of what the approval would do (a cancel needs none)
  uEfl(() => {
    if (!t || !kind || kind === 'batal' || pvWhy) { setPv(null); setPvErr(''); return undefined; }
    let live = true;
    const p = kind === 'pelanggan'
      ? api.previewReassign({ fromCustomerId: target.customerId, toCustomerId: toCust.id, transactionIds: [t.id], priceMode: 'keep' })
      : api.previewCorrection(t.id, FIELDLOGIC.correctionBody(t, change));
    p.then((x) => { if (live) { setPv(x); setPvErr(''); } }).catch((e) => { if (live) { setPv(null); setPvErr(fldErrMsg(e) || trFl('fld.loadErr')); } });
    return () => { live = false; };
  }, [kind, qty, gIn, pay, amount, toCust ? toCust.id : '', pvWhy, t ? t.id : '']);
  const send = () => {
    setBusy(true); setMsg('');
    const text = reason.trim();
    const p = kind === 'batal' ? api.requestVoid(t.id, { reason: text })
      : kind === 'pelanggan' ? api.requestReassign({ fromCustomerId: target.customerId, toCustomerId: toCust.id, transactionIds: [t.id], priceMode: 'keep', note: text, reason: text })
        : api.requestCorrection(t.id, Object.assign(FIELDLOGIC.correctionBody(t, change), { reason: FIELDLOGIC.koreksiReason(kind, t, change, text) }));
    p.then(() => onDone(trFl('fld.kSent'))).catch((e) => setMsg(fldErrMsg(e))).finally(() => setBusy(false));
  };
  const head = <FldTop title={trFl('fld.koreksiT')} sub={d ? [d.name, d.code].filter(Boolean).join(' · ') : ''} onBack={onBack} />;
  if (err) return <div className="mlap-screen">{head}<div className="mlap-body"><FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /></div></div>;
  if (!d) return <div className="mlap-screen">{head}<div className="mlap-empty">{trFl('fld.loading')}</div></div>;
  if (!t) return <div className="mlap-screen">{head}<div className="mlap-body"><FldNotice tone="warn" title={trFl('fld.kNotFound')} /></div></div>;
  const opts = FIELDLOGIC.koreksiOptions(t, can);
  const payNow = FIELDLOGIC.payOf(t);
  const needPhoto = kind === 'bayar' && pay === 'transfer' && payNow !== 'transfer';
  const rp = FIELDLOGIC.fmtRp;
  return (
    <div className="mlap-screen">
      {head}
      <div className="mlap-body">
        <div className="mlap-card mlap-sec">
          <span className="sb">{trFl('fld.kTxnLine', { date: t.txnDate, n: t.qty, pay: trFl('fld.m_' + payNow), v: rp(t.effectiveAmount != null ? t.effectiveAmount : t.amount) })}</span>
        </div>
        {t.pendingRequest ? (
          <FldNotice tone="warn" title={trFl('fld.kPendingT')} sub={trFl('fld.kPendingB')} action={onSaya ? trFl('fld.kSaya') : null} onAction={onSaya} />
        ) : !opts.length ? (
          <FldNotice tone="info" title={trFl(t.kind === 'ganti_rugi' ? 'fld.kOnlyVoid' : 'fld.kNoOptions')} />
        ) : (
          <>
            {t.kind === 'ganti_rugi' ? <FldNotice tone="info" title={trFl('fld.kOnlyVoid')} /> : null}
            <div className="mlap-eyebrow">{trFl('fld.kWhat')}</div>
            <div className="mlap-chips">{opts.map((k) => <button key={k} type="button" className={'mlap-chip-b' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => choose(k)}>{trFl('fld.k_' + k)}</button>)}</div>
            {kind === 'jumlah' && (
              <div className="mlap-card">
                <FldStepper label={trFl('fld.galOut')} value={qty} onChange={setQty} min={1} max={999} />
                <FldStepper label={trFl('fld.galBack')} value={gIn} onChange={setGIn} min={0} max={999} />
              </div>
            )}
            {kind === 'bayar' && (
              <>
                <FldSeg label={trFl('fld.k_bayar')} value={pay} onChange={setPay} options={[['lunas', trFl('fld.m_lunas')], ['bon', trFl('fld.m_bon')], ['transfer', trFl('fld.m_transfer')]]} />
                {needPhoto && (
                  <>
                    <div className="mlap-eyebrow">{trFl('fld.kTransferPhoto')} · {trFl('fld.required')}</div>
                    <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.kTransferPhotoHint" />
                  </>
                )}
              </>
            )}
            {kind === 'nominal' && <div className="mlap-card"><FldMoney label={trFl('fld.k_nominal')} value={amount} onChange={setAmount} /></div>}
            {kind === 'batal' && <FldNotice tone="warn" title={trFl('fld.kVoidNote')} />}
            {/* KOREKSI-PELANGGAN */}
            {pv && kind !== 'pelanggan' && (
              <div className="mlap-card mlap-sum">
                <div className="mlap-sumrow"><span>{trFl('fld.kAmountLine', { a: rp(pv.oldAmount), b: rp(pv.newAmount) })}</span></div>
                <div className="mlap-sumrow"><span>{trFl('fld.kBonLine', { a: rp(pv.oldSisaBon), b: rp(pv.newSisaBon) })}</span></div>
                {pv.wouldGoNegative ? <div className="mlap-warnline">{trFl('fld.kNegative')}</div> : null}
              </div>
            )}
            {pvErr ? <div className="mlap-err" role="alert">{pvErr}</div> : null}
            {kind && (
              <div className="mlap-card mlap-reason">
                <b>{trFl('fld.kReasonT')}</b>
                <FldChips options={FLD_KOREKSI_REASONS.map((k) => trFl(k)).concat([trFl('fld.r_other')])} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} />
              </div>
            )}
            {kind && kind !== 'batal' ? <div className="mlap-hint">{trFl('fld.kStaysValid')}</div> : null}
            {why ? <div className="mlap-hint">{trFl(why)}</div> : null}
            {msg && <div className="mlap-err" role="alert">{msg}</div>}
            {kind && <button type="button" className={'mlap-btn mlap-wide ' + (kind === 'batal' ? 'danger' : 'primary')} disabled={busy || !!why || !!pvErr || !reason.trim()} onClick={send}>{trFl('fld.kSend')}</button>}
          </>
        )}
      </div>
    </div>
  );
}
```

`finance-i18n.js`: add these keys in both the EN and the ID block, next to the other `fld.*` keys. Check first that none exists.

| key | EN | ID |
|---|---|---|
| fld.koreksiT | Correct transaction | Koreksi transaksi |
| fld.kWhat | What is wrong? | Apa yang salah? |
| fld.k_pelanggan | Wrong customer | Pelanggan salah |
| fld.k_jumlah | Gallon count | Jumlah galon |
| fld.k_bayar | Payment method | Cara bayar |
| fld.k_nominal | Payment amount | Nominal pembayaran |
| fld.k_batal | Cancel this transaction | Batalkan transaksi |
| fld.m_pelunasan | Bon payment | Pembayaran bon |
| fld.kTxnLine | {date} · {n} gallons · {pay} · {v} | {date} · {n} galon · {pay} · {v} |
| fld.kOnlyVoid | A gallon damage charge can't be corrected — cancel it and record it again. | Ganti rugi galon tidak bisa dikoreksi — batalkan lalu catat ulang. |
| fld.kNoOptions | Your account can't correct this transaction. | Akun ini tidak bisa mengoreksi transaksi ini. |
| fld.kNotFound | Transaction not found (it may be outside the period you can see). | Transaksi tidak ditemukan (mungkin di luar rentang yang bisa dilihat). |
| fld.kPendingT | This transaction already has a request waiting | Transaksi ini sudah punya pengajuan yang menunggu |
| fld.kPendingB | Wait for the office's decision, or withdraw it in My corrections. | Tunggu keputusan kantor, atau tarik di Koreksi saya. |
| fld.kSaya | My corrections | Koreksi saya |
| fld.kTransferPhoto | Photo of the transfer receipt | Foto bukti transfer |
| fld.kTransferPhotoHint | The transfer screen or the bank receipt. | Layar transfer atau struk bank. |
| fld.kVoidNote | The transaction is cancelled only after the office approves. Until then it stays valid. | Transaksi baru batal setelah disetujui kantor. Sampai saat itu transaksi tetap berlaku. |
| fld.kStaysValid | The original stays valid until the office approves. | Transaksi asli tetap berlaku sampai disetujui kantor. |
| fld.kAmountLine | Amount {a} → {b} | Nominal {a} → {b} |
| fld.kBonLine | Customer's bon {a} → {b} | Sisa bon pelanggan {a} → {b} |
| fld.kNegative | The customer's bon would go below zero — the office has to confirm. | Sisa bon pelanggan akan minus — kantor perlu konfirmasi. |
| fld.kReasonT | Why? | Alasannya? |
| fld.kr_salahInput | Entered wrongly | Salah input |
| fld.kr_pelangganMinta | Customer's request | Permintaan pelanggan |
| fld.kr_salahPelanggan | Wrong customer | Salah pelanggan |
| fld.kSend | Send to the office | Kirim ke kantor |
| fld.kSent | Sent to the office for approval | Dikirim ke kantor untuk disetujui |
| fld.kNoChange | Nothing changed yet | Belum ada yang diubah |
| fld.kQtyMin | At least 1 gallon | Minimal 1 galon |
| fld.kAmountMin | Enter the amount | Isi nominalnya |
| fld.kNeedTransferPhoto | Take a photo of the transfer receipt first | Ambil foto bukti transfer dulu |
| fld.kPickCust | Choose the right customer | Pilih pelanggan yang benar |

`FldPhoto` expects `hintKey` to be a key, and that key is in the table. If `fld.m_pelunasan` already exists, keep the existing one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-koreksi-static.test.js tests/field-cust-static.test.js tests/field-kit-static.test.js tests/field-shell-static.test.js tests/field-day-static.test.js`

Expected: PASS. Then `node build.mjs` from the repo root succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field-koreksi.jsx build.mjs dist-field-kit.jsx finance-i18n.js server/tests/field-koreksi-static.test.js server/tests/field-cust-static.test.js
git commit -m "feat(distribusi): field Koreksi screen — gallon count, pay method (transfer photo), bon-payment amount, cancel; office approval"
```

---

## Task 7: Koreksi — pelanggan salah (pindah ke pelanggan lain)

**Files:**
- Modify: `dist-field-koreksi.jsx` (add `FldKoreksiCust`; fill the `KOREKSI-PELANGGAN` marker)
- Modify: `dist-field.css` (row selected state)
- Modify: `finance-i18n.js`
- Test: `server/tests/field-koreksi-static.test.js` (append)

**Interfaces:**
- Consumes (Task 4): `api.customers()` (the armada's own list), `api.previewReassign`, `api.requestReassign`.
- Consumes (Task 5): `FIELDLOGIC.nearCustomers`, `customerList`.
- Produces: `FldKoreksiCust({ api, t, fromId, value, onChange })`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/field-koreksi-static.test.js`:

```js
describe('Pelanggan salah', () => {
  it('suggests the customers nearest to where the photo was taken, then a search — only the armada\'s own list', () => {
    const f = fn('FldKoreksiCust');
    expect(f).toMatch(/api\.customers\(\)/);
    expect(f).toMatch(/FIELDLOGIC\.nearCustomers\(list, pt, fromId, 5\)/);
    expect(f).toMatch(/FIELDLOGIC\.customerList\(list, \{ q, filter: 'all' \}\)\.rows\.filter\(\(c\) => c\.id !== fromId\)/);
  });
  it('previews both customers and sends a move request with the reason as its note', () => {
    const f = fn('FldKoreksi');
    expect(f).toMatch(/<FldKoreksiCust api=\{api\} t=\{t\} fromId=\{target\.customerId\} value=\{toCust\} onChange=\{setToCust\} \/>/);
    expect(f).toMatch(/\[pv\.fromCustomer, pv\.toCustomer\]\.map/);
    expect(f).toMatch(/api\.requestReassign\(\{ fromCustomerId: target\.customerId, toCustomerId: toCust\.id, transactionIds: \[t\.id\], priceMode: 'keep', note: text, reason: text \}\)/);
    expect(f).not.toContain('KOREKSI-PELANGGAN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-koreksi-static.test.js`

Expected: FAIL. `FldKoreksiCust` is not found (`indexOf` returns -1).

- [ ] **Step 3: Implement**

In `FldKoreksi`, replace the line `{/* KOREKSI-PELANGGAN */}` with:

```jsx
            {kind === 'pelanggan' && <FldKoreksiCust api={api} t={t} fromId={target.customerId} value={toCust} onChange={setToCust} />}
            {pv && kind === 'pelanggan' && (
              <div className="mlap-card mlap-sum">
                {[pv.fromCustomer, pv.toCustomer].map((c) => <div key={c.id} className="mlap-sumrow"><span>{trFl('fld.kMoveLine', { name: c.name, a: rp(c.sisaBonBefore), b: rp(c.sisaBonAfter), g: c.gallonsBefore, h: c.gallonsAfter })}</span></div>)}
              </div>
            )}
```

Append to `dist-field-koreksi.jsx`:

```jsx
// The right customer: those nearest to where this transaction's photo was taken first (that is where the
// delivery happened), then a search over the armada's own customers.
function FldKoreksiCust({ api, t, fromId, value, onChange }) {
  const [list, setList] = uSfl(null);
  const [q, setQ] = uSfl('');
  uEfl(() => { let live = true; api.customers().then((r) => { if (live) setList(r || []); }).catch(() => { if (live) setList([]); }); return () => { live = false; }; }, [api]);
  if (!list) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const pt = typeof t.proofLat === 'number' && typeof t.proofLng === 'number' ? { lat: t.proofLat, lng: t.proofLng } : null;
  const near = q.trim() || !pt ? [] : FIELDLOGIC.nearCustomers(list, pt, fromId, 5);
  const rows = q.trim() ? FIELDLOGIC.customerList(list, { q, filter: 'all' }).rows.filter((c) => c.id !== fromId).slice(0, 40) : [];
  const row = (c, sub) => (
    <button key={c.id} type="button" className={'mlap-row mlap-rowbtn' + (value && value.id === c.id ? ' on' : '')} aria-pressed={!!(value && value.id === c.id)} onClick={() => onChange(c)}>
      <span className="mlap-grow"><span className="nm">{c.name}</span><span className="sb">{sub}</span></span>
    </button>
  );
  return (
    <>
      {value ? <div className="mlap-card mlap-sec"><span className="sb">{trFl('fld.kMoveTo')}</span><b>{value.name}</b></div> : null}
      {near.length > 0 && (
        <>
          <div className="mlap-eyebrow">{trFl('fld.kNear')}</div>
          <div className="mlap-card">{near.map((c) => row(c, trFl('fld.kNearM', { m: c.meters })))}</div>
        </>
      )}
      <input className="mlap-text mlap-search" type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.length > 0 && <div className="mlap-card">{rows.map((c) => row(c, c.code || ''))}</div>}
    </>
  );
}
```

Add to `dist-field.css` before `@keyframes mlapFade`:

```css
/* KOREKSI (3C) */
.mlap-rowbtn.on { background: var(--mlap-accent-soft); box-shadow: inset 3px 0 0 var(--mlap-accent); }
```

i18n:

| key | EN | ID |
|---|---|---|
| fld.kNear | Near where it was delivered | Dekat lokasi pengantaran |
| fld.kNearM | {m} m from the photo | {m} m dari lokasi foto |
| fld.kMoveTo | Move to | Pindahkan ke |
| fld.kMoveLine | {name}: bon {a} → {b} · gallons {g} → {h} | {name}: bon {a} → {b} · galon {g} → {h} |

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-koreksi-static.test.js tests/field-shell-static.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dist-field-koreksi.jsx dist-field.css finance-i18n.js server/tests/field-koreksi-static.test.js
git commit -m "feat(distribusi): field Koreksi — wrong customer: nearest to the photo, search, both customers previewed"
```

---

## Task 8: Koreksi saya + jalan masuk (stop terkirim, Setoran, menu) + setoran tertutup

**Files:**
- Modify: `dist-field-koreksi.jsx` (add `FldKoreksiSaya`)
- Modify: `dist-field-day.jsx`:
  - `FldStopSheet`: terkirim → Koreksi button;
  - `FldSetoran`: Koreksi saya + closed state + confirm re-close.
- Modify: `dist-field.jsx`:
  - views `koreksi` / `koreksiSaya`;
  - `openFor`;
  - menu item;
  - Setoran props.
- Modify: `finance-i18n.js`
- Test: `server/tests/field-koreksi-static.test.js`, `server/tests/field-day-static.test.js`, `server/tests/field-shell-static.test.js` (append)

**Interfaces:**
- Consumes (Task 4): `api.myChangeRequests`, `api.withdrawRequest`, `daySummary().closeout`.
- Consumes (Task 5): `FIELDLOGIC.requestView`.
- Consumes (Task 6): `FldKoreksi`.
- Produces:
  - `FldKoreksiSaya({ api, tick, onResubmit(target), onBack, onChanged(msg) })`.
  - `FldSetoran({ api, ctx, tick, canKoreksi, onKoreksiSaya, onChanged })`.
  - Stop sheet `onAction('koreksi', { transactionId, customerId })`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/field-koreksi-static.test.js`:

```js
describe('Koreksi saya', () => {
  const f = () => fn('FldKoreksiSaya');
  it('lists the driver\'s own requests with their status, what was asked, and the office note', () => {
    expect(f()).toMatch(/api\.myChangeRequests\(\)/);
    expect(f()).toMatch(/const v = FIELDLOGIC\.requestView\(r\);/);
    expect(f()).toMatch(/r\.decisionNote \?/);
  });
  it('withdraw only while waiting (after a confirm); resubmit a rejected or withdrawn one', () => {
    expect(f()).toMatch(/v\.canWithdraw \?/);
    expect(f()).toMatch(/api\.withdrawRequest\(ask\.id\)/);
    expect(f()).toMatch(/v\.canResubmit && v\.target\.transactionId \?/);
    expect(f()).toMatch(/onResubmit\(v\.target\)/);
  });
});
```

Append to `server/tests/field-day-static.test.js`:

```js
describe('Plan 3C: day screens', () => {
  it('a delivered stop with a sale offers Koreksi to an account that may correct or cancel', () => {
    const f = fn('FldStopSheet');
    expect(f).toMatch(/s\.status === 'terkirim' && s\.transactionId && \(can\.correct \|\| can\.void\)/);
    expect(f).toMatch(/onAction\('koreksi', \{ transactionId: s\.transactionId, customerId: s\.customerId \}\)/);
  });
  it('Setoran opens Koreksi saya, says the day is already closed, and asks before closing again', () => {
    const f = fn('FldSetoran');
    expect(f).toMatch(/function FldSetoran\(\{ api, ctx, tick, canKoreksi, onKoreksiSaya, onChanged \}\)/);
    expect(f).toMatch(/canKoreksi \?/);
    expect(f).toMatch(/sum\.closeout \?/);
    expect(f).toMatch(/onClick=\{\(\) => \(sum\.closeout \? setAskRe\(true\) : close\(\)\)\}/);
  });
});
```

Append to `server/tests/field-shell-static.test.js`:

```js
describe('Plan 3C shell', () => {
  it('Koreksi and Koreksi saya are full-screen views opened from the stop sheet, Setoran and the menu', () => {
    expect(jsx).toMatch(/if \(act === 'koreksi'\) \{ setView\(\{ name: 'koreksi', target: c \}\); return; \}/);
    expect(jsx).toMatch(/<FldKoreksi api=\{api\} target=\{view\.target\} can=\{can\}/);
    expect(jsx).toMatch(/<FldKoreksiSaya api=\{api\} tick=\{tick\}/);
    expect(jsx).toMatch(/'koreksi', 'koreksiSaya'\]\.includes\(view\.name\)/);
    expect(jsx).toMatch(/<FldSetoran api=\{api\} ctx=\{ctx\} tick=\{tick\} canKoreksi=\{can\.correct \|\| can\.void\} onKoreksiSaya=\{\(\) => setView\(\{ name: 'koreksiSaya' \}\)\}/);
    expect(jsx).toMatch(/\(can\.correct \|\| can\.void\) && <button type="button" className="mlap-menu-item" onClick=\{\(\) => \{ setMenu\(false\); setView\(\{ name: 'koreksiSaya' \}\); \}\}>/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-koreksi-static.test.js tests/field-day-static.test.js tests/field-shell-static.test.js`

Expected: FAIL. `FldKoreksiSaya` is not found; the stop sheet and Setoran have no Koreksi; the shell has no views.

- [ ] **Step 3: Implement**

Append to `dist-field-koreksi.jsx`:

```jsx
// KOREKSI SAYA — the driver's own requests (newest first): what was asked, its status, the office's
// note. A waiting one can be withdrawn (after a confirm); a rejected or withdrawn one can be sent again.
function FldKoreksiSaya({ api, tick, onResubmit, onBack, onChanged }) {
  const [list, setList] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [ask, setAsk] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [reload, setReload] = uSfl(0);
  uEfl(() => {
    let live = true; setErr(null);
    api.myChangeRequests().then((r) => { if (live) setList(r || []); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick, reload]);
  const withdraw = () => {
    setBusy(true);
    api.withdrawRequest(ask.id).then(() => { setAsk(null); setReload((x) => x + 1); onChanged(trFl('fld.kWithdrawn')); })
      .catch((e) => { setAsk(null); setErr(e); }).finally(() => setBusy(false));
  };
  const line = ([k, v]) => trFl(k, k === 'fld.rl_pay' ? { a: trFl('fld.m_' + v.a), b: trFl('fld.m_' + v.b) } : k === 'fld.rl_amount' ? { a: FIELDLOGIC.fmtRp(v.a), b: FIELDLOGIC.fmtRp(v.b) } : v);
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.kSaya')} onBack={onBack} />
      <div className="mlap-body">
        {err ? <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /> : null}
        {!list && !err ? <div className="mlap-empty">{trFl('fld.loading')}</div> : null}
        {list && !list.length ? <div className="mlap-empty">{trFl('fld.kSayaEmpty')}</div> : null}
        {list && list.map((r) => {
          const v = FIELDLOGIC.requestView(r);
          return (
            <div key={r.id} className="mlap-card mlap-sec">
              <div className="mlap-row">
                <span className="mlap-grow"><span className="nm">{r.customerName || r.fromCustomerName || '—'}</span><span className="sb">{[trFl(v.kindKey), r.txnRef, r.txnDate].filter(Boolean).join(' · ')}</span></span>
                <span className={'mlap-tag ' + v.tone}>{trFl(v.statusKey)}</span>
              </div>
              {v.lines.map((l) => <span key={l[0]} className="sb">{line(l)}</span>)}
              {r.reason ? <span className="sb">{r.reason}</span> : null}
              {r.decisionNote ? <span className="sb"><b>{trFl('fld.kOfficeNote', { note: r.decisionNote })}</b></span> : null}
              <div className="mlap-actions">
                {v.canWithdraw ? <button type="button" className="mlap-btn" disabled={busy} onClick={() => setAsk(r)}>{trFl('fld.kWithdraw')}</button> : null}
                {v.canResubmit && v.target.transactionId ? <button type="button" className="mlap-btn primary" onClick={() => onResubmit(v.target)}>{trFl('fld.kResubmit')}</button> : null}
              </div>
            </div>
          );
        })}
      </div>
      {ask && <FldSheet title={trFl('fld.kWithdrawT')} body={trFl('fld.kWithdrawB')} confirmLabel={trFl('fld.kWithdraw')} danger onClose={() => setAsk(null)} onConfirm={withdraw} />}
    </div>
  );
}
```

`dist-field-day.jsx` `FldStopSheet`: replace

```jsx
        {s.status === 'terkirim' && <div className="mlap-note">{trFl('fld.doneNote')}</div>}
```

with

```jsx
        {s.status === 'terkirim' && s.transactionId && (can.correct || can.void)
          ? <button type="button" className="mlap-btn mlap-wide" onClick={() => onAction('koreksi', { transactionId: s.transactionId, customerId: s.customerId })}>{trFl('fld.koreksiT')}</button>
          : s.status === 'terkirim' ? <div className="mlap-note">{trFl('fld.doneNote')}</div> : null}
```

`dist-field-day.jsx` `FldSetoran`:
- signature becomes `function FldSetoran({ api, ctx, tick, canKoreksi, onKoreksiSaya, onChanged }) {`;
- add state `const [askRe, setAskRe] = uSfl(false);` after `const [reload, setReload] = uSfl(0);`;
- replace the `koreksiMenunggu` notice line with:

```jsx
      {sum.koreksiMenunggu > 0 ? <FldNotice tone="info" title={trFl('fld.koreksiWait', { n: sum.koreksiMenunggu })} sub={trFl('fld.koreksiWaitB')} action={canKoreksi ? trFl('fld.kSaya') : null} onAction={onKoreksiSaya} /> : null}
      {canKoreksi && !(sum.koreksiMenunggu > 0) ? <button type="button" className="mlap-btn mlap-wide" onClick={onKoreksiSaya}>{trFl('fld.kSaya')}</button> : null}
      {sum.closeout ? <FldNotice tone="ok" title={trFl('fld.dayClosedT', { t: new Date(sum.closeout.closedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }), by: sum.closeout.closedByName ? ' · ' + sum.closeout.closedByName : '' })} sub={trFl('fld.dayClosedB')} /> : null}
```

- replace the close button with:

```jsx
      <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !chk.ok} onClick={() => (sum.closeout ? setAskRe(true) : close())}>{trFl(sum.closeout ? 'fld.reclose' : 'fld.closeDay')}</button>
      {askRe && <FldSheet title={trFl('fld.recloseT')} body={trFl('fld.recloseB')} confirmLabel={trFl('fld.reclose')} onClose={() => setAskRe(false)} onConfirm={() => { setAskRe(false); close(); }} />}
```

`dist-field.jsx`:
- In `openFor`, add as the first line: `if (act === 'koreksi') { setView({ name: 'koreksi', target: c }); return; }`.
- In `const full = view && [...]`, add `'koreksi', 'koreksiSaya'` to the end of the array so it reads `…, 'complete', 'pin', 'koreksi', 'koreksiSaya'].includes(view.name)`.
- Setoran body: `body = <FldSetoran api={api} ctx={ctx} tick={tick} canKoreksi={can.correct || can.void} onKoreksiSaya={() => setView({ name: 'koreksiSaya' })} onChanged={(m) => done(m)} />;`
- After the `view.name === 'pin'` line add:

```jsx
      {ready && full && view.name === 'koreksi' && <FldKoreksi api={api} target={view.target} can={can} onDone={(m) => { setView({ name: 'koreksiSaya' }); flash(m); setCtxTick((t) => t + 1); }} onBack={() => setView(null)} onSaya={() => setView({ name: 'koreksiSaya' })} />}
      {ready && full && view.name === 'koreksiSaya' && <FldKoreksiSaya api={api} tick={tick} onResubmit={(tg) => setView({ name: 'koreksi', target: tg })} onBack={() => setView(null)} onChanged={(m) => { flash(m); setCtxTick((t) => t + 1); }} />}
```

- In the menu sheet, before the `onOpenRules` item:

```jsx
            {(can.correct || can.void) && <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); setView({ name: 'koreksiSaya' }); }}>{trFl('fld.kSaya')}</button>}
```

i18n:

| key | EN | ID |
|---|---|---|
| fld.kSayaEmpty | No requests yet | Belum ada pengajuan |
| fld.rq_pending | Waiting | Menunggu |
| fld.rq_approved | Approved | Disetujui |
| fld.rq_rejected | Rejected | Ditolak |
| fld.rq_withdrawn | Withdrawn | Ditarik |
| fld.rk_correction | Correction | Koreksi |
| fld.rk_void | Cancellation | Pembatalan |
| fld.rk_reassign | Move to another customer | Pindah pelanggan |
| fld.rl_to | Move to {name} | Pindah ke {name} |
| fld.rl_void | Cancel the transaction | Batalkan transaksi |
| fld.rl_qty | Gallons {a} → {b} | Galon {a} → {b} |
| fld.rl_pay | Payment {a} → {b} | Bayar {a} → {b} |
| fld.rl_amount | Amount {a} → {b} | Nominal {a} → {b} |
| fld.kOfficeNote | Office: {note} | Kantor: {note} |
| fld.kWithdraw | Withdraw | Tarik |
| fld.kWithdrawT | Withdraw this request? | Tarik pengajuan ini? |
| fld.kWithdrawB | The transaction stays as it is. | Transaksi tetap seperti sekarang. |
| fld.kWithdrawn | Request withdrawn | Pengajuan ditarik |
| fld.kResubmit | Send again | Ajukan ulang |
| fld.dayClosedT | Day closed at {t}{by} | Hari sudah ditutup pukul {t}{by} |
| fld.dayClosedB | Closing again records the stops as they are now; the earlier note stays unless you write a new one. | Menutup lagi mencatat stop seperti sekarang; catatan sebelumnya tetap kecuali Anda menulis yang baru. |
| fld.reclose | Close the day again | Tutup hari lagi |
| fld.recloseT | Close the day again? | Tutup hari lagi? |
| fld.recloseB | This day was already closed. | Hari ini sudah ditutup. |

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-koreksi-static.test.js tests/field-day-static.test.js tests/field-shell-static.test.js tests/field-kit-static.test.js`

Expected: PASS. Then `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field-koreksi.jsx dist-field-day.jsx dist-field.jsx finance-i18n.js server/tests/field-koreksi-static.test.js server/tests/field-day-static.test.js server/tests/field-shell-static.test.js
git commit -m "feat(distribusi): Koreksi saya (withdraw, send again) + Koreksi from a delivered stop, Setoran and the menu; closed-day notice"
```

---

## Task 9: Perbaikan kecil layar harian (3A)

**Files:**
- Modify: `dist-field-day.jsx`:
  - `FldBoardScreen` (3A-38);
  - `FldStopRow` (3A-39);
  - `FldNextCard` / `FldStopSheet` / `FldRoute` (links, 3A-39);
  - `FldRoute` (3A-33, 3A-36);
  - `FLD_DIFF` + `FldCloseRun` (3A-37).
- Modify: `dist-field-cust.jsx` (`FldCustSheet` links, 3A-39)
- Modify: `dist-field-kit.jsx`:
  - `FldNotice` role (3A-39);
  - new `FldLinkBtn`.
- Modify: `dist-field.css`:
  - selects 44px / 16px (3A-35);
  - stale dark-mode header comment (3A-40).
- Test: `server/tests/field-day-static.test.js`, `server/tests/field-kit-static.test.js` (append)

**Interfaces:**
- Produces: `FldLinkBtn({ href, className, newTab, children })`. It renders `<a>` when `href`, otherwise `<span className="… off" aria-disabled="true">`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/field-day-static.test.js`:

```js
describe('Plan 3C: 3A minors', () => {
  it('the next stop is not listed again under Menunggu; the list numbers after it', () => {
    const f = fn('FldBoardScreen');
    expect(f).toMatch(/v\.pending\.filter\(\(s\) => !v\.next \|\| s\.id !== v\.next\.id\)/);
    expect(f).toMatch(/n=\{i \+ \(seg === 'pending' && v\.next \? 2 : 1\)\}/);
  });
  it('Peta reads today\'s rits (the next rit number is right) and the map can be retried', () => {
    const f = fn('FldRoute');
    expect(f).toMatch(/api\.runs\(\)/);
    expect(f).toMatch(/FIELDLOGIC\.runState\(\{ today: ctx\.today, openRun: ctx\.openRun, runs \}\)/);
    expect(f).toMatch(/action=\{trFl\('fld\.retry'\)\} onAction=\{\(\) => setMapErr\(false\)\}/);
    expect(f).toMatch(/\}, \[route, mapErr\]\);/);
  });
  it('the close-rit difference is stored in Indonesian whatever the screen language', () => {
    expect(day).toMatch(/\['kembali_besok', 'fld\.d_besok', 'Tetap di armada \(besok\)'\]/);
    expect(fn('FldCloseRun')).toMatch(/body\.diffReason = label \+/);
    expect(fn('FldCloseRun')).not.toMatch(/diffReason = trFl\(/);
  });
  it('a11y: the warning dot is an image with a label; links without a target are not links', () => {
    expect(fn('FldStopRow')).toMatch(/className="mlap-warn-dot" role="img" aria-label=/);
    expect(day).not.toMatch(/href=\{links\.\w+ \|\| undefined\}/);
    expect(day).toMatch(/<FldLinkBtn href=\{links\.nav\}/);
  });
});
```

Append to `server/tests/field-kit-static.test.js`:

```js
describe('Plan 3C kit', () => {
  it('standing notices are not alerts (only errors interrupt a screen reader)', () => {
    const f = kit.slice(kit.indexOf('function FldNotice('), kit.indexOf('function FldNotice(') + 400);
    expect(f).not.toMatch(/role=\{tone === 'warn' \? 'alert'/);
  });
  it('a link with nowhere to go is a disabled span', () => {
    const f = kit.slice(kit.indexOf('function FldLinkBtn('));
    expect(f).toMatch(/if \(!href\) return <span className=\{className \+ ' off'\} aria-disabled="true">/);
  });
  it('selects are 44px and 16px (no iOS zoom); the CSS header no longer claims a dark mode', () => {
    const css = fs.readFileSync(path.join(root, 'dist-field.css'), 'utf8');
    expect(css).toMatch(/\.mlap-select \{ min-height: 44px; font-size: 16px; \}/);
    expect(css).toMatch(/\.mlap-chip select \{ min-height: 44px; font-size: 16px; \}/);
    expect(css.slice(0, 400)).not.toMatch(/Tokens redefined for dark mode/);
  });
});
```

(`field-kit-static.test.js` already has `fs`, `path`, `root`, `kit`. If a name differs, use the file's own.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-day-static.test.js tests/field-kit-static.test.js`

Expected: FAIL on every new assertion.

- [ ] **Step 3: Implement**

`dist-field-kit.jsx`:
- In `FldNotice`, change `role={tone === 'warn' ? 'alert' : 'status'}` to `role="note"`.
- Append after `fldLinks`:

```jsx
// A button-styled link; with nowhere to go it is a disabled span (a disabled <a> without href is still
// announced as a link and focusable on some readers).
function FldLinkBtn({ href, className, newTab, children }) {
  if (!href) return <span className={className + ' off'} aria-disabled="true">{children}</span>;
  return <a className={className} href={href} target={newTab ? '_blank' : undefined} rel={newTab ? 'noopener noreferrer' : undefined}>{children}</a>;
}
```

`dist-field-day.jsx`:
- `FldStopRow`: `<span className="mlap-warn-dot" role="img" aria-label={trFl('fld.incompleteB')}>!</span>`.
- `FldNextCard`: replace the nav `<a …>` with `<FldLinkBtn href={links.nav} className="mlap-btn" newTab>{trFl('fld.navigate')}</FldLinkBtn>`.
- `FldStopSheet`, the three links:
  - `<FldLinkBtn href={links.nav} className="mlap-btn" newTab>{trFl('fld.navigate')}</FldLinkBtn>`
  - `<FldLinkBtn href={links.tel} className="mlap-btn">{trFl('fld.call')}</FldLinkBtn>`
  - `<FldLinkBtn href={links.wa} className="mlap-btn" newTab>{trFl('fld.wa')}</FldLinkBtn>`
- `FldRoute` nav: `<FldLinkBtn href={firstNav} className="mlap-btn primary" newTab>{first ? trFl('fld.navTo', { n: first.order }) : trFl('fld.navigate')}</FldLinkBtn>`.
- `FldBoardScreen`:

```jsx
  const list = seg === 'pending' ? v.pending.filter((s) => !v.next || s.id !== v.next.id) : seg === 'done' ? v.done : v.held;
```

  and in the list map use `n={i + (seg === 'pending' && v.next ? 2 : 1)}`.
- `FLD_DIFF`:

```js
const FLD_DIFF = [['kembali_besok', 'fld.d_besok', 'Tetap di armada (besok)'], ['rusak', 'fld.d_rusak', 'Rusak'], ['hilang', 'fld.d_hilang', 'Hilang'], ['salah_hitung', 'fld.d_salah', 'Salah hitung']];   // [code, label key, the Indonesian text office records keep]
```

- `FldCloseRun`:

```js
    const label = (FLD_DIFF.find(([k]) => k === res) || [null, '', ''])[2];
    const body = { gallonsFullReturned: full, gallonsEmptyReturned: empty };
    if (diff !== 0) { body.diffReason = label + (note.trim() ? ' · ' + note.trim() : ''); body.resolution = res; }
```

- `FldRoute`:
  - add `const [runs, setRuns] = uSfl([]);` before `const rs = …`;
  - add `uEfl(() => { let live = true; api.runs().then((r) => { if (live) setRuns(r || []); }).catch(() => {}); return () => { live = false; }; }, [api, tick]);`;
  - change `rs` to `FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs })`;
  - in the map effect change the guard to `if (!route || mapErr || !mapEl.current) return undefined;` and the deps to `}, [route, mapErr]);`;
  - change the off-map notice to `<FldNotice tone="info" title={trFl('fld.mapOff')} action={trFl('fld.retry')} onAction={() => setMapErr(false)} />`.

`dist-field-cust.jsx` `FldCustSheet`: replace the three `<a …>` links with the same three `FldLinkBtn` lines as `FldStopSheet`.

`dist-field.css`:
- Change the header comment's last sentence `Tokens redefined for dark mode. */` to `The app has no dark theme: the field UI is light only. */`.
- Add before `@keyframes mlapFade`:

```css
/* TOUCH TARGETS (3C): every control ≥ 44px; selects at 16px so iOS does not zoom */
.mlap-select { min-height: 44px; font-size: 16px; }
.mlap-chip select { min-height: 44px; font-size: 16px; }
.mlap-chip:has(select) { height: auto; padding: 0 6px; }
.mlap-range { min-height: 44px; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-day-static.test.js tests/field-kit-static.test.js tests/field-cust-static.test.js tests/field-shell-static.test.js`

Expected: PASS. `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field-day.jsx dist-field-cust.jsx dist-field-kit.jsx dist-field.css server/tests/field-day-static.test.js server/tests/field-kit-static.test.js
git commit -m "fix(distribusi): field day-screen minors — next stop not listed twice, Peta rit number, map retry, Indonesian diff reason, 44px selects, a11y"
```

---

## Task 10: Perbaikan kecil layar pelanggan (3B)

**Files:**
- Modify: `dist-field-cust.jsx`:
  - `FldAddStop`: `can`, on-board check, `onPin(c, keep)` (M8, M9, M11);
  - `FldPinMap`: `onDone(msg, pt)` (M11).
- Modify: `dist-field.jsx` (pass `can` to `FldAddStop`; pin back view uses `FIELDLOGIC.afterPin`)
- Modify: `finance-i18n.js`
- Test: `server/tests/field-cust-static.test.js`, `server/tests/field-shell-static.test.js` (append)

**Interfaces:**
- Consumes (Task 5): `FIELDLOGIC.afterPin(back, custId, pt)`.
- Produces:
  - `FldAddStop({ api, preset, can, onPin(cust, keep), onDone, onBack })`;
  - `FldPinMap` calls `onDone(msg, { lat, lng })`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/field-cust-static.test.js`:

```js
describe('Plan 3C: 3B minors', () => {
  it('Tambah stop: pin buttons only with the location right; a customer already on today\'s route cannot be added twice', () => {
    const f = fn('FldAddStop');
    expect(f).toMatch(/function FldAddStop\(\{ api, preset, can, onPin, onDone, onBack \}\)/);
    expect(f).toMatch(/can\.location \? <button type="button" className="mlap-btn" onClick=\{\(\) => onPin\(fldCustFromStop\(s\)\)\}>/);
    expect(f).toMatch(/const onBoard = !!pick && d\.board\.some\(\(s\) => s\.customerId === pick\.id && s\.status !== 'batal'\);/);
    expect(f).toMatch(/disabled=\{busy \|\| qty < 1 \|\| onBoard\}/);
    expect(f).toMatch(/onPin\(pick, true\)/);
  });
  it('Atur titik hands the saved point back', () => {
    expect(fn('FldPinMap')).toMatch(/onDone\(trFl\('fld\.pinSaved', \{ name: c\.name \}\), \{ lat: pin\.lat, lng: pin\.lng \}\)/);
  });
});
```

Append to `server/tests/field-shell-static.test.js`:

```js
it('Plan 3C: after a pin is saved the screen we return to has it (no stale "pin needed")', () => {
  expect(jsx).toMatch(/<FldAddStop api=\{api\} preset=\{view\.preset\} can=\{can\} onPin=\{\(c, keep\) => setView\(\{ name: 'pin', cust: c, back: keep \? Object\.assign\(\{\}, view, \{ preset: c \}\) : view \}\)\}/);
  expect(jsx).toMatch(/onDone=\{\(m, pt\) => \{ if \(view\.back\) \{ setView\(pt \? FIELDLOGIC\.afterPin\(view\.back, view\.cust\.id, pt\) : view\.back\);/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-cust-static.test.js tests/field-shell-static.test.js`

Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

`dist-field-cust.jsx` `FldAddStop`:
- signature: `function FldAddStop({ api, preset, can, onPin, onDone, onBack }) {`;
- after `const pickHasPin = …;` add:

  ```js
  const onBoard = !!pick && d.board.some((s) => s.customerId === pick.id && s.status !== 'batal');   // already on today's route (also a "Tambah ke hari ini" from the customer sheet)
  ```

- the no-pin list button becomes `{can.location ? <button type="button" className="mlap-btn" onClick={() => onPin(fldCustFromStop(s))}>{trFl('fld.setPin')}</button> : null}`;
- the pick notice becomes `{!pickHasPin && <FldNotice tone="warn" title={trFl('fld.pickNoPinT', { name: pick.name })} sub={trFl('fld.pickNoPinB')} action={can.location ? trFl('fld.setPinNow') : null} onAction={() => onPin(pick, true)} />}`;
- before the qty card add `{onBoard ? <FldNotice tone="warn" title={trFl('fld.alreadyToday')} /> : null}`;
- the add button: `disabled={busy || qty < 1 || onBoard}`.

`FldPinMap`: `.then(() => onDone(trFl('fld.pinSaved', { name: c.name }), { lat: pin.lat, lng: pin.lng }))`.

`dist-field.jsx`:
- the `addStop` line:

```jsx
      {ready && full && view.name === 'addStop' && <FldAddStop api={api} preset={view.preset} can={can} onPin={(c, keep) => setView({ name: 'pin', cust: c, back: keep ? Object.assign({}, view, { preset: c }) : view })} onDone={done} onBack={() => setView(null)} />}
```

- the `pin` line's `onDone`:

```jsx
onDone={(m, pt) => { if (view.back) { setView(pt ? FIELDLOGIC.afterPin(view.back, view.cust.id, pt) : view.back); flash(m); setCtxTick((t) => t + 1); } else done(m); }}
```

i18n: `fld.alreadyToday` — EN "Already on today's route", ID "Sudah ada di rute hari ini".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-cust-static.test.js tests/field-shell-static.test.js`

Expected: PASS. `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field-cust.jsx dist-field.jsx finance-i18n.js server/tests/field-cust-static.test.js server/tests/field-shell-static.test.js
git commit -m "fix(distribusi): field customer-screen minors — pin buttons by right, no second stop for today's customer, saved pin carried back"
```

---

## Task 11: Rilis — buka kunci, layar aturan tidak menimpa, kartu sesudah rilis

**Files:**
- Modify: `dist-field.jsx` (`FLD_SCREENS_READY`, `FldRules` release save)
- Modify: `finance-shell.jsx` (the `.fld-try` card text after release)
- Modify: `finance-i18n.js`
- Modify: `server/tests/field-shell-static.test.js` (release lock test → open), `server/tests/field-shell-integration.test.js` (append)

**Interfaces:**
- Consumes: `fieldPref.released` (from `FIELDAPI.prefState`).
- Produces: `FLD_SCREENS_READY = true`. Releasing merges only `fieldUiDefault` into the screen's state.

- [ ] **Step 1: Write the failing tests**

In `server/tests/field-shell-static.test.js`, replace the test `releasing is locked while the field screens are still the foundation stub; un-releasing never is` with:

```js
it('the screens are ready: releasing is open (owner only, confirmed); un-releasing stays open', () => {
  expect(jsx).toMatch(/^const FLD_SCREENS_READY = true;/m);
  expect(jsx).toMatch(/className="mlap-btn danger" disabled=\{busy \|\| !FLD_SCREENS_READY\}/);
  expect(jsx).toMatch(/className="mlap-btn" disabled=\{busy\} onClick=\{\(\) => setAsk\('old'\)\}/);
});
it('releasing changes only the release switch — other unsaved edits on the rules screen stay', () => {
  const f = jsx.slice(jsx.indexOf('function FldRules('));
  expect(f).toMatch(/if \(patch && patch\.fieldUiDefault !== undefined\) \{ setR\(\(cur\) => Object\.assign\(\{\}, cur, \{ fieldUiDefault: x\.data\.fieldUiDefault \}\)\); \} else got\(x\.data\);/);
});
```

Append to `server/tests/field-shell-integration.test.js`:

```js
it('Plan 3C: after release the board card no longer calls the field view a demo', () => {
  expect(shell).toMatch(/\{tr\(fieldPref\.released \? 'fld\.fieldView' : 'fld\.tryNew'\)\}/);
  expect(shell).toMatch(/\{tr\(fieldPref\.released \? 'fld\.fieldViewSub' : 'fld\.tryNewSub'\)\}/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-shell-static.test.js tests/field-shell-integration.test.js`

Expected: FAIL. `FLD_SCREENS_READY` is still false; the merge is absent; the card keys are absent.

- [ ] **Step 3: Implement**

`dist-field.jsx`:
- `const FLD_SCREENS_READY = true;`. Keep its comment, and add: "3C: all screens built (day, customers, manual inputs, koreksi)."
- In `FldRules.save`, replace

  ```js
      .then((x) => { got(x.data); setDone(trFl('fld.saved')); setTimeout(() => setDone(''), 2400); if (onSaved) onSaved(x.data); })
  ```

  with

  ```js
      .then((x) => {
        // the release switch alone: keep every other edit still unsaved on this screen
        if (patch && patch.fieldUiDefault !== undefined) { setR((cur) => Object.assign({}, cur, { fieldUiDefault: x.data.fieldUiDefault })); } else got(x.data);
        setDone(trFl('fld.saved')); setTimeout(() => setDone(''), 2400); if (onSaved) onSaved(x.data);
      })
  ```

`finance-shell.jsx`, in the `.fld-try` card:

```jsx
                <span><b>{tr(fieldPref.released ? 'fld.fieldView' : 'fld.tryNew')}</b><br /><small>{tr(fieldPref.released ? 'fld.fieldViewSub' : 'fld.tryNewSub')}</small></span>
```

and `aria-label={tr(fieldPref.released ? 'fld.fieldView' : 'fld.tryNew')}` on the card `div`.

i18n:
- `fld.fieldView`: EN "Field view", ID "Tampilan lapangan".
- `fld.fieldViewSub`: EN "The phone view for deliveries.", ID "Tampilan HP untuk pengiriman."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-shell-static.test.js tests/field-shell-integration.test.js tests/field-demo-access.test.js tests/field-rules.test.js`

Expected: PASS. If `field-rules.test.js` does not exist, drop it.

- [ ] **Step 5: Commit**

```bash
git add dist-field.jsx finance-shell.jsx finance-i18n.js server/tests/field-shell-static.test.js server/tests/field-shell-integration.test.js
git commit -m "feat(distribusi): field screens ready — release unlocked; releasing keeps unsaved rule edits; the board card stops saying demo"
```

---

## Task 12: Verifikasi + spesifikasi

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md` (§4 note "Sesuai yang dibangun (Rencana 3C)")

- [ ] **Step 1: Headless harness (session scratchpad)**

Extend the scratchpad `cust-harness.html` mock:
- `customer(id)` returns `transactions` that include a sale with `proofLat`/`proofLng`, `gallonOut`/`gallonIn`, `unitPriceLocked`;
- one stop on the board is `terkirim` with a `transactionId`;
- `previewCorrect`, `previewReassign`, `myChangeRequests` (three rows: pending, rejected with a `decisionNote`, approved), and `withdraw` are mocked;
- perms include `distribusiKoreksi` and `distribusiVoid`.

Point the page at the newly built `dist/app.<hash>.js`, then run each step with Chrome `--headless=new --virtual-time-budget --dump-dom` and `--screenshot`, window 500×1300:

| Step | Expected |
|---|---|
| (a) delivered stop → "Koreksi transaksi" | options Pelanggan salah / Jumlah galon / Cara bayar / Batalkan |
| (b) Cara bayar → Transfer | photo block appears; Kirim disabled without a photo |
| (c) Jumlah galon +1 | preview lines "Nominal … → …" |
| (d) Pelanggan salah | "Dekat lokasi pengantaran" list |
| (e) menu → Koreksi saya | three rows with status chips; "Tarik" only on the pending one; "Ajukan ulang" on the rejected one |
| (f) Setoran with `closeout` in the mock | "Hari sudah ditutup …"; button "Tutup hari lagi" |

Only the expected React #299 error may appear.

- [ ] **Step 2: Full suite alone (no other jest at the same time)**

Run (from `server/`, in the background): `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand`

Expected: all suites pass. Between 00:00 and 08:00 WITA, the 9 known date-fragile files may fail. Re-run exactly those with `APP_TZ=UTC` to prove them.

- [ ] **Step 3: Build**

Run: `node build.mjs`

Expected: built `dist/app.<hash>.js`, minified, with no error.

- [ ] **Step 4: Spec note**

Append to §4, after the "Rencana 3B" note:

```markdown
**Sesuai yang dibangun (Rencana 3C, 2026-10-01): koreksi, Koreksi saya, rilis.**
- `dist-field-koreksi.jsx`:
  - **Koreksi transaksi** dari stop Terkirim, dengan pilihan:
    - Pelanggan salah: saran pelanggan terdekat dari lokasi foto, lalu cari;
    - Jumlah galon;
    - Cara bayar Lunas/Bon/Transfer;
    - Nominal pelunasan;
    - Batalkan.
  - **Koreksi saya** (dari Setoran dan menu): Tarik saat Menunggu, Ajukan ulang saat Ditolak/Ditarik.
- Semua lewat mesin persetujuan yang ada. Transaksi asli tetap berlaku sampai disetujui. Ganti rugi
  hanya bisa dibatalkan.
- **Koreksi cara bayar di server:** `payMethod` tunai↔transfer, dengan foto bukti transfer (`PROOF_REQUIRED`).
  Saat disetujui, uang pindah Kas → Bank. Pratinjau tidak meminta foto. Alasan untuk kantor menyebut
  perubahan cara bayar dalam bahasa Indonesia, karena kotak persetujuan lama tidak menampilkannya.
- **Koreksi saya** terbuka untuk `distribusiKoreksi` atau `distribusiVoid`. Tarik dilakukan dengan satu
  tulis bersyarat, sehingga tidak pernah menimpa keputusan.
- Setoran memberi tahu kalau hari sudah ditutup dan meminta konfirmasi sebelum menutup lagi. Catatan
  lama tetap ada kecuali diganti.
- **Rilis:** `FLD_SCREENS_READY = true`. Tombol "Jadikan tampilan utama" (khusus Owner) kini aktif.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md
git commit -m "docs: mode lapangan spec aligned with koreksi, Koreksi saya and release (Plan 3C)"
```

---

## Out of scope (stays deferred)

- P1-58: the old approval inbox has no label for status `withdrawn`. `distribution.jsx` stays untouched (spec).
- 3B-M7: on a replay, the screens say "already saved" but do not show the saved figures.
- 3B-M13: behavioural (browser) tests for re-entry after a lost response.
- P2-43 edge: a reset after a storage timeout deletes only the memory copy.
- P2-45 leftover: one render with the old adaptor after an armada switch.
- `.fld-try` keeps its `fld-` class name (it lives in the old `finance.css`; renaming buys nothing).
- Gallon-pool write-off decision; `distribusiApproveSelf` via role (owner decisions, unchanged).
