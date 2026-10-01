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
  it('the centre pin is the board\'s blue pin', () => {
    expect(rule('LENGKAPI', '.mlap-centerpin-dot')).toMatch(/background: #065489;/);
  });
  it('M7: moving the map with the keyboard counts as moved too', () => {
    expect(f()).toMatch(/map\.on\('keydown', \(\) => \{ userRef\.current = true; \}\);/);
  });
});
