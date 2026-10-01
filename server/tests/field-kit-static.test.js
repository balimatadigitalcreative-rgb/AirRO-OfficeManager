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
