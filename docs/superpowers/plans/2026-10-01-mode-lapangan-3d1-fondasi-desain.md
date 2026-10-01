# Mode Lapangan 3D-1 — Fondasi desain (layar penuh, kaca, animasi, ikon, gesture) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat tampilan lapangan terasa seperti mockup yang disetujui, mulai dari fondasinya:
- **Layar penuh langsung saat login** untuk akun demo, tanpa bar aplikasi lama dan tanpa banner.
- **Header persis mockup.** Penanda latihan menjadi chip kecil.
- **Material liquid glass** dengan nilai persis dari mockup.
- **Semua animasi dock dan menu:** indikator tab cair, kilau, dan efek tekan memantul.
- **45 ikon mockup.**
- **Gesture:** tarik sheet untuk menutup, usap antar tab, dan geser peta untuk Atur titik.

Tata ulang tiap layar dikerjakan di Rencana 3D-2.

**Architecture:**
- `finance-shell.jsx` tidak lagi membungkus tampilan lapangan. Untuk akun yang punya akses lapangan dan memilih tampilan baru (yang kini menjadi bawaan), shell langsung mengembalikan `FIELD.App` layar penuh.
- Nilai desain (warna, blur, bayangan, easing, durasi) disalin dari papan mockup ke `dist-field.css`.
- Ikon diambil dari mockup ke `dist-field-icons.jsx` sebagai data elemen React.
- Gesture memakai pointer events. Keputusan gesture (tutup/tidak, pindah tab) adalah fungsi murni di `FIELDLOGIC` yang diuji di Node.

**Tech Stack:**
- React 18 UMD, dibundel `build.mjs` (satu cakupan global).
- Leaflet (sudah ada).
- Jest + `@babel/parser` untuk uji statis, dan Node untuk logika murni.

**Spec:** `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md` (§4 Layar, §5 Rilis). Mockup yang disetujui: https://claude.ai/artifact/VELPmw1GNUAFNQ5KXpxj8V. Salinan sumbernya ada di scratchpad sesi: `glass-canvas/project/*.dc.html`.

## Keputusan pemilik (2026-10-01, sesi ini)

1. **Akun demo langsung masuk tampilan lapangan layar penuh saat login.**
   - Menu ⋯ tetap punya "Kembali ke tampilan lama".
   - Pilihan "lama" hanya berlaku untuk sesi aplikasi itu, tidak diingat setelah login ulang.
2. **Gesture:**
   - semua yang ada di mockup: tarik sheet ke bawah untuk menutup, geser pin/peta di Atur titik, dan detent sheet peta (di 3D-2);
   - **ditambah** usap kiri/kanan antar tab.
3. **Penanda "MODE LATIHAN"** menjadi **chip kecil di header** (selalu terlihat saat latihan), tidak lagi berupa pita oranye penuh.

## Global Constraints

- Nilai visual diambil **persis** dari papan mockup:
  - **Latar:** `#EEF2F6`.
  - **Tombol bulat dan pil kaca:** `rgba(255,255,255,.62)`, `blur(24px) saturate(1.6)`, border `1px solid rgba(255,255,255,.85)`, `inset 0 1px 0 rgba(255,255,255,.9)`.
  - **Dock dan menu:** `.66` / `blur(28px) saturate(1.6)` / `inset … .95`.
  - **Sheet:** `rgba(248,250,252,.88)` / `blur(34px) saturate(1.5)`.
  - **Easing pegas:**
    - tekan `transform .35s cubic-bezier(.34,1.56,.64,1)` dengan `:active scale(.9)`;
    - menu `lgPop .55s cubic-bezier(.34,1.45,.64,1)`;
    - indikator tab `left .55s cubic-bezier(.3,1.5,.6,1)`, `width .3s`, `transform .3s`, membentang 1,4× dan memipih `scaleY(.82)` selama 300 ms;
    - kilau `lgSheen 4.5s ease-in-out infinite`.
- Fungsi dan data tidak berubah. Rencana ini murni tampilan, navigasi layar, dan gesture.
- Selalu menghormati `prefers-reduced-motion` dan `prefers-reduced-transparency`, seperti mockup.
- Bundel satu cakupan: nama tingkat atas unik (`Fld*` / `fld*` / `FLD*`), kelas CSS `mlap-`, teks lewat `finance-i18n.js` (EN + ID, `fld.*`).
- `distribution.jsx` tidak diubah.
- Tes server tidak memerlukan `node_modules` root.
- Jangan menjalankan dua jest bersamaan.
- Perintah tes dijalankan dari `server/`: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand <files>`.

## Review Focus

1. **Akun tanpa akses lapangan, atau tanpa izin Pengiriman,** tetap melihat aplikasi lama persis seperti sebelumnya. Layar penuh hanya untuk yang berhak.
   - Dites di Task 1 (`prefState`) dan Task 2 (statis shell).
2. **"Kembali ke tampilan lama" benar-benar keluar** dan membuka papan Pengiriman lama. Membuka Aturan dari menu ⋯ tidak menjebak pengguna di layar penuh.
   - Dites di Task 2.
3. **Usap antar tab tidak terpicu** saat menggeser peta, slider, input, daftar yang digulir ke samping, atau di dalam sheet. Gulir vertikal biasa tidak pernah berpindah tab.
   - Dites di Task 8 (`swipeTab` + zona yang dikecualikan).
4. **Sheet yang ditarik sedikit lalu dilepas memantul kembali**, tidak tertutup. Tarikan cepat (flick) menutupnya.
   - Dites di Task 7 (`dragRelease`).
5. **Atur titik:** menggeser peta memindahkan pin. Zoom awal dan pemusatan awal tidak dihitung sebagai "sudah digeser", jadi tombol simpan untuk titik bawaan gudang tetap mati sampai pengguna benar-benar menggeser.
   - Dites di Task 9.

---

## Task 1: Spesifikasi + tampilan baru menjadi bawaan untuk akun berhak (pilihan "lama" tidak diingat)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md` (new note "Rencana 3D — kesetiaan desain")
- Modify: `dist-field-api.js` (`prefState`, `loadPrefs`, `savePrefs`)
- Test: `server/tests/field-api.test.js` (append)

**Interfaces:**
- Produces:
  - `prefState({perms, rules, prefs}).ui === 'new'` whenever `eligible` and `prefs.ui` is not `'old'`.
  - `loadPrefs()` returns `mode` only.
  - `savePrefs()` stores `mode` only. The `ui` choice lives in the shell's React state for the session.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/field-api.test.js`:

```js
describe('Plan 3D: the field view is the default for an account that may use it', () => {
  const base = { distribusiPengiriman: true };
  it('a demo account lands in the new view; an account without field access stays on the old one', () => {
    expect(FA.prefState({ perms: { ...base, distribusiDemoLatihan: true }, rules: {}, prefs: {} }).ui).toBe('new');
    expect(FA.prefState({ perms: { ...base, distribusiDemoPenuh: true }, rules: {}, prefs: {} }).ui).toBe('new');
    expect(FA.prefState({ perms: base, rules: {}, prefs: {} }).ui).toBe('old');
    expect(FA.prefState({ perms: { distribusiDemoPenuh: true }, rules: {}, prefs: {} }).ui).toBe('old');   // no Pengiriman
    expect(FA.prefState({ perms: { ...base, distribusiDemoLatihan: true }, rules: {}, prefs: { ui: 'old' } }).ui).toBe('old');
  });
  it('the old-view choice is not remembered across logins (only the practice/real mode is)', () => {
    const store = {}; const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    const prev = global.localStorage; global.localStorage = ls;
    try {
      FA.savePrefs({ ui: 'old', mode: 'asli' });
      expect(store['airro.dist.fieldUi']).toBeUndefined();
      store['airro.dist.fieldUi'] = 'old';   // left over from an earlier version
      expect(FA.loadPrefs()).toEqual({ mode: 'asli' });
    } finally { global.localStorage = prev; }
  });
});
```

(`dist-field-api.js` reads `root.localStorage`. In Node, `root` is `globalThis`, so `global.localStorage` is what it sees. If the file binds `root` differently, set the stub on that object.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-api.test.js`

Expected: FAIL. `ui` is `'old'` for the demo account, and `fieldUi` is stored.

- [ ] **Step 3: Implement**

In `dist-field-api.js` `prefState` change

```js
    var ui = !eligible ? 'old' : (prefs.ui === 'new' || prefs.ui === 'old' ? prefs.ui : (released ? 'new' : 'old'));
```

to

```js
    // An account that may use the field view lands in it (owner, 3D); "old" is a choice for this session.
    var ui = !eligible ? 'old' : (prefs.ui === 'old' ? 'old' : 'new');
```

Replace `loadPrefs` and `savePrefs` with:

```js
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
```

Spec: append to §4, after the 3C note:

```markdown
**Rencana 3D — kesetiaan desain (keputusan pemilik 2026-10-01).** Pemilik menilai hasil terhadap mockup
yang disetujui: tampilan, animasi, dan gesture, bukan hanya fungsi.
- Akun yang berhak (izin Pengiriman + Demo latihan/penuh, atau setelah rilis) langsung masuk tampilan
  lapangan **layar penuh** saat login, tanpa bar aplikasi lama dan tanpa banner unit.
  - Menu ⋯ punya "Kembali ke tampilan lama"; pilihan itu berlaku sampai login berikutnya.
  - Layar Aturan tetap dibuka di aplikasi.
- Penanda latihan menjadi chip kecil di header, selalu terlihat saat latihan; pita oranye dihapus.
- Gesture:
  - tarik sheet ke bawah untuk menutup;
  - usap kiri/kanan antar tab (tidak di peta, input, atau sheet);
  - Atur titik dengan menggeser peta di bawah pin tengah;
  - detent sheet peta (3D-2).
- Nilai material dan animasi disalin persis dari papan mockup. Pekerjaan dibagi dua:
  - 3D-1: fondasi;
  - 3D-2: tata ulang setiap layar sesuai papannya.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-api.test.js tests/field-shell-integration.test.js`

Expected: PASS. If an older assertion in `field-api.test.js` pins the remembered `ui`, update it to the new contract, and say so in the ledger.

- [ ] **Step 5: Commit**

```bash
git add dist-field-api.js server/tests/field-api.test.js docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md
git commit -m "feat(distribusi): field view is the default for accounts that may use it; old-view choice lasts one session"
```

---

## Task 2: Layar penuh — shell tidak lagi membungkus tampilan lapangan

**Files:**
- Modify: `finance-shell.jsx`:
  - early return before the app layout;
  - remove the in-shell field block;
  - simplify the old board condition.
- Modify: `dist-field.jsx` (`FldApp`: theme-color while open)
- Modify: `dist-field.css` (`.mlap-root` full screen)
- Test: `server/tests/field-shell-integration.test.js` (update + append), `server/tests/field-shell-static.test.js` (append)

**Interfaces:**
- Consumes: Task 1 `prefState`.
- Produces: `fieldFull` in `finance-shell.jsx`. The field app gets `onExit` (back to old Pengiriman) and `onOpenRules` (opens the rules screen inside the app).

- [ ] **Step 1: Write the failing test**

In `server/tests/field-shell-integration.test.js`, replace the test `the board screen switches on prefState` with:

```js
it('an account that may use the field view gets it FULL SCREEN (no app bar, no unit banner); the rules screen stays in the app', () => {
  expect(shell).toMatch(/const fieldPref = window\.FIELDAPI \? window\.FIELDAPI\.prefState\(\{ perms: p, rules: fieldRules, prefs: fieldPrefs \}\)/);
  expect(shell).toMatch(/const fieldFull = !!\(window\.FIELD && p\.distribusiPengiriman && fieldPref\.eligible && fieldPref\.ui === 'new' && screen !== 'dist-field-rules'\);/);
  const early = shell.indexOf('if (fieldFull) return (');
  expect(early).toBeGreaterThan(-1);
  expect(early).toBeLessThan(shell.indexOf('<div className="app">'));
  expect(shell).toMatch(/onExit=\{\(\) => \{ setFieldPref\(\{ ui: 'old' \}\); go\('dist-deliveries'\); \}\}/);
  expect(shell).not.toMatch(/screen === 'dist-deliveries' && p\.distribusiPengiriman && fieldPref\.ui === 'new' && window\.FIELD && \(/);
  expect(shell).toMatch(/\{fieldPref\.eligible && <div className="fld-try"/);
});
```

Append to `server/tests/field-shell-static.test.js`:

```js
describe('Plan 3D shell', () => {
  it('full screen: the root covers the viewport and the phone status bar takes the screen colour', () => {
    const css = read('dist-field.css');
    expect(css).toMatch(/\.mlap-root \{[^}]*position: fixed; inset: 0;[^}]*overflow-y: auto;/);
    expect(jsx).toMatch(/document\.querySelector\('meta\[name="theme-color"\]'\)/);
    expect(jsx).toMatch(/meta\.setAttribute\('content', '#EEF2F6'\)/);
  });
});
```

(`field-shell-static.test.js` already has `read` and `jsx`. If a name differs, use the file's own.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-shell-integration.test.js tests/field-shell-static.test.js`

Expected: FAIL. There is no `fieldFull`, no fixed root, no theme-color.

- [ ] **Step 3: Implement**

`finance-shell.jsx`, right before `  return (\n    <div className="app">`:

```jsx
  // MODE LAPANGAN — an account that may use the phone view lands in it FULL SCREEN: no app bar, no unit
  // banner (owner, 3D). "Kembali ke tampilan lama" (⋯ menu) returns to the old Pengiriman; the rules
  // screen opens inside the app and any other screen brings the phone view back.
  const fieldFull = !!(window.FIELD && p.distribusiPengiriman && fieldPref.eligible && fieldPref.ui === 'new' && screen !== 'dist-field-rules');
  if (fieldFull) return (
    <window.FIELD.App user={user} perms={p} pref={fieldPref} today={FIN.TODAY}
      fleetList={fleet} fleetScope={user && user.fleetScope} refreshKey={distTick}
      onExit={() => { setFieldPref({ ui: 'old' }); go('dist-deliveries'); }} onPref={setFieldPref}
      onOpenRules={p.distribusiAturanLapangan ? () => go('dist-field-rules') : null} />
  );
```

(This sits after every hook in the component, so it keeps the hook order.)

Delete the block

```jsx
          {screen === 'dist-deliveries' && p.distribusiPengiriman && fieldPref.ui === 'new' && window.FIELD && (
            <window.FIELD.App … />
          )}
```

(all its lines, up to and including its closing `)}`).

Change the next line's condition from `{screen === 'dist-deliveries' && p.distribusiPengiriman && !(fieldPref.ui === 'new' && window.FIELD) && (` to `{screen === 'dist-deliveries' && p.distribusiPengiriman && (`.

`dist-field.jsx` `FldApp`, after the `mlap-on` effect:

```jsx
  // Full screen: the phone's status bar takes the screen's colour while the field view is open.
  uEfl(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return undefined;
    const before = meta.getAttribute('content');
    meta.setAttribute('content', '#EEF2F6');
    return () => { meta.setAttribute('content', before); };
  }, []);
```

`dist-field.css`, `.mlap-root`: replace `position: relative; min-height: calc(100vh - 60px); max-width: 480px; margin: 0 auto;` with

```css
  position: fixed; inset: 0; z-index: 30; overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch;
```

and replace `padding: 0 0 120px;` with `padding: 0 0 calc(130px + env(safe-area-inset-bottom));`. Then add:

```css
/* Wide screens: the phone layout stays a readable column in the middle of the full-screen view. */
.mlap-root > .mlap-head, .mlap-root > .mlap-meta, .mlap-root > .mlap-body, .mlap-root > .mlap-screen { max-width: 560px; margin-left: auto; margin-right: auto; }
body.mlap-on { background: #EEF2F6; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-shell-integration.test.js tests/field-shell-static.test.js tests/field-kit-static.test.js`

Expected: PASS. `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add finance-shell.jsx dist-field.jsx dist-field.css server/tests/field-shell-integration.test.js server/tests/field-shell-static.test.js
git commit -m "feat(distribusi): the field view runs full screen — no app bar or unit banner; status bar takes the screen colour"
```

---

## Task 3: 45 ikon mockup

**Files:**
- Create: `dist-field-icons.jsx` (generated from the mockup; content below)
- Modify: `build.mjs` (`'dist-field-icons.jsx'` right before `'dist-field-kit.jsx'`)
- Test: `server/tests/field-icons-static.test.js` (new)

**Interfaces:**
- Produces:
  - `FLD_ICONS` (name → `[[tag, attrs], …]`);
  - `FldSvg({ n, s, sw, style, label })`;
  - names: `lock minus plus back locate hand camera close warn route receipt cash fuel pinPlus adjust bottleBroken truck map users clipboard userMove bottlePlus ban search arrowRight crosshair pinMove pinOff chevron exclam navigate check exclamThin parking wrench food dots info home pen chevDown phone wa note clock`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/field-icons-static.test.js`:

```js
'use strict';
// MOCKUP ICONS (static): the 45 stroke icons of the approved mockup, drawn as React elements (no HTML
// injection), shipped before the kit so every field screen can use them.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('dist-field-icons.jsx'); const build = read('build.mjs');

it('parses, ships right before the kit, never injects HTML', () => {
  expect(() => parse(src, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build).toMatch(/'dist-field-icons\.jsx',\s*'dist-field-kit\.jsx',/);
  expect(src).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
});
it('has the 45 mockup icons, each only path/circle/rect parts', () => {
  const start = src.indexOf('const FLD_ICONS = {'); const end = src.indexOf('\n};', start);
  const body = src.slice(start + 'const FLD_ICONS = '.length, end + 2);
  const icons = JSON.parse(body.replace(/^\s*([a-zA-Z]+):/gm, '"$1":').replace(/,\s*}$/, '}'));
  expect(Object.keys(icons).length).toBe(45);
  ['truck', 'map', 'users', 'clipboard', 'plus', 'route', 'dots', 'back', 'close', 'chevron', 'camera', 'navigate', 'check', 'warn', 'search', 'phone', 'wa'].forEach((n) => expect(icons[n]).toBeTruthy());
  Object.values(icons).forEach((parts) => parts.forEach(([tag]) => expect(['path', 'circle', 'rect']).toContain(tag)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-icons-static.test.js`

Expected: FAIL with `ENOENT … dist-field-icons.jsx`.

- [ ] **Step 3: Implement**

Create `dist-field-icons.jsx` by copying the generated file `dist-field-icons.gen.jsx` from the session scratchpad. It is produced by `gen-icons.js` from the mockup boards, which walks all 20 boards, takes each distinct 24-grid stroke icon, and names them in the order of the Interfaces list. The file's shape:

```jsx
/* MODE LAPANGAN — ICONS: the 24-grid stroke icons drawn in the approved Liquid Glass mockup (45, taken
   verbatim from its boards). One component draws any of them; stroke width follows the mockup (dock: 2.3
   active / 1.9 idle). Bundle scope: top-level names are FLD_ICONS and FldSvg only. */
const FLD_ICONS = {
  lock: [["rect",{"x":5,"y":11,"width":14,"height":10,"rx":2}],["path",{"d":"M8 11V8a4 4 0 0 1 8 0v3"}]],
  minus: [["path",{"d":"M5 12h14"}]],
  plus: [["path",{"d":"M12 5v14M5 12h14"}]],
  back: [["path",{"d":"m15 5-7 7 7 7"}]],
  …(41 more, one per line, as generated)
};
function FldSvg({ n, s, sw, style, label }) {
  const parts = FLD_ICONS[n];
  if (!parts) return null;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' };
  return (
    <svg width={s || 20} height={s || 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw || 2} strokeLinecap="round" strokeLinejoin="round" style={style} {...a11y}>
      {parts.map(([tag, a], i) => React.createElement(tag, Object.assign({ key: i }, a)))}
    </svg>
  );
}
```

If the scratchpad copy is gone, regenerate it with `node gen-icons.js` against the mockup sources (`glass-canvas/project`). The generator refuses to write unless it finds exactly 45 icons.

`build.mjs`: insert `'dist-field-icons.jsx',` right before `'dist-field-kit.jsx',`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-icons-static.test.js tests/field-kit-static.test.js tests/field-shell-static.test.js`

Expected: PASS. `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field-icons.jsx build.mjs server/tests/field-icons-static.test.js
git commit -m "feat(distribusi): the mockup's 45 stroke icons for the field screens"
```

---

## Task 4: Kerangka persis mockup — header, chip latihan, judul tugas, CTA tetap, gradasi

**Files:**
- Modify: `dist-field.jsx`:
  - header;
  - remove ribbon;
  - fleet picker into the ⋯ sheet;
  - bottom fade.
- Modify: `dist-field-kit.jsx`:
  - `FldTop` (glass Batal pill / back chevron, centred title, top fade);
  - new `FldCtaBar`;
  - new `fldDayLabel`.
- Modify: `dist-field.css`
- Modify: `finance-i18n.js` (`fld.locale`)
- Test: `server/tests/field-shell-static.test.js` (update ribbon test + append), `server/tests/field-kit-static.test.js` (append)

**Interfaces:**
- Consumes: `FldSvg` (Task 3).
- Produces:
  - `FldTop({ title, sub, onBack, kind })`: `kind === 'back'` draws the round back chevron, anything else the glass "Batal" pill;
  - `FldCtaBar({ hint, children })`;
  - `fldDayLabel(iso)`.

- [ ] **Step 1: Write the failing tests**

In `server/tests/field-shell-static.test.js`, replace the test `latihan ribbon + confirmed mode switch + reset` with:

```js
it('latihan is a chip in the header (always shown in practice) + confirmed mode switch + reset', () => {
  expect(jsx).not.toMatch(/mlap-ribbon/);
  expect(jsx).toMatch(/\{mode === 'latihan' \? <span className="mlap-chip latihan" role="status">\{trFl\('fld\.modeLatihan'\)\}<\/span> : null\}/);
  expect(jsx).toMatch(/askSwitch\(/);
  expect(jsx).toMatch(/trFl\('fld\.switchToAsliB'\)/);
  expect(jsx).toMatch(/trFl\('fld\.resetLatihanB'\)/);
});
```

Append to `server/tests/field-shell-static.test.js`:

```js
describe('Plan 3D header', () => {
  it('eyebrow (day · armada) above the title; glass round buttons top-right (Rute on Pengiriman, ⋯ menu)', () => {
    expect(jsx).toMatch(/<span>\{fldDayLabel\(today\)\}\{fleet \? ' · ' \+ fleet : ''\}<\/span>/);
    expect(jsx.indexOf('{fldDayLabel(today)}')).toBeLessThan(jsx.indexOf('<h1>{trFl(TAB_LABEL[tab])}</h1>'));
    expect(jsx).toMatch(/tab === 'kirim' \? <button type="button" className="mlap-round" aria-label=\{trFl\('fld\.seeRoute'\)\} onClick=\{\(\) => setTab\('peta'\)\}><FldSvg n="route"/);
    expect(jsx).toMatch(/<FldSvg n="dots" s=\{19\} \/>/);
  });
  it('the armada picker moved into the ⋯ sheet; a soft fade sits under the dock', () => {
    expect(jsx).toMatch(/fleets\.length > 1 && \(\s*<label className="mlap-menu-item mlap-menu-fleet">/);
    expect(jsx).toMatch(/<div className="mlap-dockfade" aria-hidden="true" \/>/);
  });
});
```

Append to `server/tests/field-kit-static.test.js`:

```js
describe('Plan 3D kit', () => {
  it('task screens: glass "Batal" pill (or round back chevron), centred title, the top fade is CSS', () => {
    const f = kit.slice(kit.indexOf('function FldTop('), kit.indexOf('function FldTop(') + 900);
    expect(f).toMatch(/kind === 'back'\s*\?\s*<button type="button" className="mlap-round" aria-label=\{trFl\('fld\.back'\)\} onClick=\{onBack\}><FldSvg n="back"/);
    expect(f).toMatch(/<button type="button" className="mlap-pill" onClick=\{onBack\}>\{trFl\('fld\.cancel'\)\}<\/button>/);
    expect(css).toMatch(/\.mlap-top \{[^}]*position: sticky;[^}]*linear-gradient\(to top, rgba\(238,242,246,0\), rgba\(238,242,246,\.94\) 55%\)/);
  });
  it('a fixed bottom action bar with its fade and hint (screens adopt it in 3D-2)', () => {
    const f = kit.slice(kit.indexOf('function FldCtaBar('));
    expect(f).toMatch(/<div className="mlap-ctabar">/);
    expect(f).toMatch(/hint \? <span className="mlap-ctahint">\{hint\}<\/span> : null/);
    expect(css).toMatch(/\.mlap-ctabar \{[^}]*position: fixed;/);
  });
  it('the day label follows the screen language', () => {
    expect(kit).toMatch(/const fldDayLabel = \(iso\) =>/);
    expect(kit).toMatch(/toLocaleDateString\(trFl\('fld\.locale'\), \{ weekday: 'long', day: 'numeric', month: 'short' \}\)/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-shell-static.test.js tests/field-kit-static.test.js`

Expected: FAIL on every new assertion.

- [ ] **Step 3: Implement**

`dist-field-kit.jsx`: replace `FldTop` with:

```jsx
// Task screens (mockup): a glass "Batal" pill on the left — or a round back chevron for screens you only
// read (kind 'back') — the title centred, and a soft fade so the content scrolls under it.
function FldTop({ title, sub, onBack, kind }) {
  return (
    <div className="mlap-top">
      {onBack ? (kind === 'back'
        ? <button type="button" className="mlap-round" aria-label={trFl('fld.back')} onClick={onBack}><FldSvg n="back" s={18} sw={2.4} /></button>
        : <button type="button" className="mlap-pill" onClick={onBack}>{trFl('fld.cancel')}</button>) : <span aria-hidden="true" />}
      <div className="mlap-top-t"><h1>{title}</h1>{sub && <div className="mlap-top-sub">{sub}</div>}</div>
      <span aria-hidden="true" />
    </div>
  );
}

// The fixed bottom action of a task screen (mockup): its hint above it, a fade under the content.
function FldCtaBar({ hint, children }) {
  return (
    <>
      <div className="mlap-ctafade" aria-hidden="true" />
      <div className="mlap-ctabar">
        {hint ? <span className="mlap-ctahint">{hint}</span> : null}
        {children}
      </div>
    </>
  );
}

// "Selasa, 30 Sep" in the screen's language (the eyebrow upper-cases it).
const fldDayLabel = (iso) => { try { return new Date(iso + 'T00:00').toLocaleDateString(trFl('fld.locale'), { weekday: 'long', day: 'numeric', month: 'short' }); } catch (e) { return iso; } };
```

`dist-field.jsx`:

- Delete the line `{mode === 'latihan' && <div className="mlap-ribbon" role="status">{trFl('fld.bannerLatihan')}</div>}`.
- Replace the header block (from `<div className="mlap-head">` through the closing `</div>` of the `mlap-eyebrow mlap-meta` row) with:

```jsx
          <div className="mlap-head">
            <div className="mlap-head-t">
              <span className="mlap-eyebrow mlap-meta">
                <span>{fldDayLabel(today)}{fleet ? ' · ' + fleet : ''}</span>
                {mode === 'latihan' ? <span className="mlap-chip latihan" role="status">{trFl('fld.modeLatihan')}</span> : null}
              </span>
              <h1>{trFl(TAB_LABEL[tab])}</h1>
            </div>
            <div className="mlap-head-act">
              {tab === 'kirim' ? <button type="button" className="mlap-round" aria-label={trFl('fld.seeRoute')} onClick={() => setTab('peta')}><FldSvg n="route" s={19} /></button> : null}
              <button type="button" className="mlap-round" aria-label={trFl('fld.menu')} onClick={() => setMenu(true)}><FldSvg n="dots" s={19} /></button>
            </div>
          </div>
```

- In the ⋯ menu sheet, right after `<h2>{trFl('fld.menu')}</h2>`, add:

```jsx
            {fleets.length > 1 && (
              <label className="mlap-menu-item mlap-menu-fleet">
                <span className="mlap-grow">{trFl('fld.pickFleet')}</span>
                <select className="mlap-select" value={fleet} onChange={(e) => { setFleet(e.target.value); setMenu(false); }} aria-label={trFl('fld.pickFleet')}>
                  {fleets.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            )}
```

- Before the `<nav className="mlap-dock"` line, add `<div className="mlap-dockfade" aria-hidden="true" />`.

`dist-field.css`: replace the `.mlap-ribbon`, `.mlap-head`, `.mlap-head h1`, `.mlap-meta` rules and the KIT `.mlap-top*` / `.mlap-chev` rules with:

```css
.mlap-head { display: flex; align-items: flex-start; gap: 8px; padding: calc(12px + env(safe-area-inset-top)) 16px 6px; }
.mlap-head-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mlap-head h1 { margin: 0; font-size: 28px; line-height: 34px; font-weight: 700; letter-spacing: -.02em; color: var(--mlap-ink); }
.mlap-head-act { display: flex; gap: 8px; padding-top: 2px; }
.mlap-head .mlap-eyebrow { padding: 0; }
.mlap-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.mlap-head .mlap-chip { height: 20px; padding: 0 8px; font-size: 11px; font-weight: 700; letter-spacing: .03em; border-radius: 10px; }
.mlap-menu-fleet { gap: 8px; }
.mlap-menu-fleet .mlap-select { max-width: 50%; }
.mlap-dockfade { position: fixed; left: 0; right: 0; bottom: 0; height: calc(130px + env(safe-area-inset-bottom)); z-index: 35; pointer-events: none; background: linear-gradient(to bottom, rgba(238,242,246,0), rgba(238,242,246,.92) 60%); }
/* task screens */
.mlap-top { position: sticky; top: 0; z-index: 20; display: grid; grid-template-columns: 70px minmax(0, 1fr) 70px; align-items: center; gap: 8px; padding: calc(8px + env(safe-area-inset-top)) 16px 26px; margin-bottom: -18px; background: linear-gradient(to top, rgba(238,242,246,0), rgba(238,242,246,.94) 55%); }
.mlap-top-t { min-width: 0; text-align: center; }
.mlap-top h1 { margin: 0; font-size: 16px; line-height: 20px; font-weight: 600; letter-spacing: 0; }
.mlap-top-sub { font-size: 12px; color: var(--mlap-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mlap-pill { height: 44px; padding: 0 16px; border-radius: 22px; display: inline-flex; align-items: center; justify-self: start; font: inherit; font-size: 15px; font-weight: 500; color: var(--mlap-ink); cursor: pointer;
  background: rgba(255,255,255,.62); -webkit-backdrop-filter: blur(24px) saturate(1.6); backdrop-filter: blur(24px) saturate(1.6); border: 1px solid rgba(255,255,255,.85); box-shadow: 0 6px 20px rgba(6,51,79,.12), inset 0 1px 0 rgba(255,255,255,.9); }
.mlap-ctafade { position: fixed; left: 0; right: 0; bottom: 0; height: calc(120px + env(safe-area-inset-bottom)); z-index: 36; pointer-events: none; background: linear-gradient(to bottom, rgba(238,242,246,0), rgba(238,242,246,.94) 45%); }
.mlap-ctabar { position: fixed; left: 50%; transform: translateX(-50%); width: min(528px, calc(100vw - 32px)); bottom: calc(28px + env(safe-area-inset-bottom)); z-index: 37; display: flex; flex-direction: column; gap: 6px; }
.mlap-ctabar .mlap-btn { min-height: 50px; border-radius: 15px; width: 100%; }
.mlap-ctahint { text-align: center; font-size: 13px; font-weight: 600; color: var(--mlap-warn); }
```

`finance-i18n.js` keys:

| key | EN | ID |
|---|---|---|
| fld.locale | en-GB | id-ID |

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-shell-static.test.js tests/field-kit-static.test.js tests/field-day-static.test.js tests/field-cust-static.test.js tests/field-koreksi-static.test.js`

Expected: PASS. `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field.jsx dist-field-kit.jsx dist-field.css finance-i18n.js server/tests/field-shell-static.test.js server/tests/field-kit-static.test.js
git commit -m "feat(distribusi): field chrome as in the mockup — eyebrow over title, glass round buttons, latihan chip, glass Batal pill, fixed CTA bar, fades"
```

---

## Task 5: Material liquid glass — nilai persis mockup

**Files:**
- Modify: `dist-field.css`
- Modify: `dist-field-kit.jsx` (new `FldCloseX`)
- Test: `server/tests/field-kit-static.test.js` (append)

**Interfaces:**
- Produces: `FldCloseX({ onClick, label })`, the glass round close button for sheets.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/field-kit-static.test.js`:

```js
describe('Plan 3D materials (values copied from the mockup)', () => {
  const rule = (sel) => { const i = css.lastIndexOf(sel + ' {'); expect(i).toBeGreaterThan(-1); return css.slice(i, css.indexOf('}', i)); };
  it('round buttons, dock, menu: glass fill, blur, border, top highlight', () => {
    expect(rule('.mlap-round')).toMatch(/background: rgba\(255,255,255,\.62\);.*blur\(24px\) saturate\(1\.6\).*inset 0 1px 0 rgba\(255,255,255,\.9\)/s);
    expect(rule('.mlap-dock')).toMatch(/background: rgba\(255,255,255,\.66\);.*inset 0 1px 0 rgba\(255,255,255,\.95\)/s);
    expect(rule('.mlap-catat-menu')).toMatch(/border: 1px solid rgba\(255,255,255,\.9\);.*inset 0 1px 0 rgba\(255,255,255,\.95\)/s);
  });
  it('sheets are frosted (.88) with a bright top edge; the menu scrim is light and blurred', () => {
    expect(rule('.mlap-sheet')).toMatch(/background: rgba\(248,250,252,\.88\);.*border-top: 1px solid rgba\(255,255,255,\.9\);.*inset 0 1px 0 rgba\(255,255,255,\.95\)/s);
    expect(rule('.mlap-scrim.menu')).toMatch(/background: rgba\(14,27,36,\.18\);.*blur\(2px\)/s);
    expect(rule('.mlap-scrim')).toMatch(/background: rgba\(14,27,36,\.32\)/);
  });
  it('Catat is the one tinted glass control (depth shadow, clipped for its sheen); menu tiles are translucent', () => {
    expect(rule('.mlap-catat')).toMatch(/overflow: hidden;.*inset 0 -6px 12px rgba\(0,30,60,\.25\)/s);
    expect(rule('.mlap-tile')).toMatch(/background: rgba\(255,255,255,\.72\);.*inset 0 1px 0 rgba\(255,255,255,\.9\)/s);
    expect(rule('.mlap-btn.primary')).toMatch(/inset 0 1px 0 rgba\(255,255,255,\.25\)/);
  });
  it('a glass close button for sheets', () => {
    expect(kit).toMatch(/function FldCloseX\(\{ onClick, label \}\) \{\s*return <button type="button" className="mlap-closex"/);
    expect(rule('.mlap-closex')).toMatch(/background: rgba\(255,255,255,\.7\);/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-kit-static.test.js`

Expected: FAIL. The values differ (`var(--mlap-glass)`, no highlights, no `.mlap-scrim.menu`, no `FldCloseX`).

- [ ] **Step 3: Implement**

Add to `dist-field.css` before `@keyframes mlapFade` (later rules win; the old rules stay as the base):

```css
/* ── LIQUID GLASS (3D) — values copied from the approved mockup boards ── */
.mlap-round { background: rgba(255,255,255,.62); -webkit-backdrop-filter: blur(24px) saturate(1.6); backdrop-filter: blur(24px) saturate(1.6); border: 1px solid rgba(255,255,255,.85); box-shadow: 0 6px 20px rgba(6,51,79,.14), inset 0 1px 0 rgba(255,255,255,.9); }
.mlap-dock { background: rgba(255,255,255,.66); -webkit-backdrop-filter: blur(28px) saturate(1.6); backdrop-filter: blur(28px) saturate(1.6); border: 1px solid rgba(255,255,255,.85); box-shadow: 0 10px 34px rgba(6,51,79,.18), inset 0 1px 0 rgba(255,255,255,.95); overflow: hidden; }
.mlap-catat { overflow: hidden; box-shadow: 0 10px 26px rgba(6,84,137,.42), inset 0 1px 0 rgba(255,255,255,.45), inset 0 -6px 12px rgba(0,30,60,.25); }
.mlap-catat-menu { background: rgba(255,255,255,.66); border: 1px solid rgba(255,255,255,.9); box-shadow: 0 18px 50px rgba(6,51,79,.26), inset 0 1px 0 rgba(255,255,255,.95); }
.mlap-tile { background: rgba(255,255,255,.72); box-shadow: inset 0 1px 0 rgba(255,255,255,.9); }
.mlap-sheet { background: rgba(248,250,252,.88); -webkit-backdrop-filter: blur(34px) saturate(1.5); backdrop-filter: blur(34px) saturate(1.5); border-top: 1px solid rgba(255,255,255,.9); box-shadow: 0 -10px 40px rgba(6,51,79,.2), inset 0 1px 0 rgba(255,255,255,.95); }
.mlap-scrim { background: rgba(14,27,36,.32); }
.mlap-scrim.menu { background: rgba(14,27,36,.18); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); }
.mlap-btn.primary { box-shadow: 0 8px 24px rgba(6,84,137,.3), inset 0 1px 0 rgba(255,255,255,.25); }
.mlap-closex { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0; cursor: pointer; color: #3E4E58; background: rgba(255,255,255,.7); border: 1px solid rgba(255,255,255,.9); box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 2px 8px rgba(6,51,79,.1); }
.mlap-tile-ico { width: 36px; height: 36px; border-radius: 50%; background: #E8F1F8; color: #065489; display: grid; place-items: center; }
```

In `dist-field.jsx`, the Catat menu scrim gets the `menu` class: `<button type="button" className="mlap-scrim menu" aria-label={trFl('fld.cancel')} onClick={() => setCatat(false)} />`.

In the tiles, put an icon disc before the label. `ACTION_ICON = { catatSale: 'receipt', catatBon: 'cash', catatExp: 'fuel', catatStop: 'pinPlus', catatAdj: 'adjust', catatDmg: 'bottleBroken' }`, declared next to `ACTION_VIEW`, and the tile content becomes:

```jsx
<span className="mlap-tile-ico"><FldSvg n={ACTION_ICON[a]} s={19} /></span>{trFl('fld.' + a)}
```

`dist-field-kit.jsx`, after `FldCtaBar`:

```jsx
// The glass round close button of a sheet (mockup).
function FldCloseX({ onClick, label }) {
  return <button type="button" className="mlap-closex" aria-label={label || trFl('fld.close')} onClick={onClick}><FldSvg n="close" s={14} sw={2.6} /></button>;
}
```

`finance-i18n.js`: if `fld.close` does not exist, add it (EN "Close", ID "Tutup").

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-kit-static.test.js tests/field-shell-static.test.js`

Expected: PASS. `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field.css dist-field.jsx dist-field-kit.jsx finance-i18n.js server/tests/field-kit-static.test.js
git commit -m "feat(distribusi): liquid glass materials with the mockup's exact values; icon discs on Catat tiles; glass close button"
```

---

## Task 6: Animasi — indikator tab cair, kilau Catat, tekan memantul, sheet muncul

**Files:**
- Modify: `dist-field-kit.jsx` (new `FldDock`)
- Modify: `dist-field.jsx` (use `FldDock`)
- Modify: `dist-field.css`
- Test: `server/tests/field-kit-static.test.js` (append)

**Interfaces:**
- Consumes: `FldSvg` (Task 3).
- Produces: `FldDock({ tabs, tab, onTab, labelOf, catat, onCatat })`, where `tabs` = `[[key, iconName], …, null (gap), …]`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/field-kit-static.test.js`:

```js
describe('Plan 3D motion (mockup Dock board)', () => {
  const f = () => kit.slice(kit.indexOf('function FldDock('));
  it('a liquid selection springs to the tab, stretching 1.4× and squashing .82 for 300 ms, with a one-shot sheen', () => {
    expect(f()).toMatch(/setMoving\(true\); const t = setTimeout\(\(\) => setMoving\(false\), 300\);/);
    expect(f()).toMatch(/const w = g \? g\.width \* \(moving \? 1\.4 : 1\) : 0;/);
    expect(f()).toMatch(/transform: 'scaleY\(' \+ \(moving \? 0\.82 : 1\) \+ '\)'/);
    expect(f()).toMatch(/moving \? <span aria-hidden="true" className="mlap-dock-sheen" \/> : null/);
    expect(css).toMatch(/\.mlap-blob \{[^}]*transition: left \.55s cubic-bezier\(\.3,1\.5,\.6,1\), width \.3s ease, transform \.3s ease;/);
  });
  it('the Catat button keeps a periodic sheen; tabs show the mockup icons (2.3 active / 1.9 idle)', () => {
    expect(f()).toMatch(/<span aria-hidden="true" className="mlap-sheen" \/>/);
    expect(f()).toMatch(/sw=\{tab === t\[0\] \? 2\.3 : 1\.9\}/);
    expect(css).toMatch(/@keyframes mlapSheen \{ 0%, 72% \{ transform: translateX\(-160%\) rotate\(20deg\); \} 100% \{ transform: translateX\(260%\) rotate\(20deg\); \} \}/);
    expect(css).toMatch(/\.mlap-sheen \{[^}]*animation: mlapSheen 4\.5s ease-in-out infinite;/);
  });
  it('every pressable control springs (scale .9 on press)', () => {
    expect(css).toMatch(/\.mlap-tab, \.mlap-tile, \.mlap-catat, \.mlap-step, \.mlap-chip-b, \.mlap-round, \.mlap-pill, \.mlap-closex, \.mlap-seg-b \{ transition: transform \.35s cubic-bezier\(\.34,1\.56,\.64,1\)/);
    expect(css).toMatch(/:active \{ transform: scale\(\.9\); \}/);
  });
  it('sheets grow out of the bottom like the menu (lgPop .45s)', () => {
    expect(css).toMatch(/\.mlap-sheet \{ animation: mlapSheetPop \.45s cubic-bezier\(\.34,1\.3,\.64,1\) both; transform-origin: 50% 100%; \}/);
  });
  it('the shell uses the dock component', () => {
    const shell = fs.readFileSync(path.join(root, 'dist-field.jsx'), 'utf8');
    expect(shell).toMatch(/<FldDock tabs=\{TABS\} tab=\{tab\} onTab=\{\(k\) => \{ setTab\(k\); setView\(null\); \}\}/);
  });
});
```

(`field-kit-static.test.js` already has `fs`, `path`, `root`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-kit-static.test.js`

Expected: FAIL. `FldDock` is missing.

- [ ] **Step 3: Implement**

`dist-field-kit.jsx`, append:

```jsx
// THE DOCK (mockup "Dock bar + animasi"): glass tabs with a liquid selection that springs to the tab and
// stretches 1.4× / squashes .82 while it travels (300 ms), a one-shot sheen across the dock, and the
// centre Catat button — the one tinted glass control — with its periodic sheen and its +→× turn.
function FldDock({ tabs, tab, onTab, labelOf, catat, onCatat }) {
  const navRef = uRfl(null);
  const [geo, setGeo] = uSfl(null);
  const [moving, setMoving] = uSfl(false);
  const prev = uRfl(tab);
  const measure = () => {
    const n = navRef.current; if (!n) return;
    setGeo([].slice.call(n.querySelectorAll('.mlap-tab')).map((b) => ({ left: b.offsetLeft, width: b.offsetWidth })));
  };
  uEfl(() => { measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, []);
  uEfl(() => {
    if (prev.current === tab) return undefined;
    prev.current = tab;
    setMoving(true); const t = setTimeout(() => setMoving(false), 300);
    return () => clearTimeout(t);
  }, [tab]);
  const idx = tabs.filter(Boolean).findIndex((t) => t[0] === tab);
  const g = geo && idx >= 0 ? geo[idx] : null;
  const w = g ? g.width * (moving ? 1.4 : 1) : 0;
  return (
    <>
      <nav ref={navRef} className="mlap-dock" aria-label={trFl('fld.nav')}>
        {g ? <span aria-hidden="true" className="mlap-blob" style={{ left: g.left - (w - g.width) / 2, width: w, transform: 'scaleY(' + (moving ? 0.82 : 1) + ')' }} /> : null}
        {moving ? <span aria-hidden="true" className="mlap-dock-sheen" /> : null}
        {tabs.map((t, i) => (t ? (
          <button key={t[0]} type="button" className={'mlap-tab' + (tab === t[0] ? ' on' : '')} aria-current={tab === t[0] ? 'page' : undefined} onClick={() => onTab(t[0])}>
            <FldSvg n={t[1]} s={20} sw={tab === t[0] ? 2.3 : 1.9} /><span>{labelOf(t[0])}</span>
          </button>
        ) : <span key={'gap' + i} aria-hidden="true" />))}
      </nav>
      <button type="button" className={'mlap-catat' + (catat ? ' open' : '')} aria-label={trFl('fld.tabCatat')} aria-expanded={catat} onClick={onCatat}>
        <span aria-hidden="true" className="mlap-sheen" />
        <FldSvg n="plus" s={24} sw={2.6} />
      </button>
    </>
  );
}
```

`dist-field.jsx`:
- change `TABS` to `const TABS = [['kirim', 'truck'], ['peta', 'map'], null, ['pelanggan', 'users'], ['setoran', 'clipboard']];`;
- replace the `<nav className="mlap-dock" …>…</nav>` block and the `<button … className={'mlap-catat' …}>…</button>` line with:

```jsx
          <FldDock tabs={TABS} tab={tab} onTab={(k) => { setTab(k); setView(null); }} labelOf={(k) => trFl(TAB_LABEL[k])} catat={catat} onCatat={() => setCatat(!catat)} />
```

`dist-field.css`, before `@keyframes mlapFade`:

```css
/* ── MOTION (3D) — easing and timing copied from the mockup's Dock board ── */
.mlap-tab.on { background: transparent; color: var(--mlap-accent); }
.mlap-tab { position: relative; z-index: 1; transition: color .3s ease, transform .35s cubic-bezier(.34,1.56,.64,1); }
.mlap-blob { position: absolute; top: 4px; height: 54px; border-radius: 27px; pointer-events: none; background: rgba(6,84,137,.13); box-shadow: inset 0 1px 0 rgba(255,255,255,.7), 0 2px 8px rgba(6,84,137,.12); transition: left .55s cubic-bezier(.3,1.5,.6,1), width .3s ease, transform .3s ease; }
.mlap-dock-sheen { position: absolute; top: -20px; left: 0; width: 34px; height: 110px; pointer-events: none; background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.75), rgba(255,255,255,0)); animation: mlapSheenOnce .55s ease-out both; }
.mlap-sheen { position: absolute; top: -20px; left: 0; width: 22px; height: 110px; pointer-events: none; background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.45), rgba(255,255,255,0)); animation: mlapSheen 4.5s ease-in-out infinite; }
.mlap-catat svg { position: relative; }
.mlap-tab, .mlap-tile, .mlap-catat, .mlap-step, .mlap-chip-b, .mlap-round, .mlap-pill, .mlap-closex, .mlap-seg-b { transition: transform .35s cubic-bezier(.34,1.56,.64,1), background .2s ease, color .2s ease; }
.mlap-tab:active, .mlap-tile:active, .mlap-catat:active, .mlap-step:active, .mlap-chip-b:active, .mlap-round:active, .mlap-pill:active, .mlap-closex:active, .mlap-seg-b:active { transform: scale(.9); }
.mlap-btn, .mlap-rowbtn { transition: transform .35s cubic-bezier(.34,1.56,.64,1); }
.mlap-btn:active:not(:disabled), .mlap-rowbtn:active:not(:disabled) { transform: scale(.97); }
.mlap-sheet { animation: mlapSheetPop .45s cubic-bezier(.34,1.3,.64,1) both; transform-origin: 50% 100%; }
.mlap-reveal { animation: mlapReveal .25s ease both; }
@keyframes mlapSheen { 0%, 72% { transform: translateX(-160%) rotate(20deg); } 100% { transform: translateX(260%) rotate(20deg); } }
@keyframes mlapSheenOnce { from { transform: translateX(-60px) rotate(20deg); } to { transform: translateX(420px) rotate(20deg); } }
@keyframes mlapSheetPop { 0% { opacity: 0; transform: translate(-50%, 60px) scale(.9, .6); filter: blur(6px); } 55% { opacity: 1; filter: blur(0); } 100% { opacity: 1; transform: translate(-50%, 0); filter: blur(0); } }
@keyframes mlapReveal { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
```

Extend the `prefers-reduced-motion` block's selector list with `, .mlap-blob, .mlap-sheen, .mlap-dock-sheen, .mlap-tab, .mlap-btn, .mlap-rowbtn, .mlap-reveal`. Add `.mlap-sheen, .mlap-dock-sheen { display: none; }` inside that block.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-kit-static.test.js tests/field-shell-static.test.js`

Expected: PASS. `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field-kit.jsx dist-field.jsx dist-field.css server/tests/field-kit-static.test.js
git commit -m "feat(distribusi): mockup motion — liquid tab selection with stretch and sheen, Catat sheen, spring press, sheets pop from the bottom"
```

---

## Task 7: Gesture — tarik sheet ke bawah untuk menutup

**Files:**
- Modify: `dist-field-logic.js` (`dragRelease`)
- Modify: `dist-field-kit.jsx`:
  - new `useFldSheetDrag` + `FldGrab`;
  - `FldSheet` uses them.
- Modify: `dist-field-day.jsx` (`FldStopSheet`), `dist-field-cust.jsx` (`FldCustSheet`), `dist-field.jsx` (⋯ menu sheet)
- Modify: `dist-field.css`
- Test: `server/tests/field-logic.test.js` (append), `server/tests/field-kit-static.test.js` (append)

**Interfaces:**
- Produces:
  - `FIELDLOGIC.dragRelease({ dy, ms, height })` → `'close' | 'stay'`;
  - `useFldSheetDrag(onClose)` → `{ ref, style, handle }`;
  - `FldGrab({ handle })`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/field-logic.test.js`:

```js
it('Plan 3D: a sheet closes when pulled far enough or flicked; a small pull springs back', () => {
  expect(L.dragRelease({ dy: 40, ms: 400, height: 600 })).toBe('stay');
  expect(L.dragRelease({ dy: 130, ms: 600, height: 600 })).toBe('close');            // past 120 px
  expect(L.dragRelease({ dy: 70, ms: 600, height: 240 })).toBe('close');             // a short sheet: a quarter of its height
  expect(L.dragRelease({ dy: 50, ms: 80, height: 600 })).toBe('close');              // a flick (>0.5 px/ms)
  expect(L.dragRelease({ dy: 20, ms: 20, height: 600 })).toBe('stay');               // a tap-sized move is never a flick
});
```

Append to `server/tests/field-kit-static.test.js`:

```js
describe('Plan 3D gestures: sheets', () => {
  it('a drag hook on the grabber: follows the finger, decides with dragRelease, slides away or springs back', () => {
    const f = kit.slice(kit.indexOf('function useFldSheetDrag('));
    expect(f).toMatch(/e\.currentTarget\.setPointerCapture\(e\.pointerId\)/);
    expect(f).toMatch(/FIELDLOGIC\.dragRelease\(\{ dy: d, ms: Date\.now\(\) - s\.t, height: ref\.current \? ref\.current\.offsetHeight : 600 \}\)/);
    expect(f).toMatch(/if \(r === 'close'\) \{ setLeaving\(true\); setTimeout\(onClose, 220\); \} else setDy\(0\);/);
    expect(css).toMatch(/\.mlap-grabzone \{[^}]*touch-action: none;/);
  });
  it('every sheet uses it', () => {
    const day = fs.readFileSync(path.join(root, 'dist-field-day.jsx'), 'utf8');
    const cust = fs.readFileSync(path.join(root, 'dist-field-cust.jsx'), 'utf8');
    const shell = fs.readFileSync(path.join(root, 'dist-field.jsx'), 'utf8');
    [kit.slice(kit.indexOf('function FldSheet(')), day.slice(day.indexOf('function FldStopSheet(')), cust.slice(cust.indexOf('function FldCustSheet('))].forEach((src) => {
      expect(src).toMatch(/const drag = useFldSheetDrag\(/);
      expect(src).toMatch(/<FldGrab handle=\{drag\.handle\} \/>/);
      expect(src).toMatch(/ref=\{drag\.ref\} style=\{drag\.style\}/);
    });
    expect(shell).toMatch(/const menuDrag = useFldSheetDrag\(\(\) => setMenu\(false\)\);/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-kit-static.test.js`

Expected: FAIL. `L.dragRelease is not a function`, and the hook is missing.

- [ ] **Step 3: Implement**

`dist-field-logic.js`, before the export object:

```js
  // SHEETS (3D): released after a pull — close past 120 px (or a quarter of a short sheet) or on a
  // flick (> 0.5 px/ms over at least 30 px); anything less springs back.
  function dragRelease(o) {
    var dy = Math.max(0, num(o.dy)); var ms = Math.max(1, num(o.ms)); var h = Math.max(1, num(o.height) || 600);
    if (dy >= Math.min(120, h * 0.25)) return 'close';
    return dy >= 30 && dy / ms > 0.5 ? 'close' : 'stay';
  }
```

Add `dragRelease: dragRelease` to the export object.

`dist-field-kit.jsx`, append:

```jsx
// Pull a sheet down by its grabber to close it (mockup grabbers): it follows the finger; past the line
// (or on a flick) it slides away, otherwise it springs back.
function useFldSheetDrag(onClose) {
  const ref = uRfl(null); const st = uRfl(null);
  const [dy, setDy] = uSfl(0);
  const [leaving, setLeaving] = uSfl(false);
  const down = (e) => { st.current = { y: e.clientY, t: Date.now() }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* older browsers */ } };
  const move = (e) => { if (st.current) setDy(Math.max(0, e.clientY - st.current.y)); };
  const up = (e) => {
    const s = st.current; st.current = null; if (!s) return;
    const d = Math.max(0, e.clientY - s.y);
    const r = FIELDLOGIC.dragRelease({ dy: d, ms: Date.now() - s.t, height: ref.current ? ref.current.offsetHeight : 600 });
    if (r === 'close') { setLeaving(true); setTimeout(onClose, 220); } else setDy(0);
  };
  const style = leaving ? { transform: 'translate(-50%, 110%)', transition: 'transform .22s ease-in', animation: 'none' }
    : dy ? { transform: 'translate(-50%, ' + dy + 'px)', transition: 'none', animation: 'none' } : undefined;
  return { ref, style, handle: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: () => { st.current = null; setDy(0); } } };
}
function FldGrab({ handle }) {
  return <div className="mlap-grabzone" {...handle}><div className="mlap-grab" /></div>;
}
```

`FldSheet`:
- add `const drag = useFldSheetDrag(onClose);` as its first line;
- the sheet div becomes `<div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={title} ref={drag.ref} style={drag.style}>`;
- replace `<div className="mlap-grab" />` with `<FldGrab handle={drag.handle} />`.

`FldStopSheet` (dist-field-day.jsx) and `FldCustSheet` (dist-field-cust.jsx): the same three edits. Their close callback is `onClose`.

`dist-field.jsx` ⋯ menu:
- add `const menuDrag = useFldSheetDrag(() => setMenu(false));` with the other hooks, near `const [menu, setMenu]`. It must sit above any early return;
- the menu sheet div gets `ref={menuDrag.ref} style={menuDrag.style}`;
- its `<div className="mlap-grab" />` becomes `<FldGrab handle={menuDrag.handle} />`.

`dist-field.css`, before `@keyframes mlapFade`:

```css
/* ── GESTURES (3D) ── */
.mlap-grabzone { display: flex; justify-content: center; padding: 7px 0 10px; margin: -8px -16px 0; touch-action: none; cursor: grab; }
.mlap-grabzone .mlap-grab { margin: 0; }
.mlap-sheet { transition: transform .3s cubic-bezier(.34,1.3,.64,1); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-kit-static.test.js tests/field-day-static.test.js tests/field-cust-static.test.js tests/field-shell-static.test.js`

Expected: PASS. `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field-logic.js dist-field-kit.jsx dist-field-day.jsx dist-field-cust.jsx dist-field.jsx dist-field.css server/tests/field-logic.test.js server/tests/field-kit-static.test.js
git commit -m "feat(distribusi): pull a sheet down to close it (follows the finger, flick or past the line closes, else springs back)"
```

---

## Task 8: Gesture — usap kiri/kanan antar tab

**Files:**
- Modify: `dist-field-logic.js` (`swipeTab`)
- Modify: `dist-field.jsx` (pointer handlers on the tab body)
- Modify: `dist-field.css` (`touch-action: pan-y` on the swipe area)
- Test: `server/tests/field-logic.test.js` (append), `server/tests/field-shell-static.test.js` (append)

**Interfaces:**
- Produces: `FIELDLOGIC.swipeTab({ dx, dy, ms, tab, order })` → next tab key or `null`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/field-logic.test.js`:

```js
it('Plan 3D: a clear sideways swipe moves one tab; scrolling, slow drags and the ends do nothing', () => {
  const order = ['kirim', 'peta', 'pelanggan', 'setoran'];
  expect(L.swipeTab({ dx: -90, dy: 10, ms: 250, tab: 'kirim', order })).toBe('peta');
  expect(L.swipeTab({ dx: 90, dy: -12, ms: 250, tab: 'peta', order })).toBe('kirim');
  expect(L.swipeTab({ dx: 90, dy: 5, ms: 250, tab: 'kirim', order })).toBeNull();          // already first
  expect(L.swipeTab({ dx: -90, dy: 5, ms: 250, tab: 'setoran', order })).toBeNull();       // already last
  expect(L.swipeTab({ dx: -40, dy: 0, ms: 200, tab: 'kirim', order })).toBeNull();         // too short
  expect(L.swipeTab({ dx: -90, dy: 80, ms: 250, tab: 'kirim', order })).toBeNull();        // mostly a scroll
  expect(L.swipeTab({ dx: -90, dy: 0, ms: 900, tab: 'kirim', order })).toBeNull();         // a slow drag, not a swipe
});
```

Append to `server/tests/field-shell-static.test.js`:

```js
it('Plan 3D: swipe between tabs on the tab body only — never from a map, an input, a sideways scroller or a sheet', () => {
  expect(jsx).toMatch(/const TAB_ORDER = \['kirim', 'peta', 'pelanggan', 'setoran'\];/);
  expect(jsx).toMatch(/e\.target\.closest\('\.mlap-map, input, textarea, select, \.mlap-hscroll, \.mlap-sheet, \.leaflet-container'\)/);
  expect(jsx).toMatch(/FIELDLOGIC\.swipeTab\(\{ dx: e\.clientX - s\.x, dy: e\.clientY - s\.y, ms: Date\.now\(\) - s\.t, tab, order: TAB_ORDER \}\)/);
  expect(jsx).toMatch(/<div className="mlap-body mlap-swipe" onPointerDown=\{swipeDown\} onPointerUp=\{swipeUp\} onPointerCancel=\{\(\) => \{ swipeRef\.current = null; \}\}>/);
  expect(read('dist-field.css')).toMatch(/\.mlap-swipe \{ touch-action: pan-y; \}/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-shell-static.test.js`

Expected: FAIL. `L.swipeTab is not a function`, and there are no handlers.

- [ ] **Step 3: Implement**

`dist-field-logic.js`, before the export object:

```js
  // TABS (3D, owner): a clear sideways swipe (≥ 60 px, 1.5× more sideways than up/down, under 700 ms)
  // moves one tab in the dock order; nothing past the first or last tab.
  function swipeTab(o) {
    var ax = Math.abs(num(o.dx)); var ay = Math.abs(num(o.dy));
    if (ax < 60 || ax < ay * 1.5 || num(o.ms) > 700) return null;
    var order = o.order || []; var i = order.indexOf(o.tab); if (i < 0) return null;
    var j = num(o.dx) < 0 ? i + 1 : i - 1;
    return j >= 0 && j < order.length ? order[j] : null;
  }
```

Add `swipeTab: swipeTab` to the export object.

`dist-field.jsx` `FldApp`, with the other hooks (above any early return):

```jsx
  // Swipe between tabs (owner, 3D) — touch only; never from a map, an input, a sideways scroller or a sheet.
  const TAB_ORDER = ['kirim', 'peta', 'pelanggan', 'setoran'];
  const swipeRef = uRfl(null);
  const swipeDown = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.target.closest('.mlap-map, input, textarea, select, .mlap-hscroll, .mlap-sheet, .leaflet-container')) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const swipeUp = (e) => {
    const s = swipeRef.current; swipeRef.current = null; if (!s) return;
    const next = FIELDLOGIC.swipeTab({ dx: e.clientX - s.x, dy: e.clientY - s.y, ms: Date.now() - s.t, tab, order: TAB_ORDER });
    if (next) { setTab(next); setView(null); }
  };
```

Replace `<div className="mlap-body">` (the one that wraps `{body}` in the tab view, not the task screens) with:

```jsx
          <div className="mlap-body mlap-swipe" onPointerDown={swipeDown} onPointerUp={swipeUp} onPointerCancel={() => { swipeRef.current = null; }}>
```

`dist-field.css`, in the GESTURES block: `.mlap-swipe { touch-action: pan-y; }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-shell-static.test.js`

Expected: PASS. `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field-logic.js dist-field.jsx dist-field.css server/tests/field-logic.test.js server/tests/field-shell-static.test.js
git commit -m "feat(distribusi): swipe left/right between field tabs (not from maps, inputs, sideways scrollers or sheets)"
```

---

## Task 9: Gesture — Atur titik: geser peta di bawah pin tengah (mockup)

**Files:**
- Modify: `dist-field-cust.jsx` (`FldPinMap`)
- Modify: `dist-field.css`
- Modify: `finance-i18n.js`
- Test: `server/tests/field-cust-static.test.js` (update the pin test + append)

**Interfaces:**
- Consumes: `FldSvg` (`locate`).
- Produces: `FldPinMap` keeps its props. The pin is the map centre. `moved` becomes true only after the user drags or zooms.

- [ ] **Step 1: Write the failing tests**

In `server/tests/field-cust-static.test.js`, in the test `Atur titik: draggable pin, …`, replace `expect(f).toMatch(/draggable: true/);` with `expect(f).toMatch(/className=\{'mlap-centerpin' \+ \(lift \? ' up' : ''\)\}/);`.

Append:

```js
describe('Plan 3D: Atur titik — move the map under the centre pin (drag anywhere)', () => {
  const f = () => fn('FldPinMap');
  it('the pin is the map centre; it lifts while the map moves; only a user drag or zoom counts as moved', () => {
    expect(f()).toMatch(/map\.on\('move', \(\) => \{ const ce = map\.getCenter\(\); setPin\(\{ lat: ce\.lat, lng: ce\.lng \}\); \}\);/);
    expect(f()).toMatch(/map\.on\('dragstart zoomstart', \(\) => \{ userRef\.current = true; setLift\(true\); \}\);/);
    expect(f()).toMatch(/map\.on\('moveend', \(\) => \{ setLift\(false\); if \(userRef\.current\) setMoved\(true\); \}\);/);
    expect(f()).not.toMatch(/L\.marker\(\[pin\.lat, pin\.lng\], \{ draggable: true/);
  });
  it('a glass locate button recentres on the phone; the hint says to move the map', () => {
    expect(f()).toMatch(/<button type="button" className="mlap-round mlap-map-locate" aria-label=\{trFl\('fld\.useMyLoc'\)\} onClick=\{\(\) => mapRef\.current\.setView\(\[dev\.lat, dev\.lng\], 18\)\}><FldSvg n="locate"/);
    expect(f()).toContain("'fld.pinPan'");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-cust-static.test.js`

Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

`FldPinMap`:
- replace `const markRef = uRfl(null);` with:

  ```js
  const userRef = uRfl(false);   // a drag or zoom by the user (the first centring is not "moved")
  const [lift, setLift] = uSfl(false);
  ```

- replace the three lines

  ```js
      const m = L.marker([pin.lat, pin.lng], { draggable: true, keyboard: true, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [30, 30], html: '<span class="mlap-pin drag">●</span>' }) }).addTo(map);
      m.on('dragend', () => { const ll = m.getLatLng(); setPin({ lat: ll.lat, lng: ll.lng }); setMoved(true); });
      markRef.current = m;
  ```

  with

  ```js
      // the pin stays in the centre; the driver moves the map under it (drag anywhere, mockup)
      map.on('move', () => { const ce = map.getCenter(); setPin({ lat: ce.lat, lng: ce.lng }); });
      map.on('dragstart zoomstart', () => { userRef.current = true; setLift(true); });
      map.on('moveend', () => { setLift(false); if (userRef.current) setMoved(true); });
  ```

- replace the map element

  ```jsx
  (pin ? <div ref={mapEl} className="mlap-map mlap-pinmap" role="application" aria-label={trFl('fld.pinT')} /> : <div className="mlap-empty">{trFl('fld.locating')}</div>)
  ```

  with

  ```jsx
  (pin ? (
            <div className="mlap-mapwrap">
              <div ref={mapEl} className="mlap-map mlap-pinmap" role="application" aria-label={trFl('fld.pinT')} />
              <span className={'mlap-centerpin' + (lift ? ' up' : '')} aria-hidden="true"><span className="mlap-centerpin-dot" /></span>
              <span className={'mlap-centerpin-shadow' + (lift ? ' up' : '')} aria-hidden="true" />
              {dev && mapReady ? <button type="button" className="mlap-round mlap-map-locate" aria-label={trFl('fld.useMyLoc')} onClick={() => mapRef.current.setView([dev.lat, dev.lng], 18)}><FldSvg n="locate" s={19} /></button> : null}
            </div>
          ) : <div className="mlap-empty">{trFl('fld.locating')}</div>)
  ```

- `{trFl('fld.pinDrag')}` → `{trFl('fld.pinPan')}`.

`dist-field.css`, in the GESTURES block:

```css
.mlap-mapwrap { position: relative; }
.mlap-centerpin { position: absolute; left: 50%; top: 50%; width: 30px; height: 30px; margin: -30px 0 0 -15px; z-index: 2; pointer-events: none; transition: transform .12s ease; }
.mlap-centerpin-dot { display: block; width: 30px; height: 30px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: #C2410C; border: 2px solid #fff; box-sizing: border-box; box-shadow: 0 3px 8px rgba(6,51,79,.35); }
.mlap-centerpin.up { transform: translateY(-10px); }
.mlap-centerpin.up .mlap-centerpin-dot { box-shadow: 0 10px 16px rgba(6,51,79,.35); }
.mlap-centerpin-shadow { position: absolute; left: 50%; top: 50%; width: 10px; height: 4px; margin: -2px 0 0 -5px; border-radius: 50%; background: rgba(14,27,36,.35); z-index: 1; opacity: 0; pointer-events: none; transition: opacity .12s ease; }
.mlap-centerpin-shadow.up { opacity: 1; }
.mlap-map-locate { position: absolute; right: 10px; bottom: 10px; z-index: 3; }
```

i18n:

| key | EN | ID |
|---|---|---|
| fld.pinPan | Move the map until the pin sits on the customer's roof or door. | Geser peta sampai pin tepat di atap / pintu rumah pelanggan. |

If `fld.useMyLoc` is missing, add it (EN "Use my location", ID "Pakai lokasi saya").

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-cust-static.test.js tests/field-shell-static.test.js`

Expected: PASS. `node build.mjs` succeeds.

- [ ] **Step 5: Commit**

```bash
git add dist-field-cust.jsx dist-field.css finance-i18n.js server/tests/field-cust-static.test.js
git commit -m "feat(distribusi): Atur titik — move the map under a centre pin (drag anywhere), pin lifts while moving, locate button"
```

---

## Task 10: Verifikasi berdampingan + spesifikasi

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md` (a short "Sesuai yang dibangun (3D-1)" note)

- [ ] **Step 1: Harness at phone size**

In the session scratchpad, make `phone-frame.html`: two 390×844 iframes side by side.
- **Left:** the field harness, `kor-harness.html` style, with `?step=…`.
- **Right:** a static capture of the matching mockup board. Use the mockup screenshots if available; if not, read the board's values instead.

Steps to capture with Chrome headless `--screenshot` (window 900×900):

| Step | Expected |
|---|---|
| (a) Pengiriman | no app bar or banner; eyebrow over the title; Rute and ⋯ glass buttons; latihan chip in latihan |
| (b) Catat menu open | icon discs, light blurred scrim |
| (c) dock after a tab tap | blob mid-travel 150 ms after the tap |
| (d) Stop sheet | frosted .88, grabber zone |
| (e) a task screen (Bayar bon) | glass Batal pill, centred title |
| (f) Atur titik | centre pin, locate button |

Only React #299 may appear in the error log.

- [ ] **Step 2: Full suite alone**

Run (from `server/`, in the background): `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand`

Expected: all suites pass. Between 00:00 and 08:00 WITA, re-run the 9 known date-fragile files with `APP_TZ=UTC`.

- [ ] **Step 3: Build**

Run: `node build.mjs`. Expected: built, no error.

- [ ] **Step 4: Spec note**

Append to the 3D note in §4:

```markdown
- **Sesuai yang dibangun (3D-1):**
  - shell mengembalikan `FIELD.App` layar penuh (`fieldFull`); `theme-color` = #EEF2F6 saat terbuka;
  - `dist-field-icons.jsx` memuat 45 ikon mockup sebagai elemen React;
  - `FldDock` dengan indikator tab cair;
  - `FldTop` berupa pil "Batal" kaca dengan judul di tengah;
  - `FldCtaBar` sebagai CTA tetap (dipakai layar di 3D-2);
  - `useFldSheetDrag`, `swipeTab`, dan Atur titik dengan pin tengah.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md
git commit -m "docs: mode lapangan spec — 3D-1 design foundation as built"
```

---

## Plan 3D-2 (next, written after 3D-1 lands)

Each screen gets re-laid-out to its board, using the 3D-1 foundation (icons, `FldTop`, `FldCtaBar`, `FldCloseX`, materials, motion):

| Screen | Changes |
|---|---|
| Pengiriman | compact rit card with a 6 px progress bar; tappable warning rows with icons; next-stop card with number badge and colour-coded chips; segment-coloured badges; 34 px segmented control |
| Stop sheet | number badge and close X; per-gap action pills; icon contact tiles; two-column facts; icon action list; fixed CTA |
| Transaksi | SVG steppers; total with "after" pill; 76 px photo with stamp; fixed CTA |
| Buka rit, Tambah stop | become sheets; SOP gauge with marker; route-fit bar |
| Peta | full-bleed map, glass header, detent sheet (470/700) |
| Setoran | coloured KPI tiles, "Uang disetor" row, custom reason pickers |
| Pelanggan | floating glass search pill, scrollable chips (`.mlap-hscroll`), round four-tint avatars |
| Lengkapi | mini-map, progress badge |
| Atur titik | full-bleed + glass sheet |
| Bayar bon, Penyesuaian, Ganti rugi, Pengeluaran | mockup layouts + fixed CTA |
| Koreksi | icon tile grid, struck-through → new impact rows |
| Koreksi saya | segments, decision box |
| Armada | SOP bars, Owner badge |
