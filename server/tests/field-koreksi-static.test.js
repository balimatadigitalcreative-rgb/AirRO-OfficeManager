'use strict';
// KOREKSI (static — no browser in the server run): parses, ships between the customer screens and the
// shell, only uses its adaptor, keeps the owner's rules (reason always, approval always, transfer photo),
// and every fld.* key it writes exists in EN and ID.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('dist-field-koreksi.jsx'); const build = read('build.mjs'); const i18n = read('finance-i18n.js'); const kit = read('dist-field-kit.jsx');
const fn = (name) => { const i = src.indexOf('function ' + name + '('); expect(i).toBeGreaterThan(-1); const j = src.indexOf('\nfunction ', i + 10); return src.slice(i, j < 0 ? undefined : j); };

it('parses, ships after the customer screens and before the shell, never calls the server directly', () => {
  expect(() => parse(src, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build).toMatch(/'dist-field-cust\.jsx',\s*'dist-field-koreksi\.jsx',/);
  expect(build.indexOf("'dist-field-koreksi.jsx'")).toBeLessThan(build.indexOf("'dist-field.jsx'"));
  expect(src).not.toMatch(/window\.API|fetch\(/);
});
it('every fld.* key written literally exists in EN and ID', () => {
  const keys = [...new Set([...src.matchAll(/["'](fld\.[A-Za-z0-9_]+)["']/g)].map((m) => m[1]))].filter((k) => !k.endsWith('_'));   // 'fld.m_' + … is a prefix
  expect(keys.length).toBeGreaterThan(15);
  keys.forEach((k) => expect({ k, n: (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length }).toEqual({ k, n: 2 }));
  // the option labels are built as 'fld.ko_' + kind (fld.k_batal is the Setoran KPI label)
  ['pelanggan', 'jumlah', 'bayar', 'nominal', 'batal'].forEach((k) => expect((i18n.match(new RegExp("'fld\\.ko_" + k + "':", 'g')) || []).length).toBe(2));
});
it('the rights decide the options (cancel needs distribusiVoid, the rest distribusiKoreksi)', () => {
  const f = kit.slice(kit.indexOf('const fldCan ='));
  expect(f).toMatch(/correct: !!p\.distribusiKoreksi/);
  expect(f).toMatch(/void: !!p\.distribusiVoid/);
  expect(fn('FldKoreksi')).toMatch(/const opts = FIELDLOGIC\.koreksiOptions\(t, can\);/);
});
describe('FldKoreksi', () => {
  const f = () => fn('FldKoreksi');
  it('a transaction with a request already waiting explains it and offers Koreksi saya (no server 400)', () => {
    expect(f()).toMatch(/t\.pendingRequest \? \(\s*<FldNotice tone="warn" title=\{trFl\('fld\.kPendingT'\)\}/);
  });
  it('the server previews the effect; sending needs a reason and nothing blocking', () => {
    expect(f()).toMatch(/api\.previewCorrection\(t\.id, FIELDLOGIC\.correctionBody\(t, change\)\)/);
    expect(f()).toMatch(/disabled=\{busy \|\| !!why \|\| !!pvErr \|\| !reason\.trim\(\)\}/);
    expect(f()).toMatch(/const why = t && kind \? FIELDLOGIC\.koreksiCheck\(\{ t, kind, change \}\) : '';/);
  });
  it('correction, cancel: the existing approval requests; the reason spells out a pay change', () => {
    expect(f()).toMatch(/api\.requestVoid\(t\.id, \{ reason: text \}\)/);
    expect(f()).toMatch(/api\.requestCorrection\(t\.id, Object\.assign\(FIELDLOGIC\.correctionBody\(t, change\), \{ reason: FIELDLOGIC\.koreksiReason\(kind, t, change, text\) \}\)\)/);
  });
  it('switching to transfer asks for the transfer receipt photo', () => {
    expect(f()).toMatch(/const needPhoto = kind === 'bayar' && pay === 'transfer' && payNow !== 'transfer';/);
    expect(f()).toMatch(/needPhoto && \(/);
    expect(f()).toMatch(/<FldPhoto api=\{api\} value=\{photo\} onChange=\{setPhoto\}/);
  });
  it('the original stays valid until approved (said on screen)', () => {
    expect(f()).toContain("'fld.kStaysValid'");
    expect(f()).toContain("'fld.kVoidNote'");
  });
});

describe('Pelanggan salah', () => {
  it('suggests the customers nearest to where the photo was taken, then a search — only the armada\'s own list', () => {
    const f = fn('FldKoreksiCust');
    expect(f).toMatch(/api\.customers\(\)/);
    expect(f).toMatch(/FIELDLOGIC\.nearCustomers\(list, pt, fromId, 5\)/);
    expect(f).toMatch(/FIELDLOGIC\.customerList\(list, \{ q, filter: 'all' \}\)\.rows\.filter\(\(c\) => c\.id !== fromId\)/);
  });
  it('previews both customers and sends a move request with the reason as its note', () => {
    const f = fn('FldKoreksi');
    expect(f).toMatch(/<FldKoreksiCust api=\{api\} t=\{t\} fromId=\{target\.customerId\} value=\{toCust\} onChange=\{setToCust\} \/>/);
    expect(f).toMatch(/FIELDLOGIC\.koreksiImpact\(\{ kind, t, change, pv \}\)/);   // 3D-2: both customers' rows come from the shared impact logic
    expect(f).toMatch(/api\.requestReassign\(\{ fromCustomerId: target\.customerId, toCustomerId: toCust\.id, transactionIds: \[t\.id\], priceMode: 'keep', note: text, reason: text \}\)/);
    expect(f).not.toContain('KOREKSI-PELANGGAN');
  });
});

describe('Koreksi saya', () => {
  const f = () => fn('FldKoreksiSaya');
  it('lists the driver\'s own requests with their status, what was asked, and the office note', () => {
    expect(f()).toMatch(/api\.myChangeRequests\(\)/);
    expect(f()).toMatch(/const v = FIELDLOGIC\.requestView\(r\);/);
    expect(f()).toMatch(/r\.decisionNote \?/);
  });
  it('withdraw only while waiting (after a confirm); resubmit a rejected or withdrawn one', () => {
    expect(f()).toMatch(/v\.canWithdraw \?/);
    expect(f()).toMatch(/api\.withdrawRequest\(ask\.id\)/);
    expect(f()).toMatch(/v\.canResubmit && v\.target\.transactionId \?/);
    expect(f()).toMatch(/onResubmit\(v\.target\)/);
  });
});
