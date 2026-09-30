# Mode Lapangan — Rencana 1: Server (akses demo + aturan & fitur baru)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server siap untuk tampilan HP baru (Mode Lapangan): izin demo khusus Owner, penjaga Mode asli, satu pengaturan "Aturan lapangan" (SOP 80 + kapasitas armada + saklar foto/alasan + harga ganti rugi), plus enam fitur baru (foto & metode Transfer, tunda/batal per stop, riwayat geser titik, ganti rugi galon, koreksi saya, ringkasan setoran). Semua aturan mati secara default sehingga tampilan lama tidak berubah.

**Architecture:** Semua perubahan server ada di `server/`. Aturan lapangan disimpan di satu settings key `fieldRules` lewat service baru `fieldRules.service.js` (baca/tulis + audit). Setiap fitur ditambahkan ke `distribution.service.js` di fungsi yang sudah ada (openRun, createTransaction, markDelivery, setCustomerLocation, updateCustomer, createExpense) atau sebagai fungsi baru di file yang sama, mengikuti pola file itu. Migrasi Prisma **hanya menambah** kolom.

**Tech Stack:** Node/Express, Prisma (SQLite), zod, Jest + supertest.

**Spec:** `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md`

Rencana ini adalah **Rencana 1 dari 3**:
- Rencana 2 (dasar klien: adaptor asli/latihan, `rit-plan.js` isomorfik, integrasi shell, layar Armada & SOP) ditulis **setelah** rencana ini selesai.
- Rencana 3 (layar Mode Lapangan) ditulis setelah Rencana 2.

## Global Constraints

- Semua perintah tes dijalankan dari `server/`: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand <file>`. Seluruh suite memakan waktu ±10 menit, jadi jalankan di background.
- Setelah mengubah `prisma/schema.prisma`, jalankan `npx prisma generate`. **Jangan pernah** menjalankan `npx prisma format`, karena perintah itu memformat ulang seluruh skema.
- DB tes dibuat dari skema (`db push --force-reset`) oleh `tests/globalSetup.js`. Migrasi SQL di `prisma/migrations/` tetap wajib ditulis untuk produksi. Nama folder mengikuti pola `2026100X100000_<nama>`, dan isinya hanya `ALTER TABLE … ADD COLUMN …`.
- Tes server **tidak boleh** me-`require` apa pun dari `node_modules` root (gerbang deploy GATE 3 hanya memasang dependensi server). Pengecekan file klien memakai `@babel/parser`.
- Edit file dengan tool Edit/Write. Jangan memakai heredoc bash untuk kode yang berisi kutip atau backslash. File di repo ini bisa CRLF, jadi jangan menambatkan pencarian pada `\n` saja.
- Pesan error untuk pengguna dalam Bahasa Indonesia. Kunci/kode dalam Bahasa Inggris.
- Semua aturan baru **default mati** (`enabled:false` / `false`). Satu-satunya yang langsung berlaku adalah **batas kapasitas armada**, dan itu hanya kalau kapasitasnya diisi (kosong = tanpa batas).
- Izin demo `distribusiDemoLatihan` dan `distribusiDemoPenuh` **tidak pernah** diturunkan dari peran, dan hanya Owner yang boleh memberi atau mencabutnya.
- Commit di cabang kerja, hanya lokal. Push hanya atas permintaan pemilik.

## Review Focus

1. **Header `X-Airro-Ui: field` pada permintaan baca (GET) dari akun yang hanya punya Demo latihan.** Harus lolos, karena Mode latihan menyalin data. Tesnya ada di Task 3.
2. **Kapasitas diisi untuk armada A tetapi kosong untuk armada B.** B harus tanpa batas, dan membuka rit 500 galon di B tetap berhasil. Tesnya ada di Task 4.
3. **SOP dinyalakan ketika tampilan lama masih dipakai.** Buka rit di bawah SOP tanpa alasan harus ditolak dengan pesan yang menyebut angka SOP dan meminta alasan, bukan 500. Tesnya ada di Task 4.
4. **Ganti rugi galon untuk qty lebih besar dari galon yang dipegang pelanggan.** Harus ditolak 400 dengan pesan jelas, dan tidak boleh ada movement yang tertulis. Tesnya ada di Task 9.
5. **Menarik (withdraw) pengajuan milik orang lain, atau yang sudah diputuskan.** Harus ditolak (404/400) tanpa mengubah status. Tesnya ada di Task 10.

---

### Task 1: Izin demo khusus Owner

**Files:**
- Modify: `server/src/config/permissions.js`, di `deriveDistribusiCaps` (sekitar baris 265, setelah `distribusiApproveSelf`)
- Modify: `server/src/services/user.service.js`, di sekitar baris 95-105 dan 144, 160-166
- Modify: `finance-users.jsx` (root), di katalog izin sekitar baris 73
- Test: `server/tests/field-demo-access.test.js` (baru)

**Interfaces:**
- Produces:
  - izin `distribusiDemoLatihan: boolean` dan `distribusiDemoPenuh: boolean` pada objek izin yang sudah di-resolve;
  - `distribusiDemoPenuh` **menyiratkan** `distribusiDemoLatihan`, yang diturunkan di `deriveDistribusiCaps`;
  - `assertOwnerOnlyCapsAllowed({ beforeRole, beforePerms, afterRole, afterPerms, actor })` di `user.service.js`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/field-demo-access.test.js`:

```js
'use strict';
// MODE LAPANGAN — izin demo: dua tingkat, TIDAK PERNAH diturunkan dari peran, hanya Owner yang memberi.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const setPerms = (tok, id, permissions) => request(app).patch(`/api/v1/users/${id}`).set(auth(tok)).send({ permissions });
const effective = async (tok, id) => (await request(app).get(`/api/v1/users/${id}`).set(auth(tok))).body.data.permissions || {};
const FIELD = { distribusi: true, distribusiPengiriman: true, distribusiInput: true };

let owner, gm, driverId, gmId;
beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Pemilik', username: 'fd_owner', password: 'secret123', role: 'owner' })).token;
  const g = await reg({ name: 'GM', username: 'fd_gm', password: 'secret123', role: 'gm' });
  gm = g.token; gmId = g.user.id;
  driverId = (await reg({ name: 'Sopir', username: 'fd_driver', password: 'secret123', role: 'finance' })).user.id;
  await setPerms(owner, driverId, FIELD);
});
afterAll(() => prisma.$disconnect());

describe('izin demo', () => {
  it('tidak diturunkan dari peran: owner dan GM pun default false', async () => {
    const me = (await request(app).get('/api/v1/auth/me').set(auth(owner))).body;
    const perms = (me.data || me.user || me).permissions;
    expect(perms.distribusiDemoLatihan).toBe(false);
    expect(perms.distribusiDemoPenuh).toBe(false);
    const gp = await effective(owner, gmId);
    expect(!!gp.distribusiDemoPenuh).toBe(false);
  });

  it('GM tidak boleh memberi Demo latihan maupun Demo penuh', async () => {
    let r = await setPerms(gm, driverId, { ...FIELD, distribusiDemoLatihan: true });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/Pemilik/);
    r = await setPerms(gm, driverId, { ...FIELD, distribusiDemoPenuh: true });
    expect(r.status).toBe(403);
    expect(!!(await effective(owner, driverId)).distribusiDemoLatihan).toBe(false);
  });

  it('Owner boleh memberi; Demo penuh menyiratkan Demo latihan', async () => {
    const r = await setPerms(owner, driverId, { ...FIELD, distribusiDemoPenuh: true });
    expect(r.status).toBe(200);
    const p = await effective(owner, driverId);
    expect(p.distribusiDemoPenuh).toBe(true);
    expect(p.distribusiDemoLatihan).toBe(true);
  });

  it('GM juga tidak boleh MENCABUT izin demo', async () => {
    const r = await setPerms(gm, driverId, { ...FIELD });
    expect(r.status).toBe(403);
    expect((await effective(owner, driverId)).distribusiDemoPenuh).toBe(true);
  });

  it('GM tetap boleh mengubah izin lain selama izin demo tidak berubah', async () => {
    const r = await setPerms(gm, driverId, { ...FIELD, distribusiExpense: true, distribusiDemoPenuh: true });
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/field-demo-access.test.js`

Expected: FAIL. Tes pertama gagal karena `undefined` ≠ `false`, dan tes GM mendapat 200 bukan 403.

- [ ] **Step 3: Tambahkan izin di `deriveDistribusiCaps`**

Di `server/src/config/permissions.js`, tepat setelah baris `if (p.distribusiApproveSelf === undefined) p.distribusiApproveSelf = false;`, tambahkan:

```js
  // MODE LAPANGAN DEMO — two owner-granted tiers for trying the new phone UI before it is released.
  // NEVER derived from a role (not even owner/GM): the owner decides per account who tries it.
  //   • distribusiDemoLatihan — Mode latihan only (practice data kept on the phone, never sent);
  //   • distribusiDemoPenuh   — latihan + Mode asli (real transactions through the new UI).
  // Penuh implies Latihan. Owner-only to grant/revoke (enforced in user.service).
  if (p.distribusiDemoPenuh === undefined) p.distribusiDemoPenuh = false;
  if (p.distribusiDemoLatihan === undefined) p.distribusiDemoLatihan = false;
  if (p.distribusiDemoPenuh) p.distribusiDemoLatihan = true;
```

- [ ] **Step 4: Tambahkan penjaga khusus Owner di `user.service.js`**

Tepat setelah fungsi `assertSelfApproveGrantAllowed` (penutupnya sekitar baris 105), tambahkan:

```js
// MODE LAPANGAN DEMO access is owner-only in BOTH directions (grant and revoke), exactly like the
// self-approval waiver: a GM may edit every other capability of the same user in the same request as
// long as these two resolve to the same value before and after.
const OWNER_ONLY_FIELD_CAPS = ['distribusiDemoLatihan', 'distribusiDemoPenuh'];
async function assertOwnerOnlyCapsAllowed({ beforeRole, beforePerms, afterRole, afterPerms, actor }) {
  const b = resolvePerms(beforeRole, beforePerms) || {};
  const a = resolvePerms(afterRole, afterPerms) || {};
  const changed = OWNER_ONLY_FIELD_CAPS.some((k) => !!b[k] !== !!a[k]);
  if (changed && !(await actorIsOwner(actor))) {
    throw ApiError.forbidden('Hanya Pemilik yang boleh memberi atau mencabut akses Demo Mode Lapangan.');
  }
}
```

Di `create` (sekitar baris 144), setelah `await assertSelfApproveGrantAllowed({ … });`, tambahkan:

```js
  await assertOwnerOnlyCapsAllowed({ beforeRole: rest.role, beforePerms: null, afterRole: rest.role, afterPerms: rest.permissions || null, actor });
```

Di `update`, di dalam blok `if ('permissions' in rest || 'role' in rest) {`, setelah pemanggilan `assertSelfApproveGrantAllowed({...});`, tambahkan pemanggilan dengan argumen yang sama persis:

```js
    await assertOwnerOnlyCapsAllowed({
      beforeRole: before.role, beforePerms: before.permissions,
      afterRole: 'role' in rest ? rest.role : before.role,
      afterPerms: 'permissions' in rest ? rest.permissions : before.permissions,
      actor,
    });
```

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/field-demo-access.test.js tests/self-approval.test.js`

Expected: PASS (5 + semua tes self-approval).

- [ ] **Step 6: Katalog izin di klien**

Di `finance-users.jsx`, tepat setelah baris katalog `['distribusiApproveSelf', …],` (baris 73), tambahkan dua baris:

```js
  ['distribusiDemoLatihan', 'distribusi', 'Demo Mode Lapangan — Latihan', 'Mencoba tampilan HP baru dalam Mode latihan: data asli hanya dibaca, semua catatan tersimpan di HP itu saja dan tidak pernah masuk pembukuan. Hanya Pemilik yang boleh memberi.', 1, { ownerOnly: true }],
  ['distribusiDemoPenuh', 'distribusi', 'Demo Mode Lapangan — Penuh', 'Mode latihan + Mode asli: mencatat transaksi sungguhan lewat tampilan HP baru selama masa demo. Hanya Pemilik yang boleh memberi.', 2, { destructive: true, ownerOnly: true }],
```

Lalu buat tes parse di `server/tests/field-demo-access.test.js` (tambahkan di akhir file):

```js
describe('katalog izin (klien)', () => {
  it('kedua izin demo ada di katalog sebagai ownerOnly, dan file ter-parse', () => {
    const fs = require('fs'); const path = require('path');
    const { parse } = require('@babel/parser');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'finance-users.jsx'), 'utf8');
    expect(src).toMatch(/\['distribusiDemoLatihan', 'distribusi', [^\n]*ownerOnly: true/);
    expect(src).toMatch(/\['distribusiDemoPenuh', 'distribusi', [^\n]*ownerOnly: true/);
    expect(() => parse(src, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  });
});
```

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/field-demo-access.test.js`

Expected: PASS (6).

- [ ] **Step 7: Commit**

```bash
git add server/src/config/permissions.js server/src/services/user.service.js finance-users.jsx server/tests/field-demo-access.test.js
git commit -m "feat(distribusi): owner-only Mode Lapangan demo access (latihan / penuh)"
```

---

### Task 2: Aturan lapangan (`fieldRules`): baca/tulis + audit

**Files:**
- Create: `server/src/services/fieldRules.service.js`
- Modify: `server/src/config/permissions.js` (izin `distribusiAturanLapangan`)
- Modify: `server/src/controllers/distribution.controller.js` (schema + 2 handler + export)
- Modify: `server/src/routes/distribution.routes.js` (2 rute)
- Test: `server/tests/field-rules.test.js` (baru)

**Interfaces:**
- Produces:
  - `fieldRules.getRules() → Promise<Rules>` dengan bentuk
    `Rules = { ritSop: { enabled: boolean, minLoad: number }, fleetCapacity: { [plate: string]: number }, wajibFotoTransaksi: boolean, wajibFotoPengeluaran: boolean, wajibAlasanBatal: boolean, hargaGantiRugiGalon: number, fieldUiDefault: 'old'|'new' }`;
  - `fieldRules.setRules(patch, actor) → Promise<Rules>`;
  - `fieldRules.capacityOf(rules, fleetId) → number|null`;
  - `GET /api/v1/distribusi/field-rules` (izin `distribusi`) → `{ data: Rules }`;
  - `PUT /api/v1/distribusi/field-rules` (izin `distribusiAturanLapangan`) → `{ data: Rules }`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/field-rules.test.js`:

```js
'use strict';
// ATURAN LAPANGAN — one settings object: SOP muatan, kapasitas per armada, saklar foto/alasan, harga
// ganti rugi galon, default tampilan. Everything defaults OFF; only owner/GM may change it; every change
// is audited in the distribusi audit log.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const D = '/api/v1/distribusi';
let gm, driver;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'fr_gm', password: 'secret123', role: 'gm' })).token;
  const d = await reg({ name: 'Sopir', username: 'fr_driver', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: d.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiPengiriman: true }) } });
  driver = await login('fr_driver', 'secret123');
});
afterAll(() => prisma.$disconnect());

describe('field rules', () => {
  it('defaults: everything off, SOP 80, no capacities, old UI', async () => {
    const r = await request(app).get(`${D}/field-rules`).set(auth(driver));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      ritSop: { enabled: false, minLoad: 80 }, fleetCapacity: {},
      wajibFotoTransaksi: false, wajibFotoPengeluaran: false, wajibAlasanBatal: false,
      hargaGantiRugiGalon: 0, fieldUiDefault: 'old',
    });
  });

  it('a driver cannot change the rules', async () => {
    const r = await request(app).put(`${D}/field-rules`).set(auth(driver)).send({ ritSop: { enabled: true } });
    expect(r.status).toBe(403);
  });

  it('owner/GM patch merges, validates and audits', async () => {
    const r = await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ ritSop: { enabled: true }, fleetCapacity: { 'DK 1': 120, 'DK 2': 70 }, hargaGantiRugiGalon: 45000 });
    expect(r.status).toBe(200);
    expect(r.body.data.ritSop).toEqual({ enabled: true, minLoad: 80 });   // minLoad kept
    expect(r.body.data.fleetCapacity).toEqual({ 'DK 1': 120, 'DK 2': 70 });
    expect(r.body.data.hargaGantiRugiGalon).toBe(45000);
    const audit = (await request(app).get(`${D}/audit`).set(auth(gm))).body.data;
    expect(audit.some((a) => /Aturan lapangan/.test(a.title) && /SOP/.test(a.detail))).toBe(true);
  });

  it('a capacity of 0 or empty removes the limit; nonsense is refused', async () => {
    let r = await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ fleetCapacity: { 'DK 2': 0 } });
    expect(r.body.data.fleetCapacity).toEqual({ 'DK 1': 120 });
    r = await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ ritSop: { minLoad: -5 } });
    expect(r.status).toBe(400);
    r = await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ fieldUiDefault: 'purple' });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/field-rules.test.js`

Expected: FAIL (404 pada `/field-rules`).

- [ ] **Step 3: Tambahkan izin `distribusiAturanLapangan`**

Di `deriveDistribusiCaps`, tepat setelah baris `if (p.distribusiZonaKelola === undefined) …`, tambahkan:

```js
  // ATURAN LAPANGAN (SOP muatan, kapasitas armada, foto/alasan wajib, harga ganti rugi, rilis tampilan
  // baru) change how every driver works — owner/GM tier, never derived from a field cap.
  if (p.distribusiAturanLapangan === undefined) p.distribusiAturanLapangan = isOwnerGm;
```

- [ ] **Step 4: Buat service**

Buat `server/src/services/fieldRules.service.js`:

```js
'use strict';
// ATURAN LAPANGAN — the business rules the new phone UI (Mode Lapangan) always follows and the server
// enforces once the owner switches them on. ONE settings key so a release flips them together.
const ApiError = require('../utils/ApiError');
const settings = require('./settings.service');

const KEY = 'fieldRules';
const DEFAULT_RULES = Object.freeze({
  ritSop: { enabled: false, minLoad: 80 },
  fleetCapacity: {},
  wajibFotoTransaksi: false,
  wajibFotoPengeluaran: false,
  wajibAlasanBatal: false,
  hargaGantiRugiGalon: 0,
  fieldUiDefault: 'old',
});

const posInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

// Whatever is stored, hand back a complete, well-typed object (older/partial blobs included).
function normalize(v) {
  const s = (v && typeof v === 'object') ? v : {};
  const sop = (s.ritSop && typeof s.ritSop === 'object') ? s.ritSop : {};
  const cap = {};
  Object.entries((s.fleetCapacity && typeof s.fleetCapacity === 'object') ? s.fleetCapacity : {}).forEach(([k, n]) => { const c = posInt(n); if (String(k).trim() && c) cap[String(k).trim()] = c; });
  return {
    ritSop: { enabled: !!sop.enabled, minLoad: posInt(sop.minLoad) || DEFAULT_RULES.ritSop.minLoad },
    fleetCapacity: cap,
    wajibFotoTransaksi: !!s.wajibFotoTransaksi,
    wajibFotoPengeluaran: !!s.wajibFotoPengeluaran,
    wajibAlasanBatal: !!s.wajibAlasanBatal,
    hargaGantiRugiGalon: posInt(s.hargaGantiRugiGalon),
    fieldUiDefault: s.fieldUiDefault === 'new' ? 'new' : 'old',
  };
}

async function getRules() {
  let v = null;
  try { v = await settings.get(KEY); } catch (e) { v = null; }
  return normalize(v);
}

const capacityOf = (rules, fleetId) => (fleetId && rules.fleetCapacity[fleetId]) || null;

// A human line per changed field, for the audit row.
function describeChanges(a, b) {
  const out = [];
  if (a.ritSop.enabled !== b.ritSop.enabled || a.ritSop.minLoad !== b.ritSop.minLoad) out.push(`SOP muatan ${b.ritSop.enabled ? 'aktif' : 'mati'}, minimal ${b.ritSop.minLoad} galon`);
  const plates = new Set([...Object.keys(a.fleetCapacity), ...Object.keys(b.fleetCapacity)]);
  plates.forEach((p) => { if ((a.fleetCapacity[p] || 0) !== (b.fleetCapacity[p] || 0)) out.push(`kapasitas ${p}: ${a.fleetCapacity[p] || 'tanpa batas'} → ${b.fleetCapacity[p] || 'tanpa batas'}`); });
  [['wajibFotoTransaksi', 'foto wajib transaksi'], ['wajibFotoPengeluaran', 'foto wajib pengeluaran'], ['wajibAlasanBatal', 'alasan wajib batal']].forEach(([k, label]) => { if (a[k] !== b[k]) out.push(`${label} ${b[k] ? 'aktif' : 'mati'}`); });
  if (a.hargaGantiRugiGalon !== b.hargaGantiRugiGalon) out.push(`harga ganti rugi galon ${a.hargaGantiRugiGalon} → ${b.hargaGantiRugiGalon}`);
  if (a.fieldUiDefault !== b.fieldUiDefault) out.push(b.fieldUiDefault === 'new' ? 'tampilan baru dijadikan tampilan utama' : 'tampilan lama dijadikan tampilan utama');
  return out;
}

async function setRules(patch, actor) {
  const p = patch || {};
  const cur = await getRules();
  const next = JSON.parse(JSON.stringify(cur));
  if (p.ritSop !== undefined) {
    if (p.ritSop.enabled !== undefined) next.ritSop.enabled = !!p.ritSop.enabled;
    if (p.ritSop.minLoad !== undefined) {
      const m = Math.round(Number(p.ritSop.minLoad));
      if (!Number.isFinite(m) || m < 1 || m > 10000) throw ApiError.badRequest('Muatan minimal harus 1–10000 galon.');
      next.ritSop.minLoad = m;
    }
  }
  if (p.fleetCapacity !== undefined) {
    Object.entries(p.fleetCapacity || {}).forEach(([k, v]) => {
      const plate = String(k).trim(); if (!plate) return;
      if (v === null || v === '' || Number(v) === 0) { delete next.fleetCapacity[plate]; return; }
      const c = Math.round(Number(v));
      if (!Number.isFinite(c) || c < 1 || c > 10000) throw ApiError.badRequest(`Kapasitas ${plate} harus 1–10000 galon.`);
      next.fleetCapacity[plate] = c;
    });
  }
  ['wajibFotoTransaksi', 'wajibFotoPengeluaran', 'wajibAlasanBatal'].forEach((k) => { if (p[k] !== undefined) next[k] = !!p[k]; });
  if (p.hargaGantiRugiGalon !== undefined) {
    const h = Math.round(Number(p.hargaGantiRugiGalon));
    if (!Number.isFinite(h) || h < 0 || h > 10000000) throw ApiError.badRequest('Harga ganti rugi galon tidak valid.');
    next.hargaGantiRugiGalon = h;
  }
  if (p.fieldUiDefault !== undefined) {
    if (p.fieldUiDefault !== 'old' && p.fieldUiDefault !== 'new') throw ApiError.badRequest('Tampilan utama harus "old" atau "new".');
    next.fieldUiDefault = p.fieldUiDefault;
  }
  const saved = normalize(next);
  await settings.set(KEY, saved);
  const changes = describeChanges(cur, saved);
  if (changes.length) await require('./distribution.service').logDistAudit('pengaturan', 'Aturan lapangan diubah', changes.join(' · '), actor, '');
  return saved;
}

module.exports = { KEY, DEFAULT_RULES, normalize, getRules, setRules, capacityOf };
```

Cek jalur `ApiError`: di `distribution.service.js` baris impornya berbentuk `const ApiError = require('../utils/ApiError');`. Kalau berbeda, samakan dengan yang ada di file itu.

- [ ] **Step 5: Controller + rute**

Di `server/src/controllers/distribution.controller.js`, dekat `depotSchema` (sekitar baris 216), tambahkan schema:

```js
// ATURAN LAPANGAN (owner/GM). Every field optional — a PATCH-style merge; the service validates ranges.
const fieldRulesSchema = z.object({
  ritSop: z.object({ enabled: z.boolean().optional(), minLoad: z.number().int().optional() }).optional(),
  fleetCapacity: z.record(z.union([z.number(), z.string(), z.null()])).optional(),
  wajibFotoTransaksi: z.boolean().optional(),
  wajibFotoPengeluaran: z.boolean().optional(),
  wajibAlasanBatal: z.boolean().optional(),
  hargaGantiRugiGalon: z.number().int().optional(),
  fieldUiDefault: z.string().max(10).optional(),
});
```

Di dekat handler `ritRoute` (sekitar baris 426), tambahkan:

```js
const fieldRules = require('../services/fieldRules.service');
const getFieldRules = asyncHandler(async (req, res) => res.json({ data: await fieldRules.getRules() }));
const putFieldRules = asyncHandler(async (req, res) => { const r = await fieldRules.setRules(req.body, req.user); bcast('rules', 'fieldRules'); res.json({ data: r }); });
```

Di `module.exports`, pada baris `ritRoute, setDepot,`, ganti menjadi `ritRoute, setDepot, getFieldRules, putFieldRules,`. Di objek `schemas: { ritQuery, depotSchema, …`, tambahkan `fieldRulesSchema,` setelah `depotSchema,`.

Di `server/src/routes/distribution.routes.js`, tepat setelah baris `router.put('/depot', …);` (baris 206), tambahkan:

```js
// ATURAN LAPANGAN — anyone in distribusi may READ them (the phone UI follows them); only owner/GM write.
router.get('/field-rules', requireCap('distribusi'), ctrl.getFieldRules);
router.put('/field-rules', requireCap('distribusiAturanLapangan'), validate({ body: ctrl.schemas.fieldRulesSchema }), ctrl.putFieldRules);
```

- [ ] **Step 6: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/field-rules.test.js`

Expected: PASS (4).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/fieldRules.service.js server/src/config/permissions.js server/src/controllers/distribution.controller.js server/src/routes/distribution.routes.js server/tests/field-rules.test.js
git commit -m "feat(distribusi): aturan lapangan (SOP, kapasitas armada, saklar foto/alasan) with audit"
```

---

### Task 3: Penjaga Mode asli (`X-Airro-Ui: field`)

**Files:**
- Create: `server/src/middleware/fieldUi.js`
- Modify: `server/src/routes/distribution.routes.js` (setelah `router.use(requireModule('distribusi'));`, baris 18)
- Test: `server/tests/field-ui-guard.test.js` (baru)

**Interfaces:**
- Consumes: `fieldRules.getRules()` (Task 2), izin `distribusiDemoPenuh` (Task 1).
- Produces: `fieldUiGuard(req, res, next)`. Permintaan **tulis** (method ≠ GET/HEAD/OPTIONS) yang membawa header `x-airro-ui: field` dari akun tanpa `distribusiDemoPenuh` akan dijawab 403, **kecuali** `fieldUiDefault === 'new'`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/field-ui-guard.test.js`:

```js
'use strict';
// The new phone UI tags every request with X-Airro-Ui: field. During the demo only a Demo penuh account
// may WRITE through it (Mode asli); reads always pass so Mode latihan can copy real data. After the
// owner releases the new UI (fieldUiDefault='new') the ordinary field caps are enough.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const D = '/api/v1/distribusi';
const FIELD = { distribusi: true, distribusiPengiriman: true, distribusiInput: true };
const today = todayISO();
let owner, latihan, penuh, plain, cid;

const mkUser = async (username, extra) => {
  const u = await reg({ name: username, username, password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: u.user.id }, data: { permissions: JSON.stringify({ ...FIELD, ...(extra || {}) }) } });
  return login(username, 'secret123');
};
const sell = (tok, field) => {
  const r = request(app).post(`${D}/transactions`).set(auth(tok));
  if (field) r.set('X-Airro-Ui', 'field');
  return r.send({ customerId: cid, qty: 1, method: 'lunas', txnDate: today });
};

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Pemilik', username: 'fu_owner', password: 'secret123', role: 'owner' })).token;
  cid = (await request(app).post(`${D}/customers`).set(auth(owner)).send({ name: 'Toko FU', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
  latihan = await mkUser('fu_latihan', { distribusiDemoLatihan: true });
  penuh = await mkUser('fu_penuh', { distribusiDemoPenuh: true });
  plain = await mkUser('fu_plain');
});
afterAll(() => prisma.$disconnect());

describe('field UI guard', () => {
  it('reads through the new UI pass for a Demo latihan account', async () => {
    const r = await request(app).get(`${D}/deliveries?date=${today}`).set(auth(latihan)).set('X-Airro-Ui', 'field');
    expect(r.status).toBe(200);
  });
  it('writes through the new UI are refused without Demo penuh', async () => {
    const r = await sell(latihan, true);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/Mode asli/);
  });
  it('Demo penuh may write through the new UI', async () => {
    expect((await sell(penuh, true)).status).toBe(201);
  });
  it('the old UI (no header) is untouched', async () => {
    expect((await sell(plain, false)).status).toBe(201);
  });
  it('after release (fieldUiDefault=new) ordinary field caps are enough', async () => {
    await request(app).put(`${D}/field-rules`).set(auth(owner)).send({ fieldUiDefault: 'new' });
    expect((await sell(plain, true)).status).toBe(201);
  });
});
```

Catatan: `createTransaction` menjawab 201 lewat controller. Kalau ternyata 200, sesuaikan `toBe(201)` dengan kode yang dipakai controller untuk rute itu.

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/field-ui-guard.test.js`

Expected: FAIL pada tes kedua (dapat 201, diharapkan 403).

- [ ] **Step 3: Buat middleware**

Buat `server/src/middleware/fieldUi.js`:

```js
'use strict';
// MODE LAPANGAN DEMO GUARD. The new phone UI sends `X-Airro-Ui: field` on every request. While the new
// UI is a demo, WRITING real data through it (Mode asli) needs the owner-granted distribusiDemoPenuh.
// Reads always pass (Mode latihan copies real data once, read-only). Once the owner releases the new UI
// (fieldRules.fieldUiDefault === 'new') the header no longer demands anything beyond the normal caps.
// This is a demo fence, not the security boundary — every route keeps its own requireCap.
const ApiError = require('../utils/ApiError');
const { resolvePerms } = require('../config/permissions');

const READ = new Set(['GET', 'HEAD', 'OPTIONS']);

async function fieldUiGuard(req, res, next) {
  try {
    if (READ.has(req.method)) return next();
    if (String(req.headers['x-airro-ui'] || '').toLowerCase() !== 'field') return next();
    if (!req.user) return next(ApiError.unauthorized());
    const perms = resolvePerms(req.user.role, req.user.permissions) || {};
    if (perms.distribusiDemoPenuh) return next();
    const rules = await require('../services/fieldRules.service').getRules();
    if (rules.fieldUiDefault === 'new') return next();
    return next(ApiError.forbidden('Akses Mode asli belum diberikan — pakai Mode latihan, atau minta Pemilik memberi akses Demo penuh.'));
  } catch (e) { return next(e); }
}

module.exports = { fieldUiGuard };
```

Samakan jalur `ApiError` dengan impor di `server/src/middleware/auth.js`.

- [ ] **Step 4: Pasang di rute**

Di `server/src/routes/distribution.routes.js`, ubah baris import auth menjadi:

```js
const { requireAuth, requireCap, requireAnyCap, requireUnit, requireModule } = require('../middleware/auth');
const { fieldUiGuard } = require('../middleware/fieldUi');
```

Lalu tepat setelah `router.use(requireModule('distribusi'));`, tambahkan:

```js
// MODE LAPANGAN demo fence (see middleware/fieldUi.js).
router.use(fieldUiGuard);
```

Di `server/src/app.js`, pastikan header CORS mengizinkan `X-Airro-Ui`. Cari opsi `allowedHeaders` di sana. Kalau ada, tambahkan `'X-Airro-Ui'`. Kalau tidak ada, `cors()` memantulkan header yang diminta, jadi tidak perlu diubah.

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/field-ui-guard.test.js`

Expected: PASS (5).

- [ ] **Step 6: Commit**

```bash
git add server/src/middleware/fieldUi.js server/src/routes/distribution.routes.js server/src/app.js server/tests/field-ui-guard.test.js
git commit -m "feat(distribusi): Mode asli fence for the new field UI (Demo penuh or released)"
```

---

### Task 4: SOP muatan + kapasitas armada saat Buka rit

**Files:**
- Modify: `server/prisma/schema.prisma` (model `DeliveryRun`, setelah `diffReason`)
- Create: `server/prisma/migrations/20261002100000_run_under_sop_reason/migration.sql`
- Modify: `server/src/controllers/distribution.controller.js` (`runOpenSchema`, baris 237)
- Modify: `server/src/services/distribution.service.js` (`openRun`, baris 4072-4091; `runClient`)
- Test: `server/tests/run-sop-capacity.test.js` (baru)

**Interfaces:**
- Consumes: `fieldRules.getRules()`, `fieldRules.capacityOf(rules, fleetId)` (Task 2).
- Produces:
  - `POST /runs/open` menerima `underSopReason?: string`;
  - run client membawa `underSopReason: string`;
  - error 400 dengan `details.code` = `'OVER_CAPACITY'` atau `'UNDER_SOP'`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/run-sop-capacity.test.js`:

```js
'use strict';
// BUKA RIT — the armada's capacity is a hard physical cap (whenever it is set); the SOP minimum
// (80 galon) needs a written reason below it once the owner switches the SOP on.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const D = '/api/v1/distribusi';
const today = todayISO();
let gm;
const open = (fleet, gallonsOut, extra) => request(app).post(`${D}/runs/open`).set(auth(gm)).send({ date: today, fleet, gallonsOut, ...(extra || {}) });
const closeOpen = async (fleet) => {
  const runs = (await request(app).get(`${D}/runs?date=${today}&fleet=${encodeURIComponent(fleet)}&status=open`).set(auth(gm))).body.data;
  for (const r of runs) await request(app).post(`${D}/runs/${r.id}/close`).set(auth(gm)).send({ gallonsFullReturned: r.gallonsOut, gallonsEmptyReturned: 0 });
};

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'sop_gm', password: 'secret123', role: 'gm' })).token;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 5000, reason: 'stok awal' });
});
afterAll(() => prisma.$disconnect());

describe('SOP + capacity', () => {
  it('with no rules set, any positive load opens (today\'s behaviour)', async () => {
    expect((await open('DK 1', 10)).status).toBe(201);
    await closeOpen('DK 1');
  });

  it('capacity is enforced even while the SOP switch is off', async () => {
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ fleetCapacity: { 'DK 1': 120 } });
    const r = await open('DK 1', 121);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/kapasitas/i);
    expect(r.body.error.details.code).toBe('OVER_CAPACITY');
    expect((await open('DK 1', 120)).status).toBe(201);
    await closeOpen('DK 1');
  });

  it('an armada without a capacity has no limit', async () => {
    expect((await open('DK 2', 500)).status).toBe(201);
    await closeOpen('DK 2');
  });

  it('SOP on: below the minimum needs a reason, which is stored and audited', async () => {
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ ritSop: { enabled: true } });
    let r = await open('DK 1', 64);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/80/);
    expect(r.body.error.details.code).toBe('UNDER_SOP');
    r = await open('DK 1', 64, { underSopReason: 'Pesanan tersisa sedikit' });
    expect(r.status).toBe(201);
    expect(r.body.data.underSopReason).toBe('Pesanan tersisa sedikit');
    const audit = (await request(app).get(`${D}/audit`).set(auth(gm))).body.data;
    expect(audit.some((a) => /di bawah SOP/.test(a.detail || '') && /Pesanan tersisa sedikit/.test(a.detail || ''))).toBe(true);
    await closeOpen('DK 1');
  });

  it('SOP on: at or above the minimum needs no reason', async () => {
    const r = await open('DK 1', 80);
    expect(r.status).toBe(201);
    expect(r.body.data.underSopReason).toBe('');
    await closeOpen('DK 1');
  });

  it('SOP off again: a low load opens without a reason', async () => {
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ ritSop: { enabled: false } });
    expect((await open('DK 1', 20)).status).toBe(201);
    await closeOpen('DK 1');
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/run-sop-capacity.test.js`

Expected: FAIL pada "capacity is enforced" (dapat 201).

- [ ] **Step 3: Skema + migrasi**

Di `server/prisma/schema.prisma`, model `DeliveryRun`, tepat setelah baris `diffReason …`, tambahkan:

```prisma
  underSopReason       String   @default("")           // why this rit left with fewer gallons than the SOP minimum (fieldRules.ritSop)
```

Buat `server/prisma/migrations/20261002100000_run_under_sop_reason/migration.sql`:

```sql
-- SOP MUATAN — the reason a rit was opened below the owner's minimum load. Additive; '' for every
-- existing rit.
ALTER TABLE "DeliveryRun" ADD COLUMN "underSopReason" TEXT NOT NULL DEFAULT '';
```

Run: `npx prisma generate`

- [ ] **Step 4: Schema zod**

Ganti `runOpenSchema` (controller baris 237) menjadi:

```js
const runOpenSchema = z.object({ date: DATE, fleet: z.string().max(60).optional(), gallonsOut: z.number().int().positive(), note: z.string().max(300).optional(), underSopReason: z.string().max(300).optional() });
```

- [ ] **Step 5: Aturan di `openRun`**

Di `openRun`, tepat setelah baris `if (gallonsOut <= 0) throw …;`, tambahkan:

```js
  // ATURAN LAPANGAN — capacity is a physical limit (always, whenever the owner set one for this armada);
  // the SOP minimum asks for a written reason below it, but only once the owner switched it on.
  const rules = await require('./fieldRules.service').getRules();
  const capacity = require('./fieldRules.service').capacityOf(rules, fleetId);
  if (capacity && gallonsOut > capacity) throw ApiError.badRequest(`Muatan ${gallonsOut} galon melebihi kapasitas armada ${fleetId} (${capacity} galon).`, { code: 'OVER_CAPACITY', capacity });
  const underSopReason = String(body.underSopReason || '').trim().slice(0, 300);
  const underSop = rules.ritSop.enabled && gallonsOut < rules.ritSop.minLoad;
  if (underSop && !underSopReason) throw ApiError.badRequest(`Muatan di bawah SOP (minimal ${rules.ritSop.minLoad} galon) — isi alasannya.`, { code: 'UNDER_SOP', minLoad: rules.ritSop.minLoad });
```

Di `prisma.deliveryRun.create({ data: { … } })` pada fungsi yang sama, tambahkan field `underSopReason: underSop ? underSopReason : ''` ke objek `data`.

Ganti baris `await logAudit('pengiriman', `Muat rit-${runNo}: ${fleetId}`, …)` menjadi:

```js
  await logAudit('pengiriman', `Muat rit-${runNo}: ${fleetId}`, `${gallonsOut} galon dimuat · ${date}${underSop ? ` · di bawah SOP (${rules.ritSop.minLoad}): ${underSopReason}` : ''}`, snap, fleetId);
```

Lalu cari `function runClient(` di file yang sama, dan di objek yang dikembalikannya tambahkan `underSopReason: r.underSopReason || '',`. Nama variabel baris di `runClient` mungkin bukan `r`; pakai nama parameter pertamanya.

- [ ] **Step 6: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/run-sop-capacity.test.js tests/rit-route.test.js`

Expected: PASS (6 + semua tes rit-route).

- [ ] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261002100000_run_under_sop_reason server/src/controllers/distribution.controller.js server/src/services/distribution.service.js server/tests/run-sop-capacity.test.js
git commit -m "feat(distribusi): rit capacity cap + SOP minimum load with required reason"
```

---

### Task 5: Foto bukti, metode Transfer, dan Kas vs Bank

**Files:**
- Modify: `server/prisma/schema.prisma` (model `DistTransaction`, setelah `note`)
- Create: `server/prisma/migrations/20261002110000_dist_txn_proof_paymethod_kind/migration.sql`
- Modify: `server/src/controllers/distribution.controller.js` (`txnSchema`, baris 85-95)
- Modify: `server/src/services/distribution.service.js`:
  - `isTransferPayment` (baris 96);
  - `createTransaction` (baris 1503-1565);
  - `createExpense` (baris 4871);
  - `dashboardSummary` (baris 3003-3006).
- Modify: `server/src/services/accounting.service.js` (`distTxnLines`, baris 278-307)
- Test: `server/tests/txn-proof-transfer.test.js` (baru)

**Interfaces:**
- Consumes: `fieldRules.getRules()` (Task 2).
- Produces:
  - Kolom `DistTransaction`: `proofPhotoId String?`, `proofTakenAt DateTime?`, `proofLat Float?`, `proofLng Float?`, `payMethod String @default("")`, `kind String @default("jual")`, `gallonQty Int @default(0)`. `kind` dan `gallonQty` dipakai Task 9.
  - `POST /transactions` menerima `payMethod: 'cash'|'tunai'|'transfer'` untuk **lunas** dan pelunasan, dan `proofPhotoId`, `proofTakenAt` (ISO), `proofLat`, `proofLng`.
  - `isTransferPayment(r)`: `r.payMethod` diutamakan, lalu akhiran catatan untuk baris lama.
  - `distTxnLines`: `payMethod==='transfer'` → BANK (1-1100), selain itu KAS.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/txn-proof-transfer.test.js`:

```js
'use strict';
process.env.ACCOUNTING_V2 = 'true';   // the journal assertions below need live posting
// FOTO BUKTI + TRANSFER — a sale can be paid by transfer (not only bon settlements); the money lands in
// BANK, cash stays in KAS; every txn can carry a proof photo, mandatory once the owner switches it on.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const D = '/api/v1/distribusi';
const today = todayISO();
let gm, cid, photoId;
const post = (body) => request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, txnDate: today, ...body });
const cashCodeOf = async (txnId) => {
  const e = await prisma.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: 'dist_txn', sourceId: txnId } }, include: { lines: { include: { chartAccount: true } } } });
  const debit = e.lines.find((l) => Number(l.debit) > 0 && ['1-1000', '1-1100'].includes(l.chartAccount.code));
  return debit ? debit.chartAccount.code : null;
};

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'pt_gm', password: 'secret123', role: 'gm' })).token;
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko PT', type: 'reguler', masterPrice: 18000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 500, reason: 'stok awal' });
  photoId = (await request(app).post('/api/v1/attachments').set(auth(gm)).send({ name: 'bukti.jpg', type: 'image/jpeg', data: 'data:image/jpeg;base64,/9j/4AAQ' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('transfer + Kas/Bank', () => {
  it('a cash sale posts to Kas', async () => {
    const r = await post({ qty: 2, method: 'lunas' });
    expect(r.status).toBe(201);
    expect(await cashCodeOf(r.body.data.id)).toBe('1-1000');
  });
  it('a transfer sale posts to Bank and is stored as lunas + payMethod transfer', async () => {
    const r = await post({ qty: 2, method: 'lunas', payMethod: 'transfer', proofPhotoId: photoId });
    expect(r.status).toBe(201);
    expect(r.body.data.method).toBe('lunas');
    expect(r.body.data.payMethod).toBe('transfer');
    expect(await cashCodeOf(r.body.data.id)).toBe('1-1100');
  });
  it('a pelunasan by transfer posts to Bank; by cash to Kas', async () => {
    await post({ qty: 5, method: 'bon' });
    const tf = await post({ method: 'pelunasan', payAmount: 18000, payMethod: 'transfer' });
    expect(tf.body.data.payMethod).toBe('transfer');
    expect(await cashCodeOf(tf.body.data.id)).toBe('1-1100');
    const cash = await post({ method: 'pelunasan', payAmount: 18000, payMethod: 'cash' });
    expect(cash.body.data.payMethod).toBe('tunai');
    expect(await cashCodeOf(cash.body.data.id)).toBe('1-1000');
  });
  it('the dashboard counts a transfer sale as transfer money-in, not cash to deposit', async () => {
    const s = (await request(app).get(`${D}/dashboard/summary`).set(auth(gm))).body.data || (await request(app).get(`${D}/dashboard/summary`).set(auth(gm))).body;
    expect(s.todayTransfer).toBe(36000 + 18000);   // transfer sale 2×18000 + transfer pelunasan
  });
  it('a legacy pelunasan tagged "· Transfer" in the note still counts as transfer', async () => {
    const t = await prisma.distTransaction.create({ data: { customerId: cid, fleetId: 'DK 1', qty: 0, unitPriceLocked: 0, amount: 1000, method: 'pelunasan', note: 'lama · Transfer', txnDate: today } });
    const svc = require('../src/services/distribution.service');
    expect(svc.isTransferPayment(t)).toBe(true);
  });
});

describe('foto bukti', () => {
  it('stores the proof photo + where/when it was taken', async () => {
    const r = await post({ qty: 1, method: 'lunas', proofPhotoId: photoId, proofTakenAt: new Date().toISOString(), proofLat: -8.67, proofLng: 115.22 });
    expect(r.body.data.proofPhotoId).toBe(photoId);
    const row = await prisma.distTransaction.findUnique({ where: { id: r.body.data.id } });
    expect(row.proofLat).toBeCloseTo(-8.67);
    expect(row.proofTakenAt).toBeTruthy();
  });
  it('switch off: a txn without a photo is accepted', async () => {
    expect((await post({ qty: 1, method: 'lunas' })).status).toBe(201);
  });
  it('switch on: sales AND bon payments need a photo; an unknown photo id is refused', async () => {
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ wajibFotoTransaksi: true });
    let r = await post({ qty: 1, method: 'bon' });
    expect(r.status).toBe(400);
    expect(r.body.error.details.code).toBe('PROOF_REQUIRED');
    r = await post({ method: 'pelunasan', payAmount: 1000, payMethod: 'cash' });
    expect(r.status).toBe(400);
    r = await post({ qty: 1, method: 'bon', proofPhotoId: 'tidak-ada' });
    expect(r.status).toBe(400);
    expect((await post({ qty: 1, method: 'bon', proofPhotoId: photoId })).status).toBe(201);
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ wajibFotoTransaksi: false });
  });
  it('expense receipt photo: optional until switched on', async () => {
    const x = (body) => request(app).post(`${D}/expenses`).set(auth(gm)).send({ date: today, fleet: 'DK 1', amount: 150000, category: 'bensin', ...body });
    expect((await x({})).status).toBe(201);
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ wajibFotoPengeluaran: true });
    const r = await x({});
    expect(r.status).toBe(400);
    expect(r.body.error.details.code).toBe('PROOF_REQUIRED');
    expect((await x({ photoId })).status).toBe(201);
  });
});
```

Cek dua hal di file lain sebelum menjalankan tes:
- Bentuk respons `POST /api/v1/attachments`: baca `server/src/controllers/attachment.controller.js` (atau routes-nya) dan sesuaikan body dan cara mengambil `id` kalau berbeda.
- Bentuk respons `dashboard/summary`: tes di atas sudah menangani `{data}` maupun objek langsung.

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/txn-proof-transfer.test.js`

Expected: FAIL (transfer sale diposting ke 1-1000, `payMethod` tidak ada).

- [ ] **Step 3: Skema + migrasi**

Di model `DistTransaction`, tepat setelah baris `note            String   @default("")`, tambahkan:

```prisma
  // HOW the money moved: 'tunai' | 'transfer' | '' (older rows — a pelunasan may still carry the legacy
  // " · Transfer" note tag). A transfer SALE is method 'lunas' + payMethod 'transfer' so every existing
  // "lunas" aggregate stays right; accounting posts it to Bank instead of Kas.
  payMethod       String   @default("")
  // KIND of row: 'jual' (every sale/bon/pelunasan so far) | 'ganti_rugi' (compensation for gallons a
  // customer broke/lost — money only, qty 0; gallonQty holds the number of gallons).
  kind            String   @default("jual")
  gallonQty       Int      @default(0)
  // FOTO BUKTI — Attachment id of the proof photo + when/where the phone took it (field UI).
  proofPhotoId    String?
  proofTakenAt    DateTime?
  proofLat        Float?
  proofLng        Float?
```

Buat `server/prisma/migrations/20261002110000_dist_txn_proof_paymethod_kind/migration.sql`:

```sql
-- MODE LAPANGAN — payment method column (transfer sales, Kas vs Bank), row kind (ganti rugi galon) and
-- the proof photo. Additive; existing rows: payMethod '' (legacy note tag still honoured), kind 'jual'.
ALTER TABLE "DistTransaction" ADD COLUMN "payMethod" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DistTransaction" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'jual';
ALTER TABLE "DistTransaction" ADD COLUMN "gallonQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DistTransaction" ADD COLUMN "proofPhotoId" TEXT;
ALTER TABLE "DistTransaction" ADD COLUMN "proofTakenAt" DATETIME;
ALTER TABLE "DistTransaction" ADD COLUMN "proofLat" REAL;
ALTER TABLE "DistTransaction" ADD COLUMN "proofLng" REAL;
```

Run: `npx prisma generate`

- [ ] **Step 4: Schema zod**

Ganti `txnSchema` menjadi:

```js
const txnSchema = z.object({
  customerId: z.string().min(1),
  qty: z.number().int().nonnegative().optional().default(0),   // 0 allowed for a standalone bon payment
  method: z.enum(['lunas', 'bon', 'pelunasan']).optional().default('lunas'),
  note: z.string().max(300).optional().default(''),
  txnDate: DATE,
  gallonOut: z.number().int().nonnegative().optional(),   // full gallons delivered (default = qty)
  gallonIn: z.number().int().nonnegative().optional(),    // empty gallons returned
  payAmount: z.number().int().nonnegative().optional(),   // method='pelunasan': bon payment amount
  payMethod: z.enum(['cash', 'tunai', 'transfer']).optional(),   // lunas + pelunasan: how the money moved
  proofPhotoId: z.string().max(60).optional(),
  proofTakenAt: z.string().max(40).optional(),
  proofLat: z.number().optional(),
  proofLng: z.number().optional(),
});
```

- [ ] **Step 5: `isTransferPayment` diekspor + mengutamakan kolom**

Ganti baris 96 menjadi:

```js
// Transfer money-in? The payMethod column wins (new rows: transfer sales + settlements); an older
// pelunasan without it falls back to the legacy trailing " · Transfer" note tag.
const isTransferPayment = (r) => {
  if (r.payMethod) return r.payMethod === 'transfer';
  if (r.method !== 'pelunasan') return false;
  const parts = String(r.note || '').split(' · ');
  return parts[parts.length - 1].trim().toLowerCase() === 'transfer';
};
```

Di `module.exports` (baris 5039-5040), ubah `bonMapFor, afterPointChange,` menjadi `bonMapFor, afterPointChange, isTransferPayment,`.

- [ ] **Step 6: Helper foto + rule di `createTransaction`**

Tepat sebelum `async function createTransaction(`, tambahkan:

```js
// FOTO BUKTI — validate the (optional) proof photo, and require it when the owner switched the
// photo rule on. Returns the columns to store. `kind` picks the message + rule key.
async function proofColumns(body, ruleKey) {
  const rules = await require('./fieldRules.service').getRules();
  const id = body.proofPhotoId ? String(body.proofPhotoId) : '';
  if (!id) {
    if (rules[ruleKey]) throw ApiError.badRequest('Foto bukti wajib dilampirkan.', { code: 'PROOF_REQUIRED' });
    return {};
  }
  const att = await prisma.attachment.findUnique({ where: { id }, select: { id: true } });
  if (!att) throw ApiError.badRequest('Foto bukti tidak ditemukan — unggah ulang fotonya.', { code: 'PROOF_MISSING' });
  const t = body.proofTakenAt ? new Date(body.proofTakenAt) : null;
  const num = (v) => (v != null && Number.isFinite(+v) ? +v : null);
  return { proofPhotoId: id, proofTakenAt: t && !isNaN(t.getTime()) ? t : null, proofLat: num(body.proofLat), proofLng: num(body.proofLng) };
}
const normPayMethod = (v) => (v === 'transfer' ? 'transfer' : 'tunai');
```

Di `createTransaction`, di cabang `if (method === 'pelunasan') {`:
- ganti `const payMethod = (body.payMethod === 'transfer') ? 'Transfer' : 'Cash';` dengan:
  ```js
  const payMethodCol = normPayMethod(body.payMethod);
  const payMethod = payMethodCol === 'transfer' ? 'Transfer' : 'Cash';   // label kept in note + audit (legacy readers)
  const proof = await proofColumns(body, 'wajibFotoTransaksi');
  ```
- di `tx.distTransaction.create({ data: { … } })` cabang itu, tambahkan `payMethod: payMethodCol, ...proof,` ke `data`.

Di cabang penjualan (setelah `const deliveryRunId = …`), tambahkan:

```js
  const proof = await proofColumns(body, 'wajibFotoTransaksi');
  // A BON has no payment yet; lunas is cash unless the driver picked transfer.
  const payMethodCol = method === 'bon' ? '' : normPayMethod(body.payMethod);
```

Lalu pada `tx.distTransaction.create({ data: { … } })` penjualan, tambahkan `payMethod: payMethodCol, ...proof,` ke `data`. Ubah pesan audit penjualan menjadi:

```js
  await logAudit('input', `Transaksi: ${customer.name}`, `${qty} × ${unitPriceLocked} = ${amount} (${method}${payMethodCol === 'transfer' ? ' · transfer' : ''}) · galon keluar ${gOut} masuk ${gIn}${proof.proofPhotoId ? ' · foto bukti' : ''}`, snap, fleetId);
```

- [ ] **Step 7: Foto nota wajib di `createExpense`**

Di `createExpense`, tepat setelah `const method = body.method === 'transfer' ? 'transfer' : 'tunai';`, tambahkan:

```js
  if (!body.photoId && (await require('./fieldRules.service').getRules()).wajibFotoPengeluaran) throw ApiError.badRequest('Foto nota wajib dilampirkan.', { code: 'PROOF_REQUIRED' });
```

- [ ] **Step 8: Kas vs Bank di `distTxnLines`**

Di `accounting.service.js` `distTxnLines`, tepat setelah `const f = t.fleetId || '';`, tambahkan:

```js
  // Where the money landed: a transfer (sale or settlement) is BANK; everything else KAS. Only the
  // payMethod column decides — a legacy row tagged "· Transfer" in its note keeps posting to Kas until
  // the owner-approved reclass script sets its payMethod (scripts/reclass-transfer-payments.js).
  const cash = t.payMethod === 'transfer' ? BANK : KAS;
  // Revenue account: gallon sales → Penjualan Air; ganti rugi galon → Pendapatan Lain.
  const rev = t.kind === 'ganti_rugi' ? REV_OTHER : REV_MAIN;
```

Lalu ubah tiga baris di fungsi itu:
- `return [{ code: KAS, debit: amt, fleetId: f }, { code: AR, credit: amt, fleetId: f }];` (pelunasan biasa) → `return [{ code: cash, debit: amt, fleetId: f }, { code: AR, credit: amt, fleetId: f }];`
- baris `if (t.method !== 'bon') { … }` → `if (t.method !== 'bon') { const amt = n(t.amount); if (!amt) return []; return [{ code: cash, debit: amt, fleetId: f }, { code: rev, credit: amt, fleetId: f }, ...(t.kind === 'ganti_rugi' ? [] : await hppOnSaleLines(t, db))]; }`
- `const lines = [{ code: AR, debit: arNet, fleetId: f }, { code: REV_MAIN, credit: revenue - tidak, fleetId: f }];` → ganti `REV_MAIN` dengan `rev`, dan baris `return [...lines, ...(await hppOnSaleLines(t, db))];` → `return [...lines, ...(t.kind === 'ganti_rugi' ? [] : await hppOnSaleLines(t, db))];`

- [ ] **Step 9: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/txn-proof-transfer.test.js tests/reassign.test.js`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261002110000_dist_txn_proof_paymethod_kind server/src/controllers/distribution.controller.js server/src/services/distribution.service.js server/src/services/accounting.service.js server/tests/txn-proof-transfer.test.js
git commit -m "feat(distribusi): transfer sales (Bank), payMethod column, proof photos + owner switches"
```

---

### Task 6: Skrip reklasifikasi pelunasan transfer lama (Kas → Bank)

**Files:**
- Create: `server/scripts/reclass-transfer-payments.js`
- Test: `server/tests/reclass-transfer-payments.test.js` (baru)

**Interfaces:**
- Consumes:
  - `isTransferPayment` (Task 5);
  - `acc.reconcileDistTxn(row, reason, actor, db)` (sudah ada, dipakai `voidTransaction`);
  - `_db-guard` (sudah ada di `server/scripts/`; baca cara pakainya di skrip lain, misalnya `grep -l "_db-guard" server/scripts/*.js`).
- Produces: `listLegacyTransfers() → {count,total,rows}` dan `applyReclass(actor) → {changed}`. Keduanya diekspor untuk tes. CLI: `node scripts/reclass-transfer-payments.js [--apply]`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/reclass-transfer-payments.test.js`:

```js
'use strict';
process.env.ACCOUNTING_V2 = 'true';
// Older bon settlements paid by transfer were posted to KAS (the note carried "· Transfer"). The script
// LISTS them without writing; --apply sets payMethod='transfer' and reconciles each journal to Bank.
// Idempotent: a second apply changes nothing.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');
const script = require('../scripts/reclass-transfer-payments');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
let gm, cid, legacyId;
const bal = async (code) => {
  const lines = await prisma.journalLine.findMany({ where: { chartAccount: { code } } });
  return lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
};

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'rc_gm', password: 'secret123', role: 'gm' })).body.token;
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko RC', type: 'reguler', masterPrice: 10000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 100, reason: 'stok awal' });
  await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 5, method: 'bon', txnDate: today });
  // A legacy-shaped transfer settlement: posted the old way (payMethod '' → Kas), note tag only.
  const r = await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, method: 'pelunasan', payAmount: 20000, payMethod: 'cash', txnDate: today });
  legacyId = r.body.data.id;
  await prisma.distTransaction.update({ where: { id: legacyId }, data: { payMethod: '', note: 'bayar · Transfer' } });
});
afterAll(() => prisma.$disconnect());

it('--list reports the legacy transfer rows and writes nothing', async () => {
  const kasBefore = await bal('1-1000');
  const l = await script.listLegacyTransfers();
  expect(l.count).toBe(1);
  expect(l.total).toBe(20000);
  expect(await bal('1-1000')).toBe(kasBefore);
  expect((await prisma.distTransaction.findUnique({ where: { id: legacyId } })).payMethod).toBe('');
});

it('--apply moves the money from Kas to Bank, once', async () => {
  const kas = await bal('1-1000'); const bank = await bal('1-1100');
  const a = await script.applyReclass({ id: null, name: 'test' });
  expect(a.changed).toBe(1);
  expect(await bal('1-1000')).toBe(kas - 20000);
  expect(await bal('1-1100')).toBe(bank + 20000);
  expect((await script.applyReclass({ id: null, name: 'test' })).changed).toBe(0);
  expect((await script.listLegacyTransfers()).count).toBe(0);
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/reclass-transfer-payments.test.js`

Expected: FAIL ("Cannot find module '../scripts/reclass-transfer-payments'").

- [ ] **Step 3: Tulis skrip**

Baca dulu bagian atas `server/scripts/reconcile-stale-ar.js` atau skrip remediasi lain yang memakai `_db-guard`, lalu tiru cara memanggil guard-nya. Buat `server/scripts/reclass-transfer-payments.js`:

```js
'use strict';
// RECLASS LEGACY TRANSFER SETTLEMENTS (Kas → Bank). Before the payMethod column, a bon settlement paid by
// transfer was tagged "· Transfer" in its note but POSTED TO KAS. This script:
//   node scripts/reclass-transfer-payments.js          → LIST only (default; writes nothing)
//   node scripts/reclass-transfer-payments.js --apply  → set payMethod='transfer' + append an adjusting
//                                                        journal per row (reconcileDistTxn) Kas → Bank
// Run --apply ONLY with the owner's approval. Idempotent (a fixed row has payMethod set).
const prisma = require('../src/lib/prisma');
const acc = require('../src/services/accounting.service');
const config = require('../src/config/env');

async function candidates() {
  const rows = await prisma.distTransaction.findMany({ where: { method: 'pelunasan', payMethod: '', status: { not: 'void' } } });
  return rows.filter((r) => { const parts = String(r.note || '').split(' · '); return parts[parts.length - 1].trim().toLowerCase() === 'transfer'; });
}

async function listLegacyTransfers() {
  const rows = await candidates();
  return { count: rows.length, total: rows.reduce((s, r) => s + Number(r.amount || 0), 0), rows: rows.map((r) => ({ id: r.id, date: r.txnDate, amount: Number(r.amount), fleetId: r.fleetId })) };
}

async function applyReclass(actor) {
  const rows = await candidates();
  let changed = 0;
  for (const r of rows) {
    await prisma.$transaction(async (tx) => {
      const row = await tx.distTransaction.update({ where: { id: r.id }, data: { payMethod: 'transfer' } });
      if (config.accountingV2) await acc.reconcileDistTxn(row, 'reclass transfer → bank', actor, tx);
    });
    changed++;
  }
  return { changed };
}

module.exports = { listLegacyTransfers, applyReclass };

if (require.main === module) {
  (async () => {
    // Same production guard the other remediation scripts use (refuses an accidental prod write).
    require('./_db-guard');
    const apply = process.argv.includes('--apply');
    const l = await listLegacyTransfers();
    console.log(`Pelunasan transfer lama yang tercatat ke Kas: ${l.count} baris, total Rp ${l.total.toLocaleString('id-ID')}`);
    l.rows.forEach((r) => console.log(`  ${r.date}  ${r.fleetId}  Rp ${r.amount.toLocaleString('id-ID')}  ${r.id}`));
    if (!apply) { console.log('\nMode daftar saja. Jalankan dengan --apply setelah disetujui pemilik.'); process.exit(0); }
    const a = await applyReclass({ id: null, name: 'script reclass-transfer-payments' });
    console.log(`Selesai: ${a.changed} baris dipindah Kas → Bank.`);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
```

Kalau `_db-guard` diekspor sebagai fungsi, bukan efek samping `require`, panggil sesuai cara skrip lain memakainya. Tanda tangan `acc.reconcileDistTxn` di `voidTransaction` adalah `(row, 'void', actor, tx)`; argumen kedua adalah label alasan. Kalau fungsinya mengharuskan label dari daftar tertentu, pakai label yang sudah dikenal (baca definisinya di `accounting.service.js`).

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/reclass-transfer-payments.test.js`

Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add server/scripts/reclass-transfer-payments.js server/tests/reclass-transfer-payments.test.js
git commit -m "feat(accounting): list/apply script to move legacy transfer settlements from Kas to Bank"
```

---

### Task 7: Tunda & Batal per stop dengan alasan

**Files:**
- Modify: `server/src/controllers/distribution.controller.js` (`markSchema`, baris 203)
- Modify: `server/src/services/distribution.service.js` (`markDelivery`, baris 4214-4247)
- Test: `server/tests/stop-hold-cancel.test.js` (baru)

**Interfaces:**
- Consumes: `fieldRules.getRules().wajibAlasanBatal` (Task 2).
- Produces: `PATCH /deliveries/:id` menerima `status: 'ditunda'` + `reason` (wajib), dan `status: 'batal'` + `reason`. Alasan disimpan di `Delivery.pendingReason`; kembali ke `pending` mengosongkannya.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/stop-hold-cancel.test.js`:

```js
'use strict';
// A stop can be put on HOLD (ditunda) straight from the board — reason required — and CANCELLED with a
// reason (required once the owner switches it on). Both land in pendingReason, the same column the
// day-closeout fills, so the report and carry-over read them unchanged.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
const ALL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
let gm; const stops = {};
const mark = (id, body) => request(app).patch(`${D}/deliveries/${id}`).set(auth(gm)).send(body);

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'hc_gm', password: 'secret123', role: 'gm' })).body.token;
  for (const n of ['A', 'B', 'C']) await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: n, type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL });
  const board = (await request(app).get(`${D}/deliveries?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
  (board.stops || board).forEach((s) => { stops[s.customerName || (s.customer && s.customer.name)] = s.id; });
});
afterAll(() => prisma.$disconnect());

it('ditunda needs a reason', async () => {
  const r = await mark(stops.A, { status: 'ditunda' });
  expect(r.status).toBe(400);
  expect(r.body.error.message).toMatch(/alasan/i);
});
it('ditunda with a reason is stored and audited', async () => {
  const r = await mark(stops.A, { status: 'ditunda', reason: 'Toko tutup' });
  expect(r.status).toBe(200);
  const row = await prisma.delivery.findUnique({ where: { id: stops.A } });
  expect(row.status).toBe('ditunda');
  expect(row.pendingReason).toBe('Toko tutup');
  const audit = (await request(app).get(`${D}/audit`).set(auth(gm))).body.data;
  expect(audit.some((a) => /Tunda/.test(a.title) && /Toko tutup/.test(a.detail || ''))).toBe(true);
});
it('back to pending clears the reason', async () => {
  await mark(stops.A, { status: 'pending' });
  expect((await prisma.delivery.findUnique({ where: { id: stops.A } })).pendingReason).toBe('');
});
it('batal: reason optional while the switch is off, stored when given', async () => {
  expect((await mark(stops.B, { status: 'batal' })).status).toBe(200);
  expect((await mark(stops.C, { status: 'batal', reason: 'Pindah alamat' })).status).toBe(200);
  expect((await prisma.delivery.findUnique({ where: { id: stops.C } })).pendingReason).toBe('Pindah alamat');
});
it('batal: reason required once the owner switches it on', async () => {
  await mark(stops.B, { status: 'pending' });
  await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ wajibAlasanBatal: true });
  const r = await mark(stops.B, { status: 'batal' });
  expect(r.status).toBe(400);
  expect(r.body.error.details.code).toBe('REASON_REQUIRED');
});
```

Cek bentuk respons `GET /deliveries`: baca `deliveryBoard` (sekitar baris 3944) dan sesuaikan cara tes membaca daftar stop dan nama pelanggan (field `customerName` pada `deliveryClient`).

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/stop-hold-cancel.test.js`

Expected: FAIL (zod menolak `ditunda` dengan 400 tanpa pesan "alasan").

- [ ] **Step 3: Schema zod**

```js
const markSchema = z.object({ status: z.enum(['pending', 'terkirim', 'batal', 'ditunda']), transactionId: z.string().min(1).optional(), noLocationReason: z.string().max(300).optional(), reason: z.string().max(300).optional() });
```

- [ ] **Step 4: `markDelivery`**

Ganti baris `const status = ['pending', 'terkirim', 'batal'].includes(body.status) ? body.status : d.status;` menjadi:

```js
  const status = ['pending', 'terkirim', 'batal', 'ditunda'].includes(body.status) ? body.status : d.status;
  // TUNDA / BATAL from the board carry a reason (pendingReason — the same column the day-closeout writes).
  const reason = String(body.reason || '').trim().slice(0, 300);
  if (status === 'ditunda' && !reason) throw ApiError.badRequest('Alasan tunda wajib diisi.', { code: 'REASON_REQUIRED' });
  if (status === 'batal' && !reason && (await require('./fieldRules.service').getRules()).wajibAlasanBatal) throw ApiError.badRequest('Alasan batal wajib diisi.', { code: 'REASON_REQUIRED' });
```

Ganti `const data = { status };` menjadi:

```js
  const data = { status };
  if (status === 'ditunda' || status === 'batal') data.pendingReason = reason;
  else if (status === 'pending') data.pendingReason = '';
```

Tepat sebelum `const sisa = (await bonMapFor(…` tambahkan:

```js
  if ((status === 'ditunda' || status === 'batal') && status !== d.status) {
    const snap = await actorSnap(actor);
    await logAudit('pengiriman', `${status === 'ditunda' ? 'Tunda' : 'Batal'}: ${row.customer ? row.customer.name : ''}`, reason ? 'alasan: ' + reason : 'tanpa alasan', snap, row.fleetId);
  }
```

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/stop-hold-cancel.test.js`

Lalu jalankan juga tes carry-over yang sudah ada: `ls tests | grep -i -E "outstanding|carry"`, kemudian `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand <file-file itu>`.

Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
git add server/src/controllers/distribution.controller.js server/src/services/distribution.service.js server/tests/stop-hold-cancel.test.js
git commit -m "feat(distribusi): tunda/batal a stop from the board with a reason"
```

---

### Task 8: Riwayat titik: geser + posisi perangkat + edit lewat formulir

**Files:**
- Modify: `server/prisma/schema.prisma` (model `CustomerLocationHistory`, setelah `movedM`)
- Create: `server/prisma/migrations/20261002120000_location_history_method/migration.sql`
- Modify: `server/src/controllers/distribution.controller.js` (`locationSchema`, baris 51)
- Modify: `server/src/services/distribution.service.js` (`setCustomerLocation` baris 642-666, `updateCustomer` baris 607-616, `listLocationHistory`)
- Test: `server/tests/location-drag-history.test.js` (baru)

**Interfaces:**
- Produces:
  - `PATCH /customers/:id/location` menerima `method: 'gps'|'geser'`, `deviceLat`, `deviceLng`, `deviceAccuracy`;
  - riwayat menyimpan `method`, `deviceLat/Lng/Accuracy`, dan `fromDeviceM` (jarak titik baru dari posisi perangkat);
  - `updateCustomer` yang mengubah lat/lng menulis riwayat `method:'form'` beserta titik sebelumnya.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/location-drag-history.test.js`:

```js
'use strict';
// GESER TITIK — the pin may be dragged away from the phone's GPS fix (which can be tens of metres off).
// History keeps HOW the point was set, the device fix and how far the pin was moved from it. A point
// typed in the customer form now leaves a history row too (it used to leave only a generic audit).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
let gm, cid;
const hist = async () => prisma.customerLocationHistory.findMany({ where: { customerId: cid }, orderBy: { createdAt: 'desc' } });

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'lg_gm', password: 'secret123', role: 'gm' })).body.token;
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Pak Wayan', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

it('a dragged pin records method, device fix and distance from the device', async () => {
  const r = await request(app).patch(`${D}/customers/${cid}/location`).set(auth(gm)).send({ lat: -8.67120, lng: 115.22626, accuracy: 25, method: 'geser', deviceLat: -8.67120, deviceLng: 115.22610, deviceAccuracy: 25 });
  expect(r.status).toBe(200);
  const h = (await hist())[0];
  expect(h.method).toBe('geser');
  expect(h.deviceLat).toBeCloseTo(-8.6712);
  expect(h.fromDeviceM).toBeGreaterThan(15);
  expect(h.fromDeviceM).toBeLessThan(20);
  const audit = (await request(app).get(`${D}/audit`).set(auth(gm))).body.data;
  expect(audit.some((a) => /Set lokasi/.test(a.title) && /digeser \d+ m dari GPS/.test(a.detail || ''))).toBe(true);
});

it('a plain GPS capture stays method gps', async () => {
  await request(app).patch(`${D}/customers/${cid}/location`).set(auth(gm)).send({ lat: -8.6713, lng: 115.2262, accuracy: 10 });
  expect((await hist())[0].method).toBe('gps');
});

it('coordinates typed in the customer form leave a history row with the previous point', async () => {
  const r = await request(app).patch(`${D}/customers/${cid}`).set(auth(gm)).send({ lat: -8.6800, lng: 115.2300 });
  expect(r.status).toBe(200);
  const h = (await hist())[0];
  expect(h.method).toBe('form');
  expect(h.prevLat).toBeCloseTo(-8.6713);
  expect(h.lat).toBeCloseTo(-8.68);
  expect(h.movedM).toBeGreaterThan(500);
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/location-drag-history.test.js`

Expected: FAIL (`h.method` undefined).

- [ ] **Step 3: Skema + migrasi**

Di model `CustomerLocationHistory`, setelah baris `movedM       Float?`, tambahkan:

```prisma
  // HOW the point was set: gps (phone fix) | geser (pin dragged on the map) | form (typed in the
  // customer form) — plus the phone's own fix at that moment and how far the pin was moved from it.
  method        String   @default("gps")
  deviceLat     Float?
  deviceLng     Float?
  deviceAccuracy Float?
  fromDeviceM   Float?
```

Buat `server/prisma/migrations/20261002120000_location_history_method/migration.sql`:

```sql
-- GESER TITIK — how a customer point was set and how far it was dragged from the phone's own fix.
-- Additive; existing history rows read as method 'gps'.
ALTER TABLE "CustomerLocationHistory" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'gps';
ALTER TABLE "CustomerLocationHistory" ADD COLUMN "deviceLat" REAL;
ALTER TABLE "CustomerLocationHistory" ADD COLUMN "deviceLng" REAL;
ALTER TABLE "CustomerLocationHistory" ADD COLUMN "deviceAccuracy" REAL;
ALTER TABLE "CustomerLocationHistory" ADD COLUMN "fromDeviceM" REAL;
```

Run: `npx prisma generate`

- [ ] **Step 4: Schema zod**

```js
const locationSchema = z.object({ lat: z.union([z.number(), z.string()]), lng: z.union([z.number(), z.string()]), accuracy: z.union([z.number(), z.string(), z.null()]).optional(), address: z.string().max(300).optional(), note: z.string().max(300).optional(), method: z.enum(['gps', 'geser']).optional(), deviceLat: z.number().optional(), deviceLng: z.number().optional(), deviceAccuracy: z.number().optional() });
```

- [ ] **Step 5: `setCustomerLocation`**

Setelah `const movedM = prev ? … : null;`, tambahkan:

```js
  const method = body.method === 'geser' ? 'geser' : 'gps';
  const dev = normLatLng(body.deviceLat, body.deviceLng);
  const fromDeviceM = dev ? Math.round(haversineKm(dev, loc) * 1000) : null;
  const devAcc = (body.deviceAccuracy != null && Number.isFinite(+body.deviceAccuracy)) ? Math.max(0, Math.round(+body.deviceAccuracy)) : null;
```

Di `customerLocationHistory.create({ data: { … } })` fungsi ini, tambahkan `method, deviceLat: dev ? dev.lat : null, deviceLng: dev ? dev.lng : null, deviceAccuracy: devAcc, fromDeviceM,` ke `data`.

Ubah detail audit menjadi:

```js
  await logAudit('pelanggan', `Set lokasi: ${c.name}`, `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}${acc != null ? ' · ±' + acc + ' m' : ''}${movedM != null ? ' · geser ' + movedM + ' m dari titik lama' : ''}${method === 'geser' && fromDeviceM != null ? ' · pin digeser ' + fromDeviceM + ' m dari GPS perangkat' : ''}`, snap, c.armada);
```

Pola tes adalah `/digeser \d+ m dari GPS/`, dan teks `pin digeser 17 m dari GPS perangkat` cocok dengan pola itu.

- [ ] **Step 6: Riwayat dari formulir (`updateCustomer`)**

Di `updateCustomer`, tepat setelah `let c = await prisma.customer.update({ where: { id }, data });`, tambahkan:

```js
  // A point typed/pasted in the customer form is a location change like any other — it gets a history
  // row (with the previous point), not just the generic "Ubah pelanggan" audit.
  if (data.lat !== undefined && data.lat !== null && (data.lat !== cur.lat || data.lng !== cur.lng)) {
    const prevPt = hasCoords(cur) ? { lat: cur.lat, lng: cur.lng } : null;
    await prisma.customerLocationHistory.create({ data: {
      customerId: id, action: 'set', method: 'form', lat: data.lat, lng: data.lng, accuracy: null,
      prevLat: prevPt ? prevPt.lat : null, prevLng: prevPt ? prevPt.lng : null, prevAccuracy: prevPt ? cur.locationAccuracy : null,
      movedM: prevPt ? Math.round(haversineKm(prevPt, { lat: data.lat, lng: data.lng }) * 1000) : null,
      note: 'diubah lewat formulir pelanggan', actorId: snap.actorId, actorName: snap.actorName,
    } });
  }
```

Kalau `listLocationHistory` memetakan kolom satu per satu, tambahkan `method`, `deviceLat`, `deviceLng`, `deviceAccuracy`, dan `fromDeviceM` ke objek hasilnya. Cari dengan `grep -n "async function listLocationHistory" -A 20`.

- [ ] **Step 7: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/location-drag-history.test.js`

Lalu jalankan juga tes riwayat lokasi yang sudah ada (`ls tests | grep -i location`).

Expected: PASS semua.

- [ ] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261002120000_location_history_method server/src/controllers/distribution.controller.js server/src/services/distribution.service.js server/tests/location-drag-history.test.js
git commit -m "feat(distribusi): location history records dragged pins, device fix and form edits"
```

---

### Task 9: Ganti rugi galon rusak (tanpa persetujuan)

**Files:**
- Modify: `server/src/services/distribution.service.js`:
  - `custEffect` / `totalEffect` / `DAMAGE_TYPES` (baris 3090-3110);
  - fungsi baru `gallonDamageCharge` (letakkan setelah `reportGallonDamage`, baris 3592);
  - `requestChange` (baris 1914) dan `computeReassign` (baris 2100);
  - `dashboardSummary` (baris 3003-3006);
  - `module.exports`.
- Modify: `server/src/controllers/distribution.controller.js` (schema + handler + export)
- Modify: `server/src/routes/distribution.routes.js`
- Test: `server/tests/gallon-damage-charge.test.js` (baru)

**Interfaces:**
- Consumes:
  - `fieldRules.getRules().hargaGantiRugiGalon` (Task 2);
  - kolom `kind`, `gallonQty`, `payMethod`, `proofPhotoId` (Task 5);
  - `distTxnLines` dengan `rev`/`cash` (Task 5).
- Produces:
  - `POST /api/v1/distribusi/customers/:id/gallon-damage` (izin `distribusiInput`), body `{ qty, kind: 'pecah'|'bocor'|'retak'|'hilang', payMethod: 'tunai'|'bon'|'transfer', photoId, note?, txnDate }`, respons `{ data: { transaction, gallonsHeld, sisaBon } }`;
  - tipe movement baru `damage_customer` dan `loss_customer` (pelanggan → rusak/hilang).

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/gallon-damage-charge.test.js`:

```js
'use strict';
process.env.ACCOUNTING_V2 = 'true';
// GANTI RUGI GALON — a customer broke/lost gallons they held. One step, no approval: the gallons leave
// the customer into the rusak/hilang bucket (4-location invariant holds), and the charge is recorded as
// money only (qty 0, kind 'ganti_rugi') — cash/transfer → Pendapatan Lain, bon → Piutang (Sisa Bon).
// It never counts as a gallon sale. Void reverses everything.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
let gm, cid, photoId;
const charge = (body) => request(app).post(`${D}/customers/${cid}/gallon-damage`).set(auth(gm)).send({ txnDate: today, photoId, ...body });
const stock = async () => (await request(app).get(`${D}/gallon`).set(auth(gm))).body.data;
const codeBal = async (code) => (await prisma.journalLine.findMany({ where: { chartAccount: { code } } })).reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'gd_gm', password: 'secret123', role: 'gm' })).body.token;
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Pak Wayan', type: 'reguler', masterPrice: 18000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 100, reason: 'stok awal' });
  await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 6, method: 'lunas', txnDate: today, gallonOut: 6, gallonIn: 0 });   // holds 6
  photoId = (await request(app).post('/api/v1/attachments').set(auth(gm)).send({ name: 'pecah.jpg', type: 'image/jpeg', data: 'data:image/jpeg;base64,/9j/4AAQ' })).body.data.id;
  await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ hargaGantiRugiGalon: 45000 });
});
afterAll(() => prisma.$disconnect());

it('refuses without a photo, and more gallons than the customer holds', async () => {
  let r = await charge({ qty: 1, kind: 'pecah', payMethod: 'tunai', photoId: undefined });
  expect(r.status).toBe(400);
  r = await charge({ qty: 7, kind: 'pecah', payMethod: 'tunai' });
  expect(r.status).toBe(400);
  expect(r.body.error.message).toMatch(/6/);
  expect(await prisma.gallonMovement.count({ where: { type: { in: ['damage_customer', 'loss_customer'] } } })).toBe(0);
});

it('cash charge: gallons move to rusak, invariant holds, money to Pendapatan Lain, not a sale', async () => {
  const before = await stock();
  const revBefore = await codeBal('4-2000');
  const sales = await codeBal('4-1000');
  const r = await charge({ qty: 1, kind: 'pecah', payMethod: 'tunai' });
  expect(r.status).toBe(201);
  const t = r.body.data.transaction;
  expect(t.kind).toBe('ganti_rugi');
  expect(t.qty).toBe(0);
  expect(t.gallonQty).toBe(1);
  expect(Number(t.amount)).toBe(45000);
  expect(r.body.data.gallonsHeld).toBe(5);
  const after = await stock();
  expect(after.stock ? after.stock.rusakHilang : after.rusakHilang).toBe((before.stock ? before.stock.rusakHilang : before.rusakHilang) + 1);
  const inv = (await request(app).get(`${D}/gallon/integrity`).set(auth(gm))).body.data;
  expect(inv.ok !== false).toBe(true);
  expect(await codeBal('4-2000')).toBe(revBefore + 45000);
  expect(await codeBal('4-1000')).toBe(sales);   // no gallon-sale revenue
});

it('bon charge raises Sisa Bon and keeps AR == Σ Sisa Bon', async () => {
  const r = await charge({ qty: 2, kind: 'hilang', payMethod: 'bon' });
  expect(r.status).toBe(201);
  expect(r.body.data.sisaBon).toBe(90000);
  const ar = (await prisma.journalLine.findMany({ where: { chartAccount: { code: '1-1200' } } })).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  expect(ar).toBe(90000);
});

it('is not counted as a sale on the dashboard, but its cash is money-in', async () => {
  const s = (await request(app).get(`${D}/dashboard/summary`).set(auth(gm))).body;
  const d = s.data || s;
  expect(d.byMethod ? d.byMethod.lunas : d.lunas).toBe(6 * 18000);   // the gallon sale only
  expect(d.todayCash).toBe(6 * 18000 + 45000);
});

it('a correction request on a ganti rugi row is refused (void + re-enter instead)', async () => {
  const t = await prisma.distTransaction.findFirst({ where: { kind: 'ganti_rugi', method: 'lunas' } });
  const r = await request(app).post(`${D}/transactions/${t.id}/corrections`).set(auth(gm)).send({ reason: 'salah', payload: { amount: 1 } });
  expect(r.status).toBe(400);
  expect(r.body.error.message).toMatch(/ganti rugi/i);
});
```

Beberapa asersi di tes ini mengandung `a ? b : c`. Tujuannya menampung bentuk respons `GET /gallon` dan `dashboard/summary` yang belum dipastikan. Sebelum menjalankan tes, baca `gallonSummary` (baris 3600) dan return `dashboardSummary` (baris 3060-3081), lalu **sederhanakan** asersinya ke bentuk yang benar.

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/gallon-damage-charge.test.js`

Expected: FAIL (404 pada `/gallon-damage`).

- [ ] **Step 3: Tipe movement baru (pelanggan → rusak/hilang)**

Ganti `custEffect` (baris 3090) menjadi:

```js
const custEffect = (m) => (m.type === 'delivery_out' ? m.qty : m.type === 'return_in' ? -m.qty : ((m.type === 'correction' || m.type === 'penyesuaian') && m.customerId) ? m.qty : (CUSTOMER_DAMAGE.has(m.type) && m.customerId) ? -Math.abs(m.qty) : 0);
```

Tepat di atasnya, tambahkan:

```js
// GANTI RUGI GALON — gallons a customer broke/lost move PELANGGAN → RUSAK/HILANG in one row: they leave
// the customer's balance and the good stock, and enter the rusak/hilang bucket, so
// depot + armada + pelanggan + rusak/hilang === total dimiliki still holds.
const CUSTOMER_DAMAGE = new Set(['damage_customer', 'loss_customer']);
```

Di `totalEffect`, ganti `if (m.type === 'damage' || m.type === 'loss') return -Math.abs(m.qty);` menjadi:

```js
  if (m.type === 'damage' || m.type === 'loss' || CUSTOMER_DAMAGE.has(m.type)) return -Math.abs(m.qty);
```

Ganti `const DAMAGE_TYPES = new Set(['damage', 'loss']);` menjadi `const DAMAGE_TYPES = new Set(['damage', 'loss', 'damage_customer', 'loss_customer']);`.

Periksa `depotEffect` dan `armadaEffect`: cabang damage di keduanya mensyaratkan `!m.customerId`, jadi tipe baru bernilai 0 di sana. Tidak ada yang perlu diubah.

Label buku besar di klien: jalankan `grep -n "'damage'" ../distribution.jsx ../gudang.jsx`. Di peta label tipe movement yang ditemukan, tambahkan entri `damage_customer: 'Rusak di pelanggan (ganti rugi)'` dan `loss_customer: 'Hilang di pelanggan (ganti rugi)'` dengan gaya yang sama. Kalau tidak ada peta label, lewati langkah ini.

- [ ] **Step 4: Fungsi `gallonDamageCharge`**

Setelah `reportGallonDamage` (akhir fungsinya, baris 3592), tambahkan:

```js
// GANTI RUGI GALON (no approval — owner decision). One DB transaction:
//   1. a damage_customer / loss_customer movement (customer → rusak/hilang), linked to the txn so a VOID
//      deactivates it like any sale movement;
//   2. a money-only DistTransaction kind 'ganti_rugi' (qty 0 → never a gallon sale; gallonQty = count):
//      tunai/transfer → method 'lunas' (+payMethod), bon → method 'bon' (feeds Sisa Bon);
//   3. journal via distTxnLines (Kas/Bank or Piutang / Pendapatan Lain) + AR reclass for a bon.
const DAMAGE_KINDS = ['pecah', 'bocor', 'retak', 'hilang'];
async function gallonDamageCharge(customerId, body, actor) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw ApiError.notFound('Pelanggan tidak ditemukan.');
  if (!fleetAllows(actor, customer.armada)) throw ApiError.forbidden('Pelanggan di luar akses armada Anda.');
  const qty = int(body.qty);
  if (qty <= 0) throw ApiError.badRequest('Jumlah galon harus lebih dari 0.');
  const kind = DAMAGE_KINDS.includes(body.kind) ? body.kind : 'pecah';
  const pay = ['tunai', 'bon', 'transfer'].includes(body.payMethod) ? body.payMethod : 'tunai';
  if (!body.photoId) throw ApiError.badRequest('Foto galon rusak wajib dilampirkan.', { code: 'PROOF_REQUIRED' });
  const att = await prisma.attachment.findUnique({ where: { id: String(body.photoId) }, select: { id: true } });
  if (!att) throw ApiError.badRequest('Foto tidak ditemukan — unggah ulang fotonya.', { code: 'PROOF_MISSING' });
  const held = await gallonBalanceOf(customer.id);
  if (qty > held) throw ApiError.badRequest(`Pelanggan hanya memegang ${held} galon — tidak bisa mengganti rugi ${qty}.`, { held });
  const price = (await require('./fieldRules.service').getRules()).hargaGantiRugiGalon;
  if (!price) throw ApiError.badRequest('Harga ganti rugi galon belum diatur pemilik.', { code: 'NO_PRICE' });
  const amount = qty * price;
  if (overCeiling(amount)) throw ApiError.badRequest(ceilingMsg, { amount });
  const txnDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.txnDate || '')) ? body.txnDate : todayISO();
  const fleetId = customer.armada || '';
  const snap = await actorSnap(actor);
  const note = `Ganti rugi ${qty} galon ${kind}${body.note ? ' · ' + String(body.note).trim().slice(0, 200) : ''}`;
  const txn = await prisma.$transaction(async (tx) => {
    const t = await tx.distTransaction.create({ data: {
      customerId: customer.id, fleetId, qty: 0, unitPriceLocked: price, amount, method: pay === 'bon' ? 'bon' : 'lunas',
      payMethod: pay === 'bon' ? '' : pay, kind: 'ganti_rugi', gallonQty: qty, note, txnDate,
      proofPhotoId: att.id, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName,
    } });
    await tx.gallonMovement.create({ data: {
      type: kind === 'hilang' ? 'loss_customer' : 'damage_customer', qty, customerId: customer.id, transactionId: t.id, fleetId,
      active: true, note, proof: JSON.stringify({ attachmentId: att.id }), actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName,
    } });
    if (config.accountingV2) { await acc.postDistTransaction(t, actor, tx); if (pay === 'bon') await acc.postReceivablesReclass(customer.id, actor, tx); }
    return t;
  });
  await logAudit('input', `Ganti rugi galon: ${customer.name}`, `${qty} galon ${kind} × ${price} = ${amount} (${pay})`, snap, fleetId);
  return { transaction: txn, gallonsHeld: await gallonBalanceOf(customer.id), sisaBon: await customerBonBalance(customer.id) };
}
```

Cek nama helper sebelum menulis kode ini. `todayISO` harus sudah diimpor di file (kalau belum: `const { todayISO } = require('../lib/time');`). `overCeiling`, `ceilingMsg`, `int`, `acc`, dan `config` sudah dipakai `createTransaction`.

Tambahkan `gallonDamageCharge` ke `module.exports`, pada baris yang memuat `reportGallonDamage`.

- [ ] **Step 5: Ganti rugi hanya bisa dibatalkan, tidak dikoreksi**

Di `requestChange`, setelah `if (txn.status === 'void') throw …;`, tambahkan:

```js
  if (kind === 'correction' && txn.kind === 'ganti_rugi') throw ApiError.badRequest('Ganti rugi galon tidak bisa dikoreksi — ajukan pembatalan lalu catat ulang.');
```

Di `computeReassign`, setelah `const txns = await prisma.distTransaction.findMany(…);`, tambahkan:

```js
  if (txns.some((t) => t.kind === 'ganti_rugi')) throw ApiError.badRequest('Ganti rugi galon tidak bisa dipindahkan ke pelanggan lain — ajukan pembatalan lalu catat ulang.');
```

Lakukan hal yang sama di `previewCorrection`. Di sana, setelah pengecekan void, tambahkan baris yang sama dengan pesan untuk koreksi.

- [ ] **Step 6: Dashboard: bukan penjualan, tapi tetap uang masuk**

Di `dashboardSummary`, di dalam `rows.forEach((r) => {`, ganti tiga baris pertama:

```js
    periodQty += r.qty;
    const e = effOf(r); amount += e;
    if (byMethod[r.method] != null && !noMoneyIn(r)) byMethod[r.method] += (r.method === 'pelunasan' ? r.amount : e);
```

menjadi:

```js
    periodQty += r.qty;
    const e = effOf(r);
    // Ganti rugi galon is compensation, not a sale: it stays out of the sales figures (amount/byMethod)
    // but its cash/transfer is real money-in below (and a bon one is in the receivable).
    const isCharge = r.kind === 'ganti_rugi';
    if (!isCharge) amount += e;
    if (!isCharge && byMethod[r.method] != null && !noMoneyIn(r)) byMethod[r.method] += (r.method === 'pelunasan' ? r.amount : e);
```

- [ ] **Step 7: Controller + rute**

Controller, di dekat `locationPhotoSchema`:

```js
const gallonDamageSchema = z.object({ qty: z.number().int().positive(), kind: z.enum(['pecah', 'bocor', 'retak', 'hilang']), payMethod: z.enum(['tunai', 'bon', 'transfer']), photoId: z.string().max(60).optional(), note: z.string().max(200).optional(), txnDate: DATE.optional() });
```

Handler (di dekat `setLocationPhoto`):

```js
const gallonDamageCharge = asyncHandler(async (req, res) => { const r = await service.gallonDamageCharge(req.params.id, req.body, req.user); bcast('update', req.params.id); res.status(201).json({ data: r }); });
```

Tambahkan `gallonDamageCharge` ke `module.exports`, dan `gallonDamageSchema` ke `schemas`.

Rute, setelah baris `router.patch('/customers/:id/location-photo', …)`:

```js
// GANTI RUGI GALON — a field action, recorded directly (no approval: owner decision).
router.post('/customers/:id/gallon-damage', requireCap('distribusiInput'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.gallonDamageSchema }), ctrl.gallonDamageCharge);
```

- [ ] **Step 8: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/gallon-damage-charge.test.js`

Lalu jalankan tes invariant galon yang sudah ada (`ls tests | grep -i -E "galon|gallon"`).

Expected: PASS semua.

- [ ] **Step 9: Commit**

```bash
git add server/src/services/distribution.service.js server/src/controllers/distribution.controller.js server/src/routes/distribution.routes.js server/tests/gallon-damage-charge.test.js ../distribution.jsx ../gudang.jsx
git commit -m "feat(distribusi): ganti rugi galon (customer → rusak/hilang + money-only charge, no approval)"
```

Jalankan perintah ini dari root repo. Sertakan `distribution.jsx`/`gudang.jsx` hanya kalau labelnya memang diubah di Step 3.

---

### Task 10: Koreksi saya + tarik pengajuan

**Files:**
- Modify: `server/src/services/distribution.service.js` (setelah `listChangeRequests`, baris 1950)
- Modify: `server/src/controllers/distribution.controller.js`
- Modify: `server/src/routes/distribution.routes.js` (sebelum `router.get('/change-requests', …)`, baris 133)
- Test: `server/tests/my-change-requests.test.js` (baru)

**Interfaces:**
- Produces:
  - `GET /change-requests/mine` (izin `distribusiKoreksi`) → `{ data: ChangeRequestClient[] }`, berisi pengajuan milik pemanggil saja, terbaru dulu, maksimal 100;
  - `POST /change-requests/:id/withdraw` (izin `distribusiKoreksi`) → `{ data }`. Hanya pemohon, hanya saat `pending`; status berubah menjadi `withdrawn`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/my-change-requests.test.js`:

```js
'use strict';
// KOREKSI SAYA — a driver sees the corrections THEY submitted (with the office's decision) and can
// withdraw one that is still pending. They can never see or touch someone else's.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const D = '/api/v1/distribusi';
const today = todayISO();
const REQ = { distribusi: true, distribusiInput: true, distribusiKoreksi: true };
let gm, a, b, cid;
const mkDriver = async (u) => { const r = await reg({ name: u, username: u, password: 'secret123', role: 'finance' }); await prisma.user.update({ where: { id: r.user.id }, data: { permissions: JSON.stringify(REQ) } }); return login(u, 'secret123'); };
const txn = async (tok) => (await request(app).post(`${D}/transactions`).set(auth(tok)).send({ customerId: cid, qty: 2, method: 'bon', txnDate: today })).body.data.id;
const ask = (tok, id) => request(app).post(`${D}/transactions/${id}/corrections`).set(auth(tok)).send({ reason: 'salah ketik', payload: { qty: 1 } });

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'mc_gm', password: 'secret123', role: 'gm' })).token;
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko MC', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 100, reason: 'stok awal' });
  a = await mkDriver('mc_a'); b = await mkDriver('mc_b');
});
afterAll(() => prisma.$disconnect());

let aReq, bReq;
it('each driver sees only their own requests, with status', async () => {
  aReq = (await ask(a, await txn(a))).body.data.id;
  bReq = (await ask(b, await txn(b))).body.data.id;
  const mine = (await request(app).get(`${D}/change-requests/mine`).set(auth(a))).body.data;
  expect(mine.map((r) => r.id)).toEqual([aReq]);
  expect(mine[0].status).toBe('pending');
});
it('a driver cannot withdraw someone else\'s request', async () => {
  const r = await request(app).post(`${D}/change-requests/${bReq}/withdraw`).set(auth(a));
  expect(r.status).toBe(404);
  expect((await prisma.distChangeRequest.findUnique({ where: { id: bReq } })).status).toBe('pending');
});
it('withdraw a pending request; it shows as withdrawn and frees the txn for a new request', async () => {
  const r = await request(app).post(`${D}/change-requests/${aReq}/withdraw`).set(auth(a));
  expect(r.status).toBe(200);
  expect(r.body.data.status).toBe('withdrawn');
  const mine = (await request(app).get(`${D}/change-requests/mine`).set(auth(a))).body.data;
  expect(mine[0].status).toBe('withdrawn');
  const row = await prisma.distChangeRequest.findUnique({ where: { id: aReq } });
  expect((await ask(a, row.transactionId)).status).toBe(201);
});
it('a decided request cannot be withdrawn', async () => {
  await request(app).post(`${D}/change-requests/${bReq}/reject`).set(auth(gm)).send({ note: 'foto menunjukkan benar' });
  const r = await request(app).post(`${D}/change-requests/${bReq}/withdraw`).set(auth(b));
  expect(r.status).toBe(400);
  const mine = (await request(app).get(`${D}/change-requests/mine`).set(auth(b))).body.data;
  expect(mine[0].status).toBe('rejected');
  expect(mine[0].decisionNote || (mine[0].decision && mine[0].decision.note)).toMatch(/foto/);
});
```

Sebelum menjalankan tes, baca `changeRequestClient` (baris 1760) untuk memastikan nama field catatan keputusan, lalu sederhanakan asersi terakhir ke nama itu.

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/my-change-requests.test.js`

Expected: FAIL (`/change-requests/mine` tertangkap sebagai `:id` atau 404).

- [ ] **Step 3: Service**

Setelah `listChangeRequests`, tambahkan:

```js
// KOREKSI SAYA — the caller's OWN requests (any status), newest first. No fleet filter needed: they are
// the requester's own rows, and requesting already required fleet access to the txn.
async function listMyChangeRequests(user) {
  if (!user || !user.id) return { data: [] };
  const rows = await prisma.distChangeRequest.findMany({ where: { requestedById: user.id }, orderBy: [{ createdAt: 'desc' }], take: 100 });
  const data = [];
  for (const r of rows) data.push(await changeRequestClient(r));
  return { data };
}
// Withdraw a request the caller submitted, while it is still pending. 'withdrawn' is a terminal status
// the approver inbox (status filter pending/approved/rejected) never lists as actionable.
async function withdrawChangeRequest(id, actor) {
  const req = await prisma.distChangeRequest.findUnique({ where: { id } });
  if (!req || !actor || req.requestedById !== actor.id) throw ApiError.notFound('Pengajuan tidak ditemukan.');
  if (req.status !== 'pending') throw ApiError.badRequest('Pengajuan ini sudah diputuskan — tidak bisa ditarik.');
  const snap = await actorSnap(actor);
  const updated = await prisma.distChangeRequest.update({ where: { id }, data: { status: 'withdrawn', decidedById: snap.actorId, decidedByName: snap.actorName, decidedByRole: snap.actorRole, decisionNote: 'ditarik oleh pemohon', decidedAt: new Date() } });
  await logAudit('koreksi', 'Tarik pengajuan', `${req.kind} · ${shortRefServer(req.transactionId)}`, snap, req.fleetId);
  return changeRequestClient(updated);
}
```

Tambahkan `listMyChangeRequests, withdrawChangeRequest` ke `module.exports`.

- [ ] **Step 4: Controller + rute**

Controller:

```js
const listMyChangeRequests = asyncHandler(async (req, res) => res.json(await service.listMyChangeRequests(req.user)));
const withdrawChangeRequest = asyncHandler(async (req, res) => { const r = await service.withdrawChangeRequest(req.params.id, req.user); bcast('change-request', req.params.id); res.json({ data: r }); });
```

Tambahkan keduanya ke `module.exports`.

Rute, **sebelum** `router.get('/change-requests', …)` (baris 133):

```js
// KOREKSI SAYA — before '/change-requests/:id' routes so 'mine' is never read as an id.
router.get('/change-requests/mine', requireCap('distribusiKoreksi'), ctrl.listMyChangeRequests);
router.post('/change-requests/:id/withdraw', requireCap('distribusiKoreksi'), validate({ params: ctrl.schemas.idParams }), ctrl.withdrawChangeRequest);
```

Periksa juga apakah ada kode yang menganggap status hanya `pending|approved|rejected` sehingga `withdrawn` bisa membuatnya error. Jalankan `grep -n "'rejected'" src/services/distribution.service.js`. Di `changeRequestClient`, pastikan status apa pun diteruskan apa adanya.

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/my-change-requests.test.js tests/self-approval.test.js tests/reassign.test.js`

Expected: PASS semua.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/distribution.service.js server/src/controllers/distribution.controller.js server/src/routes/distribution.routes.js server/tests/my-change-requests.test.js
git commit -m "feat(distribusi): koreksi saya (own requests) + withdraw a pending request"
```

---

### Task 11: Ringkasan setoran harian

**Files:**
- Modify: `server/src/services/distribution.service.js` (fungsi baru setelah `deliveryReport`, baris 5037, + export)
- Modify: `server/src/controllers/distribution.controller.js` (schema query + handler + export)
- Modify: `server/src/routes/distribution.routes.js` (setelah `router.get('/deliveries/rit-route', …)`, baris 204)
- Test: `server/tests/day-summary.test.js` (baru)

**Interfaces:**
- Produces: `GET /deliveries/day-summary?date&fleet` (izin `distribusiPengiriman`) →
  ```
  { data: {
      date, fleetId,
      tunaiPenjualan, tunaiPelunasan, tunaiGantiRugi, transfer, bonBaru, pengeluaran, wajibSetor,
      galon: { keluar, kembali, rusak },
      stops: { terkirim, ditunda, batal, pending },
      koreksiMenunggu,
      ritDiBawahSop: [{ runNo, gallonsOut, reason }]
  } }
  ```
  Semua uang dalam rupiah. `wajibSetor = tunaiPenjualan + tunaiPelunasan + tunaiGantiRugi − pengeluaran` (pengeluaran tunai).

- [ ] **Step 1: Tulis tes yang gagal**

Buat `server/tests/day-summary.test.js`:

```js
'use strict';
// SETORAN HARIAN — one armada, one day: what the driver must hand over. Cash from sales + bon payments +
// ganti rugi, transfers apart (never deposited), minus cash field expenses; plus gallons, stop counts,
// pending corrections and rits below the SOP. Same data the delivery report uses — no second figure.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
const ALL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
let gm, c1, c2, photoId;
const post = (body) => request(app).post(`${D}/transactions`).set(auth(gm)).send({ txnDate: today, ...body });
const summary = async () => (await request(app).get(`${D}/deliveries/day-summary?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'ds_gm', password: 'secret123', role: 'gm' })).body.token;
  c1 = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'A', type: 'reguler', masterPrice: 10000, armada: 'DK 1', deliveryDays: ALL })).body.data.id;
  c2 = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'B', type: 'reguler', masterPrice: 10000, armada: 'DK 1', deliveryDays: ALL })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 500, reason: 'stok awal' });
  await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ hargaGantiRugiGalon: 40000, ritSop: { enabled: true } });
  photoId = (await request(app).post('/api/v1/attachments').set(auth(gm)).send({ name: 'x.jpg', type: 'image/jpeg', data: 'data:image/jpeg;base64,/9j/4AAQ' })).body.data.id;
  await request(app).post(`${D}/runs/open`).set(auth(gm)).send({ date: today, fleet: 'DK 1', gallonsOut: 60, underSopReason: 'Rit terakhir' });
  await post({ customerId: c1, qty: 3, method: 'lunas', gallonOut: 3, gallonIn: 2 });                 // tunai 30.000
  await post({ customerId: c1, qty: 2, method: 'lunas', payMethod: 'transfer', gallonOut: 2 });        // transfer 20.000
  await post({ customerId: c2, qty: 5, method: 'bon', gallonOut: 5 });                                 // bon 50.000
  await post({ customerId: c2, method: 'pelunasan', payAmount: 15000, payMethod: 'cash' });            // tunai 15.000
  await request(app).post(`${D}/customers/${c1}/gallon-damage`).set(auth(gm)).send({ qty: 1, kind: 'pecah', payMethod: 'tunai', photoId, txnDate: today });   // tunai 40.000
  await request(app).post(`${D}/expenses`).set(auth(gm)).send({ date: today, fleet: 'DK 1', amount: 25000, category: 'bensin' });
  const board = (await request(app).get(`${D}/deliveries?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
  const stops = board.stops || board;
  await request(app).patch(`${D}/deliveries/${stops[0].id}`).set(auth(gm)).send({ status: 'ditunda', reason: 'Toko tutup' });
});
afterAll(() => prisma.$disconnect());

it('adds up what the driver must deposit', async () => {
  const s = await summary();
  expect(s.tunaiPenjualan).toBe(30000);
  expect(s.tunaiPelunasan).toBe(15000);
  expect(s.tunaiGantiRugi).toBe(40000);
  expect(s.transfer).toBe(20000);
  expect(s.bonBaru).toBe(50000);
  expect(s.pengeluaran).toBe(25000);
  expect(s.wajibSetor).toBe(30000 + 15000 + 40000 - 25000);
});
it('gallons, stops, corrections and under-SOP rits', async () => {
  const s = await summary();
  expect(s.galon).toEqual({ keluar: 10, kembali: 2, rusak: 1 });
  expect(s.stops.ditunda).toBe(1);
  expect(s.koreksiMenunggu).toBe(0);
  expect(s.ritDiBawahSop).toEqual([{ runNo: 1, gallonsOut: 60, reason: 'Rit terakhir' }]);
});
it('matches the delivery report cash (tunai − expense)', async () => {
  const rep = (await request(app).get(`${D}/reports/delivery?date=${today}&fleet=DK%201`).set(auth(gm))).body;
  const f = (rep.data || rep).fleets.find((x) => x.fleetId === 'DK 1');
  expect(f.cash.net).toBe((await summary()).wajibSetor);
  expect(f.cash.transfer).toBe(20000);
});
```

Periksa `deliveryReportQuery` untuk nama parameter tanggalnya (`date` atau `from`/`to`), lalu sesuaikan URL di tes terakhir.

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/day-summary.test.js`

Expected: FAIL (404 pada `/deliveries/day-summary`).

- [ ] **Step 3: Service**

Setelah `deliveryReport` (sebelum `module.exports`), tambahkan:

```js
// SETORAN HARIAN — for ONE armada and ONE day: what the driver must hand over and what happened. Uses
// the same predicates as deliveryReport (LIVE_TXN, noMoneyIn, isTransferPayment, active expenses) so the
// two can never disagree: wajibSetor === deliveryReport fleet.cash.net for the same day + armada.
async function daySummary(user, query) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String((query || {}).date || '')) ? query.date : todayISO();
  const fleetId = resolveWriteFleet(user, (query || {}).fleet);
  if (!fleetId) throw ApiError.badRequest('Pilih armada.');
  const where = { fleetId };
  const txns = await prisma.distTransaction.findMany({ where: { ...where, txnDate: date, ...LIVE_TXN }, include: { corrections: { select: { kind: true, deltaAmount: true, active: true } } } });
  const out = { date, fleetId, tunaiPenjualan: 0, tunaiPelunasan: 0, tunaiGantiRugi: 0, transfer: 0, bonBaru: 0, pengeluaran: 0, wajibSetor: 0,
    galon: { keluar: 0, kembali: 0, rusak: 0 }, stops: { terkirim: 0, ditunda: 0, batal: 0, pending: 0 }, koreksiMenunggu: 0, ritDiBawahSop: [] };
  txns.forEach((t) => {
    const eff = Number(t.amount) + priceDelta(t.corrections);
    if (t.method === 'bon') { out.bonBaru += eff; return; }
    if (noMoneyIn(t)) return;
    const inc = t.method === 'lunas' ? eff : t.method === 'pelunasan' ? Number(t.amount) : 0;
    if (!inc) return;
    if (isTransferPayment(t)) { out.transfer += inc; return; }
    if (t.kind === 'ganti_rugi') out.tunaiGantiRugi += inc;
    else if (t.method === 'pelunasan') out.tunaiPelunasan += inc;
    else out.tunaiPenjualan += inc;
  });
  const exp = await prisma.distExpense.findMany({ where: { ...where, date, status: 'active' }, select: { amount: true } });
  out.pengeluaran = exp.reduce((s, e) => s + Number(e.amount), 0);
  out.wajibSetor = out.tunaiPenjualan + out.tunaiPelunasan + out.tunaiGantiRugi - out.pengeluaran;
  const txnIds = txns.map((t) => t.id);
  const movs = txnIds.length ? await prisma.gallonMovement.findMany({ where: { transactionId: { in: txnIds }, active: true }, select: { type: true, qty: true } }) : [];
  movs.forEach((m) => {
    if (m.type === 'delivery_out') out.galon.keluar += m.qty;
    else if (m.type === 'return_in') out.galon.kembali += m.qty;
    else if (m.type === 'damage_customer' || m.type === 'loss_customer') out.galon.rusak += Math.abs(m.qty);
  });
  const stops = await prisma.delivery.findMany({ where: { ...where, date }, select: { status: true } });
  stops.forEach((s) => { if (out.stops[s.status] != null) out.stops[s.status] += 1; });
  out.koreksiMenunggu = await prisma.distChangeRequest.count({ where: { fleetId, status: 'pending', createdAt: { gte: new Date(date + 'T00:00:00') } } });
  const runs = await prisma.deliveryRun.findMany({ where: { ...where, date, NOT: { underSopReason: '' } }, orderBy: { runNo: 'asc' }, select: { runNo: true, gallonsOut: true, underSopReason: true } });
  out.ritDiBawahSop = runs.map((r) => ({ runNo: r.runNo, gallonsOut: r.gallonsOut, reason: r.underSopReason }));
  return out;
}
```

Catatan untuk implementer:
- `resolveWriteFleet(user, fleet)` dipakai `openRun` dan menghormati `fleetScope`. Kalau untuk baca ada helper yang lebih tepat (misalnya `fleetAllows` + parameter), pakai `fleetAllows(user, fleetId)` dan lempar 403 kalau tidak diizinkan.
- `priceDelta` dan `noMoneyIn` sudah dipakai `dashboardSummary`.

Tambahkan `daySummary` ke `module.exports` (baris `… cashIntegration, deliveryReport,`).

- [ ] **Step 4: Controller + rute**

Controller:

```js
const daySummaryQuery = z.object({ date: DATE.optional(), fleet: z.string().max(60).optional() });
const daySummary = asyncHandler(async (req, res) => res.json({ data: await service.daySummary(req.user, req.query) }));
```

Tambahkan `daySummary` ke export dan `daySummaryQuery` ke `schemas`.

Rute, setelah `router.get('/deliveries/rit-route', …)`:

```js
router.get('/deliveries/day-summary', requireCap('distribusiPengiriman'), validate({ query: ctrl.schemas.daySummaryQuery }), ctrl.daySummary);
```

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand tests/day-summary.test.js`

Expected: PASS (3).

Kalau tes "matches the delivery report" gagal karena `deliveryReport` menghitung ganti rugi atau transfer lunas secara berbeda, perbaiki **`deliveryReport`** supaya memakai `isTransferPayment(t)` (sudah) dan menghitung ganti rugi tunai sebagai uang masuk (sudah, karena `method==='lunas'`). Jangan mengubah `daySummary` agar cocok dengan angka yang salah.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/distribution.service.js server/src/controllers/distribution.controller.js server/src/routes/distribution.routes.js server/tests/day-summary.test.js
git commit -m "feat(distribusi): daily deposit summary per armada (setoran harian)"
```

---

### Task 12: Suite penuh, invariant, dan spec disamakan

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md` (keputusan implementasi)

- [ ] **Step 1: Jalankan seluruh suite server (background)**

Run (dari `server/`): `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db jest --runInBand > ../.superpowers/full-suite.log 2>&1`

Expected: semua lulus. Suite terakhir berisi 1157 tes, ditambah ±40 tes baru dari rencana ini. Baca ekor log.

Tes invariant akuntansi (`integrityCheck`, AR = Σ Sisa Bon, jurnal ganda) dan invariant galon empat lokasi harus hijau.

Kalau ada tes yang gagal karena lingkungan (timeout di bawah beban), jalankan ulang file itu sendiri sebelum menyimpulkan apa pun.

- [ ] **Step 2: Samakan spec dengan keputusan implementasi**

Di spec, perbarui bagian berikut:
- **3.1:** semua aturan disimpan dalam **satu** settings key `fieldRules` (bentuk `Rules` di Task 2). Endpoint `GET/PUT /distribusi/field-rules` memakai izin baru `distribusiAturanLapangan` (owner/GM).
- **3.6:** ganti rugi memakai akun yang sudah ada, **4-2000 Pendapatan Lain**. Baris transaksinya `qty = 0` dan `gallonQty = jumlah galon` (supaya tidak pernah terhitung sebagai penjualan galon atau HPP). Movement-nya bertipe baru `damage_customer`/`loss_customer` (pelanggan → rusak/hilang). Koreksi dan pindah pelanggan ditolak; satu-satunya jalan adalah batal lalu catat ulang.
- **3.3:** `payMethod` bernilai `tunai|transfer|''`. Transfer penjualan = `lunas` + `payMethod='transfer'`. Skrip reklasifikasi bekerja dengan mengisi `payMethod` lalu `reconcileDistTxn`.
- **3.8:** bentuk respons `day-summary` seperti di Task 11.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md docs/superpowers/plans/2026-10-01-mode-lapangan-1-server.md
git commit -m "docs: mode lapangan spec aligned with server implementation"
```

---

## Setelah rencana ini

Rencana 2 (dasar klien) ditulis setelah Task 12 hijau, dengan acuan endpoint nyata di atas:
- `/field-rules`, `/runs/open` (+`underSopReason`);
- `/transactions` (+`payMethod`, `proof*`);
- `/deliveries/:id` (+`ditunda`, `reason`);
- `/customers/:id/location` (+`method`, `device*`);
- `/customers/:id/gallon-damage`;
- `/change-requests/mine` dan `/:id/withdraw`;
- `/deliveries/day-summary`;
- header `X-Airro-Ui: field`.
