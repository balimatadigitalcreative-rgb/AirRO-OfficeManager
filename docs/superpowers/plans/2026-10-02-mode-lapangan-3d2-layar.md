# Mode Lapangan 3D-2 — Layar sesuai papan mockup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner chose **Native** (superpowers:executing-plans).

**Goal:** Re-lay out every Mode Lapangan screen to its approved Liquid Glass mockup board, on the 3D-1 foundation already on master (c11a888), and close the nine deferred 3D-1 minors (M5–M13) plus the 3C minors that live on the same screens.

**Architecture:** Presentation only — no server change, no new endpoint, no rule change. Shared pieces are re-drawn once in the kit (`dist-field-kit.jsx`), then each screen function is rewritten to its board using them. New pure helpers go into `dist-field-logic.js` / `dist-field-api.js` (Node-tested). CSS goes into `dist-field.css` as new sections appended after the 3D block (`/* ── 3D-2 … */`), so the 3D-1 material tests keep reading the 3D block.

**Tech Stack:** React 18 UMD, one-scope bundle (`build.mjs` FILES), plain CSS, Jest static tests with `@babel/parser` (server deps only — deploy gate GATE 3), Leaflet 1.9.4 (vendored), OSM tiles (owner's exception).

**Spec:** `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md` (§4 "Rencana 3D" + "Sesuai yang dibangun (3D-1)"). Mockup boards (approved): https://claude.ai/artifact/VELPmw1GNUAFNQ5KXpxj8V — local copies in the session scratchpad `glass-canvas/project/<Board>.dc.html`; every value in this plan was read from those files.

## Global Constraints

- Owner rules (always followed by the new UI): photo mandatory on customer transactions, bon payments, damage charges and expense receipts; ganti rugi needs no approval; expenses always cash from the deposit; every correction needs office approval; pin can be dragged; SOP 80 gallons per rit for all armada, capacity per armada; Catat in the centre of the dock with the liquid-glass animation.
- Bundle: one scope — every new top-level name is unique (`Fld*`, `fld*`, `FLD*`); hooks are `uSfl` / `uEfl` / `uRfl`; text through `trFl`.
- CSS prefix `mlap-`; never touch the old app's classes.
- i18n: every new `fld.*` key exists in EN **and** ID (`finance-i18n.js`, EN block = the line containing `'fld.koreksiT': 'Correct transaction',`, ID block = the line containing `'fld.koreksiT': 'Koreksi transaksi',`). Keys are added by inserting right after those two anchors with the Edit tool.
- Screens use only the adaptor `api` they are given — never `window.API` or `fetch(` (the static tests check this).
- Touch targets stay ≥ 44 px (3C rule, tested): where a board draws a 34–38 px chip or segment, the control keeps `min-height: 44px` and takes every other value from the board.
- Tests run from `server/`: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand <files>`. Never two jest runs at once. Gate every commit on jest's exit code. Between 00:00 and 08:00 WITA nine date-fragile files fail — prove them with `APP_TZ=UTC`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push until the owner asks.

## Decisions made while planning (owner may overrule at review)

1. **Satelit toggle (Atur titik board) is left out.** Satellite imagery needs a second outside tile service (e.g. Esri World Imagery); only OSM was approved (DEPLOY.md). The glass header keeps the back button, a title pill and the locate button. Ask the owner before adding a new tile source.
2. **Setoran and Peta keep the dock.** Both boards are drawn without it, but they are tabs of the dock. Setoran's "Tutup hari & setor" sits fixed just above the dock; Peta's detent sheet sits above the dock.
3. **Ganti rugi price stays the owner's setting** (read-only box in the board's input style). The board shows it editable; the rule says the owner sets it.
4. **Reason pickers (Setoran) open a small sheet** — the board's button cycles through reasons on each tap, a prototype shortcut. Same button look (red until chosen, chevron).
5. **Board sample data that the app does not have is not invented** (e.g. "09.12 · 1 foto" in delivered rows, vehicle model + driver name under each armada). Rows show the real fields we have, in the board's layout.
6. **"3 pelanggan datanya belum lengkap" opens Pelanggan filtered to "Belum lengkap"; "di luar rute" opens Tambah stop** (which lists today's stops without a pin first), or Peta when the account cannot add stops.
7. **Number badges continue across lists** like the board: delivered stops are 1…k, the next stop is k+1, the waiting list continues from there; held stops show "!".
8. **Peta has no back chevron** (the dock is the navigation); its glass bar carries the rit pill, locate and the ⋯ menu (the shell header is hidden on Peta). **Pelanggan has no "+" (new customer)** — the field app does not create customers.
9. **Lengkapi keeps one location photo** (the server stores one) and the WhatsApp field has no "+62" box (numbers stay in the 08… form; `waHref` converts). **Bayar bon has no "Ganti pelanggan" link** — "Batal" returns to where the driver came from.
10. **Koreksi shows a receipt icon tile** where the board shows the delivery photo (the adaptor has no photo fetch yet).

## Review Focus

1. **A long customer name or a long EN string** in a 38 px badge row, a 22 px heading or the centred task title — must ellipsize or wrap, never push the close/back control off-screen (M10 widened the side columns; check Stop sheet head, FldCustHead, next-stop card at 320 px wide).
2. **Fixed bottom bars over content** — on every screen with `FldCtaBar` (and the Setoran bar above the dock) the last card must be reachable by scrolling, not hidden under the bar or the fade (root `padding-bottom`, `.mlap-ctaspace`).
3. **Sheets that became tall (Stop, Buka/Tutup rit, Tambah stop)** — pull-to-close still works from the grabber, the inner body scrolls on a short phone (iPhone SE 667 px), and the keyboard opening on the "Lainnya" field does not hide the CTA.
4. **Reduced transparency / reduced motion** — every new glass surface (`.mlap-glass`, search pill, map sheet, pickers) turns solid; the new bar/gauge transitions stop.
5. **Swipe between tabs vs. sideways scrollers** — the new Pelanggan chip row (`.mlap-hscroll`) and the Peta map must never switch tabs; an edge start (≤ 20 px) never switches tabs (M8).

## How each screen is checked against its board (used by every screen task)

The executor renders the new screen and the board at 390 × 844 and compares them side by side. This is a scratch tool, not committed:

1. `node build.mjs` (prints the bundle name `dist/app.<hash>.js`).
2. The session scratchpad holds `p3d-harness.html` (mock `window.API`, renders `window.FIELD.App` at a `?step=` state) and `phone.html` (a 390 × 844 iframe around it). Update the bundle name in `p3d-harness.html`; add a `step` for the screen if it has none (open the view the task names).
3. Serve the repo at `/app/` and the scratchpad at `/h/` with any static server, then Chrome headless: `chrome --headless=new --window-size=430,900 --virtual-time-budget=4000 --screenshot=<out>.png "http://localhost:<port>/h/phone.html?step=<step>"`. Render the board the same way (`/h/glass-canvas/project/<Board>.dc.html`, it carries its own support script).
4. Read both PNGs. List every difference in chrome, materials, spacing, type size/weight, colour, icons. Fix each one, or write it in the ledger as `Ruling:` when it is one of the decisions above. The task is not done until the list is empty or ruled.

---

## File Structure

| File | Responsibility in 3D-2 |
|---|---|
| `dist-field-kit.jsx` | Shared pieces re-drawn to the boards: `FldStepper` (SVG −/+, `cls`), `FldSeg` (`size`), `FldChips` (`tone`), `FldNotice` (icon, `alert`), `FldPhoto` (photo card), `FldMoney` (30 px amount); new `FldCustHead`, `FldSheetHead`, `FldPickSheet`. |
| `dist-field-day.jsx` | Pengiriman, Detail stop, Transaksi, Buka/Tutup rit (now a sheet), Peta, Setoran — rewritten to their boards. |
| `dist-field-cust.jsx` | Pelanggan + customer sheet, Lengkapi, Atur titik, Tambah stop (now a sheet), Bayar bon, Penyesuaian, Ganti rugi, Pengeluaran. |
| `dist-field-koreksi.jsx` | Koreksi (txn card, tile grid, impact rows), Koreksi saya (two segments, from→to, decision box). |
| `dist-field.jsx` | Shell: scroll reset (M6), edge-swipe guard (M8), latihan chip role (M11), Pelanggan filter hand-off, Setoran title; `FldRules` → Armada & SOP board. |
| `dist-field-logic.js` | New pure helpers: `loadPct`, `swipeStart`, `koreksiTabs`, `requestView().change`, `loadPreview().bar`. |
| `dist-field-api.js` | New pure helpers: `sessionPrefs` (M5), `bootWait` (M13). |
| `finance-shell.jsx` | M5 (old-view choice cleared on logout), M13 (no finance flash while the rules load), `FldRules` gets `onBack`. |
| `dist-field.css` | New sections `3D-2 KIT`, `3D-2 PENGIRIMAN`, `3D-2 STOP`, `3D-2 TRANSAKSI`, `3D-2 RIT`, `3D-2 PETA`, `3D-2 SETORAN`, `3D-2 PELANGGAN`, `3D-2 LENGKAPI`, `3D-2 INPUT`, `3D-2 KOREKSI`, `3D-2 ARMADA`, appended at the end of the file in task order. |
| `finance-i18n.js` | New `fld.*` keys (EN + ID) per task. |
| `server/tests/field-3d2-kit.test.js` | New — kit + chrome minors (Task 1). |
| `server/tests/field-3d2-day.test.js` | New — day screens (Tasks 4–9). |
| `server/tests/field-3d2-cust.test.js` | New — customer + input screens (Tasks 10–13). |
| `server/tests/field-3d2-koreksi.test.js` | New — Koreksi, Koreksi saya, Armada (Tasks 14–16). |
| existing `server/tests/field-*.test.js` | Assertions that pin markup a task replaces are updated in that task (each task lists them). |

---

### Task 1: Kit pieces re-drawn to the boards + chrome minors (M9, M10, M12, error notices)

**Files:**
- Modify: `dist-field-kit.jsx` (`FldStepper`, `FldSeg`, `FldChips`, `FldNotice`, `FldPhoto`, `FldMoney`; add `FldCustHead`, `FldSheetHead`, `FldPickSheet`)
- Modify: `dist-field-day.jsx`, `dist-field-cust.jsx`, `dist-field-koreksi.jsx` (load-error notices get `alert`)
- Modify: `dist-field.css` (append section `3D-2 KIT`)
- Modify: `finance-i18n.js`
- Create: `server/tests/field-3d2-kit.test.js`

**Interfaces:**
- Produces (used by every later task):
  - `FldStepper({ label, hint, value, onChange, min, max, cls })` — `cls` is extra classes on `.mlap-stepper`: `'big'`, `'big under'`, `'teal'`.
  - `FldSeg({ label, options, value, onChange, size })` — `size: 'sm'` for list filters.
  - `FldChips({ options, otherLabel, value, onChange, tone })` — `tone: 'hold' | 'warn' | 'danger'` (default blue).
  - `FldNotice({ tone, title, sub, action, onAction, alert })` — `alert` → `role="alert"`, else `role="note"`.
  - `FldPhoto({ api, value, onChange, hintKey, title, req, w, h, optional })` — `w`/`h` tile size (default 76), `req` the red label text, `optional` → grey "Disarankan" and no red outline.
  - `FldMoney({ label, value, onChange })` — same API, new look.
  - `FldCustHead({ name, sub, aside })`, `FldSheetHead({ title, sub, lead, onClose, big })`, `FldPickSheet({ title, options, value, onPick, onClose })`.
  - CSS utility classes: `.mlap-label` (section label), `.mlap-kv` / `.mlap-kv.total` (key–value rows), `.mlap-hscroll`, `.mlap-glass`, `.mlap-nbig` (38 px number), `.mlap-pickbtn` (+`.miss`), `.mlap-radio`, `.mlap-sheet.tall` (+`.mid`), `.mlap-sheet-body`, `.mlap-sheet-cta`, `.mlap-ctaspace`, `.mlap-ctahint .ok` / `.muted`, `.mlap-btn` icon gap.

- [ ] **Step 1: Write the failing test** — create `server/tests/field-3d2-kit.test.js`:

```js
'use strict';
// PLAN 3D-2 KIT (static): the shared field pieces re-drawn to the approved mockup boards — SVG steppers,
// the segmented control, chip tones, the photo card, customer/sheet heads, the big money field, notices
// with an icon (errors announced), the list picker sheet — and the 3D-1 chrome minors M9, M10, M12.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const kit = read('dist-field-kit.jsx'); const css = read('dist-field.css');
const fn = (name) => { const i = kit.indexOf('function ' + name + '('); expect(i).toBeGreaterThan(-1); const j = kit.indexOf('\nfunction ', i + 10); return kit.slice(i, j < 0 ? undefined : j); };
const block = css.slice(css.indexOf('/* ── 3D-2 KIT'));
const rule = (sel) => { const i = block.indexOf('\n' + sel + ' {'); expect({ sel, found: i > -1 }).toEqual({ sel, found: true }); return block.slice(i, block.indexOf('}', i)); };

it('parses; the 3D-2 CSS section exists', () => {
  expect(() => parse(kit, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(css.indexOf('/* ── 3D-2 KIT')).toBeGreaterThan(css.indexOf('/* ── LIQUID GLASS (3D)'));
});
describe('stepper (boards Transaksi, Buka rit, Armada)', () => {
  it('draws − and + as SVG; + is the tinted one; a class picks the big / under / teal variants', () => {
    const f = fn('FldStepper');
    expect(f).toMatch(/function FldStepper\(\{ label, hint, value, onChange, min, max, cls \}\)/);
    expect(f).toMatch(/className="mlap-step minus"[\s\S]*?<FldSvg n="minus"/);
    expect(f).toMatch(/className="mlap-step plus"[\s\S]*?<FldSvg n="plus"/);
    expect(f).toMatch(/className=\{'mlap-stepper' \+ \(cls \? ' ' \+ cls : ''\)\}/);
    expect(f).toMatch(/FIELDLOGIC\.stepInput\(/);   // typing still clears and clamps
    expect(rule('.mlap-step')).toMatch(/background: #E8EEF3;/);
    expect(rule('.mlap-step.plus')).toMatch(/background: #E8F1F8; color: #065489;/);
    expect(rule('.mlap-stepper.teal .mlap-step.plus')).toMatch(/background: #DDF4F2; color: #0F6B66;/);
    expect(rule('.mlap-stepper.big input.mlap-stepval')).toMatch(/font-size: 44px;[\s\S]*color: #0F6B66;/);
    expect(rule('.mlap-stepper.big.under input.mlap-stepval')).toMatch(/color: #9A3412;/);
  });
});
describe('segmented control + chips', () => {
  it('segmented: #DDE4EA track with 2px padding, white thumb; a small size for list filters', () => {
    expect(fn('FldSeg')).toMatch(/function FldSeg\(\{ label, options, value, onChange, size \}\)/);
    expect(fn('FldSeg')).toMatch(/className=\{'mlap-seg' \+ \(size \? ' ' \+ size : ''\)\}/);
    expect(rule('.mlap-seg')).toMatch(/padding: 2px;[\s\S]*border-radius: 11px; background: #DDE4EA;/);
    expect(rule('.mlap-seg.sm .mlap-seg-b')).toMatch(/font-size: 13px;/);
  });
  it('a picked chip is blue; hold reasons amber; under-SOP reasons orange; a cancel red', () => {
    expect(fn('FldChips')).toMatch(/function FldChips\(\{ options, otherLabel, value, onChange, tone \}\)/);
    expect(fn('FldChips')).toMatch(/className=\{'mlap-chips' \+ \(tone \? ' ' \+ tone : ''\)\}/);
    expect(rule('.mlap-chip-b.on')).toMatch(/border-color: #065489; background: #E8F1F8; color: #065489;/);
    expect(rule('.mlap-chips.hold .mlap-chip-b.on')).toMatch(/border-color: #9A5B00; background: #FCF1D6; color: #7A4B00;/);
    expect(rule('.mlap-chips.warn .mlap-chip-b.on')).toMatch(/border-color: #C2410C;[\s\S]*inset 0 0 0 1px #C2410C/);
    expect(rule('.mlap-chips.danger .mlap-chip-b.on')).toMatch(/border-color: #B42318; background: #FDECEA; color: #8C2A20;/);
  });
});
describe('photo card (boards Transaksi, Bayar bon, Pengeluaran, Ganti rugi)', () => {
  const f = () => fn('FldPhoto');
  it('title + red "Wajib" label, the stamped thumbnail beside a dashed camera tile, the hint beside', () => {
    expect(f()).toMatch(/function FldPhoto\(\{ api, value, onChange, hintKey, title, req, w, h, optional \}\)/);
    expect(f()).toMatch(/<span className="mlap-photo-thumb" style=\{\{ width: pw, height: ph \}\}><img src=\{value\.preview\}/);
    expect(f()).toMatch(/<span className="mlap-stamp">\{stamp\}<\/span>/);
    expect(f()).toMatch(/className=\{'mlap-cam' \+ \(missing \? ' miss' : ''\)\}/);
    expect(f()).toMatch(/<FldSvg n="camera" s=\{20\} \/>/);
    expect(rule('.mlap-cam')).toMatch(/border: 1\.5px dashed #AFC0CB; background: #F5F8FA; color: #065489;/);
    expect(rule('.mlap-cam.miss')).toMatch(/border-color: #C2410C; background: #FFF4EE; color: #9A3412;/);
    expect(rule('.mlap-stamp')).toMatch(/background: rgba\(14,27,36,\.62\);/);
    expect(rule('.mlap-photo-req')).toMatch(/font-size: 12px; font-weight: 700; color: #9A3412;/);
  });
  it('still the rear camera, shrunk, uploaded through the adaptor, stamped with time + GPS', () => {
    expect(f()).toMatch(/capture="environment"/);
    expect(f()).toMatch(/shrinkToJpeg\(img\)/);
    expect(f()).toMatch(/api\.uploadPhoto\(/);
    expect(f()).toMatch(/fldGeo\(8000\)/);
  });
});
describe('heads, money, notices, picker', () => {
  it('customer head 22/28 bold; sheet head with the glass close X', () => {
    expect(fn('FldCustHead')).toMatch(/className="mlap-custhead-nm"/);
    expect(rule('.mlap-custhead-nm')).toMatch(/font-size: 22px; line-height: 28px; font-weight: 700;/);
    expect(fn('FldSheetHead')).toMatch(/<FldCloseX onClick=\{onClose\} \/>/);
    expect(rule('.mlap-sheethd-t')).toMatch(/font-size: 19px; line-height: 24px; font-weight: 700;/);
  });
  it('the money field is the big 30 px amount after "Rp"', () => {
    expect(fn('FldMoney')).toMatch(/className="mlap-money-val"/);
    expect(fn('FldMoney')).toMatch(/toLocaleString\('id-ID'\)/);
    expect(rule('.mlap-money-val')).toMatch(/font-size: 30px; font-weight: 700;/);
  });
  it('notices carry an icon; an error is announced (role alert), the rest are notes', () => {
    expect(fn('FldNotice')).toMatch(/function FldNotice\(\{ tone, title, sub, action, onAction, alert \}\)/);
    expect(fn('FldNotice')).toMatch(/role=\{alert \? 'alert' : 'note'\}/);
    expect(fn('FldNotice')).toMatch(/<FldSvg n=\{t === 'warn' \? 'warn' : t === 'ok' \? 'check' : 'info'\}/);
  });
  it('every load-error notice in the field screens is announced (3C minor)', () => {
    ['dist-field-day.jsx', 'dist-field-cust.jsx', 'dist-field-koreksi.jsx', 'dist-field-kit.jsx'].forEach((f) => {
      const src = read(f);
      const all = (src.match(/<FldNotice [^\n]*?title=\{trFl\('fld\.loadErr'\)\}/g) || []);
      all.forEach((m) => expect({ f, m }).toEqual({ f, m: m.replace('<FldNotice tone="warn" title=', '<FldNotice tone="warn" alert title=') }));
    });
  });
  it('a list choice opens a sheet (no <select>) with the drag-to-close grabber', () => {
    const f = fn('FldPickSheet');
    expect(f).toMatch(/const drag = useFldSheetDrag\(onClose\);/);
    expect(f).toMatch(/<FldGrab handle=\{drag\.handle\} \/>/);
    expect(f).toMatch(/className=\{'mlap-pickrow' \+ \(value === o \? ' on' : ''\)\} aria-pressed=\{value === o\}/);
    expect(rule('.mlap-pickrow.on .mlap-radio')).toMatch(/border: 6px solid #065489;/);
    expect(rule('.mlap-pickbtn.miss')).toMatch(/border: 1\.5px solid #C2410C; background: #FFF4EE; color: #9A3412;/);
  });
  it('tall sheets (Stop / Tambah stop at 84 px, Buka rit at 118 px) scroll inside, CTA fixed at the bottom', () => {
    expect(rule('.mlap-sheet.tall')).toMatch(/top: calc\(84px \+ env\(safe-area-inset-top\)\);[\s\S]*max-height: none;/);
    expect(rule('.mlap-sheet.tall.mid')).toMatch(/top: calc\(118px \+ env\(safe-area-inset-top\)\);/);
    expect(rule('.mlap-sheet-body')).toMatch(/overflow-y: auto;/);
    expect(rule('.mlap-sheet-cta')).toMatch(/padding: 8px 16px calc\(28px \+ env\(safe-area-inset-bottom\)\);/);
  });
  it('a disabled fixed CTA is the board\'s flat gray, not a faded blue', () => {
    expect(rule('.mlap-ctabar .mlap-btn.primary:disabled, .mlap-sheet-cta .mlap-btn.primary:disabled')).toMatch(/opacity: 1; background: #C9D3DA; color: #4A5A64; box-shadow: none;/);
  });
});
describe('Review Focus guards (kit)', () => {
  it('long names wrap instead of pushing the close / back control off-screen', () => {
    expect(rule('.mlap-custhead-nm')).toMatch(/overflow-wrap: anywhere;/);
    expect(rule('.mlap-sheethd-t')).toMatch(/overflow-wrap: anywhere;/);
  });
  it('the last card clears the fixed bars (root bottom padding stays); reduced motion still stops everything', () => {
    expect(css).toMatch(/.mlap-root {[^}]*padding: 0 0 calc(130px + env(safe-area-inset-bottom));/);
    expect(rule('.mlap-ctaspace')).toMatch(/height: 72px;/);
    expect(css).toMatch(/@media (prefers-reduced-motion: reduce) {s*.mlap-root */);
  });
});
describe('3D-1 deferred minors (chrome)', () => {
  it('M9: a Catat tile still springs when pressed (its entrance no longer holds the transform)', () => {
    expect(rule('.mlap-tile')).toMatch(/animation-fill-mode: backwards;/);
  });
  it('M10: the top fade never catches taps; side columns grow for a longer "Cancel"', () => {
    expect(rule('.mlap-top')).toMatch(/grid-template-columns: minmax\(70px, 1fr\) minmax\(0, auto\) minmax\(70px, 1fr\);/);
    expect(rule('.mlap-top')).toMatch(/pointer-events: none;/);
    expect(rule('.mlap-top > *')).toMatch(/pointer-events: auto;/);
  });
  it('M12: every glass piece turns solid when the phone asks for less transparency', () => {
    const rt = css.slice(css.lastIndexOf('@media (prefers-reduced-transparency: reduce)'));
    ['.mlap-pill', '.mlap-closex', '.mlap-tile', '.mlap-glass', '.mlap-searchpill', '.mlap-mapsheet', '.mlap-pinsheet'].forEach((s) => expect(rt).toContain(s));
    expect(rt).toMatch(/\.mlap-scrim\.menu \{[^}]*backdrop-filter: none !important;/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run (from `server/`): `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-kit.test.js`
Expected: FAIL — the first test fails on the missing `/* ── 3D-2 KIT` section; the kit tests fail on the old signatures (`FldStepper({ label, hint, value, onChange, min, max })`, no `FldCustHead`).

- [ ] **Step 3: Replace the kit pieces** in `dist-field-kit.jsx`.

Replace the whole `FldStepper` function (comment above it included) with:

```jsx
// The number can be cleared and retyped (a typed "4" never becomes "14"); it clamps when the field
// is left. The −/+ buttons always step from the last valid value. Drawn like the boards: a gray −, a
// tinted +, the value between. `cls`: 'big' (Buka rit's 44 px load), 'under' (below SOP), 'teal' (+).
function FldStepper({ label, hint, value, onChange, min, max, cls }) {
  const lo = min == null ? 0 : min; const hi = max == null ? 999 : max;
  const [draft, setDraft] = uSfl(null);   // the text while typing; null = show the value
  const set = (v) => { setDraft(null); onChange(Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)))); };
  const typed = (text) => { const r = FIELDLOGIC.stepInput(text, lo, hi); setDraft(r.draft); if (r.value != null) onChange(r.value); };
  const leave = () => { if (draft === null) return; const r = FIELDLOGIC.stepInput(draft, lo, hi); setDraft(null); onChange(r.value != null ? r.value : lo); };
  const ico = cls && cls.split(' ').indexOf('big') >= 0 ? 18 : 16;
  return (
    <div className={'mlap-stepper' + (cls ? ' ' + cls : '')}>
      <span className="lb">{label}{hint ? <span className="ht">{hint}</span> : null}</span>
      <button type="button" className="mlap-step minus" aria-label={trFl('fld.less') + ' — ' + label} disabled={value <= lo} onClick={() => set(value - 1)}><FldSvg n="minus" s={ico} sw={2.6} /></button>
      <input className="mlap-stepval" inputMode="numeric" aria-label={label} value={draft !== null ? draft : value} onChange={(e) => typed(e.target.value)} onBlur={leave} />
      <button type="button" className="mlap-step plus" aria-label={trFl('fld.more') + ' — ' + label} disabled={value >= hi} onClick={() => set(value + 1)}><FldSvg n="plus" s={ico} sw={2.6} /></button>
    </div>
  );
}
```

Replace `FldSeg`:

```jsx
function FldSeg({ label, options, value, onChange, size }) {
  return (
    <div className={'mlap-seg' + (size ? ' ' + size : '')} role="group" aria-label={label}>
      {options.map(([k, text]) => <button key={k} type="button" aria-pressed={value === k} className={'mlap-seg-b' + (value === k ? ' on' : '')} onClick={() => onChange(k)}>{text}</button>)}
    </div>
  );
}
```

In `FldChips`, change the signature to `function FldChips({ options, otherLabel, value, onChange, tone }) {` and its wrapper to `<div className={'mlap-chips' + (tone ? ' ' + tone : '')}>` (everything else unchanged).

Replace `FldNotice`:

```jsx
// A standing notice (mockup info/warn cards): icon, title, one line. `alert` only for errors — a standing
// notice must not interrupt a screen reader.
function FldNotice({ tone, title, sub, action, onAction, alert }) {
  const t = tone || 'info';
  return (
    <div className={'mlap-notice ' + t} role={alert ? 'alert' : 'note'}>
      <FldSvg n={t === 'warn' ? 'warn' : t === 'ok' ? 'check' : 'info'} s={16} sw={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
      <span className="mlap-grow"><b>{title}</b>{sub ? <span className="sb">{sub}</span> : null}</span>
      {action && onAction ? <button type="button" className="mlap-btn" onClick={onAction}>{action}</button> : null}
    </div>
  );
}
```

Replace `FldPhoto` (its comment block included):

```jsx
// PROOF PHOTO (mockup photo card) — rear camera, shrunk to ≤1024 px (the app's shrinkToJpeg), uploaded
// through the adaptor (practice photos stay on the phone), stamped with the time and, when the phone
// gives one, a GPS fix. Gallery photos can't be blocked on the web; the stamp records when/where it was
// attached. Card: title + red "Wajib …" label, the stamped thumbnail, a dashed camera tile, the hint.
function FldPhoto({ api, value, onChange, hintKey, title, req, w, h, optional }) {
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
  const pw = w || 76; const ph = h || pw;
  const missing = !value && !optional;
  return (
    <div className={'mlap-card mlap-photo' + (missing ? ' miss' : '')}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
      <div className="mlap-photo-hd"><b>{title || trFl('fld.proof')}</b><span className={'mlap-photo-req' + (optional ? ' opt' : '')}>{req || trFl(optional ? 'fld.reqSuggest' : 'fld.reqPlain')}</span></div>
      <div className="mlap-photo-row">
        {value ? <span className="mlap-photo-thumb" style={{ width: pw, height: ph }}><img src={value.preview} alt={trFl('fld.photoTaken')} /><span className="mlap-stamp">{stamp}</span></span> : null}
        <button type="button" className={'mlap-cam' + (missing ? ' miss' : '')} style={{ width: pw, height: ph }} disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>
          <FldSvg n="camera" s={20} />{busy ? trFl('fld.photoBusy') : value ? trFl('fld.retake') : trFl('fld.cam')}
        </button>
        <span className="mlap-photo-hint">{trFl(hintKey || 'fld.proofHint')}</span>
      </div>
      {err && <div className="mlap-err" role="alert">{err}</div>}
    </div>
  );
}
```

Replace `FldMoney` (its comment included):

```jsx
// Rupiah amount (mockup Bayar bon / Pengeluaran): a big 30 px number after "Rp"; shows 45.000, can be
// cleared while typing (value null = nothing typed yet).
function FldMoney({ label, value, onChange }) {
  const shown = value == null ? '' : Number(value).toLocaleString('id-ID');
  return (
    <label className="mlap-money">
      <span className="lb">{label}</span>
      <span className="mlap-money-in"><span className="rp" aria-hidden="true">Rp</span>
        <input className="mlap-money-val" inputMode="numeric" aria-label={label} value={shown} onChange={(e) => { const d = String(e.target.value).replace(/[^0-9]/g, '').slice(0, 10); onChange(d === '' ? null : parseInt(d, 10)); }} />
      </span>
    </label>
  );
}
```

Add after `FldCloseX`:

```jsx
// A task screen's customer (mockup Transaksi / Bayar bon / Lengkapi): the name at 22 px, one sub line,
// an optional item on the right (a progress badge, "Ganti pelanggan").
function FldCustHead({ name, sub, aside }) {
  return (
    <div className="mlap-custhead">
      <span className="mlap-grow"><span className="mlap-custhead-nm">{name}</span>{sub ? <span className="mlap-custhead-sb">{sub}</span> : null}</span>
      {aside || null}
    </div>
  );
}

// A sheet's head (mockup Stop / Buka rit / Tambah stop): optional lead (the 38 px stop number), the
// title, one sub line, the glass close X.
function FldSheetHead({ title, sub, lead, onClose, big }) {
  return (
    <div className={'mlap-sheethd' + (big ? ' big' : '')}>
      {lead || null}
      <span className="mlap-grow"><span className="mlap-sheethd-t">{title}</span>{sub ? <span className="mlap-sheethd-sb">{sub}</span> : null}</span>
      <FldCloseX onClick={onClose} />
    </div>
  );
}

// A list choice in a sheet (instead of a <select>, which the boards never show): radio rows.
function FldPickSheet({ title, options, value, onPick, onClose }) {
  const drag = useFldSheetDrag(onClose);
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={title} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
        <FldSheetHead title={title} onClose={onClose} />
        <div className="mlap-card mlap-picklist">
          {options.map((o) => (
            <button key={o} type="button" className={'mlap-pickrow' + (value === o ? ' on' : '')} aria-pressed={value === o} onClick={() => onPick(o)}>
              <span className="mlap-radio" aria-hidden="true" /><span className="mlap-grow">{o}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Announce every load error** — run this once from the repo root (a scratch script; adds ` alert` to the existing load-error notices):

```bash
node -e "for (const f of ['dist-field-day.jsx','dist-field-cust.jsx','dist-field-koreksi.jsx','dist-field-kit.jsx']) { const fs=require('fs'); const s=fs.readFileSync(f,'utf8'); const n=s.split('<FldNotice tone=\"warn\" title={trFl(\'fld.loadErr\')}').join('<FldNotice tone=\"warn\" alert title={trFl(\'fld.loadErr\')}'); if (n!==s) fs.writeFileSync(f,n); console.log(f, (n.match(/ alert title=\{trFl\('fld\.loadErr'\)\}/g)||[]).length); }"
```

Expected: day 4, cust 2, koreksi 2, kit 1 (non-zero for each file that has one). If the shell quoting fails on Windows, write it as `scratchpad/alert.js` and run `node alert.js` (same body).

- [ ] **Step 5: Append the CSS** at the end of `dist-field.css`:

```css
/* ── 3D-2 KIT — shared pieces re-drawn to the approved mockup boards ── */
.mlap-step { width: 44px; height: 44px; padding: 0; border-radius: 50%; border: 0; display: grid; place-items: center; background: #E8EEF3; color: var(--mlap-ink); cursor: pointer; }
.mlap-step.plus { background: #E8F1F8; color: #065489; }
.mlap-stepper.teal .mlap-step.plus { background: #DDF4F2; color: #0F6B66; }
input.mlap-stepval { width: 40px; font-size: 24px; }
.mlap-stepper.big { flex-wrap: wrap; justify-content: center; gap: 8px 18px; padding: 12px; border: 0; }
.mlap-stepper.big .lb { flex: 0 0 100%; text-align: center; font-size: 14px; font-weight: 600; color: var(--mlap-sub); }
.mlap-stepper.big .mlap-step { width: 48px; height: 48px; }
.mlap-stepper.big input.mlap-stepval { width: 88px; font-size: 44px; line-height: 48px; letter-spacing: -.03em; color: #0F6B66; transition: color .25s ease; }
.mlap-stepper.big.under input.mlap-stepval { color: #9A3412; }
.mlap-seg { padding: 2px; gap: 2px; border-radius: 11px; background: #DDE4EA; }
.mlap-seg-b { border-radius: 9px; }
.mlap-seg.sm { border-radius: 10px; }
.mlap-seg.sm .mlap-seg-b { border-radius: 8px; font-size: 13px; }
.mlap-chip-b { border-radius: 22px; }
.mlap-chip-b.on { border-color: #065489; background: #E8F1F8; color: #065489; }
.mlap-chips.hold .mlap-chip-b.on { border-color: #9A5B00; background: #FCF1D6; color: #7A4B00; }
.mlap-chips.warn .mlap-chip-b { border-color: #F0CDB6; background: rgba(255,255,255,.55); }
.mlap-chips.warn .mlap-chip-b.on { border-color: #C2410C; background: #FFFFFF; color: #9A3412; box-shadow: inset 0 0 0 1px #C2410C; }
.mlap-chips.danger .mlap-chip-b.on { border-color: #B42318; background: #FDECEA; color: #8C2A20; }
.mlap-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.mlap-photo { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.mlap-photo.miss { box-shadow: inset 0 0 0 1.5px #F4C7A8; }
.mlap-photo-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.mlap-photo-hd b { font-size: 15px; font-weight: 600; }
.mlap-photo-req { font-size: 12px; font-weight: 700; color: #9A3412; }
.mlap-photo-req.opt { color: var(--mlap-sub); font-weight: 600; }
.mlap-photo-row { display: flex; gap: 8px; align-items: center; }
.mlap-photo-thumb { position: relative; flex-shrink: 0; border-radius: 12px; overflow: hidden; background: #C9D6DE; }
.mlap-photo-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mlap-stamp { position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 5px; background: rgba(14,27,36,.62); color: #FFFFFF; font-size: 10px; font-weight: 600; }
.mlap-cam { flex-shrink: 0; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 0 4px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; border: 1.5px dashed #AFC0CB; background: #F5F8FA; color: #065489; }
.mlap-cam.miss { border-color: #C2410C; background: #FFF4EE; color: #9A3412; }
.mlap-photo-hint { flex: 1; min-width: 0; font-size: 12px; line-height: 16px; color: var(--mlap-sub); }
.mlap-custhead { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
.mlap-custhead-nm { font-size: 22px; line-height: 28px; font-weight: 700; overflow-wrap: anywhere; }
.mlap-custhead-sb { font-size: 13px; color: var(--mlap-sub); }
.mlap-sheethd { display: flex; align-items: center; gap: 10px; }
.mlap-sheethd-t { font-size: 19px; line-height: 24px; font-weight: 700; overflow-wrap: anywhere; }
.mlap-sheethd.big .mlap-sheethd-t { font-size: 20px; }
.mlap-sheethd-sb { font-size: 13px; color: var(--mlap-sub); }
.mlap-money { display: flex; flex-direction: column; gap: 4px; padding: 12px; border-radius: 16px; }
.mlap-money:focus-within { box-shadow: inset 0 0 0 2px #065489; }
.mlap-money .lb { font-size: 13px; font-weight: 600; color: var(--mlap-sub); }
.mlap-money-in { display: flex; align-items: baseline; gap: 6px; }
.mlap-money-in .rp { font-size: 20px; font-weight: 600; color: var(--mlap-sub); }
.mlap-money-val { flex: 1; min-width: 0; border: 0; padding: 0; font: inherit; font-size: 30px; font-weight: 700; letter-spacing: -.01em; background: transparent; color: var(--mlap-ink); outline: none; font-variant-numeric: tabular-nums; }
.mlap-notice { align-items: flex-start; padding: 10px 12px; font-size: 13px; line-height: 17px; }
.mlap-notice b { font-size: 14px; font-weight: 700; }
.mlap-notice.info { background: #E8F1F8; color: #06334F; }
.mlap-notice.info > svg { color: #065489; }
.mlap-notice .mlap-btn { padding: 0 12px; background: #FFFFFF; font-size: 13px; font-weight: 700; color: inherit; align-self: center; }
.mlap-label { font-size: 12px; font-weight: 600; letter-spacing: .03em; color: var(--mlap-sub); text-transform: uppercase; padding: 0 4px; }
.mlap-kv { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 12px; border-bottom: 1px solid var(--mlap-line); font-size: 14px; }
.mlap-kv:last-child { border-bottom: 0; }
.mlap-kv > span:first-child { color: #3E4E58; }
.mlap-kv b { font-weight: 600; font-variant-numeric: tabular-nums; }
.mlap-kv.total { min-height: 48px; background: #F4F8FB; }
.mlap-kv.total > span:first-child { font-size: 15px; font-weight: 700; color: var(--mlap-ink); }
.mlap-kv.total b { font-size: 20px; font-weight: 700; }
.mlap-hscroll { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 0 -16px; padding: 0 16px; }
.mlap-hscroll::-webkit-scrollbar { display: none; }
.mlap-glass { background: rgba(255,255,255,.62); -webkit-backdrop-filter: blur(24px) saturate(1.6); backdrop-filter: blur(24px) saturate(1.6); border: 1px solid rgba(255,255,255,.85); box-shadow: 0 6px 20px rgba(6,51,79,.16), inset 0 1px 0 rgba(255,255,255,.9); }
.mlap-nbig { width: 38px; height: 38px; border-radius: 12px; flex-shrink: 0; display: grid; place-items: center; background: #065489; color: #FFFFFF; font-size: 16px; font-weight: 700; }
.mlap-pickbtn { flex: 1; min-width: 0; min-height: 44px; border-radius: 10px; padding: 0 10px; display: flex; align-items: center; justify-content: space-between; gap: 6px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid #D5DDE3; background: #F7F9FA; color: var(--mlap-ink); text-align: left; }
.mlap-pickbtn.miss { border: 1.5px solid #C2410C; background: #FFF4EE; color: #9A3412; }
.mlap-picklist { margin-top: 10px; }
.mlap-pickrow { width: 100%; min-height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 0; border-bottom: 1px solid var(--mlap-line); background: #FFFFFF; font: inherit; font-size: 15px; color: var(--mlap-ink); text-align: left; cursor: pointer; }
.mlap-pickrow:last-child { border-bottom: 0; }
.mlap-pickrow.on { background: #F4F8FB; }
.mlap-radio { width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; box-sizing: border-box; border: 1.5px solid #AFC0CB; background: #FFFFFF; }
.mlap-pickrow.on .mlap-radio { border: 6px solid #065489; }
.mlap-sheet.tall { top: calc(84px + env(safe-area-inset-top)); max-height: none; display: flex; flex-direction: column; padding: 8px 0 0; overflow: hidden; }
.mlap-sheet.tall.mid { top: calc(118px + env(safe-area-inset-top)); }
.mlap-sheet.tall .mlap-grabzone { margin: -8px 0 0; }
.mlap-sheet.tall > .mlap-sheethd { padding: 2px 16px 0; }
.mlap-sheet-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 10px 16px 12px; display: flex; flex-direction: column; gap: 10px; }
.mlap-sheet-cta { padding: 8px 16px calc(28px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 6px; }
.mlap-sheet-cta .mlap-btn { min-height: 48px; border-radius: 14px; width: 100%; font-size: 16px; }
.mlap-ctabar .mlap-btn.primary:disabled, .mlap-sheet-cta .mlap-btn.primary:disabled { opacity: 1; background: #C9D3DA; color: #4A5A64; box-shadow: none; }
.mlap-ctahint .ok { color: #1E6B40; }
.mlap-ctahint .muted { font-size: 12px; font-weight: 400; color: #3E4E58; }
.mlap-ctaspace { height: 72px; flex-shrink: 0; }
.mlap-top { grid-template-columns: minmax(70px, 1fr) minmax(0, auto) minmax(70px, 1fr); pointer-events: none; }
.mlap-top > * { pointer-events: auto; }
.mlap-tile { animation-fill-mode: backwards; }
@media (prefers-reduced-transparency: reduce) {
  .mlap-pill, .mlap-closex, .mlap-tile, .mlap-glass, .mlap-searchpill, .mlap-mapsheet, .mlap-pinsheet { background: var(--mlap-surface) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
  .mlap-scrim.menu { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
}
```

- [ ] **Step 6: Add the i18n keys.** With the Edit tool, after `'fld.koreksiT': 'Correct transaction',` insert:

```
 'fld.cam': 'Camera', 'fld.reqPlain': 'Required', 'fld.reqSuggest': 'Recommended', 'fld.reqCash': 'Required · cash / receipt', 'fld.reqTf': 'Required · transfer proof', 'fld.reqBon': 'Required · gallons received',
```

and after `'fld.koreksiT': 'Koreksi transaksi',` insert:

```
 'fld.cam': 'Kamera', 'fld.reqPlain': 'Wajib', 'fld.reqSuggest': 'Disarankan', 'fld.reqCash': 'Wajib · uang / nota', 'fld.reqTf': 'Wajib · bukti transfer', 'fld.reqBon': 'Wajib · galon diterima',
```

- [ ] **Step 7: Run the new test and the existing field suite**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-kit.test.js tests/field-kit-static.test.js tests/field-day-static.test.js tests/field-cust-static.test.js tests/field-koreksi-static.test.js tests/field-shell-static.test.js`
Expected: PASS. If an older assertion pins a kit piece's previous markup (e.g. a `FldStepper` with text `−`, `mlap-photo-btn`, `className="mlap-field mlap-money"`), update it to the new markup in this commit, keeping the rule it guards, and ledger it as `Ruling: <test> pinned superseded kit markup — updated to the 3D-2 contract`.

- [ ] **Step 8: Side-by-side check** — build, then render `?step=sale` (Transaksi uses stepper, segment, photo card) next to `Transaksi.dc.html`; compare only the kit pieces (stepper buttons, segment track, photo card, notice). Screen layout is Task 6.

- [ ] **Step 9: Commit**

```bash
git add dist-field-kit.jsx dist-field-day.jsx dist-field-cust.jsx dist-field-koreksi.jsx dist-field.css finance-i18n.js server/tests/field-3d2-kit.test.js server/tests/field-*.test.js
git commit -m "feat(distribusi): 3D-2 kit — steppers, segments, chips, photo card, heads, money, notices, picker sheet to the mockup; M9/M10/M12; load errors announced"
```

---

### Task 2: Field shell minors — scroll reset (M6), edge swipe (M8), latihan chip (M11)

**Files:**
- Modify: `dist-field-logic.js` (add `swipeStart`, `loadPct`)
- Modify: `dist-field.jsx` (`FldApp`)
- Test: `server/tests/field-logic.test.js` (append), `server/tests/field-3d2-kit.test.js` (append), `server/tests/field-shell-static.test.js` (one assertion updated)

**Interfaces:**
- Produces: `FIELDLOGIC.swipeStart({ x, width }) → boolean`; `FIELDLOGIC.loadPct(remaining, out) → 0..100` (used by Task 4).

- [ ] **Step 1: Write the failing tests.** Append to `server/tests/field-logic.test.js`:

```js
describe('3D-2 helpers', () => {
  it('swipeStart: a start within 20 px of either edge belongs to the phone\'s back gesture (M8)', () => {
    expect(L.swipeStart({ x: 10, width: 390 })).toBe(false);
    expect(L.swipeStart({ x: 375, width: 390 })).toBe(false);
    expect(L.swipeStart({ x: 20, width: 390 })).toBe(true);
    expect(L.swipeStart({ x: 200, width: 390 })).toBe(true);
    expect(L.swipeStart({ x: 200 })).toBe(true);   // width unknown: only the left edge is checked
  });
  it('loadPct: share of the rit load still on the truck, 0–100, safe with an empty load', () => {
    expect(L.loadPct(74, 80)).toBe(93);
    expect(L.loadPct(0, 80)).toBe(0);
    expect(L.loadPct(90, 80)).toBe(100);
    expect(L.loadPct(5, 0)).toBe(0);
  });
});
```

Append to `server/tests/field-3d2-kit.test.js`:

```js
describe('3D-1 deferred minors (field shell)', () => {
  const shell = read('dist-field.jsx');
  it('M6: a new tab or task screen opens at the top', () => {
    expect(shell).toMatch(/const scrollKey = full \? 'v:' \+ view\.name : 't:' \+ tab;/);
    expect(shell).toMatch(/uEfl\(\(\) => \{ if \(rootRef\.current\) rootRef\.current\.scrollTop = 0; \}, \[scrollKey\]\);/);
    expect(shell).toMatch(/<div className="mlap-root" ref=\{rootRef\}>/);
  });
  it('M8: an edge start never switches tabs, and an ignored start never pairs with a later release', () => {
    const f = shell.slice(shell.indexOf('const swipeDown = (e) => {'), shell.indexOf('const swipeUp = (e) => {'));
    expect(f).toMatch(/^const swipeDown = \(e\) => \{\s*swipeRef\.current = null;/);
    expect(f).toMatch(/if \(!FIELDLOGIC\.swipeStart\(\{ x: e\.clientX, width: window\.innerWidth \}\)\) return;/);
  });
  it('M11: the latihan chip is a quiet note, not a live status', () => {
    expect(shell).toMatch(/<span className="mlap-chip latihan" role="note">\{trFl\('fld\.modeLatihan'\)\}<\/span>/);
  });
});
```

In `server/tests/field-shell-static.test.js` change the latihan assertion (line ~32) from `role="status"` to `role="note"`:

```js
  expect(jsx).toMatch(/\{mode === 'latihan' \? <span className="mlap-chip latihan" role="note">\{trFl\('fld\.modeLatihan'\)\}<\/span> : null\}/);
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-kit.test.js tests/field-shell-static.test.js`
Expected: FAIL — `L.swipeStart is not a function`, the shell assertions do not match, the latihan chip still has `role="status"`.

- [ ] **Step 3: Add the helpers** to `dist-field-logic.js`, right after the `swipeTab` function:

```js
  // TABS (3D-2, M8): a swipe that starts within 20 px of the screen edge belongs to the phone (its own
  // back gesture) — never to the tab switch.
  function swipeStart(o) { var x = num((o || {}).x); var w = num((o || {}).width); return x >= 20 && (!(w > 0) || x <= w - 20); }
  // PENGIRIMAN (3D-2): share of the rit's load still on the truck, 0–100.
  function loadPct(remaining, out) { var o = num(out); if (!(o > 0)) return 0; return Math.max(0, Math.min(100, Math.round(100 * num(remaining) / o))); }
```

and in the returned object replace `swipeTab: swipeTab }` with `swipeTab: swipeTab, swipeStart: swipeStart, loadPct: loadPct }`.

- [ ] **Step 4: Change the shell** (`dist-field.jsx`, `FldApp`).

Replace the whole `swipeDown` arrow with:

```jsx
  const swipeDown = (e) => {
    swipeRef.current = null;   // a start that is ignored never pairs with a later release (M8)
    if (e.pointerType === 'mouse') return;
    if (!FIELDLOGIC.swipeStart({ x: e.clientX, width: window.innerWidth })) return;   // the edge is the phone's back gesture
    if (e.target.closest('.mlap-map, input, textarea, select, .mlap-hscroll, .mlap-sheet, .leaflet-container')) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
```

Right after the line `const full = view && [...].includes(view.name);   // full-screen task: no tab header/dock` add:

```jsx
  // M6: a new tab or task screen opens at the top (the root is the one scroller of the field view); a
  // sheet over a tab (stop, customer) keeps the tab where it was.
  const rootRef = uRfl(null);
  const scrollKey = full ? 'v:' + view.name : 't:' + tab;
  uEfl(() => { if (rootRef.current) rootRef.current.scrollTop = 0; }, [scrollKey]);
```

Change `<div className="mlap-root">` (the `FldApp` return, not `FldRules`) to `<div className="mlap-root" ref={rootRef}>`.

Change `<span className="mlap-chip latihan" role="status">` to `<span className="mlap-chip latihan" role="note">`.

- [ ] **Step 5: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-kit.test.js tests/field-shell-static.test.js tests/field-shell-integration.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dist-field-logic.js dist-field.jsx server/tests/field-logic.test.js server/tests/field-3d2-kit.test.js server/tests/field-shell-static.test.js
git commit -m "fix(distribusi): field view — new tab/task opens at the top (M6), edge swipes left to the phone (M8), quiet latihan chip (M11)"
```

---

### Task 3: Login minors — old-view choice forgotten on logout (M5), no finance flash while rules load (M13)

**Files:**
- Modify: `dist-field-api.js` (add `sessionPrefs`, `bootWait`)
- Modify: `finance-shell.jsx` (`FApp`: rules-ready state, logout, boot wait)
- Modify: `dist-field.css` (append `.mlap-boot`)
- Test: `server/tests/field-api.test.js` (append), `server/tests/field-3d2-kit.test.js` (append)

**Interfaces:**
- Produces: `FIELDAPI.sessionPrefs(prefs) → { mode? }`; `FIELDAPI.bootWait({ perms, role, prefs, rulesReady }) → boolean`.

- [ ] **Step 1: Write the failing tests.** Append to `server/tests/field-api.test.js`:

```js
describe('3D-2 login minors (M5, M13)', () => {
  it('M5: a new login starts without the last session\'s "old view" choice; Mode latihan/asli stays', () => {
    expect(FA.sessionPrefs({ ui: 'old', mode: 'asli' })).toEqual({ mode: 'asli' });
    expect(FA.sessionPrefs({ ui: 'old' })).toEqual({});
    expect(FA.sessionPrefs(null)).toEqual({});
  });
  it('M13: only a board account that the release would move waits for the rules', () => {
    const board = { distribusiPengiriman: true };
    expect(FA.bootWait({ perms: board, role: 'finance', prefs: {}, rulesReady: false })).toBe(true);
    expect(FA.bootWait({ perms: board, role: 'finance', prefs: {}, rulesReady: true })).toBe(false);
    expect(FA.bootWait({ perms: board, role: 'finance', prefs: { ui: 'old' }, rulesReady: false })).toBe(false);   // chose the old view
    expect(FA.bootWait({ perms: board, role: 'owner', prefs: {}, rulesReady: false })).toBe(false);                // office stays in the old view
    expect(FA.bootWait({ perms: Object.assign({ distribusiDemoLatihan: true }, board), role: 'finance', prefs: {}, rulesReady: false })).toBe(false);   // a demo account lands anyway
    expect(FA.bootWait({ perms: {}, role: 'finance', prefs: {}, rulesReady: false })).toBe(false);                 // no board
  });
});
```

Append to `server/tests/field-3d2-kit.test.js`:

```js
describe('3D-1 deferred minors (login)', () => {
  const fsh = read('finance-shell.jsx');
  it('M5: logging out forgets the session\'s old-view choice', () => {
    expect(fsh).toMatch(/const logout = \(\) => \{[^\n]*setFieldPrefs\(\(x\) => \(window\.FIELDAPI \? window\.FIELDAPI\.sessionPrefs\(x\) : \{\}\)\);/);
  });
  it('M13: while the owner\'s rules load, a waiting account sees a blank field screen, never the finance app', () => {
    expect(fsh).toMatch(/const fieldRulesReady = !!user && fieldRulesFor === user\.id;/);
    expect(fsh).toMatch(/window\.FIELDAPI\.bootWait\(\{ perms: p, role: user\.role, prefs: fieldPrefs, rulesReady: fieldRulesReady \}\)/);
    expect(fsh).toMatch(/if \(fieldWait\) return <div className="mlap-boot" role="status" aria-label=\{tr\('fld\.loading'\)\} \/>;/);
    expect(fsh).toMatch(/const t = setTimeout\(done, 6000\);/);
    expect(fsh.indexOf('if (fieldWait) return')).toBeGreaterThan(-1);
    expect(fsh.indexOf('if (fieldWait) return')).toBeLessThan(fsh.indexOf('if (fieldFull) return'));
    expect(read('dist-field.css')).toMatch(/\.mlap-boot \{ position: fixed; inset: 0; z-index: 30; background: #EEF2F6; \}/);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-api.test.js tests/field-3d2-kit.test.js`
Expected: FAIL — `FA.sessionPrefs is not a function`; the shell assertions do not match.

- [ ] **Step 3: Add the helpers** to `dist-field-api.js`, right after `savePrefs`:

```js
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
```

and in the returned object replace `savePrefs: savePrefs,` with `savePrefs: savePrefs, sessionPrefs: sessionPrefs, bootWait: bootWait,`.

- [ ] **Step 4: Change `finance-shell.jsx`** (all inside `FApp`).

After `const [fieldPrefs, setFieldPrefs] = uSh(...)` add:

```jsx
  const [fieldRulesFor, setFieldRulesFor] = uSh(null);   // the user the owner's field rules were loaded for (M13)
```

Replace the rules-loading effect (the `uEh(() => { if (!user || !p.distribusiPengiriman || ...` block ending with `}, [user, p.distribusiPengiriman, fieldRulesTick]);`) with:

```jsx
  uEh(() => {
    if (!user || !p.distribusiPengiriman || !window.API || !window.API.distribusi || !window.API.distribusi.fieldRules) { setFieldRules(null); setFieldRulesFor(user ? user.id : null); return undefined; }
    let live = true;
    const done = () => { if (live) setFieldRulesFor(user.id); };
    const t = setTimeout(done, 6000);   // a slow server never keeps the screen blank longer than this
    window.API.distribusi.fieldRules.get().then((r) => { if (live) setFieldRules((r && r.data) || null); }).catch(() => { /* rules unreadable → treated as not released */ }).then(() => { clearTimeout(t); done(); });
    return () => { live = false; clearTimeout(t); };
  }, [user, p.distribusiPengiriman, fieldRulesTick]);
  const fieldRulesReady = !!user && fieldRulesFor === user.id;
```

In `const logout = () => { ... }` insert `setFieldPrefs((x) => (window.FIELDAPI ? window.FIELDAPI.sessionPrefs(x) : {}));` right after `setUser(null);` (same line).

Right before `const fieldFull = !!(` add:

```jsx
  // M13: no flash of the finance app while the owner's release switch is still loading.
  const fieldWait = !!(window.FIELD && window.FIELDAPI && user && window.FIELDAPI.bootWait({ perms: p, role: user.role, prefs: fieldPrefs, rulesReady: fieldRulesReady }));
  if (fieldWait) return <div className="mlap-boot" role="status" aria-label={tr('fld.loading')} />;
```

Append to `dist-field.css`:

```css
/* ── 3D-2 BOOT — the blank field-coloured screen while the owner's rules load (M13) ── */
.mlap-boot { position: fixed; inset: 0; z-index: 30; background: #EEF2F6; }
```

- [ ] **Step 5: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-api.test.js tests/field-3d2-kit.test.js tests/field-shell-integration.test.js tests/field-demo-access.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dist-field-api.js finance-shell.jsx dist-field.css server/tests/field-api.test.js server/tests/field-3d2-kit.test.js
git commit -m "fix(distribusi): old-view choice ends with the session (M5); no finance flash before the field rules load (M13)"
```

---

### Task 4: Pengiriman — mockup Main board

**Files:**
- Modify: `dist-field-day.jsx` (`fldStopTag`, `FldStopRow`, `FldNextCard`, `FldBoardScreen`)
- Modify: `dist-field.jsx` (custFilter state, `goIncomplete`, board + customers props)
- Modify: `dist-field-cust.jsx` (`FldCustomers` takes its filter from the shell)
- Modify: `dist-field.css` (append `3D-2 PENGIRIMAN`), `finance-i18n.js`
- Create: `server/tests/field-3d2-day.test.js`
- Update: `server/tests/field-day-static.test.js` (the numbering assertion)

**Interfaces:**
- Consumes: `FIELDLOGIC.loadPct` (Task 2), `FldSeg size`, `.mlap-nbig`, `.mlap-label` (Task 1).
- Produces: `FldBoardScreen({ api, ctx, tick, can, onStop, onSale, onOpenRun, onIncomplete, onOutside })` (no `onRoute`); stops handed to `onStop` carry `boardNo` (number shown on the board, or `'!'`) — Task 5 shows it; `FldCustomers({ api, tick, filter, onFilter, onOpen })`; shell `const goIncomplete` (Task 9 reuses it).

- [ ] **Step 1: Write the failing test** — create `server/tests/field-3d2-day.test.js`:

```js
'use strict';
// PLAN 3D-2 DAY SCREENS (static): Pengiriman, Detail stop, Transaksi, Buka/Tutup rit, Peta and Setoran
// laid out to their approved mockup boards — still only on the adaptor, still keeping the owner's rules.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const day = read('dist-field-day.jsx'); const shell = read('dist-field.jsx'); const css = read('dist-field.css');
const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); expect({ name, found: i > -1 }).toEqual({ name, found: true }); const j = src.indexOf('\nfunction ', i + 10); return src.slice(i, j < 0 ? undefined : j); };
const section = (name) => { const i = css.indexOf('/* ── 3D-2 ' + name); expect({ name, found: i > -1 }).toEqual({ name, found: true }); const j = css.indexOf('/* ── 3D-2 ', i + 10); return css.slice(i, j < 0 ? undefined : j); };
const rule = (name, sel) => { const b = section(name); const i = b.indexOf('\n' + sel + ' {'); expect({ sel, found: i > -1 }).toEqual({ sel, found: true }); return b.slice(i, b.indexOf('}', i)); };

it('parses; never calls the server directly', () => {
  expect(() => parse(day, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(day).not.toMatch(/window\.API|fetch\(/);
});

describe('Pengiriman (mockup Main board)', () => {
  const f = () => fn(day, 'FldBoardScreen');
  it('compact rit card: teal dot, remaining in teal, a 6 px progress bar, a meta row', () => {
    expect(f()).toMatch(/<span className="mlap-rit-dot" aria-hidden="true" \/>/);
    expect(f()).toMatch(/const pct = rs\.open \? FIELDLOGIC\.loadPct\(rs\.remaining, rs\.open\.gallonsOut\) : 0;/);
    expect(f()).toMatch(/<div className="mlap-bar" role="img" aria-label=\{trFl\('fld\.loadPctL', \{ p: pct \}\)\}><span style=\{\{ width: pct \+ '%' \}\} \/><\/div>/);
    expect(f()).toMatch(/trFl\('fld\.kmPlusBack'/);
    expect(rule('PENGIRIMAN', '.mlap-bar')).toMatch(/height: 6px; border-radius: 3px; background: #E1E8ED;/);
    expect(rule('PENGIRIMAN', '.mlap-bar > span')).toMatch(/background: #1A8C87;/);
    expect(rule('PENGIRIMAN', '.mlap-rit-left b')).toMatch(/color: #0F6B66;/);
  });
  it('warnings are tappable rows: incomplete data → Pelanggan "Belum lengkap"; outside the route → Tambah stop', () => {
    expect(f()).toMatch(/<button type="button" className="mlap-alert warn" onClick=\{onIncomplete\}>/);
    expect(f()).toMatch(/<button type="button" className="mlap-alert" onClick=\{onOutside\}>/);
    expect(shell).toMatch(/const goIncomplete = \(\) => \{ setCustFilter\('warn'\); setTab\('pelanggan'\); \};/);
    expect(shell).toMatch(/onIncomplete=\{goIncomplete\} onOutside=\{\(\) => \(can\.addStop \? setView\(\{ name: 'addStop' \}\) : setTab\('peta'\)\)\}/);
    expect(shell).toMatch(/<FldCustomers api=\{api\} tick=\{tick\} filter=\{custFilter\} onFilter=\{setCustFilter\}/);
    expect(rule('PENGIRIMAN', '.mlap-alert.warn')).toMatch(/background: #FFF1E8; border: 1px solid #F4C7A8; color: #9A3412;/);
  });
  it('next stop: 38 px number, blue eyebrow with the distance, chevron, coloured chips, Navigasi (gray) + Antar & catat (wider, check)', () => {
    const n = fn(day, 'FldNextCard');
    expect(n).toMatch(/<span className="mlap-nbig">\{n\}<\/span>/);
    expect(n).toMatch(/<FldSvg n="chevron"/);
    expect(n).toMatch(/className="mlap-btn gray" newTab><FldSvg n="navigate"/);
    expect(n).toMatch(/className="mlap-btn primary" onClick=\{onSale\}><FldSvg n="check"/);
    ['blue', 'bon', 'gray', 'warn'].forEach((t) => expect(n).toContain("['" + t + "'"));
    expect(rule('PENGIRIMAN', '.mlap-next-ad')).toMatch(/white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);   // a long address never pushes the card wider
    expect(rule('PENGIRIMAN', '.mlap-next-eb')).toMatch(/font-size: 11px; font-weight: 700; letter-spacing: \.05em; color: #065489;/);
    expect(rule('PENGIRIMAN', '.mlap-next .mlap-actions .mlap-btn.primary')).toMatch(/flex: 1\.3;/);
  });
  it('small segmented filter; numbers run on like the board and are coloured by list; the sheet gets the number', () => {
    expect(f()).toMatch(/<FldSeg size="sm" label=\{trFl\('fld\.filter'\)\}/);
    expect(f()).toMatch(/const first = seg === 'pending' \? v\.counts\.done \+ \(v\.next \? 2 : 1\) : 1;/);
    expect(f()).toMatch(/tone=\{seg === 'done' \? 'ok' : seg === 'held' \? 'neg' : ''\}/);
    expect(f()).toMatch(/onStop\(Object\.assign\(\{\}, s, \{ boardNo: n \}\)\)/);
    expect(f()).toMatch(/onOpen=\{\(\) => onStop\(Object\.assign\(\{\}, v\.next, \{ boardNo: v\.counts\.done \+ 1 \}\)\)\}/);
    expect(rule('PENGIRIMAN', '.mlap-num.ok')).toMatch(/background: #E3F3EA; color: #1E6B40;/);
    expect(rule('PENGIRIMAN', '.mlap-num.neg')).toMatch(/background: #FDE8E6; color: #9B2C22;/);
  });
});
```

In `server/tests/field-day-static.test.js` ("the next stop is not listed again…") the numbering assertion is superseded — replace

```js
    expect(f).toMatch(/n=\{i \+ \(seg === 'pending' && v\.next \? 2 : 1\)\}/);
```

with

```js
    expect(f).toMatch(/const first = seg === 'pending' \? v\.counts\.done \+ \(v\.next \? 2 : 1\) : 1;/);   // 3D-2: numbers run on after the delivered ones
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-day.test.js`
Expected: FAIL — no `mlap-rit-dot`, no `3D-2 PENGIRIMAN` section, no `goIncomplete`.

- [ ] **Step 3: Rewrite the Pengiriman pieces** in `dist-field-day.jsx`. Replace `fldStopTag`, `FldStopRow`, `FldNextCard` and `FldBoardScreen` (the comment above `fldLoadDay` and `fldLoadDay` itself stay) with:

```jsx
// The tag at the right of a stop row (mockup colours): delivered green, held/cancelled red, fixed order
// purple, extra blue, open bon amber.
function fldStopTag(s) {
  if (s.status === 'terkirim') return ['ok', trFl('fld.st_terkirim')];
  if (s.status === 'ditunda') return ['neg', trFl('fld.st_ditunda')];
  if (s.status === 'batal') return ['neg', trFl('fld.st_batal')];
  if (s.pinned) return ['pin', trFl('fld.tagPinned')];
  if (s.source === 'tambahan') return ['info', trFl('fld.tagExtra')];
  if (s.sisaBon > 0) return ['bon', trFl('fld.tagBon')];
  return null;
}

function FldStopRow({ s, n, tone, onClick }) {
  const tag = fldStopTag(s);
  const sub = [s.customerCode, trFl('fld.nGalon', { n: s.planQty }), s.legKm != null ? FIELDLOGIC.fmtKm(s.legKm) : '', s.pendingReason].filter(Boolean).join(' · ');
  return (
    <button type="button" className="mlap-row mlap-rowbtn" onClick={onClick}>
      <span className={'mlap-num' + (tone ? ' ' + tone : '')}>{n}</span>
      <span className="mlap-grow"><span className="nm">{s.customerName}</span><span className="sb">{sub}</span></span>
      {s.gaps.count > 0 ? <span className="mlap-warn-dot" role="img" aria-label={trFl('fld.incompleteB')}><FldSvg n="exclamThin" s={11} sw={3} /></span> : null}
      {tag && <span className={'mlap-tag ' + tag[0]}>{tag[1]}</span>}
    </button>
  );
}

// BERIKUTNYA (mockup next-stop card): the stop's number, the distance, name + address (opens the stop),
// coloured chips, then Navigasi and the wider "Antar & catat".
function FldNextCard({ s, n, canSale, onSale, onOpen }) {
  const links = fldLinks(s);
  const chips = [['blue', trFl('fld.nGalon', { n: s.planQty })]];
  if (s.sisaBon > 0) chips.push(['bon', trFl('fld.bonTag', { v: FIELDLOGIC.fmtRp(s.sisaBon) })]);
  if (s.gallonsHeld != null) chips.push(['gray', trFl('fld.heldTag', { n: s.gallonsHeld })]);
  if (s.gaps.wa) chips.push(['warn', trFl('fld.noWa')]);
  return (
    <div className="mlap-card mlap-next">
      <button type="button" className="mlap-next-hd" onClick={onOpen}>
        <span className="mlap-nbig">{n}</span>
        <span className="mlap-grow">
          <span className="mlap-next-eb">{trFl('fld.next')}{s.legKm != null ? ' · ' + FIELDLOGIC.fmtKm(s.legKm) : ''}</span>
          <span className="mlap-next-nm">{s.customerName}</span>
          {s.address ? <span className="mlap-next-ad">{s.address}</span> : null}
        </span>
        <FldSvg n="chevron" s={14} sw={2.4} style={{ color: '#8A9AA3', flexShrink: 0 }} />
      </button>
      <div className="mlap-chips">{chips.map(([t, c]) => <span key={c} className={'mlap-chip-s ' + t}>{t === 'warn' ? <FldSvg n="exclam" s={11} sw={2.8} /> : null}{c}</span>)}</div>
      <div className="mlap-actions">
        <FldLinkBtn href={links.nav} className="mlap-btn gray" newTab><FldSvg n="navigate" s={16} />{trFl('fld.navigate')}</FldLinkBtn>
        {canSale ? <button type="button" className="mlap-btn primary" onClick={onSale}><FldSvg n="check" s={16} sw={2.6} />{trFl('fld.deliverRecord')}</button> : null}
      </div>
    </div>
  );
}

function FldBoardScreen({ api, ctx, tick, can, onStop, onSale, onOpenRun, onIncomplete, onOutside }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [seg, setSeg] = uSfl('pending');
  uEfl(() => {
    let live = true; setErr(null);
    fldLoadDay(api, ctx).then((x) => { if (live) setD(x); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick]);   // the shell bumps tick right after the context reloads — ctx is current here
  if (err) return <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!d) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const v = d.view; const rs = d.rs; const r = d.route;
  const list = seg === 'pending' ? v.pending.filter((s) => !v.next || s.id !== v.next.id) : seg === 'done' ? v.done : v.held;
  // numbers run on like the board: delivered 1…k, the next stop k+1, then the waiting list; held = "!"
  const first = seg === 'pending' ? v.counts.done + (v.next ? 2 : 1) : 1;
  const pct = rs.open ? FIELDLOGIC.loadPct(rs.remaining, rs.open.gallonsOut) : 0;
  return (
    <>
      <div className="mlap-card mlap-ritcard">
        {rs.open && rs.stale ? (
          <FldNotice tone="warn" title={trFl('fld.staleRunT', { n: rs.open.runNo, date: rs.open.date })} sub={trFl('fld.staleRunB')} action={trFl('fld.closeRun')} onAction={onOpenRun} />
        ) : rs.open ? (
          <>
            <div className="mlap-rit-l">
              <span className="mlap-rit-dot" aria-hidden="true" />
              <b className="n">{trFl('fld.ritN', { n: rs.open.runNo })}</b>
              <span className="mlap-rit-left">· <b>{rs.remaining}</b> {trFl('fld.ofLoadLeft', { n: rs.open.gallonsOut })}</span>
              <button type="button" className="mlap-rit-link" onClick={onOpenRun}>{trFl('fld.closeRun')}</button>
            </div>
            <div className="mlap-bar" role="img" aria-label={trFl('fld.loadPctL', { p: pct })}><span style={{ width: pct + '%' }} /></div>
            {r ? (
              <div className="mlap-rit-meta">
                <span>{trFl('fld.nStops', { n: r.rit.length })}</span>
                <span>{trFl('fld.kmPlusBack', { km: FIELDLOGIC.fmtKm(r.totalKm - r.returnKm), back: FIELDLOGIC.fmtKm(r.returnKm) })}</span>
                {r.estRits ? <span>{trFl('fld.moreRits', { n: r.estRits })}</span> : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="mlap-rit-l"><span className="mlap-rit-dot off" aria-hidden="true" /><b className="n">{trFl('fld.noRunT')}</b></div>
            <div className="mlap-rit-meta">{trFl('fld.noRunB')}</div>
            <button type="button" className="mlap-btn primary" onClick={onOpenRun}>{trFl('fld.openRunN', { n: rs.nextNo })}</button>
          </>
        )}
      </div>
      {v.incomplete > 0 && (
        <button type="button" className="mlap-alert warn" onClick={onIncomplete}>
          <FldSvg n="warn" s={18} sw={2.2} style={{ flexShrink: 0 }} />
          <span className="mlap-grow"><span className="t">{trFl('fld.incompleteT', { n: v.incomplete })}</span><span className="s">{trFl('fld.incompleteB')}</span></span>
          <span className="act">{trFl('fld.lengkapi')}</span>
        </button>
      )}
      {v.outsideRoute > 0 && (
        <button type="button" className="mlap-alert" onClick={onOutside}>
          <FldSvg n="pinOff" s={18} style={{ flexShrink: 0, color: '#9A3412' }} />
          <span className="mlap-grow"><span className="t">{trFl('fld.outsideT', { n: v.outsideRoute })}</span><span className="s">{trFl('fld.outsideB')}</span></span>
          <FldSvg n="chevron" s={14} sw={2.4} style={{ color: '#8A9AA3', flexShrink: 0 }} />
        </button>
      )}
      {v.next && <FldNextCard s={v.next} n={v.counts.done + 1} canSale={!!(can && can.sale)} onSale={() => onSale(v.next)} onOpen={() => onStop(Object.assign({}, v.next, { boardNo: v.counts.done + 1 }))} />}
      <FldSeg size="sm" label={trFl('fld.filter')} value={seg} onChange={setSeg} options={[['pending', trFl('fld.segPending', { n: v.counts.pending })], ['done', trFl('fld.segDone', { n: v.counts.done })], ['held', trFl('fld.segHeld', { n: v.counts.held })]]} />
      <div className="mlap-card mlap-list">
        {list.length ? list.map((s, i) => {
          const n = seg === 'held' ? '!' : first + i;
          return <FldStopRow key={s.id} s={s} n={n} tone={seg === 'done' ? 'ok' : seg === 'held' ? 'neg' : ''} onClick={() => onStop(Object.assign({}, s, { boardNo: n }))} />;
        }) : <div className="mlap-empty">{trFl('fld.emptySeg')}</div>}
      </div>
      {v.outstanding.length > 0 && (
        <>
          <div className="mlap-label">{trFl('fld.outstandingT', { n: v.outstanding.length })}</div>
          <div className="mlap-card mlap-list">
            {v.outstanding.map((o) => (
              <div key={o.id} className="mlap-row">
                <span className="mlap-num neg">{o.umur}</span>
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
```

- [ ] **Step 4: Wire the shell and the customer list.**

In `dist-field.jsx` (`FldApp`), after `const [tab, setTab] = uSfl('kirim');` add:

```jsx
  const [custFilter, setCustFilter] = uSfl('all');   // the Pelanggan filter — the board can open it on "Belum lengkap"
  const goIncomplete = () => { setCustFilter('warn'); setTab('pelanggan'); };
```

Replace the `tab === 'kirim'` body line with:

```jsx
    body = <FldBoardScreen api={api} ctx={ctx} tick={tick} can={can} onStop={(s) => setView({ name: 'stop', stop: s })} onSale={(s) => setView({ name: 'sale', stop: s })} onOpenRun={() => setView({ name: 'run' })} onIncomplete={goIncomplete} onOutside={() => (can.addStop ? setView({ name: 'addStop' }) : setTab('peta'))} />;
```

and the customers body line with:

```jsx
    body = <FldCustomers api={api} tick={tick} filter={custFilter} onFilter={setCustFilter} onOpen={(c) => setView({ name: 'cust', cust: c })} />;
```

In `dist-field-cust.jsx`, change `function FldCustomers({ api, tick, onOpen }) {` to `function FldCustomers({ api, tick, filter, onFilter, onOpen }) {`, delete its line `const [filter, setFilter] = uSfl('all');`, and in its `<FldSeg … onChange={setFilter}` use `onChange={onFilter}`.

- [ ] **Step 5: Append the CSS** to `dist-field.css`:

```css
/* ── 3D-2 PENGIRIMAN — mockup Main board ── */
.mlap-ritcard { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.mlap-rit-l { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.mlap-rit-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: #1A8C87; }
.mlap-rit-dot.off { background: #AFC0CB; }
.mlap-rit-l .n { font-weight: 600; }
.mlap-rit-left { flex: 1; min-width: 0; color: var(--mlap-sub); }
.mlap-rit-left b { color: #0F6B66; }
.mlap-rit-link { min-height: 44px; display: flex; align-items: center; padding: 0; border: 0; background: transparent; font: inherit; font-size: 14px; font-weight: 600; color: #065489; cursor: pointer; flex-shrink: 0; }
.mlap-bar { height: 6px; border-radius: 3px; background: #E1E8ED; overflow: hidden; }
.mlap-bar > span { display: block; height: 100%; border-radius: 3px; background: #1A8C87; transition: width .45s cubic-bezier(.34,1.56,.64,1); }
.mlap-rit-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--mlap-sub); }
.mlap-alert { width: 100%; min-height: 44px; border-radius: 14px; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 0; background: #FFFFFF; color: var(--mlap-ink); font: inherit; text-align: left; cursor: pointer; }
.mlap-alert.warn { background: #FFF1E8; border: 1px solid #F4C7A8; color: #9A3412; }
.mlap-alert .t { font-size: 14px; font-weight: 600; }
.mlap-alert.warn .t { font-weight: 700; }
.mlap-alert .s { font-size: 12px; color: var(--mlap-sub); }
.mlap-alert.warn .s { color: #9A3412; }
.mlap-alert .act { font-size: 13px; font-weight: 700; flex-shrink: 0; }
.mlap-next { padding: 12px; border: 0; border-radius: 18px; display: flex; flex-direction: column; gap: 10px; }
.mlap-next-hd { flex-direction: row; align-items: center; gap: 10px; width: 100%; }
.mlap-next-eb { font-size: 11px; font-weight: 700; letter-spacing: .05em; color: #065489; text-transform: uppercase; }
.mlap-next-nm { font-size: 17px; font-weight: 700; }
.mlap-next-ad { font-size: 13px; color: var(--mlap-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mlap-chip-s { height: 24px; display: inline-flex; align-items: center; gap: 4px; padding: 0 8px; border-radius: 7px; font-size: 12px; font-weight: 600; background: #EEF2F6; color: #3E4E58; }
.mlap-chip-s.blue { background: #E8F1F8; color: #065489; }
.mlap-chip-s.bon { background: #FCF1D6; color: #7A4B00; }
.mlap-chip-s.warn { background: #FFF1E8; color: #9A3412; }
.mlap-btn.gray { background: #E8EEF3; color: var(--mlap-ink); }
.mlap-next .mlap-actions .mlap-btn { border-radius: 12px; }
.mlap-next .mlap-actions .mlap-btn.primary { flex: 1.3; box-shadow: none; }
.mlap-list { border-radius: 18px; }
.mlap-num.ok { background: #E3F3EA; color: #1E6B40; }
.mlap-num.neg { background: #FDE8E6; color: #9B2C22; }
.mlap-warn-dot { width: 20px; height: 20px; border: 0; flex-shrink: 0; background: #FFF1E8; color: #9A3412; display: grid; place-items: center; }
```

- [ ] **Step 6: Add the i18n keys.** After the EN anchor insert:

```
 'fld.nStops': '{n} stops', 'fld.kmPlusBack': '{km} + {back} back', 'fld.moreRits': '±{n} more trips', 'fld.loadPctL': '{p}% of the load left', 'fld.lengkapi': 'Complete',
```

after the ID anchor insert:

```
 'fld.nStops': '{n} stop', 'fld.kmPlusBack': '{km} + {back} pulang', 'fld.moreRits': '±{n} rit lagi', 'fld.loadPctL': 'Sisa muatan {p}%', 'fld.lengkapi': 'Lengkapi',
```

- [ ] **Step 7: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-day.test.js tests/field-day-static.test.js tests/field-cust-static.test.js tests/field-shell-static.test.js tests/field-3d2-kit.test.js`
Expected: PASS (the i18n-key scan in `field-day-static` sees the new keys in EN and ID).

- [ ] **Step 8: Side-by-side check** — Pengiriman tab with an open rit, a next stop, a bon and an incomplete customer, next to `Main.dc.html`. Fix every difference or rule it.

- [ ] **Step 9: Commit**

```bash
git add dist-field-day.jsx dist-field.jsx dist-field-cust.jsx dist-field.css finance-i18n.js server/tests/field-3d2-day.test.js server/tests/field-day-static.test.js
git commit -m "feat(distribusi): Pengiriman to the mockup — compact rit card + bar, tappable warnings, next-stop card, numbered coloured list"
```

---

### Task 5: Detail stop — mockup Stop board (a tall sheet)

**Files:**
- Modify: `dist-field-day.jsx` (`FldStopSheet`)
- Modify: `dist-field.css` (append `3D-2 STOP`), `finance-i18n.js`
- Test: `server/tests/field-3d2-day.test.js` (append); update `server/tests/field-day-static.test.js` (one superseded assertion)

**Interfaces:**
- Consumes: `FldSheetHead`, `.mlap-sheet.tall`, `.mlap-sheet-body`, `.mlap-sheet-cta`, `.mlap-nbig`, `FldChips tone` (Task 1); `stop.boardNo` (Task 4).
- Produces: CSS `.mlap-actrow` (+ `.off`), `.mlap-ctile` (+ `.miss`), `.mlap-facts2`, `.mlap-notecard`, `.mlap-gapcard`, `.mlap-gapact` — Task 10 reuses them in the customer sheet.

- [ ] **Step 1: Write the failing test.** Append to `server/tests/field-3d2-day.test.js`:

```js
describe('Detail stop (mockup Stop board)', () => {
  const f = () => fn(day, 'FldStopSheet');
  it('a tall sheet: 38 px number, name, glass close X; the body scrolls, the CTA stays at the bottom', () => {
    expect(f()).toMatch(/<div className="mlap-sheet tall" role="dialog" aria-modal="true" aria-label=\{s\.customerName\} ref=\{drag\.ref\} style=\{drag\.style\}>/);
    expect(f()).toMatch(/<FldSheetHead title=\{s\.customerName\} sub=\{sub\} lead=\{s\.boardNo != null \? <span className="mlap-nbig">\{s\.boardNo\}<\/span> : null\} onClose=\{onClose\} \/>/);
    expect(f()).toMatch(/<div className="mlap-sheet-body">/);
    expect(f()).toMatch(/<div className="mlap-sheet-cta"><button type="button" className="mlap-btn primary" onClick=\{\(\) => onSale\(s\)\}><FldSvg n="check"/);
  });
  it('each missing item has its own action pill (32 px pill, 44 px touch); contact tiles with icons; no WhatsApp = dashed orange', () => {
    expect(f()).toMatch(/s\.gaps\[k\] && fix \? <button type="button" className="mlap-gapact" onClick=\{fix\}>/);
    expect(f()).toMatch(/className="mlap-ctile" newTab><FldSvg n="navigate"/);
    expect(f()).toMatch(/className="mlap-ctile"><FldSvg n="phone"/);
    expect(f()).toMatch(/<button type="button" className="mlap-ctile miss" onClick=\{fix\}><FldSvg n="wa"/);
    expect(rule('STOP', '.mlap-ctile.miss')).toMatch(/border: 1px dashed #F4C7A8; color: #9A3412;/);
    expect(rule('STOP', '.mlap-gapact::before')).toMatch(/inset: -6px 0;/);
  });
  it('two coloured facts, the note card, an icon action list with chevrons, Tunda / Batal with icons', () => {
    expect(f()).toMatch(/<div className="mlap-card mlap-facts2">/);
    expect(f()).toMatch(/<div className="mlap-card mlap-notecard"><FldSvg n="note"/);
    expect(f()).toMatch(/className="mlap-actrow" onClick=\{\(\) => onAction\(k, fldCustFromStop\(s\)\)\}>/);
    expect(f()).toMatch(/<button type="button" className="mlap-btn hold"[\s\S]*?<FldSvg n="clock"/);
    expect(f()).toMatch(/<button type="button" className="mlap-btn cancel"[\s\S]*?<FldSvg n="ban"/);
    expect(f()).toMatch(/tone=\{mode === 'tunda' \? 'hold' : 'danger'\}/);
    expect(rule('STOP', '.mlap-facts2 b.blue')).toMatch(/color: #065489;/);
  });
});
```

In `server/tests/field-day-static.test.js` ("Plan 3B: the stop sheet offers …") replace

```js
  expect(f).toMatch(/onAction\('adjust', fldCustFromStop\(s\)\)/);
```

with

```js
  expect(f).toMatch(/if \(can\.adjust\) acts\.push\(\['adjust',/);   // 3D-2: one icon row per action
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-day.test.js`
Expected: FAIL in "Detail stop" (old `mlap-sheet` without `tall`, no `FldSheetHead`).

- [ ] **Step 3: Replace `FldStopSheet`** in `dist-field-day.jsx`:

```jsx
// DETAIL STOP (mockup Stop board): a tall sheet — the stop's number + name, what data is missing (each
// with its own action), Navigasi / Telepon / WhatsApp, the order and the gallons held, the note, the
// money/gallon actions, Tunda / Batal (always with a written reason), and "Antar & catat" fixed below.
function FldStopSheet({ api, stop: s, can, onClose, onSale, onAction, onChanged }) {
  const drag = useFldSheetDrag(onClose);
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
  const checks = [['titik', 'fld.chkTitik', 'fld.setPin'], ['wa', 'fld.chkWa', 'fld.fillNo'], ['foto', 'fld.chkFoto', 'fld.camera']];
  const sub = [s.customerCode, s.address, s.deliveryDays && s.deliveryDays.length ? trFl('fld.sendDays', { d: s.deliveryDays.join(', ') }) : ''].filter(Boolean).join(' · ');
  const fix = can.location && s.gaps.count > 0 ? () => onAction('complete', fldCustFromStop(s)) : null;
  const acts = [];
  if (can.bon && s.sisaBon > 0) acts.push(['bon', 'cash', 'fld.terimaBon', FIELDLOGIC.fmtRp(s.sisaBon)]);
  if (can.adjust) acts.push(['adjust', 'adjust', 'fld.adjRow', '']);
  if (can.damage && s.gallonsHeld > 0) acts.push(['damage', 'bottleBroken', 'fld.dmgRow', '']);
  const pending = s.status === 'pending';
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet tall" role="dialog" aria-modal="true" aria-label={s.customerName} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
        <FldSheetHead title={s.customerName} sub={sub} lead={s.boardNo != null ? <span className="mlap-nbig">{s.boardNo}</span> : null} onClose={onClose} />
        <div className="mlap-sheet-body">
          {s.gaps.count > 0 && (
            <div className="mlap-gapcard">
              <div className="mlap-gapcard-hd"><FldSvg n="warn" s={16} sw={2.2} /><span>{trFl('fld.gapsT', { n: 3 - s.gaps.count })}</span></div>
              {checks.map(([k, key, act]) => (
                <div key={k} className="mlap-check">
                  <span className={'mlap-dot ' + (s.gaps[k] ? 'miss' : 'ok')} aria-hidden="true">{s.gaps[k] ? '!' : '✓'}</span>
                  <span className="mlap-grow">{trFl(key)}</span>
                  {s.gaps[k] && fix ? <button type="button" className="mlap-gapact" onClick={fix}>{trFl(act)}</button> : null}
                </div>
              ))}
            </div>
          )}
          <div className="mlap-contacts">
            <FldLinkBtn href={links.nav} className="mlap-ctile" newTab><FldSvg n="navigate" s={18} />{trFl('fld.navigate')}</FldLinkBtn>
            <FldLinkBtn href={links.tel} className="mlap-ctile"><FldSvg n="phone" s={18} />{trFl('fld.call')}</FldLinkBtn>
            {links.wa ? <FldLinkBtn href={links.wa} className="mlap-ctile" newTab><FldSvg n="wa" s={18} />{trFl('fld.wa')}</FldLinkBtn>
              : fix ? <button type="button" className="mlap-ctile miss" onClick={fix}><FldSvg n="wa" s={18} />{trFl('fld.fillWaTile')}</button>
                : <FldLinkBtn href="" className="mlap-ctile"><FldSvg n="wa" s={18} />{trFl('fld.wa')}</FldLinkBtn>}
          </div>
          <div className="mlap-card mlap-facts2">
            <div><span className="sb">{trFl('fld.orderToday')}</span><b className="blue">{trFl('fld.nGalon', { n: s.planQty })}</b></div>
            <div><span className="sb">{trFl('fld.heldAt')}</span><b>{s.gallonsHeld == null ? '—' : s.gallonsHeld}</b></div>
          </div>
          {s.note ? <div className="mlap-card mlap-notecard"><FldSvg n="note" s={16} /><span>{s.note}</span></div> : null}
          {acts.length || (!can.bon && s.sisaBon > 0) ? (
            <div className="mlap-card">
              {acts.map(([k, ico, key, val]) => (
                <button key={k} type="button" className="mlap-actrow" onClick={() => onAction(k, fldCustFromStop(s))}>
                  <FldSvg n={ico} s={17} /><span className="mlap-grow">{trFl(key)}</span>{val ? <b className="mlap-bontxt">{val}</b> : null}<FldSvg n="chevron" s={13} sw={2.4} />
                </button>
              ))}
              {!can.bon && s.sisaBon > 0 ? <div className="mlap-actrow off"><FldSvg n="cash" s={17} /><span className="mlap-grow">{trFl('fld.bonNow')}</span><b className="mlap-bontxt">{FIELDLOGIC.fmtRp(s.sisaBon)}</b></div> : null}
            </div>
          ) : null}
          {err && <div className="mlap-err" role="alert">{err}</div>}
          {pending && !mode && (
            <div className="mlap-holdrow">
              <button type="button" className="mlap-btn hold" onClick={() => { setMode('tunda'); setReason(''); }}><FldSvg n="clock" s={16} sw={2.2} />{trFl('fld.hold')}</button>
              <button type="button" className="mlap-btn cancel" onClick={() => { setMode('batal'); setReason(''); }}><FldSvg n="ban" s={16} sw={2.2} />{trFl('fld.cancelStop')}</button>
            </div>
          )}
          {mode && (
            <div className={'mlap-card mlap-reason' + (mode === 'batal' ? ' neg' : '')}>
              <b>{trFl(mode === 'tunda' ? 'fld.holdWhy' : 'fld.cancelWhy')}</b>
              <FldChips options={reasons} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} tone={mode === 'tunda' ? 'hold' : 'danger'} />
              <div className="mlap-actions">
                <button type="button" className="mlap-btn gray" onClick={() => setMode('')}>{trFl('fld.cancel')}</button>
                <button type="button" className={'mlap-btn ' + (mode === 'batal' ? 'danger' : 'primary')} disabled={busy || !reason.trim()} onClick={doHold}>{trFl(mode === 'tunda' ? 'fld.holdSave' : 'fld.cancelSave')}</button>
              </div>
            </div>
          )}
          {(s.status === 'ditunda' || s.status === 'batal') && <button type="button" className="mlap-btn mlap-wide" disabled={busy} onClick={reopen}>{trFl('fld.reopen')}</button>}
          {s.status === 'terkirim' && s.transactionId && (can.correct || can.void)
            ? <button type="button" className="mlap-btn mlap-wide" onClick={() => onAction('koreksi', { transactionId: s.transactionId, customerId: s.customerId })}>{trFl('fld.koreksiT')}</button>
            : s.status === 'terkirim' ? <div className="mlap-note">{trFl('fld.doneNote')}</div> : null}
        </div>
        {pending && !mode && can.sale ? (
          <div className="mlap-sheet-cta"><button type="button" className="mlap-btn primary" onClick={() => onSale(s)}><FldSvg n="check" s={18} sw={2.6} />{trFl('fld.deliverRecordFull')}</button></div>
        ) : null}
      </div>
    </>
  );
}
```

The two Plan 3B assertions `can.bon && s.sisaBon > 0`, `can.damage && s.gallonsHeld > 0` and `can.location && s.gaps.count > 0` still hold in this code.

- [ ] **Step 4: Append the CSS:**

```css
/* ── 3D-2 STOP — mockup Stop board ── */
.mlap-gapcard { background: #FFF1E8; border: 1px solid #F4C7A8; border-radius: 16px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.mlap-gapcard-hd { display: flex; align-items: center; gap: 8px; color: #9A3412; font-size: 14px; font-weight: 700; }
.mlap-gapcard .mlap-check { min-height: 32px; padding: 0; gap: 8px; font-size: 14px; color: var(--mlap-ink); }
.mlap-gapact { position: relative; min-height: 32px; padding: 0 10px; border-radius: 16px; border: 0; background: #FFFFFF; font: inherit; font-size: 13px; font-weight: 700; color: #9A3412; cursor: pointer; flex-shrink: 0; }
.mlap-gapact::before { content: ''; position: absolute; inset: -6px 0; }
.mlap-contacts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.mlap-ctile { height: 52px; border: 0; border-radius: 14px; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: #065489; font: inherit; font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; box-sizing: border-box; }
.mlap-ctile.miss { border: 1px dashed #F4C7A8; color: #9A3412; }
.mlap-ctile.off { opacity: .45; pointer-events: none; }
.mlap-facts2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.mlap-facts2 > div { padding: 9px 12px; display: flex; flex-direction: column; gap: 1px; }
.mlap-facts2 > div:first-child { border-right: 1px solid var(--mlap-line); }
.mlap-facts2 .sb { font-size: 12px; color: var(--mlap-sub); }
.mlap-facts2 b { font-size: 17px; line-height: 22px; font-weight: 700; }
.mlap-facts2 b.blue { color: #065489; }
.mlap-notecard { padding: 10px 12px; display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 19px; }
.mlap-notecard > svg { flex-shrink: 0; margin-top: 2px; color: var(--mlap-sub); }
.mlap-actrow { width: 100%; min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 0; border-bottom: 1px solid var(--mlap-line); background: #FFFFFF; font: inherit; font-size: 15px; color: var(--mlap-ink); text-align: left; cursor: pointer; }
.mlap-actrow:last-child { border-bottom: 0; }
.mlap-actrow > svg:first-child { color: #065489; flex-shrink: 0; }
.mlap-actrow > svg:last-child { color: #8A9AA3; flex-shrink: 0; }
.mlap-actrow b { font-size: 14px; font-weight: 700; }
.mlap-actrow.off { cursor: default; }
.mlap-holdrow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.mlap-holdrow .mlap-btn { border-radius: 12px; background: #FFFFFF; }
.mlap-btn.hold { color: #7A4B00; }
.mlap-btn.cancel { color: #9B2C22; }
.mlap-reason.neg { background: #FDECEA; border: 1px solid #F2B8B1; }
.mlap-sheet-body .mlap-reason { margin-bottom: 0; }
```

- [ ] **Step 5: Add the i18n keys.** EN anchor:

```
 'fld.fillNo': 'Add number', 'fld.fillWaTile': 'Add WA no.', 'fld.terimaBon': 'Collect bon payment', 'fld.adjRow': 'Adjust gallon count', 'fld.dmgRow': 'Charge a damaged gallon', 'fld.deliverRecordFull': 'Deliver & record sale',
```

ID anchor:

```
 'fld.fillNo': 'Isi nomor', 'fld.fillWaTile': 'Isi no. WA', 'fld.terimaBon': 'Terima pembayaran bon', 'fld.adjRow': 'Penyesuaian jumlah galon', 'fld.dmgRow': 'Ganti rugi galon rusak', 'fld.deliverRecordFull': 'Antar & catat transaksi',
```

- [ ] **Step 6: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-day.test.js tests/field-day-static.test.js tests/field-kit-static.test.js tests/field-koreksi-static.test.js`
Expected: PASS ("every sheet uses it" in `field-kit-static` still matches `const drag = useFldSheetDrag(`, `<FldGrab handle={drag.handle} />`, `ref={drag.ref} style={drag.style}`).

- [ ] **Step 7: Side-by-side check** — open a pending stop with a missing WhatsApp + photo and a note, next to `Stop.dc.html`; then press Tunda (amber chips) and Batal (red chips).

- [ ] **Step 8: Commit**

```bash
git add dist-field-day.jsx dist-field.css finance-i18n.js server/tests/field-3d2-day.test.js server/tests/field-day-static.test.js
git commit -m "feat(distribusi): Detail stop to the mockup — tall sheet, per-gap actions, contact tiles, facts, note, action list, fixed CTA"
```

---

### Task 6: Transaksi — mockup Transaksi board

**Files:**
- Modify: `dist-field-day.jsx` (`FldSale`), `dist-field.jsx` (FldSale gets `onPayBon`)
- Modify: `dist-field.css` (append `3D-2 TRANSAKSI`), `finance-i18n.js`
- Test: `server/tests/field-3d2-day.test.js` (append)

**Interfaces:**
- Consumes: `FldCustHead`, `FldCtaBar`, `FldPhoto req`, `.mlap-label` (Task 1); `stop.boardNo` (Task 4).
- Produces: `FldSale({ api, stop, pending, refs, onDone, onBack, onPayBon })`; CSS `.mlap-sum2`, `.mlap-sumline`, `.mlap-sumdiv`, `.mlap-sumtot`, `.mlap-linkrow` (Task 13 reuses `.mlap-sumtot`, `.mlap-linkrow`).

- [ ] **Step 1: Write the failing test.** Append to `server/tests/field-3d2-day.test.js`:

```js
describe('Transaksi (mockup Transaksi board)', () => {
  const f = () => fn(day, 'FldSale');
  it('a plain "Transaksi" top bar, the customer at 22 px with "Stop n · code"', () => {
    expect(f()).toMatch(/<FldTop title=\{trFl\('fld\.saleTitle'\)\} onBack=\{onBack\} \/>/);
    expect(f()).toMatch(/<FldCustHead name=\{s\.customerName\}/);
  });
  it('totals: a divider, the 22 px total, the coloured "after" pill; a link to collect the old bon', () => {
    expect(f()).toMatch(/<div className="mlap-sumdiv" \/>/);
    expect(f()).toMatch(/<div className="mlap-sumtot"><span>\{trFl\(pv\.totalKey\)\}<\/span><b>/);
    expect(f()).toMatch(/onPayBon \? <button type="button" className="mlap-linkrow" onClick=\{onPayBon\}><FldSvg n="cash"/);
    expect(rule('TRANSAKSI', '.mlap-sumtot b')).toMatch(/font-size: 22px; font-weight: 700;/);
    expect(rule('TRANSAKSI', '.mlap-after.bon')).toMatch(/background: #FCF1D6; color: #7A4B00;/);
  });
  it('the photo label follows the payment (cash / transfer / gallons received); always required', () => {
    expect(f()).toMatch(/const reqKey = method === 'transfer' \? 'fld\.reqTf' : method === 'bon' \? 'fld\.reqBon' : 'fld\.reqCash';/);
    expect(f()).toMatch(/<FldPhoto api=\{api\} value=\{photo\} onChange=\{setPhoto\} hintKey="fld\.proofHintSale" req=\{trFl\(reqKey\)\} \/>/);
  });
  it('save is the fixed bottom bar with its reason above it', () => {
    expect(f()).toMatch(/<FldCtaBar hint=\{why \? trFl\(why\) : ''\}>/);
    expect(f()).toMatch(/disabled=\{busy \|\| !!why \|\| \(needReason && !noLoc\.trim\(\)\)\} onClick=\{save\}><FldSvg n="check"/);
    expect(shell).toMatch(/onPayBon=\{view\.stop\.sisaBon > 0 && can\.bon \? \(\) => openFor\('bon', fldCustFromStop\(view\.stop\)\) : null\}/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-day.test.js`
Expected: FAIL in "Transaksi" (no `FldCustHead`, no `FldCtaBar`).

- [ ] **Step 3: Replace the `return (...)` of `FldSale`** (everything from `return (` to the end of the function; the state, `save` and the comment above stay), change the signature to `function FldSale({ api, stop: s, pending, refs, onDone, onBack, onPayBon }) {`, and add `const reqKey = …` before the return:

```jsx
  const reqKey = method === 'transfer' ? 'fld.reqTf' : method === 'bon' ? 'fld.reqBon' : 'fld.reqCash';
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.saleTitle')} onBack={onBack} />
      <div className="mlap-body">
        <FldCustHead name={s.customerName} aside={<span className="mlap-custhead-sb">{[s.boardNo != null && s.boardNo !== '!' ? trFl('fld.stopN', { n: s.boardNo }) : '', s.customerCode].filter(Boolean).join(' · ')}</span>} />
        {txnId ? <FldNotice tone="warn" title={trFl('fld.savedNotMarkedT')} sub={trFl('fld.savedNotMarkedB')} /> : null}
        <fieldset className="mlap-fs" disabled={!!txnId}>
          <div className="mlap-card">
            <FldStepper label={trFl('fld.galOut')} hint={trFl('fld.galOutHint', { n: s.planQty })} value={qty} onChange={setQty} min={1} max={999} />
            <FldStepper label={trFl('fld.galBack')} hint={held == null ? '' : trFl('fld.galBackHint', { n: held })} value={back} onChange={setBack} min={0} max={999} />
          </div>
          <div className="mlap-label">{trFl('fld.payment')}</div>
          <FldSeg label={trFl('fld.payment')} value={method} onChange={setMethod} options={[['lunas', trFl('fld.m_lunas')], ['bon', trFl('fld.m_bon')], ['transfer', trFl('fld.m_transfer')]]} />
          <div className="mlap-card mlap-sum2">
            <div className="mlap-sumline"><span>{trFl('fld.qtyLine', { n: qty, p: FIELDLOGIC.fmtRp(s.masterPrice) })}</span><span>{FIELDLOGIC.fmtRp(pv.subtotal)}</span></div>
            {s.sisaBon > 0 ? <div className="mlap-sumline"><span>{trFl('fld.oldBon')}</span><span className="mlap-bontxt">{FIELDLOGIC.fmtRp(s.sisaBon)}</span></div> : null}
            <div className="mlap-sumdiv" />
            <div className="mlap-sumtot"><span>{trFl(pv.totalKey)}</span><b>{FIELDLOGIC.fmtRp(pv.paidNow)}</b></div>
            <div className={'mlap-after' + (method === 'bon' ? ' bon' : '')}>{method === 'bon' ? trFl('fld.bonAfter', { v: FIELDLOGIC.fmtRp(pv.sisaAfter) }) : trFl('fld.bonStays', { v: FIELDLOGIC.fmtRp(pv.sisaAfter) })}</div>
            {onPayBon ? <button type="button" className="mlap-linkrow" onClick={onPayBon}><FldSvg n="cash" s={15} sw={2.2} />{trFl('fld.payOldBon')}</button> : null}
          </div>
          <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.proofHintSale" req={trFl(reqKey)} />
        </fieldset>
        {needReason && (
          <div className="mlap-card mlap-reason warn">
            <b>{trFl('fld.noLocT')}</b>
            <span className="sb">{trFl('fld.noLocB')}</span>
            <input className="mlap-text" value={noLoc} onChange={(e) => setNoLoc(e.target.value.slice(0, 300))} placeholder={trFl('fld.writeReason')} aria-label={trFl('fld.noLocT')} />
          </div>
        )}
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar hint={why ? trFl(why) : ''}>
        <button type="button" className="mlap-btn primary" disabled={busy || !!why || (needReason && !noLoc.trim())} onClick={save}><FldSvg n="check" s={18} sw={2.6} />{trFl(txnId ? 'fld.retryMark' : 'fld.saveDeliver')}</button>
      </FldCtaBar>
    </div>
  );
```

In `dist-field.jsx` replace the FldSale mount with:

```jsx
      {ready && full && view.name === 'sale' && <FldSale api={api} stop={view.stop} pending={pending} refs={refs} onDone={done} onBack={() => setView(null)} onPayBon={view.stop.sisaBon > 0 && can.bon ? () => openFor('bon', fldCustFromStop(view.stop)) : null} />}
```

- [ ] **Step 4: Append the CSS:**

```css
/* ── 3D-2 TRANSAKSI — mockup Transaksi board ── */
.mlap-sum2 { padding: 12px; display: flex; flex-direction: column; gap: 7px; }
.mlap-sumline { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; font-variant-numeric: tabular-nums; }
.mlap-sumline > span:first-child { color: var(--mlap-sub); }
.mlap-sumdiv { height: 1px; background: #EDF1F4; }
.mlap-sumtot { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.mlap-sumtot > span { font-size: 15px; font-weight: 600; }
.mlap-sumtot b { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mlap-after { font-size: 12px; line-height: 16px; font-weight: 400; padding: 6px 8px; border-radius: 8px; background: #EEF2F6; color: #3E4E58; }
.mlap-after.bon { background: #FCF1D6; color: #7A4B00; }
.mlap-linkrow { min-height: 44px; display: flex; align-items: center; gap: 6px; padding: 0; border: 0; background: transparent; font: inherit; font-size: 14px; font-weight: 600; color: #065489; cursor: pointer; text-align: left; }
```

- [ ] **Step 5: Add the i18n keys.** EN: ` 'fld.stopN': 'Stop {n}', 'fld.payOldBon': 'Collect the old bon',` — ID: ` 'fld.stopN': 'Stop {n}', 'fld.payOldBon': 'Terima pembayaran bon lama',`

- [ ] **Step 6: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-day.test.js tests/field-day-static.test.js tests/field-shell-static.test.js`
Expected: PASS. If `field-day-static` pinned the old in-body hint (`<div className="mlap-hint">{trFl(why)}</div>`), update it to the `FldCtaBar hint` form and ledger the ruling.

- [ ] **Step 7: Side-by-side check** — Transaksi for a stop with a bon (Lunas, then Bon, then Transfer) next to `Transaksi.dc.html`.

- [ ] **Step 8: Commit**

```bash
git add dist-field-day.jsx dist-field.jsx dist-field.css finance-i18n.js server/tests/field-3d2-day.test.js server/tests/field-day-static.test.js
git commit -m "feat(distribusi): Transaksi to the mockup — 22px customer, SVG steppers, totals with after pill, photo card, fixed save bar"
```

---

### Task 7: Buka rit / Tutup rit — mockup Buka rit board (a sheet over Pengiriman)

**Files:**
- Modify: `dist-field-logic.js` (`loadPreview` adds `bar`, `total`)
- Modify: `dist-field-day.jsx` (add `FldRitSheet`; rewrite the returns of `FldOpenRun`, `FldCloseRun`)
- Modify: `dist-field.jsx` (`'run'` is no longer a full-screen task; mounted with the sheets)
- Modify: `dist-field.css` (append `3D-2 RIT`), `finance-i18n.js`
- Test: `server/tests/field-logic.test.js` (append), `server/tests/field-3d2-day.test.js` (append); update `server/tests/field-day-static.test.js` (one assertion)

**Interfaces:**
- Consumes: `FldStepper cls`, `FldChips tone="warn"`, `FldSheetHead big`, `.mlap-sheet.tall.mid`, `.mlap-after` (Tasks 1, 6).
- Produces: `FIELDLOGIC.loadPreview(o) → { fits, used, leftoverGallons, estRits, unlocated, bar: [{ qty, fit }], total }`; `FldRitSheet({ title, sub, onClose, cta, children })`.

- [ ] **Step 1: Write the failing tests.** Append to `server/tests/field-logic.test.js`:

```js
describe('3D-2 rit preview bar', () => {
  it('loadPreview gives the route-fit bar: planned stops first (fit), the rest after, in plan order', () => {
    const stops = [{ id: 'a', lat: -8.651, lng: 115.201, qty: 20 }, { id: 'b', lat: -8.66, lng: 115.21, qty: 40 }, { id: 'c', lat: -8.7, lng: 115.3, qty: 30 }];
    const pv = L.loadPreview({ planRit, depot: { lat: -8.65, lng: 115.2 }, stops, load: 60 });
    expect(pv.total).toBe(pv.bar.length);
    expect(pv.bar.filter((b) => b.fit).length).toBe(pv.fits);
    expect(pv.bar.slice(0, pv.fits).every((b) => b.fit)).toBe(true);
    expect(pv.bar.reduce((t, b) => t + (b.fit ? b.qty : 0), 0)).toBe(pv.used);
    expect(pv.bar.reduce((t, b) => t + (b.fit ? 0 : b.qty), 0)).toBe(pv.leftoverGallons);
  });
});
```

Append to `server/tests/field-3d2-day.test.js`:

```js
describe('Buka / Tutup rit (mockup Buka rit board) — a sheet over Pengiriman', () => {
  const f = () => fn(day, 'FldOpenRun');
  it('a 118 px sheet: the big ± load, presets, the SOP gauge with its marker, the route-fit bar', () => {
    expect(fn(day, 'FldRitSheet')).toMatch(/<div className="mlap-sheet tall mid" role="dialog" aria-modal="true" aria-label=\{title\} ref=\{drag\.ref\} style=\{drag\.style\}>/);
    expect(f()).toMatch(/<FldStepper label=\{trFl\('fld\.loadQ'\)\} value=\{g\.load\} onChange=\{setLoad\} min=\{0\} max=\{cap \|\| 9999\} cls=\{'big' \+ \(g\.under \? ' under' : ''\)\} \/>/);
    expect(f()).toMatch(/className=\{'mlap-preset' \+ \(g\.load === v \? ' on' : ''\)\}/);
    expect(f()).toMatch(/<i style=\{\{ left: gpct\(minLoad\) \+ '%' \}\} \/>/);
    expect(f()).toMatch(/pv\.bar\.map\(\(b, i\) => <span key=\{i\} className=\{b\.fit \? 'on' : ''\} style=\{\{ flex: b\.qty \}\} \/>\)/);
    expect(rule('RIT', '.mlap-preset.on')).toMatch(/border-color: #1A8C87; background: #DDF4F2; color: #0F6B66;/);
    expect(rule('RIT', '.mlap-gauge-bar > span.under')).toMatch(/background: #E8793A;/);
    expect(rule('RIT', '.mlap-fitbar > span.on')).toMatch(/background: #1A8C87;/);
  });
  it('below the SOP: orange reason chips, always asked; the CTA waits for a reason', () => {
    expect(f()).toMatch(/onChange=\{setReason\} tone="warn" \/>/);
    expect(f()).toMatch(/disabled=\{busy \|\| !g\.canOpen \|\| \(g\.under && !reason\.trim\(\)\)\}/);
  });
  it('Tutup rit is the same sheet; a difference still needs what happened', () => {
    const c = fn(day, 'FldCloseRun');
    expect(c).toMatch(/<FldRitSheet title=\{trFl\('fld\.closeRunT', \{ n: run\.runNo \}\)\}/);
    expect(c).toMatch(/disabled=\{busy \|\| \(diff !== 0 && !res\)\}/);
  });
  it('the shell opens it over the board, not as a full-screen task', () => {
    expect(shell).toMatch(/\{ready && view && view\.name === 'run' && <FldOpenRun api=\{api\} ctx=\{ctx\} tick=\{tick\} onDone=\{done\} onBack=\{\(\) => setView\(null\)\} \/>\}/);
    expect(shell).toMatch(/const full = view && \['sale', 'pick',/);
  });
});
```

In `server/tests/field-day-static.test.js` ("the load stepper is not capped at 2×SOP …") replace the assertion with:

```js
    expect(fn('FldOpenRun')).toMatch(/<FldStepper label=\{trFl\('fld\.loadQ'\)\} value=\{g\.load\} onChange=\{setLoad\} min=\{0\} max=\{cap \|\| 9999\} cls=/);
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-day.test.js`
Expected: FAIL — `pv.total` undefined; no `FldRitSheet`.

- [ ] **Step 3: Extend `loadPreview`** in `dist-field-logic.js` — replace its return line with:

```js
    // the route-fit bar of the board: every stop in plan order, coloured when it rides this rit
    var bar = p.rit.map(function (s) { return { qty: s.qty, fit: true }; }).concat(p.leftover.map(function (s) { return { qty: s.qty, fit: false }; }));
    return { fits: p.rit.length, used: p.used, leftoverGallons: p.leftoverGallons, estRits: p.estRits, unlocated: p.unlocated.length, bar: bar, total: bar.length };
```

- [ ] **Step 4: Add `FldRitSheet` and rewrite the two returns** in `dist-field-day.jsx`.

Add before the `// BUKA RIT —` comment:

```jsx
// Buka / Tutup rit as a sheet over Pengiriman (mockup Buka rit board): head with the close X, the body
// scrolls, the action stays at the bottom.
function FldRitSheet({ title, sub, onClose, cta, children }) {
  const drag = useFldSheetDrag(onClose);
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet tall mid" role="dialog" aria-modal="true" aria-label={title} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
        <FldSheetHead big title={title} sub={sub} onClose={onClose} />
        <div className="mlap-sheet-body">{children}</div>
        {cta ? <div className="mlap-sheet-cta">{cta}</div> : null}
      </div>
    </>
  );
}
```

In `FldOpenRun` replace the loading line `if (!d) return err ? … ;` with:

```jsx
  if (!d) return <FldRitSheet title={trFl('fld.openRunT')} onClose={onBack}>{err ? <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={err} /> : <div className="mlap-empty">{trFl('fld.loading')}</div>}</FldRitSheet>;
```

and replace its `return (...)` (keep `open` and everything above) with:

```jsx
  const gpct = (x) => Math.max(0, Math.min(100, (x / g.max) * 100));
  const last = (d.runs || []).filter((r) => r.date === ctx.today).sort((a, b) => b.runNo - a.runNo)[0];
  const sub = [ctx.fleet, cap ? trFl('fld.capN', { n: cap }) : trFl('fld.capNone'), last ? trFl('fld.lastRunN', { n: last.runNo, g: last.gallonsOut }) : ''].filter(Boolean).join(' · ');
  return (
    <FldRitSheet title={trFl('fld.openRunN', { n: rs.nextNo })} sub={sub} onClose={onBack}
      cta={<button type="button" className="mlap-btn primary" disabled={busy || !g.canOpen || (g.under && !reason.trim())} onClick={open}>{trFl('fld.openAndRoute')}</button>}>
      <div className="mlap-card mlap-loadcard">
        <FldStepper label={trFl('fld.loadQ')} value={g.load} onChange={setLoad} min={0} max={cap || 9999} cls={'big' + (g.under ? ' under' : '')} />
        <div className="mlap-presets">{presets.map((v) => <button key={v} type="button" className={'mlap-preset' + (g.load === v ? ' on' : '')} aria-pressed={g.load === v} onClick={() => setLoad(v)}>{v}</button>)}</div>
        <div className="mlap-gauge">
          <div className="mlap-gauge-bar"><span className={g.under ? 'under' : ''} style={{ width: gpct(g.load) + '%' }} /><i style={{ left: gpct(minLoad) + '%' }} /></div>
          <div className="mlap-gauge-sc"><span>0</span><b style={{ left: gpct(minLoad) + '%' }}>{trFl('fld.sopN', { n: minLoad })}</b>{cap ? <span className="r">{trFl('fld.capN', { n: cap })}</span> : null}</div>
          {g.atCap ? <span className="mlap-gauge-full">{trFl('fld.fullLoad')}</span> : null}
        </div>
      </div>
      {g.under && (
        <div className="mlap-card mlap-reason warn">
          <div className="mlap-reason-hd"><FldSvg n="warn" s={16} sw={2.2} /><b>{trFl('fld.underSopT2', { n: minLoad - g.load })}</b></div>
          <FldChips options={FLD_SOP_REASONS.map((k) => trFl(k)).concat([trFl('fld.r_other')])} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} tone="warn" />
          <span className="mlap-reason-note">{trFl('fld.underSopB')}</span>
        </div>
      )}
      {pv ? (
        <div className="mlap-card mlap-fit">
          <div className="mlap-fit-hd"><FldSvg n="route" s={16} /><b>{trFl('fld.previewT')}</b></div>
          <div className="mlap-fit-n"><b>{pv.fits}</b><span>{trFl('fld.fitsOf', { n: pv.total, g: pv.used })}</span></div>
          {pv.bar.length ? <div className="mlap-fitbar" aria-hidden="true">{pv.bar.map((b, i) => <span key={i} className={b.fit ? 'on' : ''} style={{ flex: b.qty }} />)}</div> : null}
          <span className={'mlap-after' + (pv.leftoverGallons > 0 ? '' : ' ok')}>{pv.leftoverGallons > 0 ? trFl('fld.fitLeft', { n: pv.total - pv.fits, g: pv.leftoverGallons }) : trFl('fld.fitAll', { g: g.load - pv.used })}</span>
          {pv.unlocated > 0 ? <span className="mlap-hint">{trFl('fld.previewNoPin', { n: pv.unlocated })}</span> : null}
        </div>
      ) : !ctx.depot ? <FldNotice tone="info" title={trFl('fld.noDepotT')} sub={trFl('fld.noDepotB')} /> : null}
      {err && <div className="mlap-err" role="alert">{err}</div>}
    </FldRitSheet>
  );
```

Replace the `return (...)` of `FldCloseRun` with:

```jsx
  return (
    <FldRitSheet title={trFl('fld.closeRunT', { n: run.runNo })} sub={trFl('fld.loadedSold', { out: run.gallonsOut, sold: run.sold || 0 })} onClose={onBack}
      cta={<button type="button" className="mlap-btn primary" disabled={busy || (diff !== 0 && !res)} onClick={close}>{trFl('fld.closeRunSave')}</button>}>
      {stale ? <FldNotice tone="warn" title={trFl('fld.staleNote', { date: run.date })} sub={trFl('fld.staleRunB')} /> : null}
      <div className="mlap-card">
        <FldStepper label={trFl('fld.fullBack')} hint={trFl('fld.fullBackHint', { n: expected })} value={full} onChange={setFull} min={0} max={9999} />
        <FldStepper label={trFl('fld.emptyBack')} value={empty} onChange={setEmpty} min={0} max={9999} />
      </div>
      {diff !== 0 && (
        <div className="mlap-card mlap-reason warn">
          <div className="mlap-reason-hd"><FldSvg n="warn" s={16} sw={2.2} /><b>{trFl('fld.diffT', { d: (diff > 0 ? '+' : '') + diff })}</b></div>
          <div className="mlap-chips warn">{allowed.map(([k, key]) => <button key={k} type="button" className={'mlap-chip-b' + (res === k ? ' on' : '')} aria-pressed={res === k} onClick={() => setRes(k)}>{trFl(key)}</button>)}</div>
          <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
        </div>
      )}
      {err && <div className="mlap-err" role="alert">{err}</div>}
    </FldRitSheet>
  );
```

- [ ] **Step 5: Make it a sheet in the shell** (`dist-field.jsx`): remove `'run', ` from the `full` list (it becomes `['sale', 'pick', 'bon', …]`), delete the line `{ready && full && view.name === 'run' && <FldOpenRun … />}`, and add next to the stop-sheet line:

```jsx
      {ready && view && view.name === 'run' && <FldOpenRun api={api} ctx={ctx} tick={tick} onDone={done} onBack={() => setView(null)} />}
```

- [ ] **Step 6: Append the CSS:**

```css
/* ── 3D-2 RIT — mockup Buka rit board (Buka / Tutup rit as a sheet) ── */
.mlap-loadcard { padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.mlap-loadcard .mlap-stepper.big { padding: 0; min-height: 0; align-self: stretch; }
.mlap-presets { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.mlap-preset { min-width: 52px; min-height: 44px; padding: 0 12px; border-radius: 22px; border: 1px solid #D5DDE3; background: #FFFFFF; font: inherit; font-size: 14px; font-weight: 600; color: var(--mlap-ink); cursor: pointer; transition: transform .35s cubic-bezier(.34,1.56,.64,1); }
.mlap-preset:active { transform: scale(.9); }
.mlap-preset.on { border-color: #1A8C87; background: #DDF4F2; color: #0F6B66; }
.mlap-gauge { align-self: stretch; display: flex; flex-direction: column; gap: 4px; padding-top: 2px; }
.mlap-gauge-bar { position: relative; height: 8px; border-radius: 4px; background: #E1E8ED; }
.mlap-gauge-bar > span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: #1A8C87; transition: width .45s cubic-bezier(.34,1.56,.64,1), background .25s ease; }
.mlap-gauge-bar > span.under { background: #E8793A; }
.mlap-gauge-bar > i { position: absolute; top: -4px; width: 2px; height: 16px; margin-left: -1px; border-radius: 1px; background: #0E1B24; }
.mlap-gauge-sc { position: relative; height: 14px; font-size: 11px; color: var(--mlap-sub); }
.mlap-gauge-sc > span { position: absolute; left: 0; }
.mlap-gauge-sc > span.r { left: auto; right: 0; }
.mlap-gauge-sc > b { position: absolute; transform: translateX(-50%); white-space: nowrap; font-weight: 700; color: var(--mlap-ink); }
.mlap-gauge-full { font-size: 12px; font-weight: 600; color: #0F6B66; text-align: center; animation: mlapFade .25s ease both; }
.mlap-reason.warn { border-radius: 16px; padding: 10px 12px; gap: 8px; }
.mlap-reason-hd { display: flex; align-items: center; gap: 8px; color: #9A3412; }
.mlap-reason-hd > svg { flex-shrink: 0; }
.mlap-reason-hd b { font-size: 14px; font-weight: 700; }
.mlap-reason-note { font-size: 12px; color: #7C2D12; }
.mlap-fit { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.mlap-fit-hd { display: flex; align-items: center; gap: 8px; }
.mlap-fit-hd > svg { color: #065489; }
.mlap-fit-hd b { font-size: 14px; font-weight: 600; }
.mlap-fit-n { display: flex; align-items: baseline; gap: 6px; }
.mlap-fit-n b { font-size: 22px; font-weight: 700; }
.mlap-fit-n span { font-size: 14px; color: #3E4E58; }
.mlap-fitbar { display: flex; gap: 2px; height: 8px; }
.mlap-fitbar > span { border-radius: 2px; background: #DDE4EA; transition: background .25s ease; }
.mlap-fitbar > span.on { background: #1A8C87; }
.mlap-after.ok { background: #E3F3EA; color: #1E6B40; }
```

- [ ] **Step 7: Add the i18n keys** (no apostrophes — the strings are single-quoted). EN:

```
 'fld.openRunT': 'Open a trip', 'fld.lastRunN': 'trip {n}: {g} gallons', 'fld.underSopT2': 'Below SOP ({n} gallons short) — pick a reason', 'fld.fitsOf': 'of {n} stops carried · {g} gallons', 'fld.fitLeft': '{n} stops ({g} gallons) wait for the next trip.', 'fld.fitAll': 'Every stop fits. {g} gallons come back to the warehouse.',
```

ID:

```
 'fld.openRunT': 'Buka rit', 'fld.lastRunN': 'rit {n}: {g} galon', 'fld.underSopT2': 'Di bawah SOP ({n} galon kurang) — pilih alasannya', 'fld.fitsOf': 'dari {n} stop terangkut · {g} galon', 'fld.fitLeft': '{n} stop ({g} galon) menunggu rit berikutnya.', 'fld.fitAll': 'Semua stop hari ini muat. Sisa {g} galon kembali ke gudang.',
```

- [ ] **Step 8: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-day.test.js tests/field-day-static.test.js tests/field-shell-static.test.js tests/field-sandbox.test.js`
Expected: PASS. If `field-shell-static` pinned the old `full` list or a full-screen `FldOpenRun` mount, update it to the sheet mount and ledger it.

- [ ] **Step 9: Side-by-side check** — Buka rit with load 64 (under SOP, reason chips) and with 120 (full) next to `BukaRit.dc.html`; Tutup rit with a −2 difference.

- [ ] **Step 10: Commit**

```bash
git add dist-field-logic.js dist-field-day.jsx dist-field.jsx dist-field.css finance-i18n.js server/tests/field-logic.test.js server/tests/field-3d2-day.test.js server/tests/field-day-static.test.js server/tests/field-shell-static.test.js
git commit -m "feat(distribusi): Buka/Tutup rit as a sheet to the mockup — big ± load, presets, SOP gauge with marker, route-fit bar"
```

---

### Task 8: Peta — mockup Rute rit board (full-bleed map, glass bar, detent sheet)

**Files:**
- Modify: `dist-field-day.jsx` (`FldRoute`), `dist-field.jsx` (no tab header on Peta; FldRoute props)
- Modify: `dist-field.css` (append `3D-2 PETA`), `finance-i18n.js`
- Test: `server/tests/field-3d2-day.test.js` (append)

**Interfaces:**
- Consumes: `.mlap-glass`, `.mlap-rit-dot`, `.mlap-alert` (Tasks 1, 4).
- Produces: `FldRoute({ api, ctx, tick, fleet, onOpenRun, onMenu, onAddStop })`.

- [ ] **Step 1: Write the failing test.** Append to `server/tests/field-3d2-day.test.js`:

```js
describe('Peta (mockup Rute rit board)', () => {
  const f = () => fn(day, 'FldRoute');
  it('a full-bleed map; the OSM attribution moves to the top (the sheet covers the bottom)', () => {
    expect(f()).toMatch(/className="mlap-map mlap-mapfull"/);
    expect(f()).toMatch(/L\.map\(mapEl\.current, \{ zoomControl: false, attributionControl: false \}\);/);
    expect(f()).toMatch(/L\.control\.attribution\(\{ position: 'topright' \}\)\.addTo\(map\);/);
    expect(rule('PETA', '.mlap-mapfull')).toMatch(/position: fixed; inset: 0;/);
  });
  it('a glass bar (rit pill, locate, menu) and a detent sheet 470 / 700 with the figures and the legs', () => {
    expect(f()).toMatch(/<div className="mlap-glass mlap-mappill">/);
    expect(f()).toMatch(/className=\{'mlap-mapsheet' \+ \(open \? ' open' : ''\)\}/);
    expect(f()).toMatch(/aria-expanded=\{open\} onClick=\{\(\) => setOpen\(!open\)\}/);
    expect(f()).toMatch(/className=\{'mlap-legno' \+ \(i === 0 \? ' now' : ''\)\}/);
    expect(rule('PETA', '.mlap-mapsheet')).toMatch(/height: min\(470px, 56vh\);/);
    expect(rule('PETA', '.mlap-mapsheet.open')).toMatch(/height: min\(700px, calc\(100vh - 120px\)\);/);
    expect(rule('PETA', '.mlap-mapsheet')).toMatch(/background: rgba\(248,250,252,\.88\);/);
  });
  it('the route line is solid out and dashed back; the next stop is the filled pin', () => {
    expect(f()).toMatch(/dashArray: '2 7'/);
    expect(f()).toMatch(/'<span class="mlap-pin' \+ \(i === 0 \? ' now' : ''\) \+ '">'/);
  });
  it('the shell drops its header on Peta (the glass bar replaces it) and hands it the menu', () => {
    expect(shell).toMatch(/\{tab !== 'peta' \? \(\s*<div className="mlap-head">/);
    expect(shell).toMatch(/<FldRoute api=\{api\} ctx=\{ctx\} tick=\{tick\} fleet=\{fleet\} onOpenRun=\{\(\) => setView\(\{ name: 'run' \}\)\} onMenu=\{\(\) => setMenu\(true\)\} onAddStop=\{can\.addStop \? \(\) => setView\(\{ name: 'addStop' \}\) : null\} \/>/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-day.test.js`
Expected: FAIL in "Peta".

- [ ] **Step 3: Replace `FldRoute`** in `dist-field-day.jsx` (its comment block included):

```jsx
// RUTE RIT / PETA (mockup Rute rit board) — today's open rit planned from the warehouse (the server's
// planner, or the phone's copy of it in practice): a full-bleed map under a glass bar, and a sheet that
// opens from 470 to 700 px with the figures and the legs. The map is a bonus: when Leaflet or the tiles
// can't load (offline), the sheet still works.
function FldRoute({ api, ctx, tick, fleet, onOpenRun, onMenu, onAddStop }) {
  const [runs, setRuns] = uSfl([]);
  uEfl(() => { let live = true; api.runs().then((r) => { if (live) setRuns(r || []); }).catch(() => {}); return () => { live = false; }; }, [api, tick]);
  const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs });
  const [route, setRoute] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [mapErr, setMapErr] = uSfl(false);
  const [open, setOpen] = uSfl(false);
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
    if (!route || mapErr || !mapEl.current) return undefined;
    let live = true;
    znLoadLeaflet().then((L) => {
      if (!live || !mapEl.current) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: false });
      L.control.attribution({ position: 'topright' }).addTo(map);
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      const depot = [route.origin.lat, route.origin.lng];
      const pts = [depot];
      L.marker(depot, { keyboard: false, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [34, 34], html: '<span class="mlap-pin depot"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"><path d="M3 12 12 4l9 8v8H3z"/></svg></span>' }) }).addTo(map);
      route.rit.forEach((s, i) => {
        if (typeof s.lat !== 'number' || typeof s.lng !== 'number') return;
        pts.push([s.lat, s.lng]);
        L.marker([s.lat, s.lng], { keyboard: false, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [28, 28], html: '<span class="mlap-pin' + (i === 0 ? ' now' : '') + '">' + Number(s.order) + '</span>' }) }).addTo(map);
      });
      L.polyline(pts, { color: '#065489', weight: 4, opacity: 0.9 }).addTo(map);
      if (pts.length > 1) L.polyline([pts[pts.length - 1], depot], { color: '#065489', weight: 3.5, opacity: 0.75, dashArray: '2 7' }).addTo(map);
      map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [24, 80], paddingBottomRight: [24, Math.min(470, window.innerHeight * 0.56) + 24] });
    }).catch(() => { if (live) setMapErr(true); });
    return () => { live = false; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [route, mapErr]);
  const locate = () => { fldGeo(8000).then((p) => { if (p && mapRef.current) mapRef.current.setView([p.lat, p.lng], 16); }); };
  const bar = (title) => (
    <div className="mlap-mapbar">
      <div className="mlap-glass mlap-mappill">{routeOk ? <span className="mlap-rit-dot" aria-hidden="true" /> : null}{title}</div>
      {route && !mapErr ? <button type="button" className="mlap-round" aria-label={trFl('fld.myPos')} onClick={locate}><FldSvg n="locate" s={18} /></button> : null}
      <button type="button" className="mlap-round" aria-label={trFl('fld.menu')} onClick={onMenu}><FldSvg n="dots" s={19} /></button>
    </div>
  );
  if (!rs.open || rs.stale) return (
    <div className="mlap-mapempty">
      {bar(trFl('fld.tabPeta'))}
      <FldNotice tone={rs.stale ? 'warn' : 'info'} title={rs.stale ? trFl('fld.staleRunT', { n: rs.open.runNo, date: rs.open.date }) : trFl('fld.noRunT')} sub={rs.stale ? trFl('fld.staleRunB') : trFl('fld.noRunB')}
        action={rs.stale ? trFl('fld.closeRun') : trFl('fld.openRunN', { n: rs.nextNo })} onAction={onOpenRun} />
    </div>
  );
  const title = trFl('fld.ritN', { n: rs.open.runNo }) + (fleet ? ' · ' + fleet : '');
  if (err) return <div className="mlap-mapempty">{bar(title)}<FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /></div>;
  if (!route) return <div className="mlap-mapempty">{bar(title)}<div className="mlap-empty">{trFl('fld.loading')}</div></div>;
  const legs = open ? route.rit : route.rit.slice(0, 4);
  const first = route.rit[0];
  const firstNav = first ? fldLinks(first).nav : '';
  return (
    <>
      {mapErr ? null : <div ref={mapEl} className="mlap-map mlap-mapfull" role="img" aria-label={trFl('fld.routeT', { n: route.run.runNo })} />}
      {bar(title)}
      {mapErr ? <div className="mlap-mapempty"><FldNotice tone="info" title={trFl('fld.mapOff')} action={trFl('fld.retry')} onAction={() => setMapErr(false)} /></div> : null}
      <div className={'mlap-mapsheet' + (open ? ' open' : '')}>
        <button type="button" className="mlap-mapsheet-grab" aria-label={trFl(open ? 'fld.sheetLess' : 'fld.sheetMore')} aria-expanded={open} onClick={() => setOpen(!open)}><span className="mlap-grab" /></button>
        <div className="mlap-mapsheet-hd"><b>{trFl('fld.routeT', { n: route.run.runNo })}</b><span className="sb">{trFl('fld.fromDepot')}</span></div>
        <div className="mlap-mapsheet-in">
          <div className="mlap-card mlap-routefig2">
            <div><b className="teal">{route.used}/{route.capacity}</b><span>{trFl('fld.gallonsUsed')}</span></div>
            <div><b>{FIELDLOGIC.fmtKm(route.totalKm - route.returnKm)}</b><span>{trFl('fld.kmBack', { km: FIELDLOGIC.fmtKm(route.returnKm) })}</span></div>
            <div><b>{route.leftover.length}</b><span>{trFl('fld.toRitN', { n: route.run.runNo + 1 })}</span></div>
          </div>
          {route.unlocated.length > 0 ? (
            <button type="button" className="mlap-alert warn sm" disabled={!onAddStop} onClick={onAddStop || undefined}>
              <FldSvg n="pinOff" s={15} sw={2.2} style={{ flexShrink: 0 }} />
              <span className="mlap-grow">{trFl('fld.unlocatedT', { n: route.unlocated.length })}</span>
              {onAddStop ? <span className="act">{trFl('fld.see')}</span> : null}
            </button>
          ) : null}
          {route.tooBig.length > 0 ? <FldNotice tone="warn" title={trFl('fld.tooBigT', { n: route.tooBig.length })} /> : null}
          <div className="mlap-card mlap-legs">
            {legs.length ? legs.map((s, i) => (
              <div key={s.id} className="mlap-row mlap-legrow">
                <span className={'mlap-legno' + (i === 0 ? ' now' : '')}>{s.order}</span>
                <span className="mlap-grow"><span className="nm">{s.customerName}</span><span className="sb">{trFl('fld.legSub', { q: s.qty, km: FIELDLOGIC.fmtKm(s.legKm) })}{i === 0 ? ' · ' + trFl('fld.nextLow') : ''}</span></span>
                <span className="mlap-legleft"><b>{s.loadAfter}</b><span className="sb">{trFl('fld.loadLeft')}</span></span>
              </div>
            )) : <div className="mlap-empty">{trFl('fld.emptyRoute')}</div>}
            {route.rit.length ? (
              <div className="mlap-row mlap-legrow">
                <span className="mlap-legno depot"><FldSvg n="home" s={14} sw={2.4} /></span>
                <span className="mlap-grow">{trFl('fld.backToDepot', { km: FIELDLOGIC.fmtKm(route.returnKm) })}</span>
                <button type="button" className="mlap-rit-link" onClick={onOpenRun}>{trFl('fld.closeRun')}</button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mlap-mapsheet-cta"><FldLinkBtn href={firstNav} className="mlap-btn primary" newTab><FldSvg n="navigate" s={18} sw={2.2} />{first ? trFl('fld.navTo', { n: first.order }) : trFl('fld.navigate')}</FldLinkBtn></div>
      </div>
    </>
  );
}
```

(The older assertions on `FldRoute` — `if (!rs.open || rs.stale) return`, `api.ritRoute()`, `znLoadLeaflet().then(`, the `setMapErr(true)` catch, `className="mlap-card mlap-legs"`, `mapErr ?`, `mapRef.current.remove()`, the OSM URL + attribution, `api.runs()`, the `runState` call, the retry action and `}, [route, mapErr]);` — all still hold.)

- [ ] **Step 4: The shell** (`dist-field.jsx`): wrap the tab header so Peta has none — replace `<div className="mlap-head">` … its closing `</div>` (the block with `mlap-head-t` and `mlap-head-act`) with `{tab !== 'peta' ? (` + that same block + `) : null}`; replace the Peta body line with:

```jsx
    body = <FldRoute api={api} ctx={ctx} tick={tick} fleet={fleet} onOpenRun={() => setView({ name: 'run' })} onMenu={() => setMenu(true)} onAddStop={can.addStop ? () => setView({ name: 'addStop' }) : null} />;
```

- [ ] **Step 5: Append the CSS:**

```css
/* ── 3D-2 PETA — mockup Rute rit board (full-bleed map, glass bar, detent sheet) ── */
.mlap-mapfull { position: fixed; inset: 0; height: auto; border-radius: 0; z-index: 0; }
.mlap-mapfull .leaflet-top { top: calc(64px + env(safe-area-inset-top)); }
.mlap-mapbar { position: fixed; z-index: 5; top: calc(8px + env(safe-area-inset-top)); left: 16px; right: 16px; max-width: 528px; margin: 0 auto; display: flex; align-items: center; gap: 8px; }
.mlap-mappill { flex: 1; min-width: 0; height: 44px; border-radius: 22px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 12px; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; }
.mlap-mapempty { padding-top: calc(64px + env(safe-area-inset-top)); display: flex; flex-direction: column; gap: 10px; }
.mlap-mapsheet { position: fixed; z-index: 6; left: 50%; transform: translateX(-50%); bottom: 0; width: min(560px, 100vw); height: min(470px, 56vh); display: flex; flex-direction: column; box-sizing: border-box; padding-bottom: calc(96px + env(safe-area-inset-bottom)); border-radius: 28px 28px 0 0; background: rgba(248,250,252,.88); -webkit-backdrop-filter: blur(34px) saturate(1.5); backdrop-filter: blur(34px) saturate(1.5); border-top: 1px solid rgba(255,255,255,.95); box-shadow: 0 -10px 40px rgba(6,51,79,.18), inset 0 1px 0 rgba(255,255,255,.95); transition: height .45s cubic-bezier(.34,1.3,.64,1); }
.mlap-mapsheet.open { height: min(700px, calc(100vh - 120px)); }
.mlap-mapsheet-grab { height: 24px; flex-shrink: 0; border: 0; background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.mlap-mapsheet-grab .mlap-grab { margin: 0; }
.mlap-mapsheet-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 2px 16px 0; }
.mlap-mapsheet-hd b { font-size: 19px; font-weight: 700; }
.mlap-mapsheet-hd .sb { font-size: 13px; color: var(--mlap-sub); }
.mlap-mapsheet-in { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 8px 16px 0; display: flex; flex-direction: column; gap: 8px; }
.mlap-routefig2 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-radius: 14px; flex-shrink: 0; }
.mlap-routefig2 > div { padding: 8px 12px; display: flex; flex-direction: column; border-right: 1px solid var(--mlap-line); }
.mlap-routefig2 > div:last-child { border-right: 0; }
.mlap-routefig2 b { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mlap-routefig2 b.teal { color: #0F6B66; }
.mlap-routefig2 span { font-size: 12px; color: var(--mlap-sub); }
.mlap-alert.sm { min-height: 44px; border-radius: 12px; padding: 0 10px; gap: 8px; font-size: 13px; font-weight: 600; flex-shrink: 0; }
.mlap-legs { border-radius: 14px; flex-shrink: 0; }
.mlap-legrow { min-height: 46px; padding: 0 12px; }
.mlap-legno { width: 26px; height: 26px; border-radius: 8px; flex-shrink: 0; display: grid; place-items: center; font-size: 12px; font-weight: 700; background: #E8F1F8; color: #065489; }
.mlap-legno.now { background: #065489; color: #FFFFFF; }
.mlap-legno.depot { background: #0E1B24; color: #FFFFFF; }
.mlap-legrow .nm { font-size: 14px; }
.mlap-legleft b { font-size: 14px; font-weight: 700; color: #0F6B66; }
.mlap-legleft .sb { font-size: 11px; }
.mlap-mapsheet-cta { padding: 10px 16px 0; flex-shrink: 0; }
.mlap-mapsheet-cta .mlap-btn { width: 100%; min-height: 48px; border-radius: 14px; font-size: 16px; }
.mlap-pin { background: #FFFFFF; color: #065489; border: 2.5px solid #065489; }
.mlap-pin.now { width: 28px; height: 28px; background: #065489; color: #FFFFFF; border-color: #FFFFFF; box-shadow: 0 0 0 6px rgba(6,84,137,.18); }
.mlap-pin.depot { width: 34px; height: 34px; border-radius: 50%; background: #0E1B24; border: 0; }
```

- [ ] **Step 6: Add the i18n keys.** EN: ` 'fld.myPos': 'Centre on my position', 'fld.sheetMore': 'Show every stop', 'fld.sheetLess': 'Show less', 'fld.toRitN': 'to trip {n}', 'fld.see': 'See', 'fld.nextLow': 'next',` — ID: ` 'fld.myPos': 'Pusatkan ke posisi saya', 'fld.sheetMore': 'Tampilkan semua stop', 'fld.sheetLess': 'Perkecil daftar', 'fld.toRitN': 'ke rit {n}', 'fld.see': 'Lihat', 'fld.nextLow': 'berikutnya',`

- [ ] **Step 7: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-day.test.js tests/field-day-static.test.js tests/field-shell-static.test.js tests/field-3d2-kit.test.js`
Expected: PASS (the swipe exclusion list still names `.mlap-map` and `.leaflet-container`, so dragging the map never switches tabs).

- [ ] **Step 8: Side-by-side check** — Peta with an open rit, sheet closed and open, next to `RuteRit.dc.html`; check the OSM attribution is visible under the bar and the CTA sits above the dock.

- [ ] **Step 9: Commit**

```bash
git add dist-field-day.jsx dist-field.jsx dist-field.css finance-i18n.js server/tests/field-3d2-day.test.js
git commit -m "feat(distribusi): Peta to the mockup — full-bleed map, glass bar, 470/700 detent sheet, solid-out dashed-back route"
```

---

### Task 9: Setoran — mockup Selesai board

**Files:**
- Modify: `dist-field-day.jsx` (`FldSetoran`), `dist-field.jsx` (title, props)
- Modify: `dist-field.css` (append `3D-2 SETORAN`), `finance-i18n.js`
- Test: `server/tests/field-3d2-day.test.js` (append); update `server/tests/field-day-static.test.js` (signature assertion)

**Interfaces:**
- Consumes: `FldPickSheet`, `FldCtaBar`, `.mlap-kv`, `.mlap-ctaspace`, `.mlap-pickbtn` (Task 1); `goIncomplete` (Task 4).
- Produces: `FldSetoran({ api, ctx, tick, canKoreksi, onKoreksiSaya, onChanged, onExpense, onIncomplete })`.

- [ ] **Step 1: Write the failing test.** Append to `server/tests/field-3d2-day.test.js`:

```js
describe('Setoran (mockup Selesai board)', () => {
  const f = () => fn(day, 'FldSetoran');
  it('three coloured KPI tiles; the deposit row highlighted; Pengeluaran opens the expense screen; a galon card', () => {
    expect(f()).toMatch(/<div className="mlap-kpi3">/);
    expect(f()).toMatch(/<b className="ok">\{sum\.stops\.terkirim\}<\/b>/);
    expect(f()).toMatch(/<div className="mlap-kv total"><span>\{trFl\('fld\.s_setor'\)\}<\/span><b>\{FIELDLOGIC\.fmtRp\(sum\.wajibSetor\)\}<\/b><\/div>/);
    expect(f()).toMatch(/onExpense \? <button type="button" className="mlap-kv mlap-kvbtn" onClick=\{onExpense\}>/);
    expect(f()).toMatch(/<div className="mlap-card mlap-gal3">/);
    expect(rule('SETORAN', '.mlap-kpi3 b.ok')).toMatch(/color: #1E6B40;/);
  });
  it('unfinished stops pick their reason in a sheet (no <select>), red until chosen', () => {
    expect(f()).not.toMatch(/<select/);
    expect(f()).toMatch(/className=\{'mlap-pickbtn' \+ \(r \? '' : ' miss'\)\}/);
    expect(f()).toMatch(/<FldPickSheet title=\{trFl\('fld\.reasonFor', \{ name: pick\.customerName \}\)\} options=\{opts\}/);
  });
  it('"Tutup hari & setor" is the fixed bar above the dock, its hint red or green', () => {
    expect(f()).toMatch(/<FldCtaBar hint=\{chk\.ok \? <span className="ok">\{trFl\('fld\.allStopsDone'\)\}<\/span> : trFl\('fld\.missingReasons', \{ n: chk\.missing\.length \}\)\}>/);
    expect(f()).toMatch(/<div className="mlap-ctaspace" \/>/);
    expect(rule('SETORAN', '.mlap-swipe .mlap-ctabar')).toMatch(/bottom: calc\(100px \+ env\(safe-area-inset-bottom\)\);/);
  });
  it('the tab is titled "Setoran hari ini"; the shell hands it Pengeluaran and "Lengkapi"', () => {
    expect(shell).toMatch(/trFl\(tab === 'setoran' \? 'fld\.setoranT' : TAB_LABEL\[tab\]\)/);
    expect(shell).toMatch(/onExpense=\{can\.expense \? \(\) => setView\(\{ name: 'exp' \}\) : null\} onIncomplete=\{goIncomplete\}/);
  });
});
```

In `server/tests/field-day-static.test.js` ("Setoran opens Koreksi saya …") replace the signature assertion with:

```js
    expect(f).toMatch(/function FldSetoran\(\{ api, ctx, tick, canKoreksi, onKoreksiSaya, onChanged, onExpense, onIncomplete \}\)/);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-day.test.js`
Expected: FAIL in "Setoran".

- [ ] **Step 3: Replace `FldSetoran`** in `dist-field-day.jsx` (its comment block included):

```jsx
// SETORAN / SELESAI KERJA (mockup Selesai board) — the day's money and gallons from the server's day
// summary (the same figures as the delivery report), then "close the day": every stop still waiting
// needs a reason (it moves to Tunda and carries over), picked in a sheet. Pending corrections never block
// closing.
function FldSetoran({ api, ctx, tick, canKoreksi, onKoreksiSaya, onChanged, onExpense, onIncomplete }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [reasons, setReasons] = uSfl({});
  const [note, setNote] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  const [reload, setReload] = uSfl(0);
  const [askRe, setAskRe] = uSfl(false);
  const [pick, setPick] = uSfl(null);   // the stop whose reason is being chosen
  uEfl(() => {
    let live = true; setErr(null);
    Promise.all([api.daySummary(), api.board()]).then(([sum, board]) => { if (live) setD({ sum, board }); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick, reload]);
  if (err) return <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!d) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const sum = d.sum;
  const pending = d.board.filter((s) => s.status === 'pending');
  const chk = FIELDLOGIC.closeCheck(pending, reasons);
  const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs: [] });
  const opts = FLD_HOLD_REASONS.map((k) => trFl(k));
  const gaps = d.board.filter((s) => FIELDLOGIC.gapsOf(s).count > 0).length;
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
      <div className="mlap-kpi3">
        <div><b className="ok">{sum.stops.terkirim}</b><span>{trFl('fld.k_terkirim')}</span></div>
        <div><b className="bon">{sum.stops.ditunda}</b><span>{trFl('fld.k_tunda')}</span></div>
        <div><b className="neg">{sum.stops.batal}</b><span>{trFl('fld.k_batal')}</span></div>
      </div>
      {canKoreksi ? (
        <button type="button" className="mlap-alert sm2" onClick={onKoreksiSaya}>
          <FldSvg n="pen" s={16} sw={2.2} style={{ color: '#7A4B00', flexShrink: 0 }} />
          <span className="mlap-grow"><span className="t">{sum.koreksiMenunggu > 0 ? trFl('fld.koreksiWait', { n: sum.koreksiMenunggu }) : trFl('fld.kSaya')}</span>{sum.koreksiMenunggu > 0 ? <span className="s">{trFl('fld.koreksiWaitB')}</span> : null}</span>
          <FldSvg n="chevron" s={12} sw={2.4} style={{ color: '#8A9AA3', flexShrink: 0 }} />
        </button>
      ) : sum.koreksiMenunggu > 0 ? <FldNotice tone="info" title={trFl('fld.koreksiWait', { n: sum.koreksiMenunggu })} sub={trFl('fld.koreksiWaitB')} /> : null}
      {sum.closeout ? <FldNotice tone="ok" title={trFl('fld.dayClosedT', { t: new Date(sum.closeout.closedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }), by: sum.closeout.closedByName ? ' · ' + sum.closeout.closedByName : '' })} sub={trFl('fld.dayClosedB')} /> : null}
      {rs.open ? <FldNotice tone="warn" title={trFl('fld.openRunWarn', { n: rs.open.runNo })} /> : null}
      <div className="mlap-card">
        {rows.map(([k, v, tone]) => <div key={k} className="mlap-kv sm"><span>{trFl(k)}</span><b className={tone === 'bon' ? 'mlap-bontxt' : ''}>{FIELDLOGIC.fmtRp(v)}</b></div>)}
        {onExpense ? <button type="button" className="mlap-kv mlap-kvbtn" onClick={onExpense}><span>{trFl('fld.s_expense')}</span><b className="neg">{FIELDLOGIC.fmtRp(-sum.pengeluaran)}</b><FldSvg n="chevron" s={12} sw={2.4} /></button>
          : <div className="mlap-kv"><span>{trFl('fld.s_expense')}</span><b className="neg">{FIELDLOGIC.fmtRp(-sum.pengeluaran)}</b></div>}
        <div className="mlap-kv total"><span>{trFl('fld.s_setor')}</span><b>{FIELDLOGIC.fmtRp(sum.wajibSetor)}</b></div>
      </div>
      <div className="mlap-card mlap-gal3">
        <div><b>{sum.galon.keluar}</b><span>{trFl('fld.g_out')}</span></div>
        <div><b>{sum.galon.kembali}</b><span>{trFl('fld.g_back')}</span></div>
        <div><b className="neg">{sum.galon.rusak}</b><span>{trFl('fld.g_rusak')}</span></div>
      </div>
      {sum.ritDiBawahSop.length > 0 && (
        <>
          <div className="mlap-label">{trFl('fld.sopRuns')}</div>
          <div className="mlap-card">{sum.ritDiBawahSop.map((r) => <div key={r.runNo} className="mlap-kv"><span>{trFl('fld.sopRunRow', { n: r.runNo, g: r.gallonsOut, r: r.reason })}</span></div>)}</div>
        </>
      )}
      {pending.length > 0 && (
        <>
          <div className="mlap-label">{trFl('fld.openStopsT')}</div>
          <div className="mlap-card">
            {pending.map((s) => {
              const r = String(reasons[s.id] || '').trim();
              return (
                <div key={s.id} className="mlap-closerow2">
                  <span className="mlap-closenm"><span className="nm">{s.customerName}</span></span>
                  <button type="button" className={'mlap-pickbtn' + (r ? '' : ' miss')} aria-label={trFl('fld.pickReason') + ' — ' + s.customerName} onClick={() => setPick(s)}><span>{r || trFl('fld.pickReason')}</span><FldSvg n="chevDown" s={12} sw={2.4} /></button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {gaps > 0 && onIncomplete ? (
        <button type="button" className="mlap-alert warn sm" onClick={onIncomplete}>
          <FldSvg n="warn" s={15} sw={2.2} style={{ flexShrink: 0 }} />
          <span className="mlap-grow">{trFl('fld.gapsToday', { n: gaps })}</span>
          <span className="act">{trFl('fld.lengkapi')}</span>
        </button>
      ) : null}
      <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder={trFl('fld.generalNote')} aria-label={trFl('fld.generalNote')} />
      {msg && <div className="mlap-err" role="alert">{msg}</div>}
      <div className="mlap-ctaspace" />
      <FldCtaBar hint={chk.ok ? <span className="ok">{trFl('fld.allStopsDone')}</span> : trFl('fld.missingReasons', { n: chk.missing.length })}>
        <button type="button" className="mlap-btn primary" disabled={busy || !chk.ok} onClick={() => (sum.closeout ? setAskRe(true) : close())}>{trFl(sum.closeout ? 'fld.reclose' : 'fld.closeDay')}</button>
      </FldCtaBar>
      {pick && <FldPickSheet title={trFl('fld.reasonFor', { name: pick.customerName })} options={opts} value={reasons[pick.id] || ''} onPick={(o) => { setReasons(Object.assign({}, reasons, { [pick.id]: o })); setPick(null); }} onClose={() => setPick(null)} />}
      {askRe && <FldSheet title={trFl('fld.recloseT')} body={trFl('fld.recloseB')} confirmLabel={trFl('fld.reclose')} onClose={() => setAskRe(false)} onConfirm={() => { setAskRe(false); close(); }} />}
    </>
  );
}
```

- [ ] **Step 4: The shell** (`dist-field.jsx`): replace `<h1>{trFl(TAB_LABEL[tab])}</h1>` with `<h1>{trFl(tab === 'setoran' ? 'fld.setoranT' : TAB_LABEL[tab])}</h1>` and the Setoran body line with:

```jsx
    body = <FldSetoran api={api} ctx={ctx} tick={tick} canKoreksi={can.correct || can.void} onKoreksiSaya={() => setView({ name: 'koreksiSaya' })} onChanged={(m) => done(m)} onExpense={can.expense ? () => setView({ name: 'exp' }) : null} onIncomplete={goIncomplete} />;
```

- [ ] **Step 5: Append the CSS:**

```css
/* ── 3D-2 SETORAN — mockup Selesai board ── */
.mlap-kpi3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.mlap-kpi3 > div { background: #FFFFFF; border-radius: 14px; padding: 8px 12px; display: flex; flex-direction: column; }
.mlap-kpi3 b { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mlap-kpi3 b.ok { color: #1E6B40; }
.mlap-kpi3 b.bon { color: #7A4B00; }
.mlap-kpi3 b.neg { color: #9B2C22; }
.mlap-kpi3 span { font-size: 12px; color: var(--mlap-sub); }
.mlap-kv.sm { min-height: 34px; }
.mlap-kv b.neg { color: #9B2C22; }
.mlap-kvbtn { width: 100%; border: 0; border-bottom: 1px solid var(--mlap-line); background: #FFFFFF; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.mlap-kvbtn > span:first-child { flex: 1; }
.mlap-kvbtn > svg { color: #8A9AA3; flex-shrink: 0; }
.mlap-gal3 { padding: 8px 12px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.mlap-gal3 > div { display: flex; flex-direction: column; }
.mlap-gal3 b { font-size: 16px; font-weight: 700; }
.mlap-gal3 b.neg { color: #9B2C22; }
.mlap-gal3 span { font-size: 12px; color: var(--mlap-sub); }
.mlap-closerow2 { padding: 4px 12px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--mlap-line); }
.mlap-closerow2:last-child { border-bottom: 0; }
.mlap-closenm { width: 118px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
.mlap-closenm .nm { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mlap-alert.sm2 { border-radius: 12px; padding: 4px 10px; gap: 8px; }
.mlap-alert.sm2 .t { font-size: 13px; font-weight: 700; }
.mlap-swipe .mlap-ctabar { bottom: calc(100px + env(safe-area-inset-bottom)); }
.mlap-swipe .mlap-ctafade { height: calc(200px + env(safe-area-inset-bottom)); }
```

- [ ] **Step 6: Add the i18n keys.** EN: ` 'fld.setoranT': 'Deposit for today', 'fld.allStopsDone': 'Every stop is recorded', 'fld.reasonFor': 'Reason · {name}', 'fld.gapsToday': '{n} customers today still miss data',` — ID: ` 'fld.setoranT': 'Setoran hari ini', 'fld.allStopsDone': 'Semua stop sudah tercatat', 'fld.reasonFor': 'Alasan · {name}', 'fld.gapsToday': '{n} pelanggan hari ini masih belum lengkap datanya',`

- [ ] **Step 7: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-day.test.js tests/field-day-static.test.js tests/field-day-closeout.test.js tests/field-shell-static.test.js tests/field-kit-static.test.js`
Expected: PASS (`FldPickSheet` is a sheet with the drag hook; the 3C select-size rule still holds for the fleet picker).

- [ ] **Step 8: Side-by-side check** — Setoran with two unfinished stops (one picked) and a waiting correction, next to `Selesai.dc.html`; scroll to the bottom: the note field and the last card clear the fixed bar.

- [ ] **Step 9: Commit**

```bash
git add dist-field-day.jsx dist-field.jsx dist-field.css finance-i18n.js server/tests/field-3d2-day.test.js server/tests/field-day-static.test.js
git commit -m "feat(distribusi): Setoran to the mockup — coloured KPI tiles, deposit row, tappable expense, reason picker sheet, fixed close bar"
```

---

### Task 10: Pelanggan + customer sheet — mockup Pelanggan board

**Files:**
- Modify: `dist-field-cust.jsx` (add `FLD_AVA_TINTS`, `fldTint`, `fldInitials`; rewrite `FldCustomers`, `FldCustSheet`)
- Modify: `dist-field.css` (append `3D-2 PELANGGAN`), `finance-i18n.js`
- Create: `server/tests/field-3d2-cust.test.js`

**Interfaces:**
- Consumes: `FldCustomers({ api, tick, filter, onFilter, onOpen })` (Task 4); `.mlap-hscroll`, `.mlap-glass`, `.mlap-ctaspace`, `FldSheetHead` (Task 1); `.mlap-ctile`, `.mlap-facts2`, `.mlap-actrow` (Task 5).
- Produces: `fldTint(id) → [bg, fg]`, `fldInitials(name)` (Task 14 reuses nothing; local to the file).

- [ ] **Step 1: Write the failing test** — create `server/tests/field-3d2-cust.test.js`:

```js
'use strict';
// PLAN 3D-2 CUSTOMER + INPUT SCREENS (static): Pelanggan, customer sheet, Lengkapi, Atur titik, Tambah
// stop, Bayar bon, Penyesuaian, Ganti rugi, Pengeluaran laid out to their approved mockup boards.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const cust = read('dist-field-cust.jsx'); const shell = read('dist-field.jsx'); const kit = read('dist-field-kit.jsx'); const css = read('dist-field.css');
const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); expect({ name, found: i > -1 }).toEqual({ name, found: true }); const j = src.indexOf('\nfunction ', i + 10); return src.slice(i, j < 0 ? undefined : j); };
const section = (name) => { const i = css.indexOf('/* ── 3D-2 ' + name); expect({ name, found: i > -1 }).toEqual({ name, found: true }); const j = css.indexOf('/* ── 3D-2 ', i + 10); return css.slice(i, j < 0 ? undefined : j); };
const rule = (name, sel) => { const b = section(name); const i = b.indexOf('\n' + sel + ' {'); expect({ sel, found: i > -1 }).toEqual({ sel, found: true }); return b.slice(i, b.indexOf('}', i)); };

it('parses; never calls the server directly', () => {
  expect(() => parse(cust, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(cust).not.toMatch(/window\.API|fetch\(/);
});

describe('Pelanggan (mockup Pelanggan board)', () => {
  const f = () => fn(cust, 'FldCustomers');
  it('a floating glass search pill above the dock; filter chips that scroll sideways (black when on)', () => {
    expect(f()).toMatch(/<label className="mlap-glass mlap-searchpill">/);
    expect(f()).toMatch(/<div className="mlap-hscroll" role="group"/);
    expect(f()).toMatch(/className=\{'mlap-fchip' \+ \(k === 'warn' \? ' warn' : ''\) \+ \(filter === k \? ' on' : ''\)\}/);
    expect(f()).toMatch(/<div className="mlap-ctaspace" \/>/);
    expect(rule('PELANGGAN', '.mlap-fchip.on')).toMatch(/background: #0E1B24; color: #FFFFFF;/);
    expect(rule('PELANGGAN', '.mlap-searchpill')).toMatch(/bottom: calc\(104px \+ env\(safe-area-inset-bottom\)\);/);
    expect(rule('PELANGGAN', '.mlap-fchip::before')).toMatch(/inset: -4px 0;/);   // 36 px chip, 44 px touch
  });
  it('round avatars in four tints (steady per customer), gap tags, a green "Lunas" when there is no bon', () => {
    expect(cust).toMatch(/const FLD_AVA_TINTS = \[\['#E8F1F8', '#065489'\], \['#DDF4F2', '#0F6B66'\], \['#EEE9F8', '#4B3A8C'\], \['#FCF1D6', '#7A4B00'\]\];/);
    expect(f()).toMatch(/style=\{\{ background: t\[0\], color: t\[1\] \}\}/);
    expect(f()).toMatch(/<span key=\{k\} className="mlap-gtag">/);
    expect(f()).toMatch(/<b className="ok">\{trFl\('fld\.lunas'\)\}<\/b>/);
    expect(rule('PELANGGAN', '.mlap-gtag')).toMatch(/background: #FFF1E8; color: #9A3412; font-size: 11px; font-weight: 700;/);
  });
  it('the customer sheet matches the stop sheet: avatar head + close X, contact tiles, facts, icon action rows', () => {
    const s = fn(cust, 'FldCustSheet');
    expect(s).toMatch(/<FldSheetHead title=\{c\.name\}/);
    expect(s).toMatch(/className="mlap-ctile" newTab><FldSvg n="navigate"/);
    expect(s).toMatch(/<div className="mlap-card mlap-facts2">/);
    expect(s).toMatch(/className="mlap-actrow" onClick=\{\(\) => onAction\(k, c\)\}>/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-cust.test.js`
Expected: FAIL in "Pelanggan" (no search pill, no `FLD_AVA_TINTS`).

- [ ] **Step 3: Rewrite** in `dist-field-cust.jsx` — replace `FldCustomers` and `FldCustSheet` with:

```jsx
// Avatar tints of the board, steady per customer (not per row, so a filter never recolours a person).
const FLD_AVA_TINTS = [['#E8F1F8', '#065489'], ['#DDF4F2', '#0F6B66'], ['#EEE9F8', '#4B3A8C'], ['#FCF1D6', '#7A4B00']];
const fldTint = (id) => FLD_AVA_TINTS[String(id || '').split('').reduce((t, ch) => t + ch.charCodeAt(0), 0) % FLD_AVA_TINTS.length];
const fldInitials = (name) => String(name || '?').split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join('').toUpperCase();

// PELANGGAN (mockup Pelanggan board): filter chips that scroll sideways, round tinted avatars, the
// missing-data tags, the bon (or a green "Lunas") with the gallons held, and the glass search pill
// floating above the dock.
function FldCustomers({ api, tick, filter, onFilter, onOpen }) {
  const [list, setList] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  uEfl(() => { let live = true; setErr(null); api.customers().then((r) => { if (live) setList(r || []); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api, tick]);
  if (err) return <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!list) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const v = FIELDLOGIC.customerList(list, { q, filter });
  const chips = [['all', trFl('fld.f_all', { n: v.counts.all })], ['warn', trFl('fld.f_warn', { n: v.counts.warn })], ['bon', trFl('fld.f_bon', { n: v.counts.bon })], ['fixed', trFl('fld.f_fixed', { n: v.counts.fixed })]];
  return (
    <>
      <div className="mlap-hscroll" role="group" aria-label={trFl('fld.filter')}>
        {chips.map(([k, text]) => <button key={k} type="button" className={'mlap-fchip' + (k === 'warn' ? ' warn' : '') + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => onFilter(k)}>{text}</button>)}
      </div>
      <div className="mlap-card mlap-list">
        {v.rows.length ? v.rows.map((c) => {
          const t = fldTint(c.id);
          const warns = [c.gaps.titik ? 'fld.tagNoPin' : '', c.gaps.wa ? 'fld.noWa' : '', c.gaps.foto ? 'fld.tagNoFoto' : ''].filter(Boolean);
          return (
            <button key={c.id} type="button" className="mlap-row mlap-rowbtn mlap-custrow" onClick={() => onOpen(c)}>
              <span className="mlap-ava" aria-hidden="true" style={{ background: t[0], color: t[1] }}>{fldInitials(c.name)}</span>
              <span className="mlap-grow">
                <span className="nm">{c.name}</span>
                <span className="sb">{[c.code, (c.deliveryDays || []).join(' · '), c.fixedDays ? trFl('fld.fixedLow') : ''].filter(Boolean).join(' · ')}</span>
                {warns.length ? <span className="mlap-gtags">{warns.map((k) => <span key={k} className="mlap-gtag">{trFl(k)}</span>)}</span> : null}
              </span>
              <span className="mlap-custside">
                {c.sisaBon > 0 ? <b className="bon">{FIELDLOGIC.fmtRp(c.sisaBon)}</b> : <b className="ok">{trFl('fld.lunas')}</b>}
                <span className="sb">{trFl('fld.nGalon', { n: c.gallonsHeld || 0 })}</span>
              </span>
            </button>
          );
        }) : <div className="mlap-empty">{trFl('fld.noCustFilter')}</div>}
      </div>
      <div className="mlap-ctaspace" />
      <label className="mlap-glass mlap-searchpill">
        <FldSvg n="search" s={16} sw={2.2} />
        <input type="search" placeholder={trFl('fld.searchCust2')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
    </>
  );
}

// The customer's sheet (same look as Detail stop): avatar + name + close X, Navigasi / Telepon / WhatsApp,
// bon and gallons held, the missing data, then the actions this account may use.
function FldCustSheet({ cust: c0, can, onClose, onAction }) {
  const drag = useFldSheetDrag(onClose);
  const c = Object.assign({}, c0, { gaps: c0.gaps || FIELDLOGIC.gapsOf(c0) });
  const links = fldLinks(c);
  const t = fldTint(c.id);
  const acts = [];
  if (can.sale) acts.push(['sale', 'receipt', 'fld.catatSale']);
  if (can.bon && c.sisaBon > 0) acts.push(['bon', 'cash', 'fld.terimaBon']);
  if (can.location && c.gaps.count > 0) acts.push(['complete', 'pinMove', 'fld.completeData']);
  if (can.addStop) acts.push(['addStop', 'pinPlus', 'fld.addToday']);
  if (can.adjust) acts.push(['adjust', 'adjust', 'fld.adjRow']);
  if (can.damage && c.gallonsHeld > 0) acts.push(['damage', 'bottleBroken', 'fld.dmgRow']);
  const fix = can.location && c.gaps.count > 0 ? () => onAction('complete', c) : null;
  const warns = [c.gaps.titik ? 'fld.tagNoPin' : '', c.gaps.wa ? 'fld.noWa' : '', c.gaps.foto ? 'fld.tagNoFoto' : ''].filter(Boolean);
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={c.name} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
        <FldSheetHead title={c.name} sub={[c.code, c.address].filter(Boolean).join(' · ')} lead={<span className="mlap-ava lg" aria-hidden="true" style={{ background: t[0], color: t[1] }}>{fldInitials(c.name)}</span>} onClose={onClose} />
        <div className="mlap-sheet-stack">
          <div className="mlap-contacts">
            <FldLinkBtn href={links.nav} className="mlap-ctile" newTab><FldSvg n="navigate" s={18} />{trFl('fld.navigate')}</FldLinkBtn>
            <FldLinkBtn href={links.tel} className="mlap-ctile"><FldSvg n="phone" s={18} />{trFl('fld.call')}</FldLinkBtn>
            {links.wa ? <FldLinkBtn href={links.wa} className="mlap-ctile" newTab><FldSvg n="wa" s={18} />{trFl('fld.wa')}</FldLinkBtn>
              : fix ? <button type="button" className="mlap-ctile miss" onClick={fix}><FldSvg n="wa" s={18} />{trFl('fld.fillWaTile')}</button>
                : <FldLinkBtn href="" className="mlap-ctile"><FldSvg n="wa" s={18} />{trFl('fld.wa')}</FldLinkBtn>}
          </div>
          <div className="mlap-card mlap-facts2">
            <div><span className="sb">{trFl('fld.bonNow')}</span>{c.sisaBon > 0 ? <b className="bon">{FIELDLOGIC.fmtRp(c.sisaBon)}</b> : <b className="ok">{trFl('fld.lunas')}</b>}</div>
            <div><span className="sb">{trFl('fld.heldAt')}</span><b>{c.gallonsHeld == null ? '—' : c.gallonsHeld}</b></div>
          </div>
          {warns.length ? <span className="mlap-gtags">{warns.map((k) => <span key={k} className="mlap-gtag">{trFl(k)}</span>)}</span> : null}
          {acts.length ? (
            <div className="mlap-card">
              {acts.map(([k, ico, key]) => (
                <button key={k} type="button" className="mlap-actrow" onClick={() => onAction(k, c)}>
                  <FldSvg n={ico} s={17} /><span className="mlap-grow">{trFl(key)}</span><FldSvg n="chevron" s={13} sw={2.4} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Append the CSS:**

```css
/* ── 3D-2 PELANGGAN — mockup Pelanggan board ── */
.mlap-hscroll { padding-top: 4px; padding-bottom: 4px; }
.mlap-fchip { position: relative; flex-shrink: 0; min-height: 36px; padding: 0 12px; border-radius: 18px; border: 0; background: #FFFFFF; font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; color: var(--mlap-ink); cursor: pointer; }
.mlap-fchip::before { content: ''; position: absolute; inset: -4px 0; }
.mlap-fchip.warn { border: 1px solid #F4C7A8; background: #FFF1E8; color: #9A3412; }
.mlap-fchip.on { border: 0; background: #0E1B24; color: #FFFFFF; }
.mlap-custrow { min-height: 56px; }
.mlap-ava { border-radius: 50%; font-weight: 700; }
.mlap-ava.lg { width: 38px; height: 38px; font-size: 14px; }
.mlap-gtags { display: flex; flex-wrap: wrap; gap: 4px; }
.mlap-gtag { height: 18px; display: inline-flex; align-items: center; padding: 0 6px; border-radius: 5px; background: #FFF1E8; color: #9A3412; font-size: 11px; font-weight: 700; }
.mlap-custside { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; flex-shrink: 0; }
.mlap-custside b { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mlap-custside b.bon { color: #7A4B00; }
.mlap-custside b.ok { color: #1E6B40; }
.mlap-custside .sb { font-size: 11px; color: var(--mlap-sub); }
.mlap-searchpill { position: fixed; z-index: 38; left: 20px; right: 20px; max-width: 520px; margin: 0 auto; bottom: calc(104px + env(safe-area-inset-bottom)); height: 46px; border-radius: 23px; display: flex; align-items: center; gap: 8px; padding: 0 16px; box-sizing: border-box; color: #3E4E58; background: rgba(255,255,255,.66); -webkit-backdrop-filter: blur(28px) saturate(1.6); backdrop-filter: blur(28px) saturate(1.6); border: 1px solid rgba(255,255,255,.85); box-shadow: 0 8px 28px rgba(6,51,79,.16), inset 0 1px 0 rgba(255,255,255,.95); }
.mlap-searchpill:focus-within { box-shadow: 0 0 0 2px #065489, 0 8px 28px rgba(6,51,79,.16); }
.mlap-searchpill input { flex: 1; min-width: 0; height: 44px; border: 0; background: transparent; font: inherit; font-size: 16px; color: var(--mlap-ink); outline: none; }
.mlap-sheet-stack { display: flex; flex-direction: column; gap: 10px; padding-top: 10px; }
.mlap-facts2 b.bon { color: #7A4B00; }
.mlap-facts2 b.ok { color: #1E6B40; }
```

- [ ] **Step 5: Add the i18n keys.** EN: ` 'fld.tagNoPin': 'No pin', 'fld.tagNoFoto': 'No photo', 'fld.lunas': 'Paid up', 'fld.fixedLow': 'fixed', 'fld.searchCust2': 'Search name, code, address',` — ID: ` 'fld.tagNoPin': 'Tanpa titik', 'fld.tagNoFoto': 'Tanpa foto', 'fld.lunas': 'Lunas', 'fld.fixedLow': 'tetap', 'fld.searchCust2': 'Cari nama, kode, alamat',`

Note: `FIELDLOGIC.customerList` already searches name + code (+ phone digits); the placeholder names what it finds. If the address is not searched there, use `fld.searchCust` as the placeholder instead and ledger it.

- [ ] **Step 6: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-cust.test.js tests/field-cust-static.test.js tests/field-kit-static.test.js tests/field-shell-static.test.js`
Expected: PASS (the cust-static "Pelanggan" and "sheet only offers actions…" assertions still match).

- [ ] **Step 7: Side-by-side check** — Pelanggan tab with a mix of bon / lunas / incomplete customers next to `Pelanggan.dc.html`; type in the search pill; swipe the chip row sideways (must not change tab).

- [ ] **Step 8: Commit**

```bash
git add dist-field-cust.jsx dist-field.css finance-i18n.js server/tests/field-3d2-cust.test.js
git commit -m "feat(distribusi): Pelanggan to the mockup — floating glass search, sideways chips, tinted round avatars, gap tags, green Lunas; matching customer sheet"
```

---

### Task 11: Lengkapi + Atur titik — mockup Lengkapi and Atur titik boards (+ M7)

**Files:**
- Modify: `dist-field-kit.jsx` (`FldTop` gets `backLabel`)
- Modify: `dist-field-cust.jsx` (add `FldMiniMap`, `fldPt`; rewrite the returns of `FldComplete`, `FldPinMap`; M7 keyboard pan)
- Modify: `dist-field.css` (append `3D-2 LENGKAPI`), `finance-i18n.js`
- Test: `server/tests/field-3d2-cust.test.js` (append); update `server/tests/field-kit-static.test.js` (one assertion)

**Interfaces:**
- Consumes: `FldCustHead`, `FldPhoto w/h/optional`, `FldCtaBar`, `.mlap-glass`, `.mlap-mapbar`, `.mlap-mappill`, `.mlap-mapempty` (Tasks 1, 8).
- Produces: `FldTop({ title, sub, onBack, kind, backLabel })`; `fldPt(p) → "−8,67120, 115,22610"`.

- [ ] **Step 1: Write the failing test.** Append to `server/tests/field-3d2-cust.test.js`:

```js
describe('Lengkapi (mockup Lengkapi board)', () => {
  const f = () => fn(cust, 'FldComplete');
  it('"Nanti saja" pill, the customer + a progress badge, a mini-map card with the pin and its caption', () => {
    expect(f()).toMatch(/<FldTop title=\{trFl\('fld\.completeT2'\)\} onBack=\{onBack\} backLabel=\{trFl\('fld\.later'\)\} \/>/);
    expect(f()).toMatch(/aside=\{<span className=\{'mlap-prog' \+ \(done === 3 \? ' ok' : ''\)\}>\{trFl\('fld\.dataN', \{ n: done \}\)\}<\/span>\}/);
    expect(f()).toMatch(/<FldMiniMap pt=\{pt\} caption=\{cap\} \/>/);
    expect(fn(cust, 'FldMiniMap')).toMatch(/dragging: false/);
    expect(fn(cust, 'FldMiniMap')).toMatch(/OpenStreetMap<\/a>/);   // the licence attribution stays on every map
    expect(rule('LENGKAPI', '.mlap-prog')).toMatch(/background: #FFF1E8; color: #9A3412;/);
  });
  it('two location buttons side by side; the photo card; save is the fixed bar', () => {
    expect(f()).toMatch(/<div className="mlap-twobtn">/);
    expect(f()).toMatch(/<FldPhoto api=\{api\} value=\{photo\} onChange=\{setPhoto\} hintKey="fld\.locPhotoHint"/);
    expect(f()).toMatch(/<FldCtaBar><button type="button" className="mlap-btn primary" disabled=\{busy \|\| !changed\} onClick=\{save\}>/);
  });
  it('the top bar can name its way out ("Nanti saja")', () => {
    expect(kit).toMatch(/function FldTop\(\{ title, sub, onBack, kind, backLabel \}\)/);
    expect(kit).toMatch(/<button type="button" className="mlap-pill" onClick=\{onBack\}>\{backLabel \|\| trFl\('fld\.cancel'\)\}<\/button>/);
  });
});
describe('Atur titik (mockup Atur titik board)', () => {
  const f = () => fn(cust, 'FldPinMap');
  it('full-bleed map with the centre pin, a glass bar (back, title, locate), a hint pill, a glass sheet with the figures', () => {
    expect(f()).toMatch(/<div className="mlap-pinwrap">/);
    expect(f()).toMatch(/<div className="mlap-mapbar">\s*<button type="button" className="mlap-round" aria-label=\{trFl\('fld\.back'\)\} onClick=\{onBack\}>/);
    expect(f()).toMatch(/<div className="mlap-glass mlap-pinhint"><FldSvg n="hand"/);
    expect(f()).toMatch(/<div className="mlap-pinsheet">/);
    expect(f()).toMatch(/mv\.meters < 3 \? trFl\('fld\.pinSame'\) : trFl\('fld\.pinMoved', \{ m: mv\.meters \}\)/);
    expect(rule('LENGKAPI', '.mlap-pinwrap')).toMatch(/position: fixed; inset: 0;/);
  });
  it('M7: moving the map with the keyboard counts as moved too', () => {
    expect(f()).toMatch(/map\.on\('keydown', \(\) => \{ userRef\.current = true; \}\);/);
  });
});
```

In `server/tests/field-kit-static.test.js` ("task screens: glass "Batal" pill …") replace the pill assertion with:

```js
    expect(f).toMatch(/<button type="button" className="mlap-pill" onClick=\{onBack\}>\{backLabel \|\| trFl\('fld\.cancel'\)\}<\/button>/);
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-cust.test.js tests/field-kit-static.test.js`
Expected: FAIL — no `backLabel`, no `FldMiniMap`, no `mlap-pinwrap`, no keydown handler.

- [ ] **Step 3: `FldTop` takes a label** (`dist-field-kit.jsx`): change the signature to `function FldTop({ title, sub, onBack, kind, backLabel }) {` and the pill to `<button type="button" className="mlap-pill" onClick={onBack}>{backLabel || trFl('fld.cancel')}</button>`.

- [ ] **Step 4: Lengkapi** (`dist-field-cust.jsx`). Add before `FldComplete`:

```jsx
const fldPt = (p) => p.lat.toFixed(5).replace('.', ',') + ', ' + p.lng.toFixed(5).replace('.', ',');

// A small still map of the customer's point (mockup Lengkapi): no gestures, the OSM licence line kept;
// a plain ground with a grey pin when there is no point yet or the map cannot load.
function FldMiniMap({ pt, caption }) {
  const el = uRfl(null);
  uEfl(() => {
    if (!pt || !el.current) return undefined;
    let live = true; let map = null;
    znLoadLeaflet().then((L) => {
      if (!live || !el.current) return;
      map = L.map(el.current, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
      L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      map.setView([pt.lat, pt.lng], 17);
    }).catch(() => { /* the plain ground stays */ });
    return () => { live = false; if (map) map.remove(); };
  }, [pt ? pt.lat + ',' + pt.lng : '']);
  return (
    <div className="mlap-minimap">
      <div ref={el} className="mlap-map mlap-minimap-map" aria-hidden="true" />
      <svg className={'mlap-minipin' + (pt ? ' on' : '')} width="28" height="36" viewBox="0 0 24 32" aria-hidden="true"><path d="M12 31s-10-10-10-18a10 10 0 0 1 20 0c0 8-10 18-10 18z" fill="currentColor" stroke="#FFFFFF" strokeWidth="2" /><circle cx="12" cy="12" r="4" fill="#FFFFFF" /></svg>
      <span className="mlap-glass mlap-minicap">{caption}</span>
    </div>
  );
}
```

Replace the `return (...)` of `FldComplete` (state, `takeGps`, `changed`, `save` stay) with:

```jsx
  const had = typeof c.lat === 'number' && typeof c.lng === 'number';
  const pt = gps ? { lat: gps.lat, lng: gps.lng } : had ? { lat: c.lat, lng: c.lng } : null;
  const okTitik = !g.titik || !!gps; const okWa = !g.wa || !!wa.trim(); const okFoto = !g.foto || !!photo;
  const done = (okTitik ? 1 : 0) + (okWa ? 1 : 0) + (okFoto ? 1 : 0);
  const cap = gps ? trFl('fld.ptGps', { p: fldPt(gps), m: Math.round(gps.accuracy || 0) }) : had ? trFl('fld.pinHave') : trFl('fld.ptNone');
  const dot = (ok) => <span className={'mlap-dot ' + (ok ? 'ok' : 'miss')} aria-hidden="true">{ok ? '✓' : '!'}</span>;
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.completeT2')} onBack={onBack} backLabel={trFl('fld.later')} />
      <div className="mlap-body">
        <FldCustHead name={c.name} sub={[c.code, c.address].filter(Boolean).join(' · ')} aside={<span className={'mlap-prog' + (done === 3 ? ' ok' : '')}>{trFl('fld.dataN', { n: done })}</span>} />
        <div className="mlap-card">
          <FldMiniMap pt={pt} caption={cap} />
          <div className="mlap-sec">
            <div className="mlap-check">{dot(okTitik)}<b className="mlap-grow">{trFl('fld.chkTitik')}</b><span className="mlap-secnote">{trFl('fld.pinNeeded')}</span></div>
            <div className="mlap-twobtn">
              <button type="button" className={'mlap-btn ' + (gps || had ? 'line' : 'soft2')} disabled={locBusy} onClick={takeGps}><FldSvg n="crosshair" s={16} sw={2.2} />{locBusy ? trFl('fld.locating') : gps ? trFl('fld.gpsAgain') : trFl('fld.useMyLoc2')}</button>
              <button type="button" className="mlap-btn line blue" onClick={() => onPin(c)}><FldSvg n="pinMove" s={16} />{trFl('fld.dragOnMap')}</button>
            </div>
            <span className="mlap-hint">{trFl('fld.gpsDrift')}</span>
          </div>
        </div>
        <div className="mlap-card mlap-sec">
          <div className="mlap-check">{dot(okWa)}<b className="mlap-grow">{trFl('fld.chkWa')}</b><span className="mlap-secnote">{trFl('fld.waFor')}</span></div>
          <input className="mlap-text" type="tel" inputMode="tel" placeholder="0812 3456 7890" aria-label={trFl('fld.chkWa')} value={wa} onChange={(e) => setWa(e.target.value.slice(0, 20))} />
        </div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.locPhotoHint" title={trFl('fld.chkFoto')} optional={!g.foto} w={100} h={76} />
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar><button type="button" className="mlap-btn primary" disabled={busy || !changed} onClick={save}>{trFl('fld.saveCust')}</button></FldCtaBar>
    </div>
  );
```

(The numbers stay in the local 08… form the app stores; no "+62" prefix box — `waHref` already converts for wa.me.)

- [ ] **Step 5: Atur titik.** In `FldPinMap`, right after the line `map.on('dragstart zoomstart', () => { userRef.current = true; setLift(true); });` add:

```jsx
      map.on('keydown', () => { userRef.current = true; });   // M7: arrow-key panning is the driver too
```

and replace its `return (...)` with:

```jsx
  return (
    <div className="mlap-screen">
      {!mapErr && pin ? (
        <div className="mlap-pinwrap">
          <div ref={mapEl} className="mlap-map mlap-pinmap" role="application" aria-label={trFl('fld.pinT')} />
          <span className={'mlap-centerpin' + (lift ? ' up' : '')} aria-hidden="true"><span className="mlap-centerpin-dot" /></span>
          <span className={'mlap-centerpin-shadow' + (lift ? ' up' : '')} aria-hidden="true" />
        </div>
      ) : null}
      <div className="mlap-mapbar">
        <button type="button" className="mlap-round" aria-label={trFl('fld.back')} onClick={onBack}><FldSvg n="back" s={18} sw={2.4} /></button>
        <div className="mlap-glass mlap-mappill">{trFl('fld.pinT')}</div>
        {dev && mapReady ? <button type="button" className="mlap-round mlap-map-locate" aria-label={trFl('fld.useMyLoc')} onClick={() => mapRef.current.setView([dev.lat, dev.lng], 18)}><FldSvg n="locate" s={19} /></button> : <span className="mlap-roundsp" aria-hidden="true" />}
      </div>
      {!mapErr && pin ? <div className="mlap-glass mlap-pinhint"><FldSvg n="hand" s={14} sw={2.2} />{trFl('fld.pinPan')}</div> : null}
      {mapErr || !pin ? <div className="mlap-mapempty">{mapErr ? <FldNotice tone="info" title={trFl('fld.mapOff')} sub={trFl('fld.pinNoMap')} /> : <div className="mlap-empty">{trFl('fld.locating')}</div>}</div> : null}
      <div className="mlap-pinsheet">
        <div className="mlap-grab" aria-hidden="true" />
        <div className="mlap-pinsheet-hd"><b>{trFl('fld.pinOf', { name: c.name })}</b>{c.code ? <span className="sb">{c.code}</span> : null}</div>
        <div className="mlap-card">
          <div className="mlap-kv"><span>{trFl('fld.coords')}</span><b>{pin ? fldPt(pin) : '—'}</b></div>
          <div className="mlap-kv"><span>{dev ? trFl('fld.fromDevice', { m: Math.round(dev.accuracy || 0) }) : trFl('fld.noGps')}</span><b className={mv.far ? 'far' : mv.meters != null && mv.meters >= 3 ? 'moved' : ''}>{mv.meters == null ? '—' : mv.meters < 3 ? trFl('fld.pinSame') : trFl('fld.pinMoved', { m: mv.meters })}</b></div>
        </div>
        <span className={'mlap-after' + (mv.far || (fallback && !moved) ? ' far' : '')}>{mv.far ? trFl('fld.pinFar') : fallback && !moved ? trFl('fld.pinNoGpsMove') : trFl('fld.pinAudit')}</span>
        {mapErr && dev ? <button type="button" className="mlap-btn mlap-wide" onClick={() => setPin({ lat: dev.lat, lng: dev.lng })}>{trFl('fld.useMyLoc')}</button> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !pin || (fallback && !moved)} onClick={() => save(false)}>{trFl('fld.savePin')}</button>
      </div>
      {askFar && <FldSheet title={trFl('fld.pinFarT', { m: mv.meters })} body={trFl('fld.pinFarB')} confirmLabel={trFl('fld.savePin')} onClose={() => setAskFar(false)} onConfirm={() => { setAskFar(false); save(true); }} />}
    </div>
  );
```

(The Leaflet effect keeps `if (!pin || !mapEl.current || mapRef.current) return undefined;` — the map div now only exists while `pin` is set and the map has not failed, exactly as before.)

- [ ] **Step 6: Append the CSS:**

```css
/* ── 3D-2 LENGKAPI — mockup Lengkapi + Atur titik boards ── */
.mlap-prog { height: 24px; padding: 0 8px; border-radius: 12px; display: inline-flex; align-items: center; font-size: 12px; font-weight: 700; flex-shrink: 0; background: #FFF1E8; color: #9A3412; }
.mlap-prog.ok { background: #E3F3EA; color: #1E6B40; }
.mlap-minimap { position: relative; height: 128px; background: #E4EAE6; overflow: hidden; }
.mlap-minimap-map { position: absolute; inset: 0; height: auto; border-radius: 0; background: transparent; }
.mlap-minipin { position: absolute; left: 50%; top: 50%; margin: -36px 0 0 -14px; z-index: 2; color: #8A9AA3; pointer-events: none; }
.mlap-minipin.on { color: #065489; }
.mlap-minicap { position: absolute; left: 8px; bottom: 8px; z-index: 2; height: 26px; max-width: calc(100% - 16px); padding: 0 10px; border-radius: 13px; box-sizing: border-box; display: flex; align-items: center; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mlap-secnote { font-size: 12px; color: var(--mlap-sub); flex-shrink: 0; }
.mlap-sec .mlap-check b { font-size: 15px; font-weight: 600; }
.mlap-twobtn { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.mlap-btn.soft2 { background: #E8F1F8; color: #065489; border-radius: 12px; font-size: 14px; }
.mlap-btn.line { background: #FFFFFF; border: 1px solid #D5DDE3; color: #3E4E58; border-radius: 12px; font-size: 14px; }
.mlap-btn.line.blue { color: #065489; }
.mlap-pinwrap { position: fixed; inset: 0; z-index: 0; }
.mlap-pinwrap .mlap-pinmap { position: absolute; inset: 0; height: auto; border-radius: 0; }
.mlap-mapbar .mlap-map-locate { position: static; }
.mlap-roundsp { width: 44px; height: 44px; flex-shrink: 0; }
.mlap-pinhint { position: fixed; z-index: 5; top: calc(62px + env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px); min-height: 32px; padding: 6px 14px; box-sizing: border-box; border-radius: 16px; display: flex; align-items: center; gap: 6px; text-align: center; font-size: 13px; font-weight: 600; pointer-events: none; background: rgba(255,255,255,.7); }
.mlap-pinsheet { position: fixed; z-index: 6; left: 50%; transform: translateX(-50%); bottom: 0; width: min(560px, 100vw); box-sizing: border-box; padding: 8px 16px calc(28px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; border-radius: 28px 28px 0 0; background: rgba(248,250,252,.9); -webkit-backdrop-filter: blur(34px) saturate(1.5); backdrop-filter: blur(34px) saturate(1.5); border-top: 1px solid rgba(255,255,255,.95); box-shadow: 0 -10px 40px rgba(6,51,79,.18), inset 0 1px 0 rgba(255,255,255,.95); }
.mlap-pinsheet .mlap-grab { margin: 0 auto; }
.mlap-pinsheet-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.mlap-pinsheet-hd b { font-size: 19px; font-weight: 700; }
.mlap-pinsheet-hd .sb { font-size: 12px; color: var(--mlap-sub); }
.mlap-pinsheet .mlap-btn.primary { min-height: 50px; border-radius: 15px; font-size: 16px; }
.mlap-kv b.far { color: #9A3412; font-weight: 700; }
.mlap-kv b.moved { color: #065489; font-weight: 700; }
.mlap-after.far { background: #FFF1E8; color: #9A3412; font-weight: 600; }
```

- [ ] **Step 7: Add the i18n keys.** EN: ` 'fld.completeT2': 'Complete data', 'fld.later': 'Later', 'fld.ptGps': '{p} · accuracy ±{m} m', 'fld.ptNone': 'No pin yet', 'fld.gpsAgain': 'Take GPS again', 'fld.useMyLoc2': 'Use my location', 'fld.pinOf': 'Location of {name}', 'fld.pinSame': 'Same', 'fld.pinMoved': 'Moved {m} m', 'fld.pinAudit': 'Every move is logged: who, when, old point → new.',` — ID: ` 'fld.completeT2': 'Lengkapi data', 'fld.later': 'Nanti saja', 'fld.ptGps': '{p} · akurasi ±{m} m', 'fld.ptNone': 'Belum ada titik lokasi', 'fld.gpsAgain': 'Ambil ulang GPS', 'fld.useMyLoc2': 'Pakai lokasi saya', 'fld.pinOf': 'Titik lokasi {name}', 'fld.pinSame': 'Sama', 'fld.pinMoved': 'Digeser {m} m', 'fld.pinAudit': 'Perubahan titik dicatat: siapa, jam, titik lama → baru.',`

- [ ] **Step 8: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-cust.test.js tests/field-cust-static.test.js tests/field-kit-static.test.js tests/field-logic.test.js`
Expected: PASS (all the 3B/3C/3D Atur titik assertions — centre pin, `L.circle(`, `pinMove`, far confirm, `method: 'geser'`, locate button, `'fld.pinPan'`, `setView` before the gesture handlers — still match).

- [ ] **Step 9: Side-by-side check** — Lengkapi for a customer with no pin / no WA, then after "Pakai lokasi saya", next to `Lengkapi.dc.html`; Atur titik next to `AturTitik.dc.html` (no Satelit toggle — Decision 1).

- [ ] **Step 10: Commit**

```bash
git add dist-field-kit.jsx dist-field-cust.jsx dist-field.css finance-i18n.js server/tests/field-3d2-cust.test.js server/tests/field-kit-static.test.js
git commit -m "feat(distribusi): Lengkapi + Atur titik to the mockup — mini-map card, progress badge, full-bleed pin map with glass bar and sheet; keyboard pan counts as moved (M7)"
```

---

### Task 12: Tambah stop — mockup Tambah stop board (a sheet)

**Files:**
- Modify: `dist-field-cust.jsx` (`FldAddStop`), `dist-field.jsx` (`'addStop'` becomes a sheet)
- Modify: `dist-field.css` (append `3D-2 TAMBAH`), `finance-i18n.js`
- Test: `server/tests/field-3d2-cust.test.js` (append); update `server/tests/field-cust-static.test.js` (one assertion)

**Interfaces:**
- Consumes: `.mlap-sheet.tall`, `.mlap-sheet-body`, `.mlap-sheet-cta`, `FldSheetHead`, `.mlap-pickrow`, `.mlap-radio` (Task 1).
- Produces: `FldAddStop` unchanged signature `({ api, preset, can, onPin, onDone, onBack })`.

- [ ] **Step 1: Write the failing test.** Append to `server/tests/field-3d2-cust.test.js`:

```js
describe('Tambah stop (mockup Tambah stop board) — a sheet', () => {
  const f = () => fn(cust, 'FldAddStop');
  it('a tall sheet with a search box, radio rows tagged "Ada titik / Tanpa titik", the consequence card, the gallons, the CTA', () => {
    expect(f()).toMatch(/<div className="mlap-sheet tall" role="dialog" aria-modal="true" aria-label=\{trFl\('fld\.addStopT'\)\} ref=\{drag\.ref\} style=\{drag\.style\}>/);
    expect(f()).toMatch(/<label className="mlap-searchbox">/);
    expect(f()).toMatch(/className=\{'mlap-pickrow' \+ \(pick && pick\.id === c\.id \? ' on' : ''\)\}/);
    expect(f()).toMatch(/trFl\(c\.gaps\.titik \? 'fld\.tagNoPin' : 'fld\.tagHasPin'\)/);
    expect(f()).toMatch(/pick \? \(pickHasPin \? 'fld\.addToRoute' : 'fld\.addAtEnd'\)/);
    expect(rule('TAMBAH', '.mlap-nopincard')).toMatch(/background: #FFF1E8; border: 1px solid #F4C7A8;/);
  });
  it('the shell opens it over the current tab', () => {
    expect(shell).toMatch(/\{ready && view && view\.name === 'addStop' && <FldAddStop /);
    expect(shell).not.toMatch(/'exp', 'addStop'/);
  });
});
```

In `server/tests/field-cust-static.test.js` ("Tambah stop … prompted to set it") replace

```js
    expect(f).toMatch(/!pickHasPin && <FldNotice tone="warn"/);
```

with

```js
    expect(f).toMatch(/pick && !pickHasPin \? \(\s*<div className="mlap-nopincard" role="alert">/);   // 3D-2: the board's warning card
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-cust.test.js tests/field-cust-static.test.js`
Expected: FAIL in "Tambah stop".

- [ ] **Step 3: Replace `FldAddStop`** (comment included) in `dist-field-cust.jsx`:

```jsx
// TAMBAH STOP (mockup Tambah stop board) — a sheet: search; today's stops that cannot join the route (no
// pin — set it); other customers as radio rows tagged with whether they have a pin; what the pick means
// (no pin → the end of the list, set the pin now; a pin → it joins the route); how many gallons; add.
function FldAddStop({ api, preset, can, onPin, onDone, onBack }) {
  const drag = useFldSheetDrag(onBack);
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  const [pick, setPick] = uSfl(preset || null);
  const [qty, setQty] = uSfl(1);
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  uEfl(() => { let live = true; Promise.all([api.board(), api.customers()]).then(([board, customers]) => { if (live) setD({ board, customers }); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api]);
  const sheet = (body, cta) => (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onBack} />
      <div className="mlap-sheet tall" role="dialog" aria-modal="true" aria-label={trFl('fld.addStopT')} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
        <FldSheetHead title={trFl('fld.addStopT')} onClose={onBack} />
        <div className="mlap-sheet-body">{body}</div>
        {cta ? <div className="mlap-sheet-cta">{cta}</div> : null}
      </div>
    </>
  );
  if (err) return sheet(<FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />);
  if (!d) return sheet(<div className="mlap-empty">{trFl('fld.loading')}</div>);
  const cand = FIELDLOGIC.addStopCandidates({ board: d.board, customers: d.customers, q });
  const pickHasPin = !!pick && typeof pick.lat === 'number' && typeof pick.lng === 'number';
  const onBoard = !!pick && d.board.some((s) => s.customerId === pick.id && s.status !== 'batal');   // already on today's route (also a "Tambah ke hari ini" from the customer sheet)
  const save = () => {
    setBusy(true); setMsg('');
    api.addStop({ customerId: pick.id, qty }).then(() => onDone(trFl('fld.stopAdded', { name: pick.name }))).catch((e) => setMsg(fldErrMsg(e))).finally(() => setBusy(false));
  };
  return sheet(
    <>
      <label className="mlap-searchbox"><FldSvg n="search" s={16} sw={2.2} /><input type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {cand.noPin.length > 0 && !q.trim() && (
        <>
          <div className="mlap-label">{trFl('fld.noPinToday')}</div>
          <div className="mlap-card">
            {cand.noPin.map((s) => (
              <div key={s.id} className="mlap-row">
                <span className="mlap-grow"><span className="nm">{s.customerName}</span><span className="sb">{s.customerCode}</span></span>
                {can.location ? <button type="button" className="mlap-btn" onClick={() => onPin(fldCustFromStop(s))}>{trFl('fld.setPin')}</button> : null}
              </div>
            ))}
          </div>
        </>
      )}
      <div className="mlap-label">{trFl('fld.otherCust')}</div>
      <div className="mlap-card">
        {cand.others.length ? cand.others.slice(0, 60).map((c) => (
          <button key={c.id} type="button" className={'mlap-pickrow' + (pick && pick.id === c.id ? ' on' : '')} aria-pressed={!!(pick && pick.id === c.id)} onClick={() => setPick(c)}>
            <span className="mlap-radio" aria-hidden="true" />
            <span className="mlap-grow"><span className="nm">{c.name}</span><span className="sb">{[c.code, c.address].filter(Boolean).join(' · ')}</span></span>
            <span className={'mlap-tag ' + (c.gaps.titik ? 'warnt' : 'ok')}>{trFl(c.gaps.titik ? 'fld.tagNoPin' : 'fld.tagHasPin')}</span>
          </button>
        )) : <div className="mlap-empty">{trFl('fld.emptySeg')}</div>}
      </div>
      {pick && !pickHasPin ? (
        <div className="mlap-nopincard" role="alert">
          <div className="mlap-nopincard-hd"><FldSvg n="pinOff" s={18} sw={2.2} /><span className="mlap-grow"><b>{trFl('fld.pickNoPinT', { name: pick.name })}</b><span>{trFl('fld.pickNoPinB')}</span></span></div>
          {can.location ? <button type="button" className="mlap-btn mlap-pinnow" onClick={() => onPin(pick, true)}><FldSvg n="crosshair" s={16} sw={2.2} />{trFl('fld.setPinNow')}</button> : null}
        </div>
      ) : pick ? <FldNotice tone="info" title={trFl('fld.pickPinT', { name: pick.name })} /> : null}
      {onBoard ? <FldNotice tone="warn" title={trFl('fld.alreadyToday')} /> : null}
      {pick ? <div className="mlap-card"><FldStepper label={trFl('fld.qtyGalon')} value={qty} onChange={setQty} min={1} max={999} /></div> : null}
      {msg && <div className="mlap-err" role="alert">{msg}</div>}
    </>,
    <button type="button" className="mlap-btn primary" disabled={busy || qty < 1 || onBoard || !pick} onClick={save}>{trFl(pick ? (pickHasPin ? 'fld.addToRoute' : 'fld.addAtEnd') : 'fld.addStopCta')}</button>
  );
}
```

In `server/tests/field-cust-static.test.js` ("Plan 3C: 3B minors — Tambah stop …") the disabled assertion now reads with `|| !pick` — replace

```js
    expect(f).toMatch(/disabled=\{busy \|\| qty < 1 \|\| onBoard\}/);
```

with

```js
    expect(f).toMatch(/disabled=\{busy \|\| qty < 1 \|\| onBoard \|\| !pick\}/);   // 3D-2: the CTA is always there, waiting for a pick
```

- [ ] **Step 4: The shell** (`dist-field.jsx`): remove `'addStop', ` from the `full` list; change the mount guard `{ready && full && view.name === 'addStop' && <FldAddStop …` to `{ready && view && view.name === 'addStop' && <FldAddStop …` (props unchanged) and move that line next to the stop-sheet line.

- [ ] **Step 5: Append the CSS:**

```css
/* ── 3D-2 TAMBAH — mockup Tambah stop board ── */
.mlap-searchbox { min-height: 44px; border-radius: 12px; background: #FFFFFF; display: flex; align-items: center; gap: 8px; padding: 0 12px; color: var(--mlap-sub); }
.mlap-searchbox input { flex: 1; min-width: 0; height: 42px; border: 0; background: transparent; font: inherit; font-size: 16px; color: var(--mlap-ink); outline: none; }
.mlap-searchbox:focus-within { box-shadow: inset 0 0 0 2px #065489; }
.mlap-pickrow .nm { font-size: 15px; font-weight: 600; }
.mlap-pickrow .sb { font-size: 12px; color: var(--mlap-sub); }
.mlap-tag.warnt { background: #FFF1E8; color: #9A3412; }
.mlap-nopincard { background: #FFF1E8; border: 1px solid #F4C7A8; border-radius: 16px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.mlap-nopincard-hd { display: flex; gap: 8px; color: #9A3412; }
.mlap-nopincard-hd > svg { flex-shrink: 0; }
.mlap-nopincard-hd b { font-size: 14px; font-weight: 700; }
.mlap-nopincard-hd .mlap-grow > span { font-size: 13px; line-height: 17px; color: #7C2D12; }
.mlap-btn.mlap-pinnow { border-radius: 12px; background: #FFFFFF; border: 1.5px solid #C2410C; color: #9A3412; font-size: 15px; font-weight: 700; }
```

- [ ] **Step 6: Add the i18n keys.** EN: ` 'fld.tagHasPin': 'Has pin', 'fld.otherCust': 'Other customers', 'fld.pickPinT': '{name} has a pin — it joins the trip route.', 'fld.addToRoute': 'Add to the route', 'fld.addAtEnd': 'Add at the end of the list',` — ID: ` 'fld.tagHasPin': 'Ada titik', 'fld.otherCust': 'Pelanggan lain', 'fld.pickPinT': '{name} punya titik lokasi — ikut disusun di rute rit.', 'fld.addToRoute': 'Tambah ke rute', 'fld.addAtEnd': 'Tambah di akhir daftar',`

- [ ] **Step 7: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-cust.test.js tests/field-cust-static.test.js tests/field-shell-static.test.js tests/field-kit-static.test.js`
Expected: PASS (the shell's `<FldAddStop api={api} preset={view.preset} can={can} onPin={(c, keep) => …` assertion still matches).

- [ ] **Step 8: Side-by-side check** — Tambah stop from Catat, pick a customer without a pin, then one with a pin, next to `TambahStop.dc.html`; "Isi titik lokasi sekarang" → Atur titik → back returns to the sheet with the pick kept.

- [ ] **Step 9: Commit**

```bash
git add dist-field-cust.jsx dist-field.jsx dist-field.css finance-i18n.js server/tests/field-3d2-cust.test.js server/tests/field-cust-static.test.js
git commit -m "feat(distribusi): Tambah stop as a sheet to the mockup — search, radio rows with pin tags, no-pin warning card, CTA by pin"
```

---

### Task 13: Bayar bon, Penyesuaian, Ganti rugi, Pengeluaran — their mockup boards

**Files:**
- Modify: `dist-field-logic.js` (add `settleBons`)
- Modify: `dist-field-cust.jsx` (`FldPayBon`, `FldAdjust`, `FldDamage`, `FldExpense` returns; `FLD_EXP_CATS` gets icons)
- Modify: `dist-field.css` (append `3D-2 INPUT`), `finance-i18n.js`
- Test: `server/tests/field-logic.test.js` (append), `server/tests/field-3d2-cust.test.js` (append)

**Interfaces:**
- Consumes: `FldCustHead`, `FldMoney`, `FldPhoto`, `FldCtaBar`, `.mlap-kv`, `.mlap-label` (Task 1); `'fld.pinSame'` (Task 11).
- Produces: `FIELDLOGIC.settleBons(bons, pay) → ['lunas'|'sebagian'|'belum', …]` (oldest first); CSS `.mlap-cats` / `.mlap-cat` (+`.on`, `.danger`) — Task 14 reuses them.

- [ ] **Step 1: Write the failing tests.** Append to `server/tests/field-logic.test.js`:

```js
describe('3D-2 bon settlement', () => {
  it('settleBons: the payment settles the oldest bons first', () => {
    const bons = [{ amount: 18000 }, { amount: 27000 }];
    expect(L.settleBons(bons, 45000)).toEqual(['lunas', 'lunas']);
    expect(L.settleBons(bons, 18000)).toEqual(['lunas', 'belum']);
    expect(L.settleBons(bons, 20000)).toEqual(['lunas', 'sebagian']);
    expect(L.settleBons(bons, 0)).toEqual(['belum', 'belum']);
    expect(L.settleBons(bons, null)).toEqual(['belum', 'belum']);
  });
});
```

Append to `server/tests/field-3d2-cust.test.js`:

```js
describe('Manual inputs (mockup Bayar bon, Penyesuaian, Ganti rugi, Pengeluaran boards)', () => {
  it('Bayar bon: each open bon shows how this payment settles it; quick chips; the photo title follows cash / transfer; a green "Lunas" after', () => {
    const f = fn(cust, 'FldPayBon');
    expect(f).toMatch(/const settle = FIELDLOGIC\.settleBons\(open, pay\);/);
    expect(f).toMatch(/<span className=\{'mlap-bonst ' \+ settle\[i\]\}>\{trFl\('fld\.bs_' \+ settle\[i\]\)\}<\/span>/);
    expect(f).toMatch(/title=\{trFl\(via === 'transfer' \? 'fld\.payTfPhoto' : 'fld\.payCashPhoto'\)\}/);
    expect(f).toMatch(/<FldCtaBar hint=\{!photo \? trFl\('fld\.needPhoto'\) : ''\}>/);
    expect(rule('INPUT', '.mlap-bonst.lunas')).toMatch(/background: #E3F3EA; color: #1E6B40;/);
  });
  it('Penyesuaian: the record, the count, a coloured difference row (green when equal); fixed send bar', () => {
    const f = fn(cust, 'FldAdjust');
    expect(f).toMatch(/<div className=\{'mlap-diffrow' \+ \(diff === 0 \? ' same' : ''\)\}>/);
    expect(f).toMatch(/<FldCtaBar><button type="button" className="mlap-btn primary" disabled=\{busy \|\| !reasonKey \|\| diff === 0\} onClick=\{send\}>/);
    expect(rule('INPUT', '.mlap-diffrow.same')).toMatch(/background: #E3F3EA; color: #1E6B40;/);
  });
  it('Ganti rugi: count, damage chips, the owner\'s price in an input-styled box, the effect card with the highlighted total', () => {
    const f = fn(cust, 'FldDamage');
    expect(f).toMatch(/<span className="mlap-pricebox">/);
    expect(f).toMatch(/<div className="mlap-kv total"><span>\{trFl\(pv\.totalKey\)\}<\/span><b>\{FIELDLOGIC\.fmtRp\(pv\.total\)\}<\/b><\/div>/);
    expect(f).toMatch(/<FldCtaBar><button type="button" className="mlap-btn primary" disabled=\{busy \|\| !!pv\.blocked \|\| !kind \|\| !photo\} onClick=\{save\}>/);
  });
  it('Pengeluaran: five icon category tiles, the big amount, litres + odometer side by side for fuel, the receipt card', () => {
    const f = fn(cust, 'FldExpense');
    expect(cust).toMatch(/const FLD_EXP_CATS = \[\['bensin', 'fld\.c_bensin', 'fuel'\], \['parkir', 'fld\.c_parkir', 'parking'\], \['servis', 'fld\.c_servis', 'wrench'\], \['makan', 'fld\.c_makan', 'food'\], \['lainnya', 'fld\.c_lainnya', 'dots'\]\];/);
    expect(f).toMatch(/className=\{'mlap-cat' \+ \(cat === k \? ' on' : ''\)\}/);
    expect(f).toMatch(/<div className="mlap-card mlap-two">/);
    expect(f).toMatch(/<FldCtaBar><button type="button" className="mlap-btn primary" disabled=\{busy \|\| !cat \|\| !\(amount > 0\) \|\| !photo\} onClick=\{save\}>/);
    expect(rule('INPUT', '.mlap-cat.on')).toMatch(/border: 1\.5px solid #065489; background: #E8F1F8; color: #065489;/);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-cust.test.js`
Expected: FAIL — `L.settleBons is not a function`; the four screens do not match.

- [ ] **Step 3: Add `settleBons`** to `dist-field-logic.js` after `payPreview`:

```js
  // BAYAR BON (3D-2): how this payment settles each open bon, oldest first (view only — the server keeps
  // the real balance).
  function settleBons(bons, pay) {
    var left = Math.max(0, Math.round(num(pay)));
    return (bons || []).map(function (b) { var a = Math.max(0, num(b.amount)); var paid = Math.min(left, a); left -= paid; return paid >= a && a > 0 ? 'lunas' : paid > 0 ? 'sebagian' : 'belum'; });
  }
```

and add `settleBons: settleBons, ` to the returned object (before `swipeTab: swipeTab`).

- [ ] **Step 4: Rewrite the four returns** in `dist-field-cust.jsx`.

`FldPayBon` — keep everything above `return (` and replace the return with this block (it starts with the two new consts `settle` and `quick`):

```jsx
  const settle = FIELDLOGIC.settleBons(open, pay);
  const quick = [[bon, trFl('fld.payAllV', { v: FIELDLOGIC.fmtRp(bon) })], [open.length > 1 ? open[0].amount : 0, trFl('fld.payOldestV', { v: FIELDLOGIC.fmtRp(open.length > 1 ? open[0].amount : 0) })]].filter(([v]) => v > 0 && v <= bon);
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatBon')} onBack={onBack} />
      <div className="mlap-body">
        <FldCustHead name={c.name} sub={<>{c.code ? c.code + ' · ' : ''}{trFl('fld.sisaBonL')} <b className="mlap-bontxt">{FIELDLOGIC.fmtRp(bon)}</b></>} />
        {open.length > 0 && (
          <div className="mlap-card">
            {open.map((b, i) => (
              <div key={b.id} className="mlap-bonrow">
                <span className="mlap-grow"><span className="nm">{b.txnDate}</span><span className="sb">{trFl('fld.nGalon', { n: b.qty })}{b.partial ? ' · ' + trFl('fld.partPaid') : ''}</span></span>
                <b>{FIELDLOGIC.fmtRp(b.amount)}</b>
                <span className={'mlap-bonst ' + settle[i]}>{trFl('fld.bs_' + settle[i])}</span>
              </div>
            ))}
            <div className="mlap-cardnote">{trFl('fld.oldestFirst')}</div>
          </div>
        )}
        <div className="mlap-card">
          <FldMoney label={trFl('fld.payAmount')} value={pay} onChange={setPay} />
          {quick.length ? <div className="mlap-chips mlap-pad">{quick.map(([v, l]) => <button key={l} type="button" className={'mlap-chip-b' + (pay === v ? ' on' : '')} aria-pressed={pay === v} onClick={() => setPay(v)}>{l}</button>)}</div> : null}
        </div>
        <FldSeg label={trFl('fld.payVia')} value={via} onChange={setVia} options={[['tunai', trFl('fld.m_tunai')], ['transfer', trFl('fld.m_transfer')]]} />
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey={via === 'transfer' ? 'fld.payTfHint' : 'fld.payCashHint'} title={trFl(via === 'transfer' ? 'fld.payTfPhoto' : 'fld.payCashPhoto')} w={64} />
        <div className="mlap-card"><div className="mlap-kv tall"><span>{trFl('fld.bonAfterPay')}</span><b className={pv.rest === 0 ? 'big ok' : 'big bon'}>{pv.rest === 0 ? trFl('fld.lunas') : FIELDLOGIC.fmtRp(pv.rest)}</b></div></div>
        {pv.over > 0 ? <div className="mlap-warnline">{trFl('fld.payOver', { v: FIELDLOGIC.fmtRp(pv.over) })}</div> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar hint={!photo ? trFl('fld.needPhoto') : ''}>
        <button type="button" className="mlap-btn primary" disabled={busy || !pv.ok || !photo} onClick={save}>{trFl('fld.payCta', { v: FIELDLOGIC.fmtRp(pay || 0) })}</button>
      </FldCtaBar>
    </div>
  );
```

`FldAdjust` — replace its return with:

```jsx
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatAdj')} onBack={onBack} />
      <div className="mlap-body">
        <FldCustHead name={c.name} sub={[c.code, trFl('fld.adjSub')].filter(Boolean).join(' · ')} />
        <div className="mlap-card">
          <div className="mlap-kv tall"><span>{trFl('fld.adjRecord')}</span><b className="big">{trFl('fld.nGalon', { n: rec })}</b></div>
          <FldStepper label={trFl('fld.adjCounted')} hint={trFl('fld.adjCountedHint')} value={counted} onChange={setCounted} min={0} max={9999} />
          <div className={'mlap-diffrow' + (diff === 0 ? ' same' : '')}><span>{trFl('fld.adjDiff')}</span><b>{diff === 0 ? trFl('fld.pinSame') : (diff > 0 ? '+' : '−') + trFl('fld.nGalon', { n: Math.abs(diff) })}</b></div>
        </div>
        <div className="mlap-label">{trFl('fld.reasonT')}</div>
        <div className="mlap-chips">{FIELDLOGIC.ADJ_REASON_KEYS.map(([k]) => <button key={k} type="button" className={'mlap-chip-b' + (reasonKey === k ? ' on' : '')} aria-pressed={reasonKey === k} onClick={() => setReasonKey(k)}>{trFl(k)}</button>)}</div>
        <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.adjPhotoHint" title={trFl('fld.adjPhotoT')} optional w={64} />
        <FldNotice tone="info" title={trFl(needsApproval === false ? 'fld.adjNoWait' : 'fld.adjWaits')} />
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar><button type="button" className="mlap-btn primary" disabled={busy || !reasonKey || diff === 0} onClick={send}>{trFl('fld.adjCta')}</button></FldCtaBar>
    </div>
  );
```

`FldDamage` — replace its return with:

```jsx
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatDmg')} onBack={onBack} />
      <div className="mlap-body">
        <FldCustHead name={c.name} sub={[c.code, trFl('fld.dmgSub')].filter(Boolean).join(' · ')} />
        {pv.blocked ? <FldNotice tone="warn" title={trFl(pv.blocked)} sub={trFl(pv.blocked + 'B')} /> : null}
        <div className="mlap-card">
          <FldStepper label={trFl('fld.dmgQty')} hint={trFl('fld.dmgFrom', { n: held })} value={qty} onChange={setQty} min={1} max={Math.max(1, held)} />
          <div className="mlap-cardsec"><span className="mlap-cardsec-t">{trFl('fld.dmgKindL')}</span><div className="mlap-chips">{FLD_DMG_KINDS.map(([k, key]) => <button key={k} type="button" className={'mlap-chip-b' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>{trFl(key)}</button>)}</div></div>
          <div className="mlap-kv tall"><span className="strong">{trFl('fld.dmgPrice')}</span><span className="mlap-pricebox">Rp <b>{Number(rules.hargaGantiRugiGalon || 0).toLocaleString('id-ID')}</b></span></div>
        </div>
        <div className="mlap-label">{trFl('fld.payVia')}</div>
        <FldSeg label={trFl('fld.payVia')} value={pay} onChange={setPay} options={[['tunai', trFl('fld.m_tunai')], ['bon', trFl('fld.toBon')], ['transfer', trFl('fld.m_transfer')]]} />
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.dmgPhotoHint" title={trFl('fld.dmgPhotoT')} w={72} />
        <div className="mlap-card">
          <div className="mlap-kv"><span>{trFl('fld.galAtCust')}</span><b>{held + ' → ' + pv.heldAfter}</b></div>
          <div className="mlap-kv"><span>{trFl('fld.dmgToDepot')}</span><b>{kind === 'hilang' ? trFl('fld.dmgLost') : trFl('fld.nGalon', { n: qty })}</b></div>
          <div className="mlap-kv total"><span>{trFl(pv.totalKey)}</span><b>{FIELDLOGIC.fmtRp(pv.total)}</b></div>
        </div>
        <div className="mlap-hint">{trFl('fld.dmgNoApproval')}</div>
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar><button type="button" className="mlap-btn primary" disabled={busy || !!pv.blocked || !kind || !photo} onClick={save}>{trFl('fld.dmgCta')}</button></FldCtaBar>
    </div>
  );
```

`FldExpense` — change the categories line to

```jsx
const FLD_EXP_CATS = [['bensin', 'fld.c_bensin', 'fuel'], ['parkir', 'fld.c_parkir', 'parking'], ['servis', 'fld.c_servis', 'wrench'], ['makan', 'fld.c_makan', 'food'], ['lainnya', 'fld.c_lainnya', 'dots']];
```

and replace its return with:

```jsx
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatExp')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-cats" role="group" aria-label={trFl('fld.catatExp')}>{FLD_EXP_CATS.map(([k, key, ico]) => <button key={k} type="button" className={'mlap-cat' + (cat === k ? ' on' : '')} aria-pressed={cat === k} onClick={() => setCat(k)}><FldSvg n={ico} s={20} /><span>{trFl(key)}</span></button>)}</div>
        <div className="mlap-card"><FldMoney label={trFl('fld.expAmount')} value={amount} onChange={setAmount} /></div>
        {cat === 'bensin' && (
          <div className="mlap-card mlap-two">
            <label><span>{trFl('fld.liters')}</span><input inputMode="decimal" placeholder={trFl('fld.litersPh')} value={liters} onChange={(e) => setLiters(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 6))} /></label>
            <label><span>{trFl('fld.odometer')}</span><input inputMode="numeric" placeholder={trFl('fld.odoPh')} value={odo} onChange={(e) => setOdo(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))} /></label>
          </div>
        )}
        <FldNotice tone="info" title={trFl('fld.expFromDeposit')} sub={trFl('fld.expFromDepositB')} />
        <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.receiptHint" title={trFl('fld.receiptT')} w={64} h={76} />
        {today != null ? <div className="mlap-card"><div className="mlap-kv"><span>{trFl('fld.expToday', { v: FIELDLOGIC.fmtRp(today) })}</span></div></div> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar><button type="button" className="mlap-btn primary" disabled={busy || !cat || !(amount > 0) || !photo} onClick={save}>{trFl('fld.expCta')}</button></FldCtaBar>
    </div>
  );
```

- [ ] **Step 5: Append the CSS:**

```css
/* ── 3D-2 INPUT — mockup Bayar bon, Penyesuaian, Ganti rugi, Pengeluaran boards ── */
.mlap-bonrow { min-height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-bottom: 1px solid var(--mlap-line); }
.mlap-bonrow .nm { font-size: 14px; font-weight: 600; }
.mlap-bonrow .sb { font-size: 12px; color: var(--mlap-sub); }
.mlap-bonrow > b { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.mlap-bonst { width: 62px; height: 20px; line-height: 20px; text-align: center; border-radius: 5px; font-size: 11px; font-weight: 700; flex-shrink: 0; background: #EEF2F6; color: #3E4E58; }
.mlap-bonst.lunas { background: #E3F3EA; color: #1E6B40; }
.mlap-bonst.sebagian { background: #FCF1D6; color: #7A4B00; }
.mlap-cardnote { padding: 6px 12px 8px; font-size: 12px; color: var(--mlap-sub); }
.mlap-kv.tall { min-height: 48px; }
.mlap-kv b.big { font-size: 17px; font-weight: 700; }
.mlap-kv b.ok { color: #1E6B40; }
.mlap-kv b.bon { color: #7A4B00; }
.mlap-kv .strong { font-size: 15px; font-weight: 600; color: var(--mlap-ink); }
.mlap-diffrow { min-height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; background: #FFF1E8; color: #9A3412; }
.mlap-diffrow.same { background: #E3F3EA; color: #1E6B40; }
.mlap-diffrow span { font-size: 14px; font-weight: 600; }
.mlap-diffrow b { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mlap-cardsec { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--mlap-line); }
.mlap-cardsec-t { font-size: 13px; font-weight: 600; color: var(--mlap-sub); }
.mlap-pricebox { height: 40px; border-radius: 10px; border: 1px solid #D5DDE3; display: flex; align-items: center; gap: 4px; padding: 0 10px; font-size: 15px; color: #3E4E58; }
.mlap-pricebox b { font-size: 16px; font-weight: 600; color: var(--mlap-ink); font-variant-numeric: tabular-nums; }
.mlap-cats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.mlap-cat { height: 64px; border-radius: 14px; border: 1px solid transparent; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 0 2px; font: inherit; font-size: 11px; font-weight: 600; color: #3E4E58; cursor: pointer; text-align: center; transition: transform .35s cubic-bezier(.34,1.56,.64,1); }
.mlap-cat:active { transform: scale(.9); }
.mlap-cat.on { border: 1.5px solid #065489; background: #E8F1F8; color: #065489; }
.mlap-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.mlap-two label { padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
.mlap-two label:first-child { border-right: 1px solid var(--mlap-line); }
.mlap-two span { font-size: 12px; color: var(--mlap-sub); }
.mlap-two input { min-height: 28px; border: 0; padding: 0; background: transparent; font: inherit; font-size: 16px; font-weight: 600; color: var(--mlap-ink); outline: none; }
.mlap-two label:focus-within { box-shadow: inset 0 0 0 2px #065489; }
```

- [ ] **Step 6: Add the i18n keys.** EN:

```
 'fld.sisaBonL': 'bon left', 'fld.bs_lunas': 'Paid', 'fld.bs_sebagian': 'Part', 'fld.bs_belum': 'Open', 'fld.payAllV': 'Pay all {v}', 'fld.payOldestV': 'Oldest bon {v}', 'fld.payCashPhoto': 'Photo of the cash / receipt', 'fld.payTfPhoto': 'Transfer proof photo', 'fld.payCashHint': 'Photo of the cash received or the signed receipt.', 'fld.payTfHint': 'Screenshot or photo of the customer banking app.', 'fld.adjSub': 'count the gallons at the customer', 'fld.adjPhotoT': 'Photo of the gallons on site', 'fld.dmgSub': 'borrowed gallon broken / lost', 'fld.dmgKindL': 'Damage', 'fld.dmgPhotoT': 'Photo of the damaged gallon', 'fld.galAtCust': 'Gallons at the customer', 'fld.dmgToDepot': 'Damaged gallons to the warehouse', 'fld.dmgLost': '— (lost)', 'fld.receiptT': 'Receipt photo', 'fld.litersPh': 'e.g. 11.2', 'fld.odoPh': 'e.g. 48215',
```

ID:

```
 'fld.sisaBonL': 'sisa bon', 'fld.bs_lunas': 'Lunas', 'fld.bs_sebagian': 'Sebagian', 'fld.bs_belum': 'Belum', 'fld.payAllV': 'Lunas semua {v}', 'fld.payOldestV': 'Bon tertua {v}', 'fld.payCashPhoto': 'Foto uang / kwitansi', 'fld.payTfPhoto': 'Foto bukti transfer', 'fld.payCashHint': 'Foto uang yang diterima atau kwitansi yang ditandatangani.', 'fld.payTfHint': 'Screenshot atau foto layar m-banking pelanggan.', 'fld.adjSub': 'hitung galon yang ada di pelanggan', 'fld.adjPhotoT': 'Foto galon di lokasi', 'fld.dmgSub': 'galon pinjaman rusak / hilang', 'fld.dmgKindL': 'Kerusakan', 'fld.dmgPhotoT': 'Foto galon rusak', 'fld.galAtCust': 'Galon di pelanggan', 'fld.dmgToDepot': 'Galon rusak ke gudang', 'fld.dmgLost': '— (hilang)', 'fld.receiptT': 'Foto nota / struk', 'fld.litersPh': 'mis. 11,2', 'fld.odoPh': 'mis. 48.215',
```

- [ ] **Step 7: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-cust.test.js tests/field-cust-static.test.js tests/field-expense.test.js tests/field-kit-static.test.js`
Expected: PASS (every 3B/3C assertion on these four screens — clientRef slots, replay message, `payPreview`, `'fld.adjWaits'`, `pv.blocked` notice, `'fld.dmgNoApproval'`, no `method:` in the expense, `cat === 'bensin' &&`, `'fld.expFromDeposit'` — still matches).

- [ ] **Step 8: Side-by-side check** — each screen next to its board (`BayarBon`, `Penyesuaian`, `GantiRugi`, `Pengeluaran`); Bayar bon with two open bons at "Bon tertua"; Pengeluaran with Bensin.

- [ ] **Step 9: Commit**

```bash
git add dist-field-logic.js dist-field-cust.jsx dist-field.css finance-i18n.js server/tests/field-logic.test.js server/tests/field-3d2-cust.test.js
git commit -m "feat(distribusi): Bayar bon, Penyesuaian, Ganti rugi, Pengeluaran to their mockup boards — settle states, diff row, price box, icon categories, fixed save bars"
```

---

### Task 14: Koreksi — mockup Koreksi boards (Galon / Bayar / Pelanggan)

**Files:**
- Modify: `dist-field-logic.js` (add `koreksiImpact`)
- Modify: `dist-field-koreksi.jsx` (add `FLD_KICO`, `fldValText`; rewrite the return of `FldKoreksi` and `FldKoreksiCust`)
- Modify: `dist-field.css` (append `3D-2 KOREKSI`), `finance-i18n.js`
- Create: `server/tests/field-3d2-koreksi.test.js`; append `server/tests/field-logic.test.js`; update `server/tests/field-koreksi-static.test.js` (one assertion)

**Interfaces:**
- Consumes: `.mlap-cats` / `.mlap-cat` (Task 13), `.mlap-pickrow` / `.mlap-radio` / `.mlap-searchbox` (Tasks 1, 12), `FldCtaBar`, `.mlap-ctahint .muted` (Task 1).
- Produces: `FIELDLOGIC.koreksiImpact({ kind, t, change, pv }) → [{ key, a, b, type, name? }]`; `fldValText(type, v)` (Task 15 uses it).

- [ ] **Step 1: Write the failing tests.** Append to `server/tests/field-logic.test.js`:

```js
describe('3D-2 koreksi impact', () => {
  const t = { id: 't1', qty: 3, gallonIn: 2, method: 'bon', amount: 54000 };
  it('gallon counts from the transaction, money from the server preview, raw values', () => {
    expect(L.koreksiImpact({ kind: 'jumlah', t, change: { qty: 2, gallonIn: 2 }, pv: { oldAmount: 54000, newAmount: 36000, oldSisaBon: 54000, newSisaBon: 36000 } })).toEqual([
      { key: 'fld.ki_out', a: 3, b: 2, type: 'n' },
      { key: 'fld.ki_bill', a: 54000, b: 36000, type: 'rp' },
      { key: 'fld.ki_bon', a: 54000, b: 36000, type: 'rp' },
    ]);
  });
  it('a pay change names old and new; a cancel shows the status; a move shows both customers', () => {
    expect(L.koreksiImpact({ kind: 'bayar', t, change: { pay: 'lunas' }, pv: null })).toEqual([{ key: 'fld.ki_pay', a: 'bon', b: 'lunas', type: 'pay' }]);
    expect(L.koreksiImpact({ kind: 'batal', t, change: {} })).toEqual([{ key: 'fld.ki_status', a: 'aktif', b: 'batal', type: 'status' }]);
    const pv = { fromCustomer: { name: 'A', sisaBonBefore: 54000, sisaBonAfter: 0, gallonsBefore: 4, gallonsAfter: 3 }, toCustomer: { name: 'B', sisaBonBefore: 0, sisaBonAfter: 54000, gallonsBefore: 5, gallonsAfter: 6 } };
    expect(L.koreksiImpact({ kind: 'pelanggan', t, change: { toId: 'c2' }, pv })).toEqual([
      { key: 'fld.ki_bonOf', name: 'A', a: 54000, b: 0, type: 'rp' }, { key: 'fld.ki_galOf', name: 'A', a: 4, b: 3, type: 'n' },
      { key: 'fld.ki_bonOf', name: 'B', a: 0, b: 54000, type: 'rp' }, { key: 'fld.ki_galOf', name: 'B', a: 5, b: 6, type: 'n' },
    ]);
    expect(L.koreksiImpact({ kind: 'pelanggan', t, change: {}, pv: null })).toEqual([]);
  });
});
```

Create `server/tests/field-3d2-koreksi.test.js`:

```js
'use strict';
// PLAN 3D-2 KOREKSI + ARMADA (static): Koreksi, Koreksi saya and Armada & SOP laid out to their approved
// mockup boards — every correction still goes to the office, the original stays valid until approved.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const kor = read('dist-field-koreksi.jsx'); const shellSrc = read('dist-field.jsx'); const kit = read('dist-field-kit.jsx'); const css = read('dist-field.css');
const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); expect({ name, found: i > -1 }).toEqual({ name, found: true }); const j = src.indexOf('\nfunction ', i + 10); return src.slice(i, j < 0 ? undefined : j); };
const section = (name) => { const i = css.indexOf('/* ── 3D-2 ' + name); expect({ name, found: i > -1 }).toEqual({ name, found: true }); const j = css.indexOf('/* ── 3D-2 ', i + 10); return css.slice(i, j < 0 ? undefined : j); };
const rule = (name, sel) => { const b = section(name); const i = b.indexOf('\n' + sel + ' {'); expect({ sel, found: i > -1 }).toEqual({ sel, found: true }); return b.slice(i, b.indexOf('}', i)); };

it('parses; never calls the server directly', () => {
  expect(() => parse(kor, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(kor).not.toMatch(/window\.API|fetch\(/);
});

describe('Koreksi (mockup Koreksi boards)', () => {
  const f = () => fn(kor, 'FldKoreksi');
  it('the recorded transaction as a card; "what is wrong" as icon tiles (cancel in red)', () => {
    expect(f()).toMatch(/<div className="mlap-card mlap-txncard">/);
    expect(f()).toMatch(/className=\{'mlap-cat k' \+ \(k === 'batal' \? ' danger' : ''\) \+ \(kind === k \? ' on' : ''\)\}/);
    expect(f()).toMatch(/<FldSvg n=\{FLD_KICO\[k\]\} s=\{19\} \/>/);
    expect(rule('KOREKSI', '.mlap-cat.danger.on')).toMatch(/border-color: #B42318; background: #FDECEA; color: #8C2A20;/);
  });
  it('the impact as struck-through → new rows from the shared logic; reasons are blue chips', () => {
    expect(f()).toMatch(/const impact = kind \? FIELDLOGIC\.koreksiImpact\(\{ kind, t, change, pv \}\) : \[\];/);
    expect(f()).toMatch(/<s>\{fldValText\(r\.type, r\.a\)\}<\/s><FldSvg n="arrowRight" s=\{12\} sw=\{2\.4\} \/><b>\{fldValText\(r\.type, r\.b\)\}<\/b>/);
    expect(f()).not.toMatch(/tone="hold"/);
  });
  it('the request is the fixed bottom bar (red for a cancel) under "stays valid until approved"', () => {
    expect(f()).toMatch(/<FldCtaBar hint=\{<span className="muted">\{trFl\('fld\.kStaysValid'\)\}<\/span>\}>/);
    expect(f()).toMatch(/className=\{'mlap-btn ' \+ \(kind === 'batal' \? 'danger solid' : 'primary'\)\} disabled=\{busy \|\| !!why \|\| !!pvErr \|\| !reason\.trim\(\)\}/);
    expect(rule('KOREKSI', '.mlap-btn.danger.solid')).toMatch(/background: #B42318; color: #FFFFFF;/);
  });
  it('the right customer is picked from radio rows (nearest first, then a search)', () => {
    const c = fn(kor, 'FldKoreksiCust');
    expect(c).toMatch(/className=\{'mlap-pickrow' \+ \(value && value\.id === c\.id \? ' on' : ''\)\}/);
    expect(c).toMatch(/<label className="mlap-searchbox gray">/);
  });
});
```

In `server/tests/field-koreksi-static.test.js` ("previews both customers …") replace

```js
    expect(f).toMatch(/\[pv\.fromCustomer, pv\.toCustomer\]\.map/);
```

with

```js
    expect(f).toMatch(/FIELDLOGIC\.koreksiImpact\(\{ kind, t, change, pv \}\)/);   // 3D-2: both customers' rows come from the shared impact logic
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-koreksi.test.js`
Expected: FAIL — `L.koreksiImpact is not a function`; no `mlap-txncard`.

- [ ] **Step 3: Add `koreksiImpact`** to `dist-field-logic.js` after `koreksiReason`:

```js
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
```

and add `koreksiImpact: koreksiImpact, ` to the returned object (before `swipeTab: swipeTab`).

- [ ] **Step 4: Rewrite the Koreksi screen** in `dist-field-koreksi.jsx`. After `const FLD_KOREKSI_REASONS = …;` add:

```jsx
const FLD_KICO = { pelanggan: 'userMove', jumlah: 'bottlePlus', bayar: 'cash', nominal: 'cash', batal: 'ban' };
// A raw value of a correction row, in words (the boards' "struck-through → new").
const fldValText = (type, v) => (type === 'rp' ? FIELDLOGIC.fmtRp(v) : type === 'n' ? trFl('fld.nGalon', { n: v }) : type === 'pay' ? trFl('fld.m_' + v) : type === 'status' ? trFl('fld.ks_' + v) : String(v == null ? '—' : v));
```

In `FldKoreksi`: change `const head = <FldTop title={trFl('fld.koreksiT')} sub={…} onBack={onBack} />;` to `const head = <FldTop title={trFl('fld.koreksiT')} onBack={onBack} />;`, add `alert` to its load-error notice if Task 1 did not, and replace its final `return (...)` (after `const rp = FIELDLOGIC.fmtRp;`) with:

```jsx
  const impact = kind ? FIELDLOGIC.koreksiImpact({ kind, t, change, pv }) : [];
  return (
    <div className="mlap-screen">
      {head}
      <div className="mlap-body">
        <div className="mlap-card mlap-txncard">
          <span className="mlap-txnthumb" aria-hidden="true"><FldSvg n="receipt" s={22} /></span>
          <span className="mlap-grow">
            <span className="mlap-txn-eb">{trFl('fld.kTxnAt', { d: t.txnDate })}</span>
            <span className="mlap-txn-nm">{[d.name, d.code].filter(Boolean).join(' · ')}</span>
            <span className="mlap-txn-sb">{trFl('fld.kTxnGal', { n: t.qty, b: t.gallonIn || 0 })} · <b className={payNow === 'bon' ? 'mlap-bontxt' : ''}>{trFl('fld.m_' + payNow)} {rp(t.effectiveAmount != null ? t.effectiveAmount : t.amount)}</b></span>
          </span>
        </div>
        {t.pendingRequest ? (
          <FldNotice tone="warn" title={trFl('fld.kPendingT')} sub={trFl('fld.kPendingB')} action={onSaya ? trFl('fld.kSaya') : null} onAction={onSaya} />
        ) : !opts.length ? (
          <FldNotice tone="info" title={trFl(t.kind === 'ganti_rugi' ? 'fld.kOnlyVoid' : 'fld.kNoOptions')} />
        ) : (
          <>
            {t.kind === 'ganti_rugi' ? <FldNotice tone="info" title={trFl('fld.kOnlyVoid')} /> : null}
            <div className="mlap-label">{trFl('fld.kWhat')}</div>
            <div className="mlap-cats" style={{ gridTemplateColumns: 'repeat(' + opts.length + ', minmax(0, 1fr))' }}>
              {opts.map((k) => <button key={k} type="button" className={'mlap-cat k' + (k === 'batal' ? ' danger' : '') + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => choose(k)}><FldSvg n={FLD_KICO[k]} s={19} /><span>{trFl('fld.kt_' + k)}</span></button>)}
            </div>
            {kind === 'jumlah' && (
              <div className="mlap-card">
                <FldStepper label={trFl('fld.galOut')} hint={trFl('fld.kWas', { n: t.qty })} value={qty} onChange={setQty} min={1} max={999} cls={qty !== t.qty ? 'chg' : ''} />
                <FldStepper label={trFl('fld.galBack')} hint={trFl('fld.kWas', { n: t.gallonIn || 0 })} value={gIn} onChange={setGIn} min={0} max={999} cls={gIn !== (t.gallonIn || 0) ? 'chg' : ''} />
              </div>
            )}
            {kind === 'bayar' && (
              <div className="mlap-card mlap-cardsec">
                <span className="mlap-cardsec-t">{trFl('fld.kShouldBe')} · {trFl('fld.kWasPay')} <b className={payNow === 'bon' ? 'mlap-bontxt' : ''}>{trFl('fld.m_' + payNow)}</b></span>
                <FldSeg label={trFl('fld.ko_bayar')} value={pay} onChange={setPay} options={[['lunas', trFl('fld.m_lunas')], ['bon', trFl('fld.m_bon')], ['transfer', trFl('fld.m_transfer')]]} />
              </div>
            )}
            {kind === 'bayar' && needPhoto && (
              <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.kTransferPhotoHint" title={trFl('fld.kTransferPhoto')} />
            )}
            {kind === 'nominal' && <div className="mlap-card"><FldMoney label={trFl('fld.ko_nominal')} value={amount} onChange={setAmount} /></div>}
            {kind === 'batal' && <div className="mlap-voidcard" role="note"><FldSvg n="warn" s={18} sw={2.2} /><span>{trFl('fld.kVoidNote')}</span></div>}
            {kind === 'pelanggan' && <FldKoreksiCust api={api} t={t} fromId={target.customerId} value={toCust} onChange={setToCust} />}
            {kind && (
              <div className="mlap-card mlap-impact">
                <div className="mlap-impact-hd">{trFl('fld.kImpact')}</div>
                {impact.length ? impact.map((r, i) => (
                  <div key={i} className="mlap-improw"><span className="l">{trFl(r.key, { name: r.name })}</span><s>{fldValText(r.type, r.a)}</s><FldSvg n="arrowRight" s={12} sw={2.4} /><b>{fldValText(r.type, r.b)}</b></div>
                )) : <div className="mlap-impact-none">{trFl('fld.kNoChange')}</div>}
                {pv && pv.wouldGoNegative ? <div className="mlap-warnline">{trFl('fld.kNegative')}</div> : null}
              </div>
            )}
            {pvErr ? <div className="mlap-err" role="alert">{pvErr}</div> : null}
            {kind && (
              <>
                <div className="mlap-label">{trFl('fld.kReasonL')}</div>
                <FldChips options={FLD_KOREKSI_REASONS.map((k) => trFl(k)).concat([trFl('fld.r_other')])} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} />
              </>
            )}
            {why ? <div className="mlap-hint">{trFl(why)}</div> : null}
            {msg && <div className="mlap-err" role="alert">{msg}</div>}
          </>
        )}
      </div>
      {kind && !t.pendingRequest && opts.length ? (
        <FldCtaBar hint={<span className="muted">{trFl('fld.kStaysValid')}</span>}>
          <button type="button" className={'mlap-btn ' + (kind === 'batal' ? 'danger solid' : 'primary')} disabled={busy || !!why || !!pvErr || !reason.trim()} onClick={send}>{trFl(kind === 'batal' ? 'fld.kSendVoid' : 'fld.kSendFix')}</button>
        </FldCtaBar>
      ) : null}
    </div>
  );
```

(`<FldPhoto api={api} value={photo} onChange={setPhoto}` and `needPhoto && (` keep the 3C transfer-photo assertions true; the old `needPhoto` eyebrow line is now the photo card's title.)

Replace the return of `FldKoreksiCust` (from `const row = …` to the end) with:

```jsx
  const row = (c, sub) => (
    <button key={c.id} type="button" className={'mlap-pickrow' + (value && value.id === c.id ? ' on' : '')} aria-pressed={!!(value && value.id === c.id)} onClick={() => onChange(c)}>
      <span className="mlap-radio" aria-hidden="true" />
      <span className="mlap-grow"><span className="nm">{c.name}</span><span className="sb">{sub}</span></span>
    </button>
  );
  const shown = q.trim() ? rows : near;
  return (
    <div className="mlap-card mlap-kcust">
      <div className="mlap-kcust-t">{trFl('fld.kMoveTo')}</div>
      <label className="mlap-searchbox gray"><FldSvg n="search" s={15} sw={2.2} /><input type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {!q.trim() && near.length ? <div className="mlap-kcust-sub">{trFl('fld.kNear')}</div> : null}
      {value && !shown.some((c) => c.id === value.id) ? row(value, value.code || '') : null}
      {q.trim() ? rows.map((c) => row(c, c.code || '')) : near.map((c) => row(c, [c.code, trFl('fld.kNearM', { m: c.meters })].filter(Boolean).join(' · ')))}
    </div>
  );
```

- [ ] **Step 5: Append the CSS:**

```css
/* ── 3D-2 KOREKSI — mockup Koreksi + Koreksi saya boards ── */
.mlap-txncard { padding: 10px 12px; display: flex; gap: 10px; align-items: center; }
.mlap-txnthumb { width: 48px; height: 48px; border-radius: 10px; flex-shrink: 0; display: grid; place-items: center; background: #E8F1F8; color: #065489; }
.mlap-txn-eb { font-size: 11px; font-weight: 700; letter-spacing: .05em; color: var(--mlap-sub); text-transform: uppercase; }
.mlap-txn-nm { font-size: 16px; font-weight: 700; }
.mlap-txn-sb { font-size: 13px; color: #3E4E58; }
.mlap-cat.k { height: 60px; }
.mlap-cat.danger.on { border-color: #B42318; background: #FDECEA; color: #8C2A20; }
.mlap-stepper.chg input.mlap-stepval { color: #065489; }
.mlap-impact { padding: 8px 0 6px; }
.mlap-impact-hd { padding: 0 12px 2px; font-size: 13px; font-weight: 600; color: var(--mlap-sub); }
.mlap-improw { min-height: 34px; display: flex; align-items: center; gap: 6px; padding: 0 12px; font-size: 13px; }
.mlap-improw .l { flex: 1; min-width: 0; color: #3E4E58; }
.mlap-improw s { color: var(--mlap-sub); font-variant-numeric: tabular-nums; }
.mlap-improw > svg { color: #8A9AA3; flex-shrink: 0; }
.mlap-improw b { font-weight: 700; font-variant-numeric: tabular-nums; }
.mlap-impact-none { padding: 4px 12px; font-size: 13px; color: var(--mlap-sub); }
.mlap-voidcard { background: #FDECEA; border: 1px solid #F2B8B1; border-radius: 16px; padding: 10px 12px; display: flex; gap: 8px; color: #8C2A20; font-size: 13px; line-height: 17px; }
.mlap-voidcard > svg { flex-shrink: 0; }
.mlap-btn.danger.solid { background: #B42318; color: #FFFFFF; box-shadow: 0 8px 24px rgba(180,35,24,.28); }
.mlap-kcust { padding-bottom: 4px; }
.mlap-kcust-t { padding: 8px 12px 4px; font-size: 13px; font-weight: 600; color: var(--mlap-sub); }
.mlap-kcust-sub { padding: 6px 12px 2px; font-size: 12px; font-weight: 600; color: var(--mlap-sub); }
.mlap-searchbox.gray { margin: 0 12px 6px; background: #F1F4F7; min-height: 44px; }
.mlap-kcust .mlap-pickrow { border-bottom: 0; border-top: 1px solid var(--mlap-line); }
```

- [ ] **Step 6: Add the i18n keys.** EN:

```
 'fld.kt_pelanggan': 'Customer', 'fld.kt_jumlah': 'Gallons', 'fld.kt_bayar': 'Payment', 'fld.kt_nominal': 'Amount', 'fld.kt_batal': 'Cancel it', 'fld.ks_aktif': 'Active', 'fld.ks_batal': 'Cancelled', 'fld.ki_status': 'Status', 'fld.ki_bonOf': 'Bon left · {name}', 'fld.ki_galOf': 'Gallons at {name}', 'fld.ki_out': 'Gallons out', 'fld.ki_back': 'Empties back', 'fld.ki_pay': 'Payment', 'fld.ki_bill': 'Bill', 'fld.ki_bon': 'Bon left', 'fld.kImpact': 'What changes', 'fld.kSendVoid': 'Request cancellation', 'fld.kSendFix': 'Request correction', 'fld.kTxnAt': 'Recorded sale · {d}', 'fld.kTxnGal': '{n} gallons out · {b} back', 'fld.kReasonL': 'Reason · required', 'fld.kWas': 'Recorded: {n}', 'fld.kShouldBe': 'Should be', 'fld.kWasPay': 'recorded',
```

ID:

```
 'fld.kt_pelanggan': 'Pelanggan', 'fld.kt_jumlah': 'Jumlah galon', 'fld.kt_bayar': 'Cara bayar', 'fld.kt_nominal': 'Nominal', 'fld.kt_batal': 'Batalkan', 'fld.ks_aktif': 'Aktif', 'fld.ks_batal': 'Batal', 'fld.ki_status': 'Status transaksi', 'fld.ki_bonOf': 'Sisa bon {name}', 'fld.ki_galOf': 'Galon di {name}', 'fld.ki_out': 'Galon keluar', 'fld.ki_back': 'Galon kembali', 'fld.ki_pay': 'Cara bayar', 'fld.ki_bill': 'Tagihan', 'fld.ki_bon': 'Sisa bon', 'fld.kImpact': 'Dampak koreksi', 'fld.kSendVoid': 'Ajukan pembatalan', 'fld.kSendFix': 'Ajukan koreksi', 'fld.kTxnAt': 'Transaksi tercatat · {d}', 'fld.kTxnGal': '{n} galon keluar · {b} kembali', 'fld.kReasonL': 'Alasan · wajib', 'fld.kWas': 'Tercatat: {n}', 'fld.kShouldBe': 'Seharusnya', 'fld.kWasPay': 'tercatat',
```

- [ ] **Step 7: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-koreksi.test.js tests/field-koreksi-static.test.js tests/field-koreksi-bayar.test.js tests/field-koreksi-saya.test.js tests/field-koreksi-final.test.js`
Expected: PASS (the 3C assertions — `koreksiOptions`, `kPendingT` notice, `previewCorrection`, the disabled rule, `koreksiCheck`, `requestVoid` / `requestCorrection` / `requestReassign`, `needPhoto`, `kStaysValid`, `kVoidNote`, `FldKoreksiCust` with `nearCustomers` + `customerList` — still match).

- [ ] **Step 8: Side-by-side check** — Koreksi for a Bon sale: "Jumlah galon" (3→2) next to `KoreksiGalon.dc.html`, "Cara bayar" (Bon→Lunas) next to `KoreksiBayar.dc.html`, "Pelanggan" next to `KoreksiPelanggan.dc.html`, then "Batalkan".

- [ ] **Step 9: Commit**

```bash
git add dist-field-logic.js dist-field-koreksi.jsx dist-field.css finance-i18n.js server/tests/field-logic.test.js server/tests/field-3d2-koreksi.test.js server/tests/field-koreksi-static.test.js
git commit -m "feat(distribusi): Koreksi to the mockup — transaction card, icon tiles, struck-through → new impact rows, blue reasons, fixed request bar"
```

---

### Task 15: Koreksi saya — mockup KoreksiList board (+ 3C minor: a failed withdraw stays on the list)

**Files:**
- Modify: `dist-field-logic.js` (`requestView` gains `changes`; add `koreksiTabs`)
- Modify: `dist-field-kit.jsx` (add `FldBackHead`)
- Modify: `dist-field-koreksi.jsx` (`FldKoreksiSaya`)
- Modify: `dist-field.css` (append to `3D-2 KOREKSI` — a second section `3D-2 KSAYA`), `finance-i18n.js`
- Test: `server/tests/field-logic.test.js` (append), `server/tests/field-3d2-koreksi.test.js` (append)

**Interfaces:**
- Consumes: `fldValText` (Task 14), `FldSeg size` (Task 1).
- Produces: `FIELDLOGIC.requestView(r).changes: [{ key, a, b, type }]`; `FIELDLOGIC.koreksiTabs(list) → { wait, done }`; `FldBackHead({ onBack, eyebrow, title, aside })` (Task 16 uses it).

- [ ] **Step 1: Write the failing tests.** Append to `server/tests/field-logic.test.js`:

```js
describe('3D-2 Koreksi saya', () => {
  it('requestView gives the board\'s from → to rows; koreksiTabs splits waiting from done', () => {
    expect(L.requestView({ kind: 'correction', status: 'pending', current: { qty: 6, method: 'bon' }, requested: { qty: 5 } }).changes).toEqual([{ key: 'fld.rc_qty', a: 6, b: 5, type: 'n' }]);
    expect(L.requestView({ kind: 'reassign', status: 'approved', customerName: 'A', toCustomerName: 'B' }).changes).toEqual([{ key: 'fld.rc_cust', a: 'A', b: 'B', type: 'text' }]);
    expect(L.requestView({ kind: 'void', status: 'rejected' }).changes).toEqual([{ key: 'fld.rc_status', a: 'aktif', b: 'batal', type: 'status' }]);
    const tabs = L.koreksiTabs([{ id: 1, status: 'pending' }, { id: 2, status: 'approved' }, { id: 3, status: 'withdrawn' }]);
    expect(tabs.wait.map((r) => r.id)).toEqual([1]);
    expect(tabs.done.map((r) => r.id)).toEqual([2, 3]);
    expect(L.koreksiTabs(null)).toEqual({ wait: [], done: [] });
  });
});
```

Append to `server/tests/field-3d2-koreksi.test.js`:

```js
describe('Koreksi saya (mockup KoreksiList board)', () => {
  const f = () => fn(kor, 'FldKoreksiSaya');
  it('a read-only page: round back chevron + big title; two segments (waiting / done)', () => {
    expect(fn(kit, 'FldBackHead')).toMatch(/<button type="button" className="mlap-round" aria-label=\{trFl\('fld\.back'\)\} onClick=\{onBack\}><FldSvg n="back"/);
    expect(f()).toMatch(/<FldBackHead onBack=\{onBack\} title=\{trFl\('fld\.kSaya'\)\} \/>/);
    expect(f()).toMatch(/const tabs = list \? FIELDLOGIC\.koreksiTabs\(list\) : \{ wait: \[\], done: \[\] \};/);
    expect(f()).toMatch(/<FldSeg size="sm" label=\{trFl\('fld\.kSaya'\)\} value=\{seg\} onChange=\{setSeg\}/);
  });
  it('each card: status tag, the from → to box, the office decision box, withdraw / resubmit', () => {
    expect(f()).toMatch(/<div className="mlap-fromto">/);
    expect(f()).toMatch(/<div className=\{'mlap-decision ' \+ v\.tone\}>/);
    expect(rule('KSAYA', '.mlap-fromto')).toMatch(/background: #F4F7F9;/);
    expect(rule('KSAYA', '.mlap-kcard .mlap-tag.info')).toMatch(/background: #FCF1D6; color: #7A4B00;/);   // waiting = amber on this board
  });
  it('3C minor: a failed withdraw is said in place — the list stays', () => {
    expect(f()).toMatch(/\.catch\(\(e\) => \{ setAsk\(null\); setMsg\(fldErrMsg\(e\) \|\| trFl\('fld\.kWithdrawErr'\)\); \}\)/);
    expect(f()).not.toMatch(/setAsk\(null\); setErr\(e\);/);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-koreksi.test.js`
Expected: FAIL — `changes` undefined, `L.koreksiTabs is not a function`, no `FldBackHead`.

- [ ] **Step 3: Logic.** In `requestView` (`dist-field-logic.js`), before its `return {`, add:

```js
    // the board's "from → to" box (3D-2): one row per change, raw values
    var changes = [];
    if (x.kind === 'reassign') changes.push({ key: 'fld.rc_cust', a: x.fromCustomerName || x.customerName || '—', b: x.toCustomerName || '—', type: 'text' });
    else if (x.kind === 'void') changes.push({ key: 'fld.rc_status', a: 'aktif', b: 'batal', type: 'status' });
    lines.forEach(function (l) {
      if (l[0] === 'fld.rl_qty') changes.push({ key: 'fld.rc_qty', a: l[1].a, b: l[1].b, type: 'n' });
      else if (l[0] === 'fld.rl_pay') changes.push({ key: 'fld.rc_pay', a: l[1].a, b: l[1].b, type: 'pay' });
      else if (l[0] === 'fld.rl_amount') changes.push({ key: 'fld.rc_amount', a: l[1].a, b: l[1].b, type: 'rp' });
    });
```

add `changes: changes,` to its returned object (after `lines: lines,`), and after `requestView` add:

```js
  // KOREKSI SAYA (3D-2): the board's two segments.
  function koreksiTabs(list) { var l = list || []; return { wait: l.filter(function (r) { return r.status === 'pending'; }), done: l.filter(function (r) { return r.status !== 'pending'; }) }; }
```

with `koreksiTabs: koreksiTabs, ` in the returned object (before `swipeTab: swipeTab`).

- [ ] **Step 4: Kit.** Add to `dist-field-kit.jsx` after `FldTop`:

```jsx
// A read-only page (mockup Koreksi saya / Armada & SOP): the round back chevron on top, then the big
// title (eyebrow above, an optional badge at its right).
function FldBackHead({ onBack, eyebrow, title, aside }) {
  return (
    <>
      <div className="mlap-top"><button type="button" className="mlap-round" aria-label={trFl('fld.back')} onClick={onBack}><FldSvg n="back" s={18} sw={2.4} /></button><span aria-hidden="true" /><span aria-hidden="true" /></div>
      <div className="mlap-bighd"><span className="mlap-grow">{eyebrow ? <span className="mlap-eyebrow">{eyebrow}</span> : null}<h1>{title}</h1></span>{aside || null}</div>
    </>
  );
}
```

- [ ] **Step 5: Replace `FldKoreksiSaya`** in `dist-field-koreksi.jsx` (its comment included):

```jsx
// KOREKSI SAYA (mockup KoreksiList board) — the driver's own requests in two segments (waiting / done):
// what was asked as "from → to", the status, the office's decision. A waiting one can be withdrawn (after
// a confirm); a rejected or withdrawn one can be sent again. A failed withdraw is said here; the list stays.
function FldKoreksiSaya({ api, tick, onResubmit, onBack, onChanged }) {
  const [list, setList] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [msg, setMsg] = uSfl('');
  const [ask, setAsk] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [reload, setReload] = uSfl(0);
  const [seg, setSeg] = uSfl('wait');
  uEfl(() => {
    let live = true; setErr(null);
    api.myChangeRequests().then((r) => { if (live) setList(r || []); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick, reload]);
  const withdraw = () => {
    setBusy(true); setMsg('');
    api.withdrawRequest(ask.id).then(() => { setAsk(null); setReload((x) => x + 1); onChanged(trFl('fld.kWithdrawn')); })
      .catch((e) => { setAsk(null); setMsg(fldErrMsg(e) || trFl('fld.kWithdrawErr')); }).finally(() => setBusy(false));
  };
  const tabs = list ? FIELDLOGIC.koreksiTabs(list) : { wait: [], done: [] };
  const shown = seg === 'wait' ? tabs.wait : tabs.done;
  const by = (r) => (r.decidedBy && r.decidedBy.name ? r.decidedBy.name : trFl('fld.kOffice'));
  return (
    <div className="mlap-screen">
      <FldBackHead onBack={onBack} title={trFl('fld.kSaya')} />
      <div className="mlap-body">
        {err ? <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /> : null}
        {msg ? <div className="mlap-err" role="alert">{msg}</div> : null}
        {!list && !err ? <div className="mlap-empty">{trFl('fld.loading')}</div> : null}
        {list ? <FldSeg size="sm" label={trFl('fld.kSaya')} value={seg} onChange={setSeg} options={[['wait', trFl('fld.kTabWait', { n: tabs.wait.length })], ['done', trFl('fld.kTabDone', { n: tabs.done.length })]]} /> : null}
        {list && !shown.length ? <div className="mlap-empty">{trFl('fld.kSayaEmpty')}</div> : null}
        {shown.map((r) => {
          const v = FIELDLOGIC.requestView(r);
          return (
            <div key={r.id} className="mlap-card mlap-kcard">
              <div className="mlap-kcard-hd">
                <span className="mlap-grow"><span className="nm">{r.customerName || r.fromCustomerName || '—'}</span><span className="sb">{[trFl(v.kindKey), r.txnRef, r.txnDate].filter(Boolean).join(' · ')}</span></span>
                <span className={'mlap-tag ' + v.tone}>{trFl(v.statusKey)}</span>
              </div>
              {v.changes.length ? (
                <div className="mlap-fromto">
                  {v.changes.map((ch) => (
                    <React.Fragment key={ch.key}>
                      <span className="k">{trFl(ch.key)}</span>
                      <span className="v"><s>{fldValText(ch.type, ch.a)}</s><FldSvg n="arrowRight" s={12} sw={2.4} /><b>{fldValText(ch.type, ch.b)}</b></span>
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
              {r.reason ? <span className="mlap-kreason">{r.reason}</span> : null}
              {r.decisionNote ? (
                <div className={'mlap-decision ' + v.tone}><b>{trFl(r.status === 'rejected' ? 'fld.kRejectedBy' : r.status === 'approved' ? 'fld.kApprovedBy' : 'fld.kWithdrawnBy', { name: by(r) })}</b><span>{r.decisionNote}</span></div>
              ) : null}
              {v.canWithdraw ? <button type="button" className="mlap-btn soft" disabled={busy} onClick={() => setAsk(r)}>{trFl('fld.kWithdrawFull')}</button> : null}
              {v.canResubmit && v.target.transactionId ? <button type="button" className="mlap-btn primary" onClick={() => onResubmit(v.target)}>{trFl('fld.kResubmit')}</button> : null}
            </div>
          );
        })}
      </div>
      {ask && <FldSheet title={trFl('fld.kWithdrawT')} body={trFl('fld.kWithdrawB')} confirmLabel={trFl('fld.kWithdraw')} danger onClose={() => setAsk(null)} onConfirm={withdraw} />}
    </div>
  );
}
```

- [ ] **Step 6: Append the CSS:**

```css
/* ── 3D-2 KSAYA — mockup KoreksiList board + the read-only page head ── */
.mlap-bighd { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; padding: 0 16px 4px; }
.mlap-root > .mlap-screen > .mlap-bighd { max-width: 528px; }
.mlap-bighd .mlap-eyebrow { padding: 0; }
.mlap-bighd h1 { margin: 0; font-size: 28px; line-height: 34px; font-weight: 700; letter-spacing: -.02em; }
.mlap-kcard { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.mlap-kcard-hd { display: flex; align-items: center; gap: 8px; }
.mlap-kcard-hd .nm { font-size: 15px; font-weight: 700; }
.mlap-kcard-hd .sb { font-size: 12px; color: var(--mlap-sub); }
.mlap-kcard .mlap-tag.info { background: #FCF1D6; color: #7A4B00; }
.mlap-kcard .mlap-tag.neg { background: #FDECEA; color: #8C2A20; }
.mlap-fromto { border-radius: 10px; background: #F4F7F9; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
.mlap-fromto .k { font-size: 12px; font-weight: 600; color: var(--mlap-sub); }
.mlap-fromto .v { display: flex; align-items: center; gap: 6px; font-size: 14px; flex-wrap: wrap; }
.mlap-fromto s { color: var(--mlap-sub); }
.mlap-fromto svg { color: #8A9AA3; }
.mlap-fromto b { font-weight: 700; }
.mlap-decision { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; border-radius: 10px; background: #E3F3EA; color: #1E6B40; }
.mlap-decision.neg { background: #FDECEA; color: #8C2A20; }
.mlap-decision.held { background: #F4F7F9; color: #3E4E58; }
.mlap-decision b { font-size: 12px; font-weight: 700; }
.mlap-decision span { font-size: 13px; line-height: 17px; }
.mlap-kreason { font-size: 13px; color: #3E4E58; }
.mlap-btn.soft { border-radius: 11px; background: #F1F4F7; color: #3E4E58; font-size: 14px; }
.mlap-kcard .mlap-btn.primary { border-radius: 11px; font-size: 14px; box-shadow: none; }
```

- [ ] **Step 7: Add the i18n keys.** EN: ` 'fld.rc_cust': 'Move to another customer', 'fld.rc_status': 'Status', 'fld.rc_qty': 'Gallons out', 'fld.rc_pay': 'Payment', 'fld.rc_amount': 'Amount', 'fld.kTabWait': 'Waiting · {n}', 'fld.kTabDone': 'Done · {n}', 'fld.kApprovedBy': 'Approved by {name}', 'fld.kRejectedBy': 'Rejected by {name}', 'fld.kWithdrawnBy': 'Withdrawn by {name}', 'fld.kOffice': 'the office', 'fld.kWithdrawFull': 'Withdraw request', 'fld.kWithdrawErr': 'Could not withdraw — try again.',` — ID: ` 'fld.rc_cust': 'Pindah pelanggan', 'fld.rc_status': 'Status transaksi', 'fld.rc_qty': 'Jumlah galon keluar', 'fld.rc_pay': 'Cara bayar', 'fld.rc_amount': 'Nominal', 'fld.kTabWait': 'Menunggu · {n}', 'fld.kTabDone': 'Selesai · {n}', 'fld.kApprovedBy': 'Disetujui oleh {name}', 'fld.kRejectedBy': 'Ditolak oleh {name}', 'fld.kWithdrawnBy': 'Ditarik oleh {name}', 'fld.kOffice': 'kantor', 'fld.kWithdrawFull': 'Tarik pengajuan', 'fld.kWithdrawErr': 'Gagal menarik pengajuan — coba lagi.',`

- [ ] **Step 8: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-logic.test.js tests/field-3d2-koreksi.test.js tests/field-koreksi-static.test.js tests/field-kit-static.test.js`
Expected: PASS (the 3C "Koreksi saya" assertions — `myChangeRequests`, `requestView`, `r.decisionNote ?`, `v.canWithdraw ?`, `withdrawRequest(ask.id)`, `v.canResubmit && v.target.transactionId ?`, `onResubmit(v.target)` — still match; existing `requestView` tests keep passing because `lines` is unchanged).

- [ ] **Step 9: Side-by-side check** — Koreksi saya with one waiting, one approved, one rejected request next to `KoreksiList.dc.html` (both segments).

- [ ] **Step 10: Commit**

```bash
git add dist-field-logic.js dist-field-kit.jsx dist-field-koreksi.jsx dist-field.css finance-i18n.js server/tests/field-logic.test.js server/tests/field-3d2-koreksi.test.js
git commit -m "feat(distribusi): Koreksi saya to the mockup — back chevron + big title, two segments, from→to box, office decision box; a failed withdraw stays on the list"
```

---

### Task 16: Armada & SOP — mockup Armada board

**Files:**
- Modify: `dist-field.jsx` (`FldRules` return + `onBack`), `finance-shell.jsx` (mount passes `onBack`)
- Modify: `dist-field.css` (append `3D-2 ARMADA`), `finance-i18n.js`
- Test: `server/tests/field-3d2-koreksi.test.js` (append)

**Interfaces:**
- Consumes: `FldBackHead` (Task 15), `FldCtaBar`, `.mlap-ctaspace`, `.mlap-label` (Task 1).
- Produces: `FldRules({ fleetList, canRelease, onSaved, onBack })`.

- [ ] **Step 1: Write the failing test.** Append to `server/tests/field-3d2-koreksi.test.js`:

```js
describe('Armada & SOP (mockup Armada board)', () => {
  const f = () => fn(shellSrc, 'FldRules');
  it('back chevron + big title + Owner/GM badge; the SOP stepper; each armada with ± (teal +), its bar and the SOP marker', () => {
    expect(f()).toMatch(/<FldBackHead onBack=\{onBack\} title=\{trFl\('fld\.armadaT'\)\} aside=\{<span className="mlap-ownbadge"><FldSvg n="lock"/);
    expect(f()).toMatch(/<div className="mlap-capbar"><span className=\{low \? 'low' : ''\} style=\{\{ width: pct\(c\) \+ '%' \}\} \/><i style=\{\{ left: pct\(r\.ritSop\.minLoad\) \+ '%' \}\} \/><\/div>/);
    expect(f()).toMatch(/className="mlap-step plus teal"/);
    expect(rule('ARMADA', '.mlap-capbar > span.low')).toMatch(/background: #E8793A;/);
    expect(rule('ARMADA', '.mlap-ownbadge')).toMatch(/background: #0E1B24; color: #FFFFFF;/);
  });
  it('save is the fixed bottom bar; the release card stays as it was', () => {
    expect(f()).toMatch(/<FldCtaBar><button type="button" className="mlap-btn primary" disabled=\{busy\} onClick=\{\(\) => save\(\)\}>\{trFl\('fld\.saveRules'\)\}<\/button><\/FldCtaBar>/);
    expect(f()).toMatch(/className="mlap-btn danger" disabled=\{busy \|\| !FLD_SCREENS_READY\}/);
  });
  it('the finance shell gives it a way back', () => {
    expect(read('finance-shell.jsx')).toMatch(/<window\.FIELD\.RulesScreen fleetList=\{fleet\} canRelease=\{!!user && user\.role === 'owner'\} onSaved=\{\(r\) => setFieldRules\(r\)\} onBack=\{\(\) => go\('dist-dashboard'\)\} \/>/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-koreksi.test.js`
Expected: FAIL in "Armada & SOP".

- [ ] **Step 3: Rewrite the `FldRules` screen** (`dist-field.jsx`): change the signature to `function FldRules({ fleetList, canRelease, onSaved, onBack }) {`; keep the loading branch, `set`, `setSop`, `cap`, `setCap`, `save`, `toggle` exactly; replace its final `return (...)` with:

```jsx
  const scale = Math.max(160, r.ritSop.minLoad, ...plates.map((p) => cap(p)));
  const pct = (v) => Math.max(0, Math.min(100, (v / scale) * 100));
  return (
    <div className="mlap-root">
      <div className="mlap-screen">
        <FldBackHead onBack={onBack} title={trFl('fld.armadaT')} aside={<span className="mlap-ownbadge"><FldSvg n="lock" s={12} sw={2.4} />{trFl('fld.ownerGm')}</span>} />
        <div className="mlap-body">
          <div className="mlap-note">{trFl('fld.rulesAsliNote')}</div>
          <div className="mlap-card mlap-soprow">
            <span className="lb"><b>{trFl('fld.sopMinT')}</b><span>{trFl('fld.sopMinB')}</span></span>
            <button type="button" className="mlap-step minus" aria-label={trFl('fld.less') + ' — ' + trFl('fld.sopMinT')} onClick={() => setSop({ minLoad: Math.max(1, r.ritSop.minLoad - 5) })}><FldSvg n="minus" s={16} sw={2.6} /></button>
            <span className="val">{r.ritSop.minLoad}</span>
            <button type="button" className="mlap-step plus" aria-label={trFl('fld.more') + ' — ' + trFl('fld.sopMinT')} onClick={() => setSop({ minLoad: r.ritSop.minLoad + 5 })}><FldSvg n="plus" s={16} sw={2.6} /></button>
          </div>
          <div className="mlap-label">{trFl('fld.capTitle')}</div>
          <div className="mlap-card">
            {plates.map((p) => {
              const c = cap(p); const low = c > 0 && c < r.ritSop.minLoad;
              return (
                <div key={p} className="mlap-caprow">
                  <div className="mlap-caprow-top">
                    <span className="lb"><b>{p}</b><span>{c ? c + ' ' + trFl('fld.galon') : trFl('fld.capNone')}</span></span>
                    <button type="button" className="mlap-step minus" aria-label={trFl('fld.less') + ' ' + p} onClick={() => setCap(p, c - 5)}><FldSvg n="minus" s={16} sw={2.6} /></button>
                    <span className={'val' + (low ? ' low' : '')}>{c || '—'}</span>
                    <button type="button" className="mlap-step plus teal" aria-label={trFl('fld.more') + ' ' + p} onClick={() => setCap(p, (c || r.ritSop.minLoad) + 5)}><FldSvg n="plus" s={16} sw={2.6} /></button>
                  </div>
                  <div className="mlap-capbar"><span className={low ? 'low' : ''} style={{ width: pct(c) + '%' }} /><i style={{ left: pct(r.ritSop.minLoad) + '%' }} /></div>
                  {low ? <div className="mlap-warnline">{trFl('fld.capBelowSop')}</div> : null}
                </div>
              );
            })}
            {!plates.length && <div className="mlap-empty">{trFl('fld.noFleet')}</div>}
          </div>
          <div className="mlap-foot">{trFl('fld.capFoot')}</div>
          <div className="mlap-card">
            <label className="mlap-field"><span className="lb">{trFl('fld.sopEnabled')}</span><input type="checkbox" checked={!!r.ritSop.enabled} onChange={(e) => setSop({ enabled: e.target.checked })} /></label>
            {toggle('wajibFotoTransaksi', trFl('fld.fotoTxn'))}
            {toggle('wajibFotoPengeluaran', trFl('fld.fotoExp'))}
            {toggle('wajibAlasanBatal', trFl('fld.alasanBatal'))}
            <label className="mlap-field"><span className="lb">{trFl('fld.hargaGR')}</span>
              <input className="mlap-input" inputMode="numeric" value={r.hargaGantiRugiGalon || ''} onChange={(e) => set({ hargaGantiRugiGalon: +String(e.target.value).replace(/[^0-9]/g, '') || 0 })} /></label>
          </div>
          {err && <div className="mlap-err" role="alert">{err}</div>}
          {canRelease && (
            <div className="mlap-card mlap-release">
              <b>{trFl('fld.releaseTitle')}</b>
              <small>{r.fieldUiDefault === 'new' ? trFl('fld.released') : trFl('fld.releaseSub')}</small>
              {r.fieldUiDefault === 'new'
                ? <button type="button" className="mlap-btn" disabled={busy} onClick={() => setAsk('old')}>{trFl('fld.unreleaseBtn')}</button>
                : <button type="button" className="mlap-btn danger" disabled={busy || !FLD_SCREENS_READY} onClick={() => setAsk('new')}>{trFl('fld.releaseBtn')}</button>}
              {r.fieldUiDefault !== 'new' && !FLD_SCREENS_READY && <small>{trFl('fld.releaseLater')}</small>}
            </div>
          )}
          <div className="mlap-ctaspace" />
        </div>
      </div>
      <FldCtaBar><button type="button" className="mlap-btn primary" disabled={busy} onClick={() => save()}>{trFl('fld.saveRules')}</button></FldCtaBar>
      {ask && <FldSheet title={ask === 'new' ? trFl('fld.releaseT') : trFl('fld.unreleaseT')} body={ask === 'new' ? trFl('fld.releaseB') : trFl('fld.unreleaseB')} danger={ask === 'new'} onClose={() => setAsk(null)} onConfirm={() => { const v = ask; setAsk(null); save({ fieldUiDefault: v }); }} />}
      {done && <div className="mlap-toast" role="status">{done}</div>}
    </div>
  );
```

In `finance-shell.jsx` change the RulesScreen mount to:

```jsx
          {screen === 'dist-field-rules' && p.distribusiAturanLapangan && window.FIELD && <window.FIELD.RulesScreen fleetList={fleet} canRelease={!!user && user.role === 'owner'} onSaved={(r) => setFieldRules(r)} onBack={() => go('dist-dashboard')} />}
```

(A field account leaving the rules screen lands back in the field view: `fieldFull` is true again as soon as `screen` is no longer `dist-field-rules`.)

- [ ] **Step 4: Append the CSS:**

```css
/* ── 3D-2 ARMADA — mockup Armada board ── */
.mlap-ownbadge { height: 24px; padding: 0 8px; border-radius: 12px; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; background: #0E1B24; color: #FFFFFF; flex-shrink: 0; }
.mlap-soprow { min-height: 72px; padding: 4px 12px; display: flex; align-items: center; gap: 6px; }
.mlap-soprow .lb { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mlap-soprow .lb b { font-size: 15px; font-weight: 700; }
.mlap-soprow .lb span { font-size: 12px; line-height: 16px; color: var(--mlap-sub); }
.mlap-soprow .val { width: 40px; text-align: center; font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mlap-caprow { padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--mlap-line); }
.mlap-caprow:last-child { border-bottom: 0; }
.mlap-caprow-top { display: flex; align-items: center; gap: 6px; }
.mlap-caprow-top .lb { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mlap-caprow-top .lb b { font-size: 15px; font-weight: 700; }
.mlap-caprow-top .lb span { font-size: 12px; color: var(--mlap-sub); }
.mlap-caprow .val { width: 44px; text-align: center; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; transition: color .25s ease; }
.mlap-caprow .val.low { color: #9A3412; }
.mlap-capbar { position: relative; height: 6px; border-radius: 3px; background: #E1E8ED; }
.mlap-capbar > span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: #1A8C87; transition: width .45s cubic-bezier(.34,1.56,.64,1), background .25s ease; }
.mlap-capbar > span.low { background: #E8793A; }
.mlap-capbar > i { position: absolute; top: -3px; width: 2px; height: 12px; margin-left: -1px; border-radius: 1px; background: #0E1B24; transition: left .45s cubic-bezier(.34,1.56,.64,1); }
.mlap-step.plus.teal { background: #DDF4F2; color: #0F6B66; }
.mlap-foot { font-size: 12px; line-height: 16px; color: var(--mlap-sub); padding: 0 4px; }
```

- [ ] **Step 5: Add the i18n keys.** EN: ` 'fld.armadaT': 'Fleet & SOP', 'fld.ownerGm': 'Owner / GM', 'fld.sopMinT': 'Minimum load per trip', 'fld.sopMinB': 'For every armada. Below it the driver must give a reason.', 'fld.capFoot': 'A driver cannot load more than the armada capacity when opening a trip. Every change is logged.', 'fld.saveRules': 'Save settings',` — ID: ` 'fld.armadaT': 'Armada & SOP', 'fld.ownerGm': 'Owner / GM', 'fld.sopMinT': 'Muatan minimal per rit', 'fld.sopMinB': 'Berlaku untuk semua armada. Di bawah ini sopir wajib isi alasan.', 'fld.capFoot': 'Sopir tidak bisa memuat melebihi kapasitas armada saat Buka rit. Setiap perubahan dicatat di log audit.', 'fld.saveRules': 'Simpan pengaturan',`

- [ ] **Step 6: Run the tests**

Run: `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand tests/field-3d2-koreksi.test.js tests/field-shell-static.test.js tests/field-rules.test.js tests/field-shell-integration.test.js`
Expected: PASS (release buttons, "releasing changes only the release switch", "saved through the untagged owner API, never the adaptor" still match).

- [ ] **Step 7: Side-by-side check** — Armada & SOP with three armada (one below SOP) next to `Armada.dc.html`; tap back → returns to the field view.

- [ ] **Step 8: Commit**

```bash
git add dist-field.jsx finance-shell.jsx dist-field.css finance-i18n.js server/tests/field-3d2-koreksi.test.js
git commit -m "feat(distribusi): Armada & SOP to the mockup — back + big title + Owner/GM badge, SOP stepper, capacity bars with the SOP marker, fixed save bar"
```

---

### Task 17: Whole-view check, spec note, full suite

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md` (§4 — add "Sesuai yang dibangun (3D-2)")

- [ ] **Step 1: Board sweep** — build once, then render every one of the 20 boards next to the new screen at 390 × 844 (Main, Stop, Transaksi, BukaRit, TambahStop, RuteRit, Selesai, Pelanggan, Lengkapi, AturTitik, BayarBon, Penyesuaian, GantiRugi, Pengeluaran, KoreksiGalon, KoreksiBayar, KoreksiPelanggan, KoreksiList, Armada, Dock). Also at 320 px wide (iPhone SE) for Pengiriman, Detail stop, Setoran, Pelanggan: no horizontal scroll, nothing hidden under a fixed bar. Any difference left is fixed now or written in the ledger as `Ruling:` (with one of the planning decisions or a new reason).

- [ ] **Step 2: Reduced settings** — with Chrome DevTools rendering emulation `prefers-reduced-transparency: reduce` and `prefers-reduced-motion: reduce`, render Pengiriman with the Catat menu open, Peta, Atur titik and Pelanggan: every glass surface solid, no bar/gauge animation.

- [ ] **Step 3: Spec note** — in §4 of the spec, after "Sesuai yang dibangun (3D-1)", add:

```markdown
#### Sesuai yang dibangun (3D-2)

Every field screen now follows its mockup board: Pengiriman (compact rit card + bar, tappable warnings, next-stop card, numbered coloured list), Detail stop (tall sheet), Transaksi, Buka/Tutup rit (sheet over Pengiriman with presets, SOP gauge and route-fit bar), Peta (full-bleed map, glass bar, 470/700 sheet), Setoran (KPI tiles, reason picker sheet, fixed close bar above the dock), Pelanggan (floating glass search, sideways chips), Lengkapi (mini-map), Atur titik (full-bleed map + glass sheet), Tambah stop (sheet), Bayar bon / Penyesuaian / Ganti rugi / Pengeluaran, Koreksi (tiles + impact rows), Koreksi saya (two segments), Armada & SOP. Deliberate differences: no Satelit toggle (needs a second tile service — owner to decide); Setoran and Peta keep the dock; the ganti-rugi price stays the owner's setting; reasons are picked in a sheet; board sample data the app does not have is not invented; touch targets stay ≥ 44 px. 3D-1 minors M5–M13 closed (old-view choice ends with the session, no finance flash before the rules load, scroll reset, keyboard pan counts, edge swipes left to the phone, tile press, top bar, quiet latihan chip, solid fallbacks).
```

- [ ] **Step 4: Full suite + build**

Run (from `server/`, output to a file): `npx cross-env NODE_ENV=test DATABASE_URL=file:./test.db npx jest --runInBand > ../.superpowers/sdd/2026-10-02-mode-lapangan-3d2-layar/full.txt 2>&1; tail -5 ../.superpowers/sdd/2026-10-02-mode-lapangan-3d2-layar/full.txt`
Expected: all suites pass (≥ 164 files). Between 00:00 and 08:00 WITA the nine date-fragile files fail — rerun those with `APP_TZ=UTC` and record both runs.

Run (repo root): `node build.mjs`
Expected: prints the new `dist/app.<hash>.js`, no error.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-01-mode-lapangan-demo-design.md
git commit -m "docs: mode lapangan spec — 3D-2 screens as built"
```

---

## Not in this plan (kept for later)

- The remaining 3C minors that are not on these screens' layout: idempotency on change-request create; the transfer proof in the request shape; the clash path tested only with a hand-built error; "Galon diantar" when qty ≠ gallonOut; the pending notice offering Koreksi saya for someone else's request.
- Satellite imagery for Atur titik (Decision 1).
- A photo preview of the recorded transaction in Koreksi (the board shows the delivery photo; the adaptor has no photo fetch yet — the card shows a receipt icon tile).
