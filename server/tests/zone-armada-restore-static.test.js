'use strict';
// "Kembalikan armada" on Peta Zona (static — the server test run has no browser): a manager-only
// button opens a list (every row ticked), only the ticked ids are sent, and every key exists in EN + ID.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const zn = read('dist-zones.jsx'); const api = read('api.js'); const i18n = read('finance-i18n.js');
const fn = (name) => { const i = zn.indexOf('function ' + name + '('); expect(i).toBeGreaterThan(-1); const j = zn.indexOf('\nfunction ', i + 10); return zn.slice(i, j < 0 ? undefined : j); };

it('the API has the preview and the apply call', () => {
  expect(api).toMatch(/armadaRestore: \(\) => req\('GET', '\/distribusi\/zones\/armada-restore'\)/);
  expect(api).toMatch(/armadaRestoreApply: \(ids\) => req\('POST', '\/distribusi\/zones\/armada-restore', \{ ids \}\)/);
});
it('the list starts all ticked and sends only the ticked customers', () => {
  expect(() => parse(zn, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  const f = fn('ZnArmadaRestore');
  expect(f).toMatch(/const picked = rows\.filter\(\(r\) => !off\[r\.id\]\);/);
  expect(f).toMatch(/armadaRestoreApply\(picked\.map\(\(r\) => r\.id\)\)/);
  expect(f).toMatch(/disabled=\{busy \|\| !picked\.length\}/);
});
it('the button sits with the manager-only actions', () => {
  const head = zn.slice(zn.indexOf('{canManage && !drawing && !depotMode && ('), zn.indexOf("{trD('zn.auto')}</button>"));
  expect(head).toMatch(/onClick=\{\(\) => setArOpen\(true\)\}/);
  expect(zn).toMatch(/\{arOpen && <ZnArmadaRestore /);
});
it('every zn.ar* key exists in EN and ID', () => {
  const keys = [...new Set([...zn.matchAll(/'(zn\.ar[A-Za-z]+)'/g)].map((m) => m[1]))];
  expect(keys.length).toBeGreaterThan(10);
  keys.forEach((k) => expect({ k, n: (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length }).toEqual({ k, n: 2 }));
});
