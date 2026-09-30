'use strict';
// Mode Lapangan UI shell (static checks — the server test run has no browser): files parse, are in the
// bundle, the MODE LATIHAN ribbon is unconditional in latihan, switching mode goes through a confirm,
// the rules screen writes through the UNTAGGED rules API, and every fld.* key exists in both languages.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const jsx = read('dist-field.jsx'); const css = read('dist-field.css'); const i18n = read('finance-i18n.js'); const build = read('build.mjs'); const html = read('index.html');

it('parses and ships', () => {
  expect(() => parse(jsx, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build).toMatch(/'dist-zones\.jsx',\s*'dist-field\.jsx',/);
  expect(build).toMatch(/CSS_FILES = \[[^\]]*'dist-field\.css'/);
  expect(html).toMatch(/dist-field\.css\?v=/);
  expect(jsx).toMatch(/window\.FIELD = \{ App: FldApp, RulesScreen: FldRules \}/);
});
it('its top-level names do not collide with any other bundled file (one shared scope)', () => {
  const names = [...jsx.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const destructured = [...jsx.matchAll(/^const \{([^}]*)\} = React;/gm)].flatMap((m) => m[1].split(',').map((x) => x.split(':').pop().trim()));
  const mine = [...names, ...destructured].filter(Boolean);
  const files = [...build.matchAll(/'([\w.-]+\.jsx?)'/g)].map((m) => m[1]).filter((f) => f !== 'dist-field.jsx' && fs.existsSync(path.join(root, f)));
  files.forEach((f) => {
    const src = read(f);
    mine.forEach((n) => expect({ file: f, name: n, clash: new RegExp('^(?:const|let|var|function)\\s+' + n.replace('$', '\\$') + '\\b|^const \\{[^}]*:\\s*' + n + '\\s*[,}]', 'm').test(src) }).toEqual({ file: f, name: n, clash: false }));
  });
});
it('latihan ribbon + confirmed mode switch + reset', () => {
  expect(jsx).toMatch(/\{mode === 'latihan' && <div className="mlap-ribbon"[^>]*>\{trFl\('fld\.bannerLatihan'\)\}/);
  expect(jsx).toMatch(/askSwitch\(/);
  expect(jsx).toMatch(/trFl\('fld\.switchToAsliB'\)/);
  expect(jsx).toMatch(/trFl\('fld\.resetLatihanB'\)/);
  expect(jsx).toMatch(/openLatihan\(\{ key, real, storage: storageRef\.current, today \}\)/);   // yesterday's practice copy is never reused
});
it('rules are saved through the untagged owner API, never the adaptor', () => {
  const rules = jsx.slice(jsx.indexOf('function FldRules('));
  expect(rules).toMatch(/window\.API\.distribusi\.fieldRules\.set\(/);
  expect(rules).not.toMatch(/\bapi\.\w+\(/);
});
it('glass only on the functional layer + reduced transparency / motion honoured', () => {
  expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  expect(css).toMatch(/\.mlap-dock[^{]*\{[^}]*backdrop-filter/);
  expect(css).not.toMatch(/\.mlap-card[^{]*\{[^}]*backdrop-filter/);
  expect(css).not.toMatch(/(^|[\s,}])\.fld[-\s{]/m);   // the old form classes (.fld, .fld-label) are never restyled
});
it('every fld.* key used exists in EN and ID', () => {
  const used = [...new Set([...jsx.matchAll(/trFl\('(fld\.[A-Za-z0-9_]+)'\s*[),]/g)].map((m) => m[1]))];   // literal keys; dynamic ones listed below
  const dynamic = ['fld.st_pending', 'fld.st_terkirim', 'fld.st_ditunda', 'fld.st_batal', 'fld.catatSale', 'fld.catatBon', 'fld.catatExp', 'fld.catatStop', 'fld.catatAdj', 'fld.catatDmg', 'fld.tabKirim', 'fld.tabPeta', 'fld.tabPelanggan', 'fld.tabSetoran'];
  expect(used.length).toBeGreaterThan(20);
  [...used, ...dynamic].forEach((k) => expect({ k, n: (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length }).toEqual({ k, n: 2 }));
});
