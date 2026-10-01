'use strict';
// PLAN 3D-2 DAY SCREENS (static): Pengiriman, Detail stop, Transaksi, Buka/Tutup rit, Peta and Setoran
// laid out to their approved mockup boards — still only on the adaptor, still keeping the owner's rules.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const day = read('dist-field-day.jsx'); const shell = read('dist-field.jsx'); const css = read('dist-field.css');
const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); expect({ name, found: i > -1 }).toEqual({ name, found: true }); const j = src.indexOf('\nfunction ', i + 10); return src.slice(i, j < 0 ? undefined : j); };
const section = (name) => { const i = css.indexOf('/* ── 3D-2 ' + name); expect({ name, found: i > -1 }).toEqual({ name, found: true }); const j = css.indexOf('/* ── 3D-2 ', i + 10); return css.slice(i, j < 0 ? undefined : j); };
const rule = (name, sel) => { const b = section(name); const i = b.indexOf('\n' + sel + ' {'); expect({ sel, found: i > -1 }).toEqual({ sel, found: true }); return b.slice(i, b.indexOf('}', i)); };

it('parses; never calls the server directly', () => {
  expect(() => parse(day, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(day).not.toMatch(/window\.API|fetch\(/);
});

describe('Pengiriman (mockup Main board)', () => {
  const f = () => fn(day, 'FldBoardScreen');
  it('compact rit card: teal dot, remaining in teal, a 6 px progress bar, a meta row', () => {
    expect(f()).toMatch(/<span className="mlap-rit-dot" aria-hidden="true" \/>/);
    expect(f()).toMatch(/const pct = rs\.open \? FIELDLOGIC\.loadPct\(rs\.remaining, rs\.open\.gallonsOut\) : 0;/);
    expect(f()).toMatch(/<div className="mlap-bar" role="img" aria-label=\{trFl\('fld\.loadPctL', \{ p: pct \}\)\}><span style=\{\{ width: pct \+ '%' \}\} \/><\/div>/);
    expect(f()).toMatch(/trFl\('fld\.kmPlusBack'/);
    expect(rule('PENGIRIMAN', '.mlap-bar')).toMatch(/height: 6px; border-radius: 3px; background: #E1E8ED;/);
    expect(rule('PENGIRIMAN', '.mlap-bar > span')).toMatch(/background: #1A8C87;/);
    expect(rule('PENGIRIMAN', '.mlap-rit-left b')).toMatch(/color: #0F6B66;/);
  });
  it('warnings are tappable rows: incomplete data → Pelanggan "Belum lengkap"; outside the route → Tambah stop', () => {
    expect(f()).toMatch(/<button type="button" className="mlap-alert warn" onClick=\{onIncomplete\}>/);
    expect(f()).toMatch(/<button type="button" className="mlap-alert" onClick=\{onOutside\}>/);
    expect(shell).toMatch(/const goIncomplete = \(\) => \{ setCustFilter\('warn'\); setTab\('pelanggan'\); \};/);
    expect(shell).toMatch(/onIncomplete=\{goIncomplete\} onOutside=\{\(\) => \(can\.addStop \? setView\(\{ name: 'addStop' \}\) : setTab\('peta'\)\)\}/);
    expect(shell).toMatch(/<FldCustomers api=\{api\} tick=\{tick\} filter=\{custFilter\} onFilter=\{setCustFilter\}/);
    expect(rule('PENGIRIMAN', '.mlap-alert.warn')).toMatch(/background: #FFF1E8; border: 1px solid #F4C7A8; color: #9A3412;/);
  });
  it('next stop: 38 px number, blue eyebrow with the distance, chevron, coloured chips, Navigasi (gray) + Antar & catat (wider, check)', () => {
    const n = fn(day, 'FldNextCard');
    expect(n).toMatch(/<span className="mlap-nbig">\{n\}<\/span>/);
    expect(n).toMatch(/<FldSvg n="chevron"/);
    expect(n).toMatch(/className="mlap-btn gray" newTab><FldSvg n="navigate"/);
    expect(n).toMatch(/className="mlap-btn primary" onClick=\{onSale\}><FldSvg n="check"/);
    ['blue', 'bon', 'gray', 'warn'].forEach((t) => expect(n).toContain("['" + t + "'"));
    expect(rule('PENGIRIMAN', '.mlap-next-ad')).toMatch(/white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);   // a long address never pushes the card wider
    expect(rule('PENGIRIMAN', '.mlap-next-eb')).toMatch(/font-size: 11px; font-weight: 700; letter-spacing: \.05em; color: #065489;/);
    expect(rule('PENGIRIMAN', '.mlap-next .mlap-actions .mlap-btn.primary')).toMatch(/flex: 1\.3;/);
  });
  it('small segmented filter; numbers run on like the board and are coloured by list; the sheet gets the number', () => {
    expect(f()).toMatch(/<FldSeg size="sm" label=\{trFl\('fld\.filter'\)\}/);
    expect(f()).toMatch(/const first = seg === 'pending' \? v\.counts\.done \+ \(v\.next \? 2 : 1\) : 1;/);
    expect(f()).toMatch(/tone=\{seg === 'done' \? 'ok' : seg === 'held' \? 'neg' : ''\}/);
    expect(f()).toMatch(/onStop\(Object\.assign\(\{\}, s, \{ boardNo: n \}\)\)/);
    expect(f()).toMatch(/onOpen=\{\(\) => onStop\(Object\.assign\(\{\}, v\.next, \{ boardNo: v\.counts\.done \+ 1 \}\)\)\}/);
    expect(rule('PENGIRIMAN', '.mlap-num.ok')).toMatch(/background: #E3F3EA; color: #1E6B40;/);
    expect(rule('PENGIRIMAN', '.mlap-num.neg')).toMatch(/background: #FDE8E6; color: #9B2C22;/);
  });
});

describe('Detail stop (mockup Stop board)', () => {
  const f = () => fn(day, 'FldStopSheet');
  it('a tall sheet: 38 px number, name, glass close X; the body scrolls, the CTA stays at the bottom', () => {
    expect(f()).toMatch(/<div className="mlap-sheet tall" role="dialog" aria-modal="true" aria-label=\{s\.customerName\} ref=\{drag\.ref\} style=\{drag\.style\}>/);
    expect(f()).toMatch(/<FldSheetHead title=\{s\.customerName\} sub=\{sub\} lead=\{s\.boardNo != null \? <span className="mlap-nbig">\{s\.boardNo\}<\/span> : null\} onClose=\{onClose\} \/>/);
    expect(f()).toMatch(/<div className="mlap-sheet-body">/);
    expect(f()).toMatch(/<div className="mlap-sheet-cta"><button type="button" className="mlap-btn primary" onClick=\{\(\) => onSale\(s\)\}><FldSvg n="check"/);
  });
  it('each missing item has its own action pill (32 px pill, 44 px touch); contact tiles with icons; no WhatsApp = dashed orange', () => {
    expect(f()).toMatch(/s\.gaps\[k\] && fix \? <button type="button" className="mlap-gapact" onClick=\{fix\}>/);
    expect(f()).toMatch(/className="mlap-ctile" newTab><FldSvg n="navigate"/);
    expect(f()).toMatch(/className="mlap-ctile"><FldSvg n="phone"/);
    expect(f()).toMatch(/<button type="button" className="mlap-ctile miss" onClick=\{fix\}><FldSvg n="wa"/);
    expect(rule('STOP', '.mlap-ctile.miss')).toMatch(/border: 1px dashed #F4C7A8; color: #9A3412;/);
    expect(rule('STOP', '.mlap-gapact::before')).toMatch(/inset: -6px 0;/);
  });
  it('two coloured facts, the note card, an icon action list with chevrons, Tunda / Batal with icons', () => {
    expect(f()).toMatch(/<div className="mlap-card mlap-facts2">/);
    expect(f()).toMatch(/<div className="mlap-card mlap-notecard"><FldSvg n="note"/);
    expect(f()).toMatch(/className="mlap-actrow" onClick=\{\(\) => onAction\(k, fldCustFromStop\(s\)\)\}>/);
    expect(f()).toMatch(/<button type="button" className="mlap-btn hold"[\s\S]*?<FldSvg n="clock"/);
    expect(f()).toMatch(/<button type="button" className="mlap-btn cancel"[\s\S]*?<FldSvg n="ban"/);
    expect(f()).toMatch(/tone=\{mode === 'tunda' \? 'hold' : 'danger'\}/);
    expect(rule('STOP', '.mlap-facts2 b.blue')).toMatch(/color: #065489;/);
  });
});

describe('Transaksi (mockup Transaksi board)', () => {
  const f = () => fn(day, 'FldSale');
  it('the next card hands the sale its stop number (board: "Stop 3 · C-0511")', () => {
    expect(fn(day, 'FldBoardScreen')).toMatch(/onSale=\{\(\) => onSale\(Object\.assign\(\{\}, v\.next, \{ boardNo: v\.counts\.done \+ 1 \}\)\)\}/);
  });
  it('a plain "Transaksi" top bar, the customer at 22 px with "Stop n · code"', () => {
    expect(f()).toMatch(/<FldTop title=\{trFl\('fld\.saleTitle'\)\} onBack=\{onBack\} \/>/);
    expect(f()).toMatch(/<FldCustHead name=\{s\.customerName\}/);
  });
  it('totals: a divider, the 22 px total, the coloured "after" pill; a link to collect the old bon', () => {
    expect(f()).toMatch(/<div className="mlap-sumdiv" \/>/);
    expect(f()).toMatch(/<div className="mlap-sumtot"><span>\{trFl\(pv\.totalKey\)\}<\/span><b>/);
    expect(f()).toMatch(/onPayBon \? <button type="button" className="mlap-linkrow" onClick=\{onPayBon\}><FldSvg n="cash"/);
    expect(rule('TRANSAKSI', '.mlap-sumtot b')).toMatch(/font-size: 22px; font-weight: 700;/);
    expect(rule('TRANSAKSI', '.mlap-after.bon')).toMatch(/background: #FCF1D6; color: #7A4B00;/);
  });
  it('the photo label follows the payment (cash / transfer / gallons received); always required', () => {
    expect(f()).toMatch(/const reqKey = method === 'transfer' \? 'fld\.reqTf' : method === 'bon' \? 'fld\.reqBon' : 'fld\.reqCash';/);
    expect(f()).toMatch(/<FldPhoto api=\{api\} value=\{photo\} onChange=\{setPhoto\} hintKey="fld\.proofHintSale" req=\{trFl\(reqKey\)\} \/>/);
  });
  it('save is the fixed bottom bar with its reason above it', () => {
    expect(f()).toMatch(/<FldCtaBar hint=\{why \? trFl\(why\) : ''\}>/);
    expect(f()).toMatch(/disabled=\{busy \|\| !!why \|\| \(needReason && !noLoc\.trim\(\)\)\} onClick=\{save\}><FldSvg n="check"/);
    expect(shell).toMatch(/onPayBon=\{view\.stop\.sisaBon > 0 && can\.bon \? \(\) => openFor\('bon', fldCustFromStop\(view\.stop\)\) : null\}/);
  });
});

describe('Buka / Tutup rit (mockup Buka rit board) — a sheet over Pengiriman', () => {
  const f = () => fn(day, 'FldOpenRun');
  it('a 118 px sheet: the big ± load, presets, the SOP gauge with its marker, the route-fit bar', () => {
    expect(fn(day, 'FldRitSheet')).toMatch(/<div className="mlap-sheet tall mid" role="dialog" aria-modal="true" aria-label=\{title\} ref=\{drag\.ref\} style=\{drag\.style\}>/);
    expect(f()).toMatch(/<FldStepper label=\{trFl\('fld\.loadQ'\)\} value=\{g\.load\} onChange=\{setLoad\} min=\{0\} max=\{cap \|\| 9999\} cls=\{'big teal' \+ \(g\.under \? ' under' : ''\)\} \/>/);   // the board's + is teal
    expect(f()).toMatch(/className=\{'mlap-preset' \+ \(g\.load === v \? ' on' : ''\)\}/);
    expect(f()).toMatch(/<i style=\{\{ left: gpct\(minLoad\) \+ '%' \}\} \/>/);
    expect(f()).toMatch(/pv\.bar\.map\(\(b, i\) => <span key=\{i\} className=\{b\.fit \? 'on' : ''\} style=\{\{ flex: b\.qty \}\} \/>\)/);
    expect(rule('RIT', '.mlap-preset.on')).toMatch(/border-color: #1A8C87; background: #DDF4F2; color: #0F6B66;/);
    expect(rule('RIT', '.mlap-gauge-bar > span.under')).toMatch(/background: #E8793A;/);
    expect(rule('RIT', '.mlap-fitbar > span.on')).toMatch(/background: #1A8C87;/);
  });
  it('below the SOP: orange reason chips, always asked; the CTA waits for a reason', () => {
    expect(f()).toMatch(/onChange=\{setReason\} tone="warn" \/>/);
    expect(f()).toMatch(/disabled=\{busy \|\| !g\.canOpen \|\| \(g\.under && !reason\.trim\(\)\)\}/);
  });
  it('Tutup rit is the same sheet; a difference still needs what happened', () => {
    const c = fn(day, 'FldCloseRun');
    expect(c).toMatch(/<FldRitSheet title=\{trFl\('fld\.closeRunT', \{ n: run\.runNo \}\)\}/);
    expect(c).toMatch(/disabled=\{busy \|\| \(diff !== 0 && !res\)\}/);
  });
  it('the shell opens it over the board, not as a full-screen task', () => {
    expect(shell).toMatch(/\{ready && view && view\.name === 'run' && <FldOpenRun api=\{api\} ctx=\{ctx\} tick=\{tick\} onDone=\{done\} onBack=\{\(\) => setView\(null\)\} \/>\}/);
    expect(shell).toMatch(/const full = view && \['sale', 'pick',/);
  });
});

describe('Peta (mockup Rute rit board)', () => {
  const f = () => fn(day, 'FldRoute');
  it('a full-bleed map; the OSM attribution moves to the top (the sheet covers the bottom)', () => {
    expect(f()).toMatch(/className="mlap-map mlap-mapfull"/);
    expect(f()).toMatch(/L\.map\(mapEl\.current, \{ zoomControl: false, attributionControl: false \}\);/);
    expect(f()).toMatch(/L\.control\.attribution\(\{ position: 'topright' \}\)\.addTo\(map\);/);
    expect(rule('PETA', '.mlap-mapfull')).toMatch(/position: fixed; inset: 0;/);
  });
  it('a glass bar (rit pill, locate, menu) and a detent sheet 470 / 700 with the figures and the legs', () => {
    expect(f()).toMatch(/<div className="mlap-glass mlap-mappill">/);
    expect(f()).toMatch(/className=\{'mlap-mapsheet' \+ \(open \? ' open' : ''\)\}/);
    expect(f()).toMatch(/aria-expanded=\{open\} onClick=\{\(\) => setOpen\(!open\)\}/);
    expect(f()).toMatch(/className=\{'mlap-legno' \+ \(i === 0 \? ' now' : ''\)\}/);
    expect(rule('PETA', '.mlap-mapsheet')).toMatch(/height: min\(470px, 56vh\);/);
    expect(rule('PETA', '.mlap-mapsheet.open')).toMatch(/height: min\(700px, calc\(100vh - 120px\)\);/);
    expect(rule('PETA', '.mlap-mapsheet')).toMatch(/background: rgba\(248,250,252,\.88\);/);
  });
  it('the warehouse row reads 14 px grey like the board', () => {
    expect(fn(day, 'FldRoute')).toMatch(/<span className="mlap-grow mlap-legdep">\{trFl\('fld\.backToDepot'/);
    expect(rule('PETA', '.mlap-legdep')).toMatch(/font-size: 14px; color: #3E4E58;/);
  });
  it('the route line is solid out and dashed back; the next stop is the filled pin', () => {
    expect(f()).toMatch(/dashArray: '2 7'/);
    expect(f()).toMatch(/'<span class="mlap-pin' \+ \(i === 0 \? ' now' : ''\) \+ '">'/);
  });
  it('the shell drops its header on Peta (the glass bar replaces it) and hands it the menu', () => {
    expect(shell).toMatch(/\{tab !== 'peta' \? \(\s*<div className="mlap-head">/);
    expect(shell).toMatch(/<FldRoute api=\{api\} ctx=\{ctx\} tick=\{tick\} fleet=\{fleet\} onOpenRun=\{\(\) => setView\(\{ name: 'run' \}\)\} onMenu=\{\(\) => setMenu\(true\)\} onAddStop=\{can\.addStop \? \(\) => setView\(\{ name: 'addStop' \}\) : null\} \/>/);
  });
});

describe('Setoran (mockup Selesai board)', () => {
  const f = () => fn(day, 'FldSetoran');
  it('three coloured KPI tiles; the deposit row highlighted; Pengeluaran opens the expense screen; a galon card', () => {
    expect(f()).toMatch(/<div className="mlap-kpi3">/);
    expect(f()).toMatch(/<b className="ok">\{sum\.stops\.terkirim\}<\/b>/);
    expect(f()).toMatch(/<div className="mlap-kv total"><span>\{trFl\('fld\.s_setor'\)\}<\/span><b>\{FIELDLOGIC\.fmtRp\(sum\.wajibSetor\)\}<\/b><\/div>/);
    expect(f()).toMatch(/onExpense \? <button type="button" className="mlap-kv mlap-kvbtn" onClick=\{onExpense\}>/);
    expect(f()).toMatch(/<div className="mlap-card mlap-gal3">/);
    expect(rule('SETORAN', '.mlap-kpi3 b.ok')).toMatch(/color: #1E6B40;/);
  });
  it('unfinished stops pick their reason in a sheet (no <select>), red until chosen', () => {
    expect(f()).not.toMatch(/<select/);
    expect(f()).toMatch(/className=\{'mlap-pickbtn' \+ \(r \? '' : ' miss'\)\}/);
    expect(f()).toMatch(/<FldPickSheet title=\{trFl\('fld\.reasonFor', \{ name: pick\.customerName \}\)\} options=\{opts\}/);
  });
  it('"Tutup hari & setor" is the fixed bar above the dock, its hint red or green', () => {
    expect(f()).toMatch(/<FldCtaBar hint=\{chk\.ok \? <span className="ok">\{trFl\('fld\.allStopsDone'\)\}<\/span> : trFl\('fld\.missingReasons', \{ n: chk\.missing\.length \}\)\}>/);
    expect(f()).toMatch(/<div className="mlap-ctaspace" \/>/);
    expect(rule('SETORAN', '.mlap-swipe .mlap-ctabar')).toMatch(/bottom: calc\(100px \+ env\(safe-area-inset-bottom\)\);/);
  });
  it('the Pengeluaran row keeps the 14 px of the other rows; the fade under the bar starts early so its hint reads', () => {
    expect(rule('SETORAN', '.mlap-kvbtn')).toMatch(/font: inherit; font-size: 14px;/);
    expect(rule('SETORAN', '.mlap-swipe .mlap-ctafade')).toMatch(/rgba\(238,242,246,\.94\) 30%/);
  });
  it('the tab is titled "Setoran hari ini"; the shell hands it Pengeluaran and "Lengkapi"', () => {
    expect(shell).toMatch(/trFl\(tab === 'setoran' \? 'fld\.setoranT' : TAB_LABEL\[tab\]\)/);
    expect(shell).toMatch(/onExpense=\{can\.expense \? \(\) => setView\(\{ name: 'exp' \}\) : null\} onIncomplete=\{goIncomplete\}/);
  });
});
