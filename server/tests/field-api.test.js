'use strict';
// THE FIELD ADAPTOR — one interface, two implementations: real (server, tagged) and latihan (the phone).
const path = require('path');
const root = path.join(__dirname, '..', '..');
global.RITPLAN = require(path.join(root, 'rit-plan.js'));
const SB = require(path.join(root, 'dist-field-sandbox.js'));
const FA = require(path.join(root, 'dist-field-api.js'));
afterAll(() => { delete global.RITPLAN; });

const FIELD_NAMES = ['context', 'board', 'customers', 'runs', 'ritRoute', 'daySummary', 'myChangeRequests', 'mark', 'sale', 'openRun', 'closeRun', 'setLocation', 'setLocationPhoto', 'setPhone', 'addOrder', 'adjust', 'gallonDamage', 'expense', 'correct', 'void', 'reassign', 'withdraw', 'closeDay', 'upload', 'photo'];
const fakeApi = (over) => {
  const ok = (v) => () => Promise.resolve({ data: v });
  const F = {
    context: ok({ today: '2026-10-01', fleet: 'DK 1', fleets: ['DK 1'], rules: { ritSop: { enabled: false, minLoad: 80 }, fleetCapacity: {}, hargaGantiRugiGalon: 0 }, depot: null, demand: {} }),
    board: ok([{ id: 's1', date: '2026-10-01', fleetId: 'DK 1', customerId: 'c1', status: 'pending', seq: 0 }]),
    customers: ok([{ id: 'c1', name: 'A', armada: 'DK 1', masterPrice: 6000, sisaBon: 0, gallonsHeld: 2 }]),
    runs: ok([]), myChangeRequests: ok([]),
    ...(over || {}),
  };
  FIELD_NAMES.forEach((m) => { if (!F[m]) F[m] = ok({}); });
  return { API: { distribusi: { field: F } } };
};
const REAL = (over) => FA.real(fakeApi(over).API, { date: '2026-10-01', fleet: 'DK 1' });

it('both adaptors expose exactly the same methods', () => {
  const real = REAL();
  const lat = SB.createSandbox(SB.fromSnapshot({ context: {}, board: [], customers: [], runs: [], myRequests: [] }), {});
  expect(FA.METHODS.length).toBe(28);
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
  it('Demo penuh → both modes; default latihan; old UI until chosen', () => {
    const r = FA.prefState({ perms: { distribusiPengiriman: true, distribusiDemoPenuh: true, distribusiDemoLatihan: true }, rules: rulesOld, prefs: {} });
    expect(r).toMatchObject({ eligible: true, ui: 'old', mode: 'latihan', canAsli: true, canLatihan: true });
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
