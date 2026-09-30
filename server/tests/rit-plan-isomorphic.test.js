'use strict';
// RUTE RIT is ONE module for the server and the phone (Mode latihan plans rits offline): the root UMD file
// is the source; the server lib re-exports it; the bundle loads it before the field modules.
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..', '..');

it('the server lib is the root module (same functions)', () => {
  const lib = require('../src/lib/rit-plan');
  const iso = require(path.join(root, 'rit-plan.js'));
  expect(lib.planRit).toBe(iso.planRit);
  expect(lib.haversineKm).toBe(iso.haversineKm);
});
it('in a browser it registers window.RITPLAN', () => {
  const src = fs.readFileSync(path.join(root, 'rit-plan.js'), 'utf8');
  const win = {};
  new Function('globalThis', 'window', 'module', src)(win, win, undefined);
  expect(typeof win.RITPLAN.planRit).toBe('function');
});
it('the bundle loads it before the field modules', () => {
  const b = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8');
  expect(b.indexOf("'rit-plan.js'")).toBeGreaterThan(-1);
  expect(b.indexOf("'rit-plan.js'")).toBeLessThan(b.indexOf("'api.js'"));
});
