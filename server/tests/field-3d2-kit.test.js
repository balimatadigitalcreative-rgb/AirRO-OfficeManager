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
    expect(css).toMatch(/\.mlap-root \{[^}]*padding: 0 0 calc\(130px \+ env\(safe-area-inset-bottom\)\);/);
    expect(rule('.mlap-ctaspace')).toMatch(/height: 72px;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.mlap-root \*/);
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
