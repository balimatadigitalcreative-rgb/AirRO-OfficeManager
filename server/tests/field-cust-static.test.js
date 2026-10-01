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
  expect(build).toMatch(/'dist-field-day\.jsx',\s*'dist-field-cust\.jsx',/);
  expect(build.indexOf("'dist-field-cust.jsx'")).toBeLessThan(build.indexOf("'dist-field.jsx'"));   // koreksi may sit between
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
    expect(f).toMatch(/clientRef: ref,/);
    expect(f).toMatch(/\['tunai', trFl\('fld\.m_tunai'\)\], \['transfer', trFl\('fld\.m_transfer'\)\]/);
  });
});

describe('Penyesuaian + Ganti rugi', () => {
  it('adjustment: reasons from the shared list, waits for the office', () => {
    const f = fn('FldAdjust');
    expect(f).toMatch(/FIELDLOGIC\.ADJ_REASON_KEYS/);
    expect(f).toMatch(/api\.adjustGallon\(c\.id, FIELDLOGIC\.adjustBody\(/);
    expect(f).toContain("'fld.adjWaits'");
    expect(f).toMatch(/disabled=\{busy \|\| !reasonKey \|\| diff === 0\}/);
  });
  it('damage: price from the owner\'s rules, explained when missing, photo required, clientRef, no approval', () => {
    const f = fn('FldDamage');
    expect(f).toMatch(/const pv = FIELDLOGIC\.damagePreview\(\{ qty, price: rules\.hargaGantiRugiGalon, held, payMethod: pay \}\);/);
    expect(f).toMatch(/pv\.blocked \? <FldNotice tone="warn" title=\{trFl\(pv\.blocked\)\}/);
    expect(f).toMatch(/disabled=\{busy \|\| !!pv\.blocked \|\| !kind \|\| !photo\}/);
    expect(f).toMatch(/clientRef: ref \}/);
    expect(f).toContain("'fld.dmgNoApproval'");
  });
});

describe('Pengeluaran', () => {
  it('always cash from the deposit, receipt photo required, fuel asks litres + odometer', () => {
    const f = fn('FldExpense');
    expect(f).toMatch(/api\.addExpense\(Object\.assign\(FIELDLOGIC\.expenseBody\(/);
    expect(f).not.toMatch(/method:/);
    expect(f).toMatch(/disabled=\{busy \|\| !cat \|\| !\(amount > 0\) \|\| !photo\}/);
    expect(f).toMatch(/cat === 'bensin' &&/);
    expect(f).toContain("'fld.expFromDeposit'");
  });
});

describe('Final review fixes (customer screens)', () => {
  it('bon payment, damage and expense keep ONE clientRef per customer/day until saved (a retry after leaving is not a second write)', () => {
    expect(cust).not.toMatch(/FIELDLOGIC\.newRef\(\)/);
    expect(fn('FldPayBon')).toMatch(/const slot = 'bon:' \+ c\.id;\s*const \[ref\] = uSfl\(\(\) => refs\.take\(slot\)\);/);
    expect(fn('FldDamage')).toMatch(/const slot = 'dmg:' \+ c\.id;\s*const \[ref\] = uSfl\(\(\) => refs\.take\(slot\)\);/);
    expect(fn('FldExpense')).toMatch(/const slot = 'exp';\s*const \[ref\] = uSfl\(\(\) => refs\.take\(slot\)\);/);
    ['FldPayBon', 'FldDamage', 'FldExpense'].forEach((n) => {
      expect(fn(n)).toMatch(/clientRef: ref/);
      expect(fn(n)).toMatch(/refs\.done\(slot\);/);
      expect(fn(n)).toMatch(/r && r\.replay \? trFl\('fld\.replayed'\)/);   // tells the driver it was already saved
    });
  });
  it('Atur titik never dead-ends without GPS: starts at the warehouse and must be moved before saving', () => {
    const f = fn('FldPinMap');
    expect(f).toMatch(/function FldPinMap\(\{ api, cust: c, depot, onDone, onBack \}\)/);
    expect(f).toMatch(/FIELDLOGIC\.pinStart\(\{ cust: c, device: p, depot \}\)/);
    expect(f).toMatch(/disabled=\{busy \|\| !pin \|\| \(fallback && !moved\)\}/);
    expect(f).toMatch(/'fld\.pinNoGpsMove'/);
  });
  it('Penyesuaian says what really happened: waits for the office, or applied (owner turned approval off)', () => {
    const f = fn('FldAdjust');
    expect(f).toMatch(/function FldAdjust\(\{ api, cust: c, needsApproval, onDone, onBack \}\)/);
    expect(f).toMatch(/r && r\.status === 'approved' \? 'fld\.adjApplied' : 'fld\.adjSent'/);
    expect(f).toMatch(/needsApproval === false \? 'fld\.adjNoWait' : 'fld\.adjWaits'/);
  });
});
