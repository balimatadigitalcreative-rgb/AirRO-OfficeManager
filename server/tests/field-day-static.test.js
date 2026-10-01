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
  expect(build).toMatch(/'dist-field-kit\.jsx',\s*'dist-field-day\.jsx',/);
  expect(build.indexOf("'dist-field-day.jsx'")).toBeLessThan(build.indexOf("'dist-field.jsx'"));   // customer screens may sit between
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

describe('Transaksi', () => {
  const f = () => fn('FldSale');
  it('a proof photo is always required; save is locked until then', () => {
    expect(f()).toMatch(/const why = txnId \? '' : FIELDLOGIC\.canSaveSale\(\{ qty, photo \}\);/);   // once saved, only marking remains
    expect(f()).toMatch(/disabled=\{busy \|\| !!why \|\| \(needReason && !noLoc\.trim\(\)\)\}/);
    expect(f()).toMatch(/<FldPhoto api=\{api\} value=\{photo\} onChange=\{setPhoto\}/);
  });
  it('a saved sale is never created twice — only the marking is retried (also after a network error)', () => {
    expect(f()).toMatch(/const \[txnId, setTxnId\] = uSfl\(\(\) => \(s\.id \? pending\.get\(s\.id\) : null\)\);/);   // a saved sale survives leaving the screen
    expect(f()).toMatch(/FIELDLOGIC\.recordSale\(api, \{ stopId: s\.id, body, txnId,/);
    expect(f()).toMatch(/if \(e && e\.txnId\) keep\(e\.txnId\);/);
    expect(f()).toMatch(/const keep = \(id\) => \{ setTxnId\(id\); if \(s\.id\) pending\.set\(s\.id, id\); \};/);
    expect(f()).toMatch(/pending\.clear\(s\.id\)/);
    expect(f()).toMatch(/<fieldset className="mlap-fs" disabled=\{!!txnId\}>/);   // inputs locked once saved
  });
  it('Lunas / Bon / Transfer', () => {
    expect(f()).toMatch(/\['lunas', trFl\('fld\.m_lunas'\)\], \['bon', trFl\('fld\.m_bon'\)\], \['transfer', trFl\('fld\.m_transfer'\)\]/);
  });
});

describe('Buka / Tutup rit', () => {
  it('an open rit (today or older) is closed first; otherwise the gauge', () => {
    const f = fn('FldOpenRun');
    expect(f).toMatch(/if \(rs\.open\) return <FldCloseRun api=\{api\} run=\{rs\.open\} stale=\{rs\.stale\}/);
    expect(f).toMatch(/FIELDLOGIC\.runGauge\(\{ load, capacity: cap, minLoad \}\)/);
  });
  it('below the SOP a reason is always required; above capacity it cannot open', () => {
    const f = fn('FldOpenRun');
    expect(f).toMatch(/disabled=\{busy \|\| !g\.canOpen \|\| \(g\.under && !reason\.trim\(\)\)\}/);
    expect(f).toMatch(/underSopReason: g\.under \? reason\.trim\(\) : ''/);
  });
  it('closing with a difference needs what happened; damaged/lost only when gallons are missing', () => {
    const f = fn('FldCloseRun');
    expect(f).toMatch(/disabled=\{busy \|\| \(diff !== 0 && !res\)\}/);
    expect(f).toMatch(/\(k === 'rusak' \|\| k === 'hilang'\) \? lost > 0 : true/);
  });
});

describe('Rute rit / Peta', () => {
  const f = () => fn('FldRoute');
  it('no open rit (or a stale one) → the button, not an error; the route only for today\'s rit', () => {
    expect(f()).toMatch(/if \(!rs\.open \|\| rs\.stale\) return/);
    expect(f()).toMatch(/api\.ritRoute\(\)/);
  });
  it('the map is optional: a Leaflet failure keeps the list', () => {
    expect(f()).toMatch(/znLoadLeaflet\(\)\.then\(/);
    expect(f()).toMatch(/\.catch\(\(\) => \{ if \(live\) setMapErr\(true\); \}\)/);
    const list = f().indexOf('className="mlap-card mlap-legs"'); const mapBranch = f().indexOf('mapErr ?');
    expect(list).toBeGreaterThan(-1); expect(mapBranch).toBeGreaterThan(-1);
    expect(f()).toMatch(/mapRef\.current\.remove\(\)/);   // no leaked map on unmount
  });
  it('uses the same OSM tiles + attribution as Peta Zona', () => {
    expect(f()).toMatch(/https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
    expect(f()).toMatch(/OpenStreetMap<\/a>/);
  });
});

describe('Setoran', () => {
  const f = () => fn('FldSetoran');
  it('figures come from the day summary; transfer is shown but not deposited', () => {
    expect(f()).toMatch(/Promise\.all\(\[api\.daySummary\(\), api\.board\(\)\]\)/);
    ['fld.s_tunai', 'fld.s_pelunasan', 'fld.s_transfer', 'fld.s_bon', 'fld.s_gantiRugi', 'fld.s_expense', 'fld.s_setor'].forEach((k) => expect(f()).toContain("'" + k + "'"));
    expect(f()).toMatch(/sum\.wajibSetor/);
  });
  it('closing the day needs a reason for every unfinished stop', () => {
    expect(f()).toMatch(/const chk = FIELDLOGIC\.closeCheck\(pending, reasons\);/);
    expect(f()).toMatch(/disabled=\{busy \|\| !chk\.ok\}/);
    expect(f()).toMatch(/api\.closeDay\(\{ reasons: picked, generalNote: note\.trim\(\) \}\)/);
  });
});

describe('final review fixes (screens)', () => {
  it('the board reloads once per tick, not again for every new context object', () => {
    const f = fn('FldBoardScreen');
    expect(f).toMatch(/\}, \[api, tick\]\);/);
  });
  it('a stepper can be cleared while typing (no "14" when the driver types 4)', () => {
    const kit = read('dist-field-kit.jsx'); const st = kit.slice(kit.indexOf('function FldStepper('));
    expect(st).toMatch(/FIELDLOGIC\.stepInput\(/);
    expect(st).toMatch(/onBlur=/);
  });
  it('the load stepper is not capped at 2×SOP when the armada has no capacity', () => {
    expect(fn('FldOpenRun')).toMatch(/<FldStepper label=\{trFl\('fld\.loadQ'\)\} value=\{g\.load\} onChange=\{setLoad\} min=\{0\} max=\{cap \|\| 9999\} \/>/);
  });
  it('the Leaflet map never paints over the sheets, menu or dock', () => {
    expect(read('dist-field.css')).toMatch(/\.mlap-map \{[^}]*isolation: isolate;/);
  });
});

describe('Plan 3B: sale screen', () => {
  it('every visit carries one clientRef (a retry after a lost response is never a second sale); a manual sale has no stop', () => {
    const f = fn('FldSale');
    expect(f).toMatch(/const \[ref\] = uSfl\(\(\) => refs\.take\(slot\)\);/);   // kept until saved (final review fix)
    expect(f).toMatch(/clientRef: ref \}/);
    expect(f).toMatch(/s\.id \? pending\.get\(s\.id\) : null/);
    expect(day).toMatch(/const fldSaleStopFromCust = \(c\) => \(\{ id: null, customerId: c\.id,/);
  });
});

it('Plan 3B: the stop sheet offers bon / adjustment / damage / complete for the stop\'s customer, by cap', () => {
  const f = fn('FldStopSheet');
  expect(f).toMatch(/can\.bon && s\.sisaBon > 0/);
  expect(f).toMatch(/if \(can\.adjust\) acts\.push\(\['adjust',/);   // 3D-2: one icon row per action
  expect(f).toMatch(/can\.damage && s\.gallonsHeld > 0/);
  expect(f).toMatch(/can\.location && s\.gaps\.count > 0/);
});

it('Final fix: the sale keeps ONE clientRef per stop/customer until saved, and says when it was already saved', () => {
  const f = fn('FldSale');
  expect(f).toMatch(/function FldSale\(\{ api, stop: s, pending, refs, onDone, onBack \}\)/);
  expect(f).toMatch(/const slot = 'sale:' \+ \(s\.id \|\| 'c:' \+ s\.customerId\);\s*const \[ref\] = uSfl\(\(\) => refs\.take\(slot\)\);/);
  expect(f).toMatch(/clientRef: ref/);
  expect(f).toMatch(/refs\.done\(slot\);/);
  expect(f).toMatch(/r\.replay \? 'fld\.replayed' : 'fld\.saleDone'/);
});

describe('Plan 3C: day screens', () => {
  it('a delivered stop with a sale offers Koreksi to an account that may correct or cancel', () => {
    const f = fn('FldStopSheet');
    expect(f).toMatch(/s\.status === 'terkirim' && s\.transactionId && \(can\.correct \|\| can\.void\)/);
    expect(f).toMatch(/onAction\('koreksi', \{ transactionId: s\.transactionId, customerId: s\.customerId \}\)/);
  });
  it('Setoran opens Koreksi saya, says the day is already closed, and asks before closing again', () => {
    const f = fn('FldSetoran');
    expect(f).toMatch(/function FldSetoran\(\{ api, ctx, tick, canKoreksi, onKoreksiSaya, onChanged \}\)/);
    expect(f).toMatch(/canKoreksi \?/);
    expect(f).toMatch(/sum\.closeout \?/);
    expect(f).toMatch(/onClick=\{\(\) => \(sum\.closeout \? setAskRe\(true\) : close\(\)\)\}/);
  });
});

describe('Plan 3C: 3A minors', () => {
  it('the next stop is not listed again under Menunggu; the list numbers after it', () => {
    const f = fn('FldBoardScreen');
    expect(f).toMatch(/v\.pending\.filter\(\(s\) => !v\.next \|\| s\.id !== v\.next\.id\)/);
    expect(f).toMatch(/const first = seg === 'pending' \? v\.counts\.done \+ \(v\.next \? 2 : 1\) : 1;/);   // 3D-2: numbers run on after the delivered ones
  });
  it('Peta reads today\'s rits (the next rit number is right) and the map can be retried', () => {
    const f = fn('FldRoute');
    expect(f).toMatch(/api\.runs\(\)/);
    expect(f).toMatch(/FIELDLOGIC\.runState\(\{ today: ctx\.today, openRun: ctx\.openRun, runs \}\)/);
    expect(f).toMatch(/action=\{trFl\('fld\.retry'\)\} onAction=\{\(\) => setMapErr\(false\)\}/);
    expect(f).toMatch(/\}, \[route, mapErr\]\);/);
  });
  it('the close-rit difference is stored in Indonesian whatever the screen language', () => {
    expect(day).toMatch(/\['kembali_besok', 'fld\.d_besok', 'Tetap di armada \(besok\)'\]/);
    expect(fn('FldCloseRun')).toMatch(/body\.diffReason = label \+/);
    expect(fn('FldCloseRun')).not.toMatch(/diffReason = trFl\(/);
  });
  it('a11y: the warning dot is an image with a label; links without a target are not links', () => {
    expect(fn('FldStopRow')).toMatch(/className="mlap-warn-dot" role="img" aria-label=/);
    expect(day).not.toMatch(/href=\{links\.\w+ \|\| undefined\}/);
    expect(day).toMatch(/<FldLinkBtn href=\{links\.nav\}/);
  });
});
