'use strict';
// FIELD DAY SCREENS (static checks — the server test run has no browser): parse, ship in order, use
// only the adaptor they are given, and keep the owner's rules (reasons always asked).
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const day = read('dist-field-day.jsx'); const build = read('build.mjs');
const fn = (name) => { const i = day.indexOf('function ' + name + '('); expect(i).toBeGreaterThan(-1); const j = day.indexOf('\nfunction ', i + 10); return day.slice(i, j < 0 ? undefined : j); };

it('every fld.* key written literally in the kit and day screens exists in EN and ID (also keys held in arrays)', () => {
  const src = read('dist-field-kit.jsx') + '\n' + day; const i18n = read('finance-i18n.js');
  const keys = [...new Set([...src.matchAll(/["'](fld\.[A-Za-z0-9_]+)["']/g)].map((m) => m[1]))];
  expect(keys.length).toBeGreaterThan(20);
  keys.forEach((k) => expect({ k, n: (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length }).toEqual({ k, n: 2 }));
});
it('parses, ships after the kit and before the shell, never calls the server directly', () => {
  expect(() => parse(day, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build).toMatch(/'dist-field-kit\.jsx',\s*'dist-field-day\.jsx',\s*'dist-field\.jsx',/);
  expect(day).not.toMatch(/window\.API|fetch\(/);
});

describe('Pengiriman', () => {
  it('loads board, customers, runs, outstanding, and the route only for today\'s open rit', () => {
    const f = fn('fldLoadDay');
    expect(f).toMatch(/Promise\.all\(\[api\.board\(\), api\.customers\(\), api\.runs\(\), api\.outstanding\(\)\]\)/);
    expect(f).toMatch(/rs\.open && !rs\.stale \? api\.ritRoute\(\)\.catch\(\(\) => null\)/);
  });
  it('shows the next stop, the three filters, incomplete-data and outside-route warnings, and a stale rit', () => {
    const f = fn('FldBoardScreen');
    ['fld.segPending', 'fld.segDone', 'fld.segHeld', 'fld.incompleteT', 'fld.outsideT', 'fld.staleRunT', 'fld.openRunN'].forEach((k) => expect(f).toContain("'" + k + "'"));
    expect(f).toMatch(/<FldNextCard /);
  });
});
describe('Detail stop', () => {
  it('hold and cancel always need a written reason (whatever the owner\'s switch)', () => {
    const f = fn('FldStopSheet');
    expect(f).toMatch(/disabled=\{busy \|\| !reason\.trim\(\)\}/);
    expect(f).toMatch(/api\.holdStop\(s\.id, reason\)/);
    expect(f).toMatch(/api\.cancelStop\(s\.id, reason\)/);
    expect(f).toMatch(/fldLinks\(s\)/);
  });
});
