'use strict';
// Mode Lapangan UI shell (static checks — the server test run has no browser): files parse, are in the
// bundle, the MODE LATIHAN ribbon is unconditional in latihan, switching mode goes through a confirm,
// the rules screen writes through the UNTAGGED rules API, and every fld.* key exists in both languages.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const jsx = read('dist-field.jsx'); const allJsx = ['dist-field-kit.jsx', 'dist-field-day.jsx', 'dist-field-cust.jsx', 'dist-field.jsx'].filter((f) => fs.existsSync(path.join(root, f))).map(read).join('\n'); const css = read('dist-field.css'); const i18n = read('finance-i18n.js'); const build = read('build.mjs'); const html = read('index.html');

it('parses and ships', () => {
  expect(() => parse(jsx, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build.indexOf("'dist-zones.jsx'")).toBeLessThan(build.indexOf("'dist-field.jsx'"));
  expect(build).toMatch(/CSS_FILES = \[[^\]]*'dist-field\.css'/);
  expect(html).toMatch(/dist-field\.css\?v=/);
  expect(jsx).toMatch(/window\.FIELD = \{ App: FldApp, RulesScreen: FldRules \}/);
});
it('top-level names in every field file are unique across the whole bundle (one shared scope)', () => {
  const fieldFiles = ['dist-field-kit.jsx', 'dist-field-day.jsx', 'dist-field-cust.jsx', 'dist-field.jsx'].filter((f) => fs.existsSync(path.join(root, f)));
  const namesOf = (src) => [...src.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
    .concat([...src.matchAll(/^const \{([^}]*)\} = React;/gm)].flatMap((m) => m[1].split(',').map((x) => x.split(':').pop().trim())));
  const bundled = [...build.matchAll(/'([\w.-]+\.jsx?)'/g)].map((m) => m[1]).filter((f) => fs.existsSync(path.join(root, f)));
  fieldFiles.forEach((ff) => {
    const mine = namesOf(read(ff)).filter(Boolean);
    bundled.filter((f) => f !== ff).forEach((f) => {
      const src = read(f);
      mine.forEach((n) => expect({ in: ff, other: f, name: n, clash: new RegExp('^(?:const|let|var|function)\\s+' + n.replace('$', '\\$') + '\\b|^const \\{[^}]*:\\s*' + n + '\\s*[,}]', 'm').test(src) }).toEqual({ in: ff, other: f, name: n, clash: false }));
    });
  });
});
it('latihan is a chip in the header (always shown in practice) + confirmed mode switch + reset', () => {
  expect(jsx).not.toMatch(/mlap-ribbon/);
  expect(jsx).toMatch(/\{mode === 'latihan' \? <span className="mlap-chip latihan" role="status">\{trFl\('fld\.modeLatihan'\)\}<\/span> : null\}/);
  expect(jsx).toMatch(/askSwitch\(/);
  expect(jsx).toMatch(/trFl\('fld\.switchToAsliB'\)/);
  expect(jsx).toMatch(/trFl\('fld\.resetLatihanB'\)/);
});
it('the old view stays reachable from the menu, also after release (spec 5: masa transisi)', () => {
  expect(jsx).toMatch(/onClick=\{\(\) => \{ setMenu\(false\); onExit\(\); \}\}>\{trFl\('fld\.backOld'\)\}/);
  expect(jsx).not.toMatch(/!pref\.released && <button[^\n]*fld\.backOld/);
});
it('the screens are ready: releasing is open (owner only, confirmed); un-releasing stays open', () => {
  expect(jsx).toMatch(/^const FLD_SCREENS_READY = true;/m);
  expect(jsx).toMatch(/className="mlap-btn danger" disabled=\{busy \|\| !FLD_SCREENS_READY\}/);
  expect(jsx).toMatch(/className="mlap-btn" disabled=\{busy\} onClick=\{\(\) => setAsk\('old'\)\}/);
});
it('releasing changes only the release switch — other unsaved edits on the rules screen stay', () => {
  const f = jsx.slice(jsx.indexOf('function FldRules('));
  expect(f).toMatch(/if \(patch && patch\.fieldUiDefault !== undefined\) \{ setR\(\(cur\) => Object\.assign\(\{\}, cur, \{ fieldUiDefault: x\.data\.fieldUiDefault \}\)\); \} else got\(x\.data\);/);
});
it('rules are saved through the untagged owner API, never the adaptor', () => {
  const rules = jsx.slice(jsx.indexOf('function FldRules('));
  expect(rules).toMatch(/window\.API\.distribusi\.fieldRules\.set\(/);
  expect(rules).not.toMatch(/\bapi\.\w+\(/);
});
it('on phones the app\'s own bottom nav steps aside while the field UI is open (it would cover the dock)', () => {
  expect(jsx).toMatch(/document\.body\.classList\.add\('mlap-on'\)/);
  expect(jsx).toMatch(/document\.body\.classList\.remove\('mlap-on'\)/);
  expect(css).toMatch(/body\.mlap-on \.mobile-nav \{ display: none !important; \}/);
});
it('glass only on the functional layer + reduced transparency / motion honoured', () => {
  expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  expect(css).toMatch(/\.mlap-dock[^{]*\{[^}]*backdrop-filter/);
  expect(css).not.toMatch(/\.mlap-card[^{]*\{[^}]*backdrop-filter/);
  expect(css).not.toMatch(/(^|[\s,}])\.fld[-\s{]/m);   // the old form classes (.fld, .fld-label) are never restyled
});
it('every fld.* key used exists in EN and ID', () => {
  const used = [...new Set([...allJsx.matchAll(/trFl\('(fld\.[A-Za-z0-9_]+)'\s*[),]/g)].map((m) => m[1]))];   // literal keys; dynamic ones listed below
  const dynamic = ['fld.st_pending', 'fld.st_terkirim', 'fld.st_ditunda', 'fld.st_batal', 'fld.catatSale', 'fld.catatBon', 'fld.catatExp', 'fld.catatStop', 'fld.catatAdj', 'fld.catatDmg', 'fld.tabKirim', 'fld.tabPeta', 'fld.tabPelanggan', 'fld.tabSetoran'];
  expect(used.length).toBeGreaterThan(20);
  [...used, ...dynamic].forEach((k) => expect({ k, n: (i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length }).toEqual({ k, n: 2 }));
});

describe('Plan 3A shell wiring', () => {
  it('screens only run on the adaptor of the ACTIVE mode (never the old one after a switch)', () => {
    expect(jsx).toMatch(/const ready = !!api && api\.mode === mode && !!ctx;/);
  });
  it('the armada follows the list when it arrives later', () => {
    expect(jsx).toMatch(/if \(!fleets\.includes\(fleet\)\) setFleet\(fleets\[0\] \|\| ''\);/);
  });
  it('tabs and views map to the day screens', () => {
    ['<FldBoardScreen ', '<FldRoute ', '<FldSetoran ', '<FldSale ', '<FldOpenRun ', '<FldStopSheet '].forEach((t) => expect(jsx).toContain(t));
    expect(jsx).not.toMatch(/function FldBoard\(/);   // the Plan 2 stub is gone
  });
  it('a lost practice save and a failed restart are shown', () => {
    expect(jsx).toMatch(/api\.persisted === false \|\| persistOk === false/);
    expect(jsx).toMatch(/\.catch\(\(e\) => flash\(trFl\('fld\.resetFail'\)/);
  });
});

describe('final review fixes (shell)', () => {
  it('a saved-but-unmarked sale is remembered per mode + user and handed to the sale screen', () => {
    expect(jsx).toMatch(/FIELDLOGIC\.pendingSales\(/);
    expect(jsx).toMatch(/<FldSale api=\{api\} stop=\{view\.stop\} pending=\{pending\}/);
  });
  it('one write → context reload → ONE screen reload; office events are coalesced', () => {
    expect(jsx).toMatch(/\.then\(\(c\) => \{ if \(!live\) return; ctxRef\.current = c; setCtx\(c\); setTick\(\(t\) => t \+ 1\); \}\)/);
    expect(jsx).toMatch(/window\.DISTLIVE\.createCoalescer\(/);
    expect(jsx).toMatch(/const done = \(m\) => \{ setView\(null\); setCtxTick\(\(t\) => t \+ 1\);/);
  });
  it('a failed context reload keeps the working screen (only the first load may show the error)', () => {
    expect(jsx).toMatch(/if \(ctxRef\.current\) flash\(trFl\('fld\.reloadErr'\)\); else setErr\(e\);/);
  });
  it('in Mode asli the driver\'s position is sent (throttled like the old board), never in practice', () => {
    expect(jsx).toMatch(/if \(mode !== 'asli' \|\| !ready\) return undefined;/);
    expect(jsx).toMatch(/navigator\.geolocation\.watchPosition\(/);
    expect(jsx).toMatch(/navigator\.geolocation\.clearWatch\(/);
    expect(jsx).toMatch(/POS_EVERY_MS/);
    expect(jsx).toMatch(/api\.position\(/);
  });
});

describe('Plan 3B shell', () => {
  it('Catat items appear only when the account may use them, and open their screens', () => {
    expect(jsx).toMatch(/const can = fldCan\(perms\);/);
    expect(jsx).toMatch(/\['catatSale', can\.sale\], \['catatBon', can\.bon\], \['catatExp', can\.expense\], \['catatStop', can\.addStop\], \['catatAdj', can\.adjust\], \['catatDmg', can\.damage\]\]\.filter\(\(a\) => a\[1\]\)/);
    expect(jsx).not.toMatch(/className="mlap-tile" disabled/);
  });
  it('the Pelanggan tab and every new screen are wired', () => {
    ['<FldCustomers ', '<FldCustSheet ', '<FldPickCustomer ', '<FldPayBon ', '<FldAdjust ', '<FldDamage ', '<FldExpense ', '<FldAddStop ', '<FldComplete ', '<FldPinMap '].forEach((t) => expect(jsx).toContain(t));
  });
  it('pickers disable customers an action cannot use (no bon → no bon payment; no gallons → no damage)', () => {
    expect(jsx).toMatch(/view\.act === 'bon' \? \(\(c\) => \(c\.sisaBon > 0 \? '' : 'fld\.pickNoBon'\)\)/);
    expect(jsx).toMatch(/view\.act === 'damage' \? \(\(c\) => \(c\.gallonsHeld > 0 \? '' : 'fld\.dmgNoHeld'\)\)/);
  });
});

describe('Final review fixes (shell)', () => {
  it('clientRefs live in localStorage per mode + user + armada + day (they survive leaving the screen and a reload)', () => {
    expect(jsx).toMatch(/const refKey = 'airro\.fld\.ref:' \+ mode \+ ':' \+ \(\(user && user\.id\) \|\| 'anon'\) \+ ':' \+ fleet \+ ':' \+ today;/);
    expect(jsx).toMatch(/FIELDLOGIC\.refStore\(\(\(\) => \{ try \{ return window\.localStorage; \} catch \(e\) \{ return null; \} \}\)\(\), refKey\)/);
    ['FldSale', 'FldPayBon', 'FldDamage', 'FldExpense'].forEach((n) => expect(jsx).toMatch(new RegExp('<' + n + ' [^>]*refs=\{refs\}')));
  });
  it('a sale for a customer with a pending stop today goes through that stop (marked, not sold twice)', () => {
    expect(jsx).toMatch(/FIELDLOGIC\.saleStopFor\(\{ board, customer: c, demand: ctx\.demand \}\)/);
  });
  it('Atur titik gets the warehouse; Penyesuaian gets the owner\'s approval setting', () => {
    expect(jsx).toMatch(/<FldPinMap api=\{api\} cust=\{view\.cust\} depot=\{ctx\.depot\}/);
    expect(jsx).toMatch(/<FldAdjust api=\{api\} cust=\{view\.cust\} needsApproval=\{ctx\.galonNeedsApproval\}/);
  });
});

describe('Plan 3C shell', () => {
  it('Koreksi and Koreksi saya are full-screen views opened from the stop sheet, Setoran and the menu', () => {
    expect(jsx).toMatch(/if \(act === 'koreksi'\) \{ setView\(\{ name: 'koreksi', target: c \}\); return; \}/);
    expect(jsx).toMatch(/<FldKoreksi api=\{api\} target=\{view\.target\} can=\{can\}/);
    expect(jsx).toMatch(/<FldKoreksiSaya api=\{api\} tick=\{tick\}/);
    expect(jsx).toMatch(/'koreksi', 'koreksiSaya'\]\.includes\(view\.name\)/);
    expect(jsx).toMatch(/<FldSetoran api=\{api\} ctx=\{ctx\} tick=\{tick\} canKoreksi=\{can\.correct \|\| can\.void\} onKoreksiSaya=\{\(\) => setView\(\{ name: 'koreksiSaya' \}\)\}/);
    expect(jsx).toMatch(/\(can\.correct \|\| can\.void\) && <button type="button" className="mlap-menu-item" onClick=\{\(\) => \{ setMenu\(false\); setView\(\{ name: 'koreksiSaya' \}\); \}\}>/);
  });
});

it('Plan 3C: after a pin is saved the screen we return to has it (no stale "pin needed")', () => {
  expect(jsx).toMatch(/<FldAddStop api=\{api\} preset=\{view\.preset\} can=\{can\} onPin=\{\(c, keep\) => setView\(\{ name: 'pin', cust: c, back: keep \? Object\.assign\(\{\}, view, \{ preset: c \}\) : view \}\)\}/);
  expect(jsx).toMatch(/onDone=\{\(m, pt\) => \{ if \(view\.back\) \{ setView\(pt \? FIELDLOGIC\.afterPin\(view\.back, view\.cust\.id, pt\) : view\.back\);/);
});

describe('Plan 3D shell', () => {
  it('full screen: the root covers the viewport and the phone status bar takes the screen colour', () => {
    const css = read('dist-field.css');
    expect(css).toMatch(/\.mlap-root \{[^}]*position: fixed; inset: 0;[^}]*overflow-y: auto;/);
    expect(jsx).toMatch(/document\.querySelector\('meta\[name="theme-color"\]'\)/);
    expect(jsx).toMatch(/meta\.setAttribute\('content', '#EEF2F6'\)/);
  });
});

describe('Plan 3D header', () => {
  it('eyebrow (day · armada) above the title; glass round buttons top-right (Rute on Pengiriman, ⋯ menu)', () => {
    expect(jsx).toMatch(/<span>\{fldDayLabel\(today\)\}\{fleet \? ' · ' \+ fleet : ''\}<\/span>/);
    expect(jsx.indexOf('{fldDayLabel(today)}')).toBeLessThan(jsx.indexOf('<h1>{trFl(TAB_LABEL[tab])}</h1>'));
    expect(jsx).toMatch(/tab === 'kirim' \? <button type="button" className="mlap-round" aria-label=\{trFl\('fld\.seeRoute'\)\} onClick=\{\(\) => setTab\('peta'\)\}><FldSvg n="route"/);
    expect(jsx).toMatch(/<FldSvg n="dots" s=\{19\} \/>/);
  });
  it('the armada picker moved into the ⋯ sheet; a soft fade sits under the dock', () => {
    expect(jsx).toMatch(/fleets\.length > 1 && \(\s*<label className="mlap-menu-item mlap-menu-fleet">/);
    expect(jsx).toMatch(/<div className="mlap-dockfade" aria-hidden="true" \/>/);
  });
});

it('Plan 3D: swipe between tabs on the tab body only — never from a map, an input, a sideways scroller or a sheet', () => {
  expect(jsx).toMatch(/const TAB_ORDER = \['kirim', 'peta', 'pelanggan', 'setoran'\];/);
  expect(jsx).toMatch(/e\.target\.closest\('\.mlap-map, input, textarea, select, \.mlap-hscroll, \.mlap-sheet, \.leaflet-container'\)/);
  expect(jsx).toMatch(/FIELDLOGIC\.swipeTab\(\{ dx: e\.clientX - s\.x, dy: e\.clientY - s\.y, ms: Date\.now\(\) - s\.t, tab, order: TAB_ORDER \}\)/);
  expect(jsx).toMatch(/<div className="mlap-body mlap-swipe" onPointerDown=\{swipeDown\} onPointerUp=\{swipeUp\} onPointerCancel=\{\(\) => \{ swipeRef\.current = null; \}\}>/);
  expect(read('dist-field.css')).toMatch(/\.mlap-swipe \{ touch-action: pan-y; \}/);
});
