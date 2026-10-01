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
