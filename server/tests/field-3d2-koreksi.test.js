'use strict';
// PLAN 3D-2 KOREKSI + ARMADA (static): Koreksi, Koreksi saya and Armada & SOP laid out to their approved
// mockup boards — every correction still goes to the office, the original stays valid until approved.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const kor = read('dist-field-koreksi.jsx'); const shellSrc = read('dist-field.jsx'); const kit = read('dist-field-kit.jsx'); const css = read('dist-field.css');
const fn = (src, name) => { const i = src.indexOf('function ' + name + '('); expect({ name, found: i > -1 }).toEqual({ name, found: true }); const j = src.indexOf('\nfunction ', i + 10); return src.slice(i, j < 0 ? undefined : j); };
const section = (name) => { const i = css.indexOf('/* ── 3D-2 ' + name); expect({ name, found: i > -1 }).toEqual({ name, found: true }); const j = css.indexOf('/* ── 3D-2 ', i + 10); return css.slice(i, j < 0 ? undefined : j); };
const rule = (name, sel) => { const b = section(name); const i = b.indexOf('\n' + sel + ' {'); expect({ sel, found: i > -1 }).toEqual({ sel, found: true }); return b.slice(i, b.indexOf('}', i)); };

it('parses; never calls the server directly', () => {
  expect(() => parse(kor, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(kor).not.toMatch(/window\.API|fetch\(/);
});

describe('Koreksi (mockup Koreksi boards)', () => {
  const f = () => fn(kor, 'FldKoreksi');
  it('the recorded transaction as a card; "what is wrong" as icon tiles (cancel in red)', () => {
    expect(f()).toMatch(/<div className="mlap-card mlap-txncard">/);
    expect(f()).toMatch(/className=\{'mlap-cat k' \+ \(k === 'batal' \? ' danger' : ''\) \+ \(kind === k \? ' on' : ''\)\}/);
    expect(f()).toMatch(/<FldSvg n=\{FLD_KICO\[k\]\} s=\{19\} \/>/);
    expect(rule('KOREKSI', '.mlap-cat.danger.on')).toMatch(/border-color: #B42318; background: #FDECEA; color: #8C2A20;/);
  });
  it('the impact as struck-through → new rows from the shared logic; reasons are blue chips', () => {
    expect(f()).toMatch(/const impact = kind \? FIELDLOGIC\.koreksiImpact\(\{ kind, t, change, pv \}\) : \[\];/);
    expect(f()).toMatch(/<s>\{fldValText\(r\.type, r\.a\)\}<\/s><FldSvg n="arrowRight" s=\{12\} sw=\{2\.4\} \/><b>\{fldValText\(r\.type, r\.b\)\}<\/b>/);
    expect(f()).not.toMatch(/tone="hold"/);
  });
  it('the request is the fixed bottom bar (red for a cancel) under "stays valid until approved"', () => {
    expect(f()).toMatch(/<FldCtaBar hint=\{<span className="muted">\{trFl\('fld\.kStaysValid'\)\}<\/span>\}>/);
    expect(f()).toMatch(/className=\{'mlap-btn ' \+ \(kind === 'batal' \? 'danger solid' : 'primary'\)\} disabled=\{busy \|\| !!why \|\| !!pvErr \|\| !reason\.trim\(\)\}/);
    expect(rule('KOREKSI', '.mlap-btn.danger.solid')).toMatch(/background: #B42318; color: #FFFFFF;/);
  });
  it('the right customer is picked from radio rows (nearest first, then a search)', () => {
    const c = fn(kor, 'FldKoreksiCust');
    expect(c).toMatch(/className=\{'mlap-pickrow' \+ \(value && value\.id === c\.id \? ' on' : ''\)\}/);
    expect(c).toMatch(/<label className="mlap-searchbox gray">/);
  });
});

describe('Koreksi saya (mockup KoreksiList board)', () => {
  const f = () => fn(kor, 'FldKoreksiSaya');
  it('a read-only page: round back chevron + big title; two segments (waiting / done)', () => {
    expect(fn(kit, 'FldBackHead')).toMatch(/<button type="button" className="mlap-round" aria-label=\{trFl\('fld\.back'\)\} onClick=\{onBack\}><FldSvg n="back"/);
    expect(f()).toMatch(/<FldBackHead onBack=\{onBack\} title=\{trFl\('fld\.kSaya'\)\} \/>/);
    expect(f()).toMatch(/const tabs = list \? FIELDLOGIC\.koreksiTabs\(list\) : \{ wait: \[\], done: \[\] \};/);
    expect(f()).toMatch(/<FldSeg size="sm" label=\{trFl\('fld\.kSaya'\)\} value=\{seg\} onChange=\{setSeg\}/);
  });
  it('each card: status tag, the from → to box, the office decision box, withdraw / resubmit', () => {
    expect(f()).toMatch(/<div className="mlap-fromto">/);
    expect(f()).toMatch(/<div className=\{'mlap-decision ' \+ v\.tone\}>/);
    expect(rule('KSAYA', '.mlap-fromto')).toMatch(/background: #F4F7F9;/);
    expect(rule('KSAYA', '.mlap-kcard .mlap-tag.info')).toMatch(/background: #FCF1D6; color: #7A4B00;/);   // waiting = amber on this board
  });
  it('3C minor: a failed withdraw is said in place — the list stays', () => {
    expect(f()).toMatch(/\.catch\(\(e\) => \{ setAsk\(null\); setMsg\(fldErrMsg\(e\) \|\| trFl\('fld\.kWithdrawErr'\)\); \}\)/);
    expect(f()).not.toMatch(/setAsk\(null\); setErr\(e\);/);
  });
});

describe('Armada & SOP (mockup Armada board)', () => {
  const f = () => fn(shellSrc, 'FldRules');
  it('back chevron + big title + Owner/GM badge; the SOP stepper; each armada with ± (teal +), its bar and the SOP marker', () => {
    expect(f()).toMatch(/<FldBackHead onBack=\{onBack\} title=\{trFl\('fld\.armadaT'\)\} aside=\{<span className="mlap-ownbadge"><FldSvg n="lock"/);
    expect(f()).toMatch(/<div className="mlap-capbar"><span className=\{low \? 'low' : ''\} style=\{\{ width: pct\(c\) \+ '%' \}\} \/><i style=\{\{ left: pct\(r\.ritSop\.minLoad\) \+ '%' \}\} \/><\/div>/);
    expect(f()).toMatch(/className="mlap-step plus teal"/);
    expect(rule('ARMADA', '.mlap-capbar > span.low')).toMatch(/background: #E8793A;/);
    expect(rule('ARMADA', '.mlap-ownbadge')).toMatch(/background: #0E1B24; color: #FFFFFF;/);
  });
  it('save is the fixed bottom bar; the release card stays as it was', () => {
    expect(f()).toMatch(/<FldCtaBar><button type="button" className="mlap-btn primary" disabled=\{busy\} onClick=\{\(\) => save\(\)\}>\{trFl\('fld\.saveRules'\)\}<\/button><\/FldCtaBar>/);
    expect(f()).toMatch(/className="mlap-btn danger" disabled=\{busy \|\| !FLD_SCREENS_READY\}/);
  });
  it('the below-SOP line sits flush under its bar', () => {
    expect(rule('ARMADA', '.mlap-caprow .mlap-warnline')).toMatch(/padding: 0;/);
  });
  it('the finance shell gives it a way back', () => {
    expect(read('finance-shell.jsx')).toMatch(/<window\.FIELD\.RulesScreen fleetList=\{fleet\} canRelease=\{!!user && user\.role === 'owner'\} onSaved=\{\(r\) => setFieldRules\(r\)\} onBack=\{\(\) => go\('dist-dashboard'\)\} \/>/);
  });
});
