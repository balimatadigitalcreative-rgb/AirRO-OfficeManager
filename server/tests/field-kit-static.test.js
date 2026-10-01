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

describe('Plan 3D materials (values copied from the mockup)', () => {
  const glass = css.slice(css.indexOf('/* ── LIQUID GLASS (3D)'));   // the 3D block (the reduced-transparency fallback comes later)
  const rule = (sel) => { const i = glass.indexOf('\n' + sel + ' {'); expect(i).toBeGreaterThan(-1); return glass.slice(i, glass.indexOf('}', i)); };
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
