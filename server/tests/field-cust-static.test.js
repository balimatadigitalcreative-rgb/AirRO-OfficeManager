'use strict';
// FIELD CUSTOMER SCREENS (static): parse, ship after the day screens, use only the adaptor, keep the
// owner's rules, and every fld.* key literal exists in EN + ID.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const cust = read('dist-field-cust.jsx'); const build = read('build.mjs');
const fn = (name) => { const i = cust.indexOf('function ' + name + '('); expect(i).toBeGreaterThan(-1); const j = cust.indexOf('\nfunction ', i + 10); return cust.slice(i, j < 0 ? undefined : j); };

it('parses, ships after the day screens, never calls the server directly', () => {
  expect(() => parse(cust, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build).toMatch(/'dist-field-day\.jsx',\s*'dist-field-cust\.jsx',\s*'dist-field\.jsx',/);
  expect(cust).not.toMatch(/window\.API|fetch\(/);
});
it('every fld.* key written literally exists in EN and ID', () => {
  const i18n = read('finance-i18n.js');
  const keys = [...new Set([...cust.matchAll(/["'](fld\.[A-Za-z0-9_]+)["']/g)].map((m) => m[1]))];
  expect(keys.length).toBeGreaterThan(5);
  keys.forEach((k) => expect({ k, n: (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length }).toEqual({ k, n: 2 }));
});
describe('Pelanggan', () => {
  it('search + the four filters from the shared list logic', () => {
    const f = fn('FldCustomers');
    expect(f).toMatch(/FIELDLOGIC\.customerList\(list, \{ q, filter \}\)/);
    ['fld.f_all', 'fld.f_warn', 'fld.f_bon', 'fld.f_fixed'].forEach((k) => expect(f).toContain("'" + k + "'"));
  });
  it('the sheet only offers actions the account may use and that make sense', () => {
    const f = fn('FldCustSheet');
    expect(f).toMatch(/can\.bon && c\.sisaBon > 0/);
    expect(f).toMatch(/can\.damage && c\.gallonsHeld > 0/);
    expect(f).toMatch(/can\.location && c\.gaps\.count > 0/);
    expect(f).toMatch(/can\.addStop/);
  });
});

describe('Lengkapi + Atur titik', () => {
  it('Lengkapi saves only what changed: GPS pin (method gps), WhatsApp, location photo', () => {
    const f = fn('FldComplete');
    expect(f).toMatch(/api\.setLocation\(c\.id, \{ lat: gps\.lat, lng: gps\.lng, accuracy: gps\.accuracy, method: 'gps' \}\)/);
    expect(f).toMatch(/api\.setPhone\(c\.id, wa\)/);
    expect(f).toMatch(/api\.setLocationPhoto\(c\.id, photo\.id\)/);
    expect(f).toMatch(/onPin\(c\)/);
  });
  it('Atur titik: draggable pin, device fix + accuracy circle, >150 m asks to confirm, saved as a drag with the device fix', () => {
    const f = fn('FldPinMap');
    expect(f).toMatch(/draggable: true/);
    expect(f).toMatch(/L\.circle\(/);
    expect(f).toMatch(/FIELDLOGIC\.pinMove\(\{ device: dev, pin \}\)/);
    expect(f).toMatch(/if \(mv\.far && !confirmFar\) \{ setAskFar\(true\); return; \}/);
    expect(f).toMatch(/method: 'geser', deviceLat: dev \? dev\.lat : undefined/);
    expect(f).toMatch(/\.catch\(\(\) => \{ if \(live\) setMapErr\(true\); \}\)/);
  });
});

describe('Tambah stop', () => {
  it('lists today\'s stops without a pin and other customers; a customer without a pin is prompted to set it', () => {
    const f = fn('FldAddStop');
    expect(f).toMatch(/FIELDLOGIC\.addStopCandidates\(\{ board: d\.board, customers: d\.customers, q \}\)/);
    expect(f).toMatch(/onPin\(fldCustFromStop\(s\)\)/);
    expect(f).toMatch(/!pickHasPin && <FldNotice tone="warn"/);
    expect(f).toMatch(/api\.addStop\(\{ customerId: pick\.id, qty \}\)/);
  });
});

describe('Pembayaran bon', () => {
  it('oldest bons first, never more than the bon, photo required, one clientRef per visit, cash or transfer', () => {
    const f = fn('FldPayBon');
    expect(f).toMatch(/FIELDLOGIC\.openBons\(/);
    expect(f).toMatch(/const pv = FIELDLOGIC\.payPreview\(\{ sisaBon: bon, pay \}\);/);
    expect(f).toMatch(/disabled=\{busy \|\| !pv\.ok \|\| !photo\}/);
    expect(f).toMatch(/clientRef: refRef\.current/);
    expect(f).toMatch(/\['tunai', trFl\('fld\.m_tunai'\)\], \['transfer', trFl\('fld\.m_transfer'\)\]/);
  });
});
