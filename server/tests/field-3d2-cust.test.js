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
