'use strict';
/*
 * The REAL cloud.js, driven by a fake clock: how many /state polls and full resyncs does one open tab
 * produce? This is the behaviour behind request-volume.test.js's static checks.
 *   - stream connected, tab visible:   the /state net runs every 30s (was every 5s);
 *   - tab hidden:                      no polling at all;
 *   - stream first opens (page load):  no resync — the app has just loaded everything;
 *   - flicking back to the tab / flaky reconnects: at most one resync per 30s.
 */
const path = require('path');

function boot() {
  jest.useFakeTimers();
  const listeners = {};
  let es = null;
  const counts = { poll: 0, focus: [] };
  global.document = { hidden: false, visibilityState: 'visible', addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const store = {};
  global.localStorage = { get length() { return Object.keys(store).length; }, key: (i) => Object.keys(store)[i], getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  global.EventSource = class { constructor() { es = this; this.readyState = 0; } close() { this.readyState = 2; } };
  global.window = global;
  global.FS = {};
  global.API = {
    BASE: 'http://x/api/v1', getToken: () => 'tok', setToken() {},
    me: async () => ({ id: 'u1', role: 'owner', name: 'O' }),
    state: { all: async () => { counts.poll++; return { data: {}, meta: {}, now: new Date().toISOString() }; }, set: async () => ({}) },
  };
  window.API = global.API;
  jest.isolateModules(() => require(path.join(__dirname, '..', '..', 'cloud.js')));
  window.CLOUD.onEvent = (evt) => { if (evt.entity === 'focus') counts.focus.push(evt.action); };
  const open = () => { es.readyState = 1; es.onopen && es.onopen(); };
  const drop = () => { es.readyState = 0; };
  const visible = (v) => { document.hidden = !v; document.visibilityState = v ? 'visible' : 'hidden'; (listeners.visibilitychange || []).forEach((fn) => fn()); };
  return { counts, open, drop, visible };
}
afterEach(() => { jest.useRealTimers(); ['document', 'localStorage', 'EventSource', 'API', 'CLOUD', 'FS'].forEach((k) => { delete global[k]; }); });

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

it('a visible tab with a live stream polls /state about twice a minute, not twelve times', async () => {
  const t = boot();
  await window.CLOUD.restore(); await flush();
  t.open(); await flush();
  const base = t.counts.poll;
  for (let s = 0; s < 60; s += 5) { jest.advanceTimersByTime(5000); await flush(); }
  expect(t.counts.poll - base).toBeLessThanOrEqual(2);
});

it('with the stream DOWN the 5s safety net is back in full', async () => {
  const t = boot();
  await window.CLOUD.restore(); await flush();
  t.drop();
  const base = t.counts.poll;
  for (let s = 0; s < 60; s += 5) { jest.advanceTimersByTime(5000); await flush(); }
  expect(t.counts.poll - base).toBeGreaterThanOrEqual(10);
});

it('a hidden tab does not poll', async () => {
  const t = boot();
  await window.CLOUD.restore(); await flush();
  t.drop();
  t.visible(false);
  const base = t.counts.poll;
  for (let s = 0; s < 60; s += 5) { jest.advanceTimersByTime(5000); await flush(); }
  expect(t.counts.poll - base).toBe(0);
});

it('the first stream open (page load) does not trigger a full resync', async () => {
  const t = boot();
  await window.CLOUD.restore(); await flush();
  t.open(); await flush();
  expect(t.counts.focus).toEqual([]);
});

it('ten quick returns to the tab within a minute → at most two full resyncs', async () => {
  const t = boot();
  await window.CLOUD.restore(); await flush();
  t.open(); await flush();
  jest.advanceTimersByTime(31000);
  for (let i = 0; i < 10; i++) { t.visible(false); t.visible(true); jest.advanceTimersByTime(3000); await flush(); }
  expect(t.counts.focus.length).toBeGreaterThanOrEqual(1);
  expect(t.counts.focus.length).toBeLessThanOrEqual(2);
});

it('a flaky connection reconnecting every few seconds does not resync on every reconnect', async () => {
  const t = boot();
  await window.CLOUD.restore(); await flush();
  t.open(); await flush();
  jest.advanceTimersByTime(31000);
  for (let i = 0; i < 6; i++) { t.drop(); t.open(); jest.advanceTimersByTime(4000); await flush(); }
  expect(t.counts.focus.length).toBe(1);
});
