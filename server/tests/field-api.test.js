'use strict';
// THE FIELD ADAPTOR — one interface, two implementations: real (server, tagged) and latihan (the phone).
const path = require('path');
const root = path.join(__dirname, '..', '..');
global.RITPLAN = require(path.join(root, 'rit-plan.js'));
const SB = require(path.join(root, 'dist-field-sandbox.js'));
const FA = require(path.join(root, 'dist-field-api.js'));
afterAll(() => { delete global.RITPLAN; });

const FIELD_NAMES = ['context', 'board', 'customers', 'runs', 'ritRoute', 'daySummary', 'myChangeRequests', 'mark', 'sale', 'openRun', 'closeRun', 'setLocation', 'setLocationPhoto', 'setPhone', 'addOrder', 'adjust', 'gallonDamage', 'expense', 'correct', 'void', 'reassign', 'withdraw', 'closeDay', 'upload', 'photo', 'outstanding', 'position', 'customer', 'previewCorrect', 'previewReassign'];
const fakeApi = (over) => {
  const ok = (v) => () => Promise.resolve({ data: v });
  const F = {
    context: ok({ today: '2026-10-01', fleet: 'DK 1', fleets: ['DK 1'], rules: { ritSop: { enabled: false, minLoad: 80 }, fleetCapacity: {}, hargaGantiRugiGalon: 0 }, depot: null, demand: {} }),
    board: ok([{ id: 's1', date: '2026-10-01', fleetId: 'DK 1', customerId: 'c1', status: 'pending', seq: 0 }]),
    customers: ok([{ id: 'c1', name: 'A', armada: 'DK 1', masterPrice: 6000, sisaBon: 0, gallonsHeld: 2 }]),
    runs: ok([]), myChangeRequests: ok([]), outstanding: ok([]),
    ...(over || {}),
  };
  FIELD_NAMES.forEach((m) => { if (!F[m]) F[m] = ok({}); });
  return { API: { distribusi: { field: F } } };
};
const REAL = (over) => FA.real(fakeApi(over).API, { date: '2026-10-01', fleet: 'DK 1' });

it('both adaptors expose exactly the same methods', () => {
  const real = REAL();
  const lat = SB.createSandbox(SB.fromSnapshot({ context: {}, board: [], customers: [], runs: [], myRequests: [] }), {});
  expect(FA.METHODS.length).toBe(33);
  FA.METHODS.forEach((m) => { expect(typeof real[m]).toBe('function'); expect(typeof lat[m]).toBe('function'); });
  expect(real.mode).toBe('asli'); expect(lat.mode).toBe('latihan');
});
it('real unwraps {data} and fills date/fleet', async () => {
  const calls = [];
  const real = REAL({ sale: (b) => { calls.push(b); return Promise.resolve({ data: { id: 't' } }); }, mark: (id, b) => { calls.push([id, b]); return Promise.resolve({ data: {} }); } });
  expect(await real.board()).toEqual([expect.objectContaining({ id: 's1' })]);
  await real.payBon({ customerId: 'c1', payAmount: 1000 });
  expect(calls[0]).toMatchObject({ method: 'pelunasan', txnDate: '2026-10-01', payAmount: 1000 });
  await real.holdStop('s1', 'tutup');
  expect(calls[1]).toEqual(['s1', { status: 'ditunda', reason: 'tutup' }]);
});
it('latihan: snapshot once, persist, reopen from storage, reset re-copies', async () => {
  const storage = FA.memoryStorage();
  const a = await FA.openLatihan({ key: 'u1', real: REAL(), storage, sandbox: SB });
  expect(a.mode).toBe('latihan');
  await a.holdStop('s1', 'tutup');
  const b = await FA.openLatihan({ key: 'u1', real: REAL({ board: () => Promise.reject(new Error('should not re-copy')) }), storage, sandbox: SB });
  expect((await b.board())[0].status).toBe('ditunda');
  await b.reset();
  const c = await FA.openLatihan({ key: 'u1', real: REAL(), storage, sandbox: SB });
  expect((await c.board())[0].status).toBe('pending');
});
it('latihan: yesterday\'s saved copy is never reused — a new day re-copies the real board', async () => {
  const storage = FA.memoryStorage();
  const a = await FA.openLatihan({ key: 'u7', real: REAL(), storage, sandbox: SB, today: '2026-10-01' });
  await a.holdStop('s1', 'tutup');
  const tomorrow = REAL({
    context: () => Promise.resolve({ data: { today: '2026-10-02', fleet: 'DK 1', fleets: ['DK 1'], rules: {}, depot: null, demand: {} } }),
    board: () => Promise.resolve({ data: [{ id: 's9', date: '2026-10-02', fleetId: 'DK 1', customerId: 'c1', status: 'pending', seq: 0 }] }),
  });
  const b = await FA.openLatihan({ key: 'u7', real: tomorrow, storage, sandbox: SB, today: '2026-10-02' });
  expect((await b.board()).map((s) => s.id)).toEqual(['s9']);
  expect((await b.context()).today).toBe('2026-10-02');
  // same day → the saved practice is kept
  const c = await FA.openLatihan({ key: 'u7', real: REAL({ board: () => Promise.reject(new Error('should not re-copy')) }), storage, sandbox: SB, today: '2026-10-02' });
  expect((await c.board()).map((s) => s.id)).toEqual(['s9']);
});
it('latihan: a failed copy stores nothing and reports the error', async () => {
  const storage = FA.memoryStorage();
  await expect(FA.openLatihan({ key: 'u2', real: REAL({ board: () => Promise.reject(Object.assign(new Error('offline'), { offline: true })) }), storage, sandbox: SB })).rejects.toMatchObject({ offline: true });
  expect(await storage.get('u2')).toBeUndefined();
});
it('latihan: phone storage that never answers (seen on some Safari builds) → practice still opens, in memory, flagged not persisted', async () => {
  const hung = { get: () => new Promise(() => {}), set: () => new Promise(() => {}), del: () => new Promise(() => {}) };
  const a = await FA.openLatihan({ key: 'u4', real: REAL(), storage: hung, sandbox: SB, storageTimeoutMs: 20 });
  expect(a.persisted).toBe(false);
  expect((await a.board())[0].id).toBe('s1');
  await a.holdStop('s1', 'tutup');
  expect((await a.board())[0].status).toBe('ditunda');
});
it('latihan: storage that throws → same fallback; working storage → persisted', async () => {
  const broken = { get: () => Promise.reject(new Error('QuotaExceeded')), set: () => Promise.reject(new Error('x')), del: () => Promise.resolve() };
  expect((await FA.openLatihan({ key: 'u5', real: REAL(), storage: broken, sandbox: SB })).persisted).toBe(false);
  expect((await FA.openLatihan({ key: 'u6', real: REAL(), storage: FA.memoryStorage(), sandbox: SB })).persisted).toBe(true);
});
it('latihan: a driver without correction rights (403 on "Koreksi saya") still gets a practice copy', async () => {
  const storage = FA.memoryStorage();
  const denied = () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }));
  const a = await FA.openLatihan({ key: 'u3', real: REAL({ myChangeRequests: denied }), storage, sandbox: SB });
  expect(await a.myChangeRequests()).toEqual([]);
});

describe('who sees what (prefState)', () => {
  const rulesOld = { fieldUiDefault: 'old' }; const rulesNew = { fieldUiDefault: 'new' };
  it('no demo caps → not eligible, old UI', () => {
    expect(FA.prefState({ perms: { distribusiPengiriman: true }, rules: rulesOld, prefs: { ui: 'new' } })).toMatchObject({ eligible: false, ui: 'old' });
  });
  it('rules not loaded yet → treated as not released', () => {
    expect(FA.prefState({ perms: { distribusiPengiriman: true }, rules: null, prefs: {} })).toMatchObject({ eligible: false, ui: 'old' });
  });
  it('Demo latihan only → never Mode asli, even with a stored preference', () => {
    expect(FA.prefState({ perms: { distribusiPengiriman: true, distribusiDemoLatihan: true }, rules: rulesOld, prefs: { ui: 'new', mode: 'asli' } })).toMatchObject({ eligible: true, ui: 'new', mode: 'latihan', canAsli: false });
  });
  it('Demo penuh → both modes; default latihan; lands in the new UI (owner, 3D)', () => {
    const r = FA.prefState({ perms: { distribusiPengiriman: true, distribusiDemoPenuh: true, distribusiDemoLatihan: true }, rules: rulesOld, prefs: {} });
    expect(r).toMatchObject({ eligible: true, ui: 'new', mode: 'latihan', canAsli: true, canLatihan: true });
  });
  it('after release: every field user opens the new UI in Mode asli; latihan stays for demo holders', () => {
    expect(FA.prefState({ perms: { distribusiPengiriman: true }, rules: rulesNew, prefs: {} })).toMatchObject({ eligible: true, ui: 'new', mode: 'asli', canLatihan: false });
    expect(FA.prefState({ perms: { distribusiPengiriman: true, distribusiDemoLatihan: true }, rules: rulesNew, prefs: { mode: 'latihan' } })).toMatchObject({ mode: 'latihan', canAsli: true });
  });
  it('no board cap → nothing', () => {
    expect(FA.prefState({ perms: { distribusiDemoPenuh: true }, rules: rulesNew, prefs: {} }).eligible).toBe(false);
  });
});
it('data gaps (titik, WA, foto)', () => {
  expect(FA.dataGaps({ lat: null, lng: null, phone: '', locationPhotoId: null })).toEqual({ titik: true, wa: true, foto: true, count: 3 });
  expect(FA.dataGaps({ lat: 1, lng: 2, phone: '08', locationPhotoId: 'p' }).count).toBe(0);
});
it('preferences survive a blocked localStorage', () => {
  const saved = global.localStorage;
  global.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  expect(FA.loadPrefs()).toEqual({});
  expect(() => FA.savePrefs({ ui: 'new' })).not.toThrow();
  global.localStorage = saved;
});
describe('Plan 3A adaptor hardening', () => {
  it('29 methods incl. outstanding; real outstanding 403 → []', async () => {
    expect(FA.METHODS).toContain('outstanding');
    expect(FA.METHODS.length).toBe(33);
    const denied = () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }));
    expect(await REAL({ outstanding: denied }).outstanding()).toEqual([]);
    expect(await REAL({ outstanding: () => Promise.resolve({ data: [{ id: 'o1' }], count: 1 }) }).outstanding()).toEqual([{ id: 'o1' }]);
  });
  it('the practice copy includes outstanding (403 → empty)', async () => {
    const denied = () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }));
    const a = await FA.openLatihan({ key: 'p1', real: REAL({ outstanding: denied }), storage: FA.memoryStorage(), sandbox: SB });
    expect(await a.outstanding()).toEqual([]);
  });
  it('practice photos live under their own key, saved only when a photo is added, and survive a reopen', async () => {
    const storage = FA.memoryStorage();
    const a = await FA.openLatihan({ key: 'p2', real: REAL(), storage, sandbox: SB });
    const ph = await a.uploadPhoto({ data: 'data:image/jpeg;base64,BBB' });
    await a.holdStop('s1', 'tutup');
    await new Promise((r) => setTimeout(r, 0));
    expect((await storage.get('p2')).photos[ph.id]).toBe(true);
    expect((await storage.get('p2:photos'))[ph.id]).toBe('data:image/jpeg;base64,BBB');
    const b = await FA.openLatihan({ key: 'p2', real: REAL({ board: () => Promise.reject(new Error('no re-copy')) }), storage, sandbox: SB });
    expect(await b.photo(ph.id)).toBe('data:image/jpeg;base64,BBB');
    await b.reset();
    expect(await storage.get('p2')).toBeUndefined();
    expect(await storage.get('p2:photos')).toBeUndefined();
  });
  it('a save failing mid-session flips persisted and tells the screen', async () => {
    const mem = FA.memoryStorage(); let fail = false; const seen = [];
    const storage = { get: mem.get, del: mem.del, set: (k, v) => (fail ? Promise.reject(new Error('QuotaExceeded')) : mem.set(k, v)) };
    const a = await FA.openLatihan({ key: 'p3', real: REAL(), storage, sandbox: SB, onPersist: (ok) => seen.push(ok) });
    expect(a.persisted).toBe(true);
    fail = true;
    await a.holdStop('s1', 'tutup');
    await new Promise((r) => setTimeout(r, 10));
    expect(a.persisted).toBe(false);
    expect(seen).toEqual([false]);
  });
  it('reset reports a failed delete instead of pretending', async () => {
    const mem = FA.memoryStorage();
    const storage = { get: mem.get, set: mem.set, del: () => Promise.reject(new Error('locked')) };
    const a = await FA.openLatihan({ key: 'p4', real: REAL(), storage, sandbox: SB });
    await expect(a.reset()).rejects.toThrow();
  });
  it('a version-1 copy (Plan 2) is re-copied', async () => {
    const storage = FA.memoryStorage();
    await storage.set('p5', { v: 1, date: '2026-10-01', stops: [], runs: [] });
    const a = await FA.openLatihan({ key: 'p5', real: REAL(), storage, sandbox: SB, today: '2026-10-01' });
    expect((await a.board())[0].id).toBe('s1');
  });
});

describe('driver position', () => {
  it('real posts the fix; practice accepts it and keeps nothing', async () => {
    const calls = [];
    const real = REAL({ position: (b) => { calls.push(b); return Promise.resolve({ data: { ok: true } }); } });
    await real.position({ lat: -8.6, lng: 115.2, accuracy: 12, recordedAt: 1 });
    expect(calls[0]).toEqual({ lat: -8.6, lng: 115.2, accuracy: 12, recordedAt: 1 });
    const lat = SB.createSandbox(SB.fromSnapshot({ context: {}, board: [], customers: [], runs: [], myRequests: [] }), {});
    const before = JSON.stringify(lat.exportState());
    expect(await lat.position({ lat: 1, lng: 2 })).toEqual({ ok: true, practice: true });
    expect(JSON.stringify(lat.exportState())).toBe(before);
  });
});

describe('Plan 3B adaptor', () => {
  it('31 methods incl. customerDetail; real asks the server', async () => {
    expect(FA.METHODS).toContain('customerDetail');
    expect(FA.METHODS.length).toBe(33);
    const real = REAL({ customer: (id) => Promise.resolve({ data: { id, name: 'A', transactions: [] } }) });
    expect(await real.customerDetail('c1')).toEqual({ id: 'c1', name: 'A', transactions: [] });
  });
  it('expenses are always paid in cash from the deposit — a caller cannot change that', async () => {
    const calls = [];
    const real = REAL({ expense: (b) => { calls.push(b); return Promise.resolve({ data: {} }); } });
    await real.addExpense({ amount: 5000, category: 'bensin', method: 'transfer' });
    expect(calls[0].method).toBe('tunai');
  });
});

describe('Plan 3C adaptor', () => {
  it('the previews reach the tagged endpoints; Koreksi saya without the right is an empty list', async () => {
    const calls = [];
    const F = {}; FIELD_NAMES.forEach((m) => { F[m] = (...a) => { calls.push([m, a]); return Promise.resolve({ data: { ok: m } }); }; });
    F.myChangeRequests = () => Promise.reject(Object.assign(new Error('no'), { status: 403 }));
    const real = FA.real({ distribusi: { field: F } }, { date: '2026-10-01', fleet: 'DK 1' });
    expect(await real.previewCorrection('t1', { qty: 1 })).toEqual({ ok: 'previewCorrect' });
    expect(calls.pop()).toEqual(['previewCorrect', ['t1', { qty: 1 }]]);
    expect(await real.previewReassign({ fromCustomerId: 'a' })).toEqual({ ok: 'previewReassign' });
    expect(await real.myChangeRequests()).toEqual([]);
    expect(FA.METHODS).toEqual(expect.arrayContaining(['previewCorrection', 'previewReassign']));
  });
});

describe('Plan 3D: the field view is the default for an account that may use it', () => {
  const base = { distribusiPengiriman: true };
  it('a demo account lands in the new view; an account without field access stays on the old one', () => {
    expect(FA.prefState({ perms: { ...base, distribusiDemoLatihan: true }, rules: {}, prefs: {} }).ui).toBe('new');
    expect(FA.prefState({ perms: { ...base, distribusiDemoPenuh: true }, rules: {}, prefs: {} }).ui).toBe('new');
    expect(FA.prefState({ perms: base, rules: {}, prefs: {} }).ui).toBe('old');
    expect(FA.prefState({ perms: { distribusiDemoPenuh: true }, rules: {}, prefs: {} }).ui).toBe('old');   // no Pengiriman
    expect(FA.prefState({ perms: { ...base, distribusiDemoLatihan: true }, rules: {}, prefs: { ui: 'old' } }).ui).toBe('old');
  });
  it('the old-view choice is not remembered across logins (only the practice/real mode is)', () => {
    const store = {}; const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    const prev = global.localStorage; global.localStorage = ls;
    try {
      FA.savePrefs({ ui: 'old', mode: 'asli' });
      expect(store['airro.dist.fieldUi']).toBeUndefined();
      store['airro.dist.fieldUi'] = 'old';   // left over from an earlier version
      expect(FA.loadPrefs()).toEqual({ mode: 'asli' });
    } finally { global.localStorage = prev; }
  });
});
