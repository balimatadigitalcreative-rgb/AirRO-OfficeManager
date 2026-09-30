'use strict';
/*
 * PENGIRIMAN LIVE REFRESH — the board must update in place, never blink.
 *
 * The bug (2026-09-30): every realtime `distribusi` event from ANYONE in the company, plus every tab
 * focus / SSE reconnect, bumped refreshKey; the delivery board then set itself to null ("Memuat…"),
 * the Belum-terkirim section unmounted and remounted (scroll jump, selection and search lost), and a
 * proximity-sorted list snapped back to the saved order. These pin the pieces of the fix:
 *   - orderByIds     keeps a route-sorted display order across background reloads;
 *   - createCoalescer turns a burst of events into ONE reload, and can never be starved by a
 *                     steady stream (it does not reset its timer);
 *   - createLatest   lets a late response from an older request be ignored.
 * The last block pins the wiring in distribution.jsx (static, like the other client guards).
 */
const fs = require('fs');
const path = require('path');
const DL = require('../../dist-live.js');

describe('orderByIds', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('returns the rows unchanged when there is no order to keep', () => {
    expect(DL.orderByIds(rows, null)).toBe(rows);
    expect(DL.orderByIds(rows, [])).toBe(rows);
  });

  it('applies the kept order to fresh rows (the server returned them in saved seq)', () => {
    expect(DL.orderByIds(rows, ['c', 'a', 'd', 'b']).map((r) => r.id)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('never drops a row: stops new since the route was computed trail in server order', () => {
    const fresh = rows.concat([{ id: 'e' }]);
    expect(DL.orderByIds(fresh, ['d', 'b']).map((r) => r.id)).toEqual(['d', 'b', 'a', 'c', 'e']);
  });

  it('ignores ids that are no longer on the board', () => {
    expect(DL.orderByIds(rows, ['x', 'b', 'a']).map((r) => r.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('carries the fresh row objects (new status), not stale ones', () => {
    const fresh = [{ id: 'a', status: 'terkirim' }, { id: 'b', status: 'pending' }];
    const out = DL.orderByIds(fresh, ['b', 'a']);
    expect(out[1]).toBe(fresh[0]);
  });
});

describe('createCoalescer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs once for a burst of triggers', () => {
    const fn = jest.fn();
    const c = DL.createCoalescer(fn, 1200);
    c.trigger(); c.trigger(); c.trigger();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is not starved by a steady stream of events (the timer is not reset)', () => {
    const fn = jest.fn();
    const c = DL.createCoalescer(fn, 1200);
    for (let t = 0; t < 3000; t += 300) { c.trigger(); jest.advanceTimersByTime(300); }
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('cancel() drops a pending run (unmount)', () => {
    const fn = jest.fn();
    const c = DL.createCoalescer(fn, 1200);
    c.trigger(); c.cancel();
    jest.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('createLatest', () => {
  it('only the most recent request is current', () => {
    const l = DL.createLatest();
    const t1 = l.next();
    const t2 = l.next();
    expect(l.isCurrent(t1)).toBe(false);
    expect(l.isCurrent(t2)).toBe(true);
  });
});

describe('wiring in the Pengiriman screen', () => {
  const jsx = fs.readFileSync(path.join(__dirname, '..', '..', 'distribution.jsx'), 'utf8');
  const between = (a, b) => { const s = jsx.indexOf(a); return jsx.slice(s, jsx.indexOf(b, s)); };
  const deliveries = between('function DistDeliveries(', 'function CloseoutModal(');
  const outstanding = between('function OutstandingSection(', 'function DriverWatch(');

  it('the board blanks only for a different day/armada, not on a refreshKey bump', () => {
    // The loading state belongs to [ef, date]; the refresh key reloads silently.
    expect(deliveries).toMatch(/uEx\(\(\) => \{ setBoard\(null\);[^\n]*\}, \[ef, date\]\);/);
    expect(deliveries).not.toMatch(/setBoard\(null\);[^\n]*\[refreshKey/);
    expect(deliveries).toMatch(/useLiveKey\(refreshKey\)/);
  });

  it('a route-sorted board keeps its order across reloads', () => {
    expect(deliveries).toMatch(/DISTLIVE\.orderByIds\(/);
  });

  it('late responses are ignored', () => {
    expect(deliveries).toMatch(/isCurrent\(/);
    expect(outstanding).toMatch(/isCurrent\(/);
  });

  it('Belum terkirim resets selection/search only for a different armada/day', () => {
    expect(outstanding).toMatch(/uEx\(\(\) => \{ setRes\(null\); setSel\(\{\}\); setQ\(''\);[^}]*\}, \[ef, today\]\);/);
    expect(outstanding).not.toMatch(/setRes\(null\);[^\n]*refreshKey\]/);
  });

  it('children get the coalesced key, not the raw one', () => {
    expect(deliveries).toMatch(/<OutstandingSection[^>]*refreshKey=\{liveKey\}/);
    expect(deliveries).toMatch(/<RunPanel[^>]*refreshKey=\{liveKey\}/);
  });

  it('dist-live.js is in the bundle before distribution.jsx', () => {
    const build = fs.readFileSync(path.join(__dirname, '..', '..', 'build.mjs'), 'utf8');
    const a = build.indexOf("'dist-live.js'"); const b = build.indexOf("'distribution.jsx'");
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
  });
});
