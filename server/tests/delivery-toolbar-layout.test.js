'use strict';
/*
 * PENGIRIMAN SCREEN LAYOUT on phones — static guards on the source, like the other client pins.
 *
 * Three regressions this holds shut:
 *   1. the four-button delivery toolbar was sticky and, wrapped to two rows, covered a third of the
 *      screen over the list — it must scroll away (is-flow), with "Selesai Kerja" repeated at the end;
 *   2. the sticky search toolbars elsewhere let rows show through .content's padding strip above them;
 *   3. the bulk "Belum terkirim" bar was docked at bottom:12px UNDER the fixed bottom nav (z 40).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const jsx = fs.readFileSync(path.join(root, 'distribution.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'finance.css'), 'utf8');

const deliveriesSrc = () => {
  const start = jsx.indexOf('function DistDeliveries(');
  const end = jsx.indexOf('function CloseoutModal(', start);
  return jsx.slice(start, end);
};

describe('delivery toolbar does not cover the list', () => {
  it('the Pengiriman toolbar opts out of sticky', () => {
    expect(deliveriesSrc()).toMatch(/className="dist-tx-toolbar is-flow"/);
    expect(css).toMatch(/\.dist-tx-toolbar\.is-flow\s*\{[^}]*position:\s*static/);
  });

  it('the day-close action is repeated below the list, under the same conditions', () => {
    const src = deliveriesSrc();
    expect(src).toMatch(/dist-close-foot/);
    // Same gate as the toolbar button: never offer closing a day that is closed or has no fleet.
    expect(src).toMatch(/canClose && closeFleet && !closedFor && board !== null && rows\.length > 0 && \(\s*<div className="dist-close-foot/);
    expect(css).toMatch(/\.dist-close-foot\s*\{\s*display:\s*none/);
  });

  it('other sticky toolbars cover the padding strip above them', () => {
    expect(css).toMatch(/\.dist-tx-toolbar\s*\{[^}]*position:\s*sticky[^}]*box-shadow:\s*0 -12px 0 var\(--surface\)/);
  });
});

describe('Belum terkirim can be folded away', () => {
  const src = (() => { const s = jsx.indexOf('function OutstandingSection('); return jsx.slice(s, jsx.indexOf('function DriverWatch(', s)); })();

  it('starts folded and remembers the choice per device (storage failures fall back to folded)', () => {
    expect(src).toMatch(/localStorage\.getItem\(CARRY_OPEN_KEY\) === '1'; \} catch \(e\) \{ return false; \}/);
    expect(src).toMatch(/try \{ localStorage\.setItem\(CARRY_OPEN_KEY/);
  });

  it('the header is a real toggle button that says whether it is open', () => {
    expect(src).toMatch(/<button type="button" className="dist-carry-toggle" aria-expanded=\{open\}/);
  });

  it('folded, the rows, the search and the bulk bar are not rendered — only the count line', () => {
    expect(src).toMatch(/\{open && <div className="dist-carry-search">/);
    expect(src).toMatch(/\{open && \(\s*<>\s*<div className="dist-carry-selrow">/);
  });
});

describe('bulk carry bar is reachable on phones', () => {
  it('docks above the fixed bottom nav, not under it', () => {
    const m = css.match(/@media \(max-width: 640px\)\s*\{[\s\S]*?\.dist-carry-bar\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    const bottom = m[1].match(/bottom:\s*calc\((\d+)px/);
    expect(bottom && +bottom[1]).toBeGreaterThanOrEqual(70);   // bottom nav is ~62px tall
    const z = m[1].match(/z-index:\s*(\d+)/);
    expect(z && +z[1]).toBeGreaterThan(40);                    // .mobile-nav is z-index 40
  });
});
