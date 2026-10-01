'use strict';
// FIELD SCREEN LOGIC — everything the day screens decide, as pure functions tested in Node.
const path = require('path');
const root = path.join(__dirname, '..', '..');
const L = require(path.join(root, 'dist-field-logic.js'));
const { planRit } = require(path.join(root, 'rit-plan.js'));
const FA = require(path.join(root, 'dist-field-api.js'));

const stop = (o) => Object.assign({ id: 's', date: '2026-10-01', fleetId: 'DK 1', customerId: 'c', seq: 0, status: 'pending', qty: null, pinned: false, source: 'jadwal', customerName: 'X', phone: '0812', lat: -8.6, lng: 115.2, locationPhotoId: 'p', sisaBon: 0, mapsLink: 'm' }, o);

describe('formatting + gaps', () => {
  it('rupiah and km in Indonesian style', () => {
    expect(L.fmtRp(45000)).toBe('Rp 45.000');
    expect(L.fmtRp(-5000)).toBe('−Rp 5.000');
    expect(L.fmtKm(0.43)).toBe('0,4 km');
    expect(L.fmtKm(11.4)).toBe('11,4 km');
  });
  it('gaps agree with the adaptor\'s rule', () => {
    [{ lat: null, lng: null, phone: '', locationPhotoId: null }, { lat: 1, lng: 2, phone: '08', locationPhotoId: 'p' }, { lat: 1, lng: 2, phone: '', locationPhotoId: null }]
      .forEach((c) => expect(L.gapsOf(c)).toEqual(FA.dataGaps(c)));
  });
});

describe('boardView', () => {
  const board = [
    stop({ id: 'a', customerId: 'ca', seq: 0, customerName: 'A' }),
    stop({ id: 'b', customerId: 'cb', seq: 1, customerName: 'B', lat: null, lng: null, mapsLink: '', phone: '' }),
    stop({ id: 'c', customerId: 'cc', seq: 2, customerName: 'C', status: 'terkirim' }),
    stop({ id: 'd', customerId: 'cd', seq: 3, customerName: 'D', status: 'ditunda', pendingReason: 'tutup' }),
    stop({ id: 'e', customerId: 'ce', seq: 4, customerName: 'E' }),
  ];
  const customers = [{ id: 'ca', gallonsHeld: 6, address: 'Jl. A' }, { id: 'ce', gallonsHeld: null }];
  it('splits, counts, flags gaps and stops outside the route', () => {
    const v = L.boardView({ board, customers, route: null, outstanding: [], demand: { a: 4 } });
    expect(v.counts).toEqual({ pending: 3, done: 1, held: 1 });
    expect(v.pending.map((s) => s.id)).toEqual(['a', 'b', 'e']);
    expect(v.outsideRoute).toBe(1);
    expect(v.incomplete).toBe(1);
    expect(v.next.id).toBe('a');
    const a = v.stops.find((s) => s.id === 'a');
    expect(a).toMatchObject({ gallonsHeld: 6, address: 'Jl. A', planQty: 4 });
    expect(v.stops.find((s) => s.id === 'e').gallonsHeld).toBeNull();
  });
  it('with an open route: route order first, next = first leg, plan qty and leg km from the route', () => {
    const route = { rit: [{ id: 'e', qty: 5, legKm: 0.4 }, { id: 'a', qty: 3, legKm: 1.2 }] };
    const v = L.boardView({ board, customers, route, outstanding: [], demand: {} });
    expect(v.pending.map((s) => s.id)).toEqual(['e', 'a', 'b']);
    expect(v.next).toMatchObject({ id: 'e', planQty: 5, legKm: 0.4, routeIdx: 0 });
  });
  it('nothing to deliver → no next', () => {
    expect(L.boardView({ board: [stop({ status: 'terkirim' })], customers: [] }).next).toBeNull();
  });
});

describe('rits', () => {
  it('runState: open today, stale from yesterday, next number', () => {
    const runs = [{ id: 'r1', date: '2026-10-01', runNo: 1, status: 'closed', gallonsOut: 80, sold: 80 }, { id: 'r2', date: '2026-10-01', runNo: 2, status: 'open', gallonsOut: 80, sold: 6 }];
    expect(L.runState({ today: '2026-10-01', openRun: null, runs })).toMatchObject({ stale: false, nextNo: 3, remaining: 74, count: 2 });
    expect(L.runState({ today: '2026-10-01', openRun: null, runs })).toHaveProperty('open.id', 'r2');
    const y = L.runState({ today: '2026-10-01', openRun: { id: 'r9', date: '2026-09-30', runNo: 2, status: 'open', gallonsOut: 80, sold: 70 }, runs: [] });
    expect(y).toMatchObject({ stale: true, nextNo: 1, remaining: 10 });
    expect(L.runState({ today: '2026-10-01', openRun: null, runs: [] })).toMatchObject({ open: null, stale: false, nextNo: 1 });
  });
  it('runGauge: under SOP needs a reason, over capacity cannot open', () => {
    expect(L.runGauge({ load: 64, capacity: 120, minLoad: 80 })).toMatchObject({ under: true, over: false, canOpen: true, max: 120 });
    expect(L.runGauge({ load: 121, capacity: 120, minLoad: 80 })).toMatchObject({ over: true, canOpen: false });
    expect(L.runGauge({ load: 120, capacity: 120, minLoad: 80 })).toMatchObject({ atCap: true, under: false });
    expect(L.runGauge({ load: 0, capacity: 0, minLoad: 80 })).toMatchObject({ canOpen: false, max: 160 });
  });
  it('loadPreview plans with the real rit planner; no depot → null', () => {
    const stops = [{ id: 'a', lat: -8.66, lng: 115.21, qty: 30 }, { id: 'b', lat: -8.64, lng: 115.19, qty: 40 }, { id: 'c', lat: null, lng: null, qty: 5 }];
    expect(L.loadPreview({ planRit, depot: { lat: -8.65, lng: 115.2 }, stops, load: 60 })).toMatchObject({ fits: 1, leftoverGallons: 40, estRits: 1, unlocated: 1 });
    expect(L.loadPreview({ planRit, depot: null, stops, load: 60 })).toBeNull();
  });
});

describe('sale', () => {
  it('preview per method', () => {
    expect(L.salePreview({ qty: 4, price: 18000, method: 'lunas', sisaBon: 45000 })).toEqual({ subtotal: 72000, paidNow: 72000, sisaAfter: 45000, totalKey: 'fld.cashIn' });
    expect(L.salePreview({ qty: 4, price: 18000, method: 'bon', sisaBon: 45000 })).toEqual({ subtotal: 72000, paidNow: 0, sisaAfter: 117000, totalKey: 'fld.paidNow' });
    expect(L.salePreview({ qty: 4, price: 18000, method: 'transfer', sisaBon: 0 }).totalKey).toBe('fld.transferred');
  });
  it('body per method, proof fields only when known', () => {
    const photo = { id: 'p1', takenAt: '2026-10-01T02:04:00.000Z', lat: -8.6, lng: 115.2 };
    expect(L.saleBody({ customerId: 'c', qty: 4, gallonIn: 6, method: 'transfer', photo })).toEqual({ customerId: 'c', qty: 4, gallonOut: 4, gallonIn: 6, method: 'lunas', payMethod: 'transfer', proofPhotoId: 'p1', proofTakenAt: '2026-10-01T02:04:00.000Z', proofLat: -8.6, proofLng: 115.2 });
    expect(L.saleBody({ customerId: 'c', qty: 1, gallonIn: 0, method: 'bon', photo: { id: 'p2', takenAt: 't', lat: null, lng: null } })).toEqual({ customerId: 'c', qty: 1, gallonOut: 1, gallonIn: 0, method: 'bon', proofPhotoId: 'p2', proofTakenAt: 't' });
    expect(L.saleBody({ customerId: 'c', qty: 1, gallonIn: 0, method: 'lunas', photo: null }).payMethod).toBe('tunai');
  });
  it('canSaveSale: a photo is always required in the new UI', () => {
    expect(L.canSaveSale({ qty: 0, photo: { id: 'p' } })).toBe('fld.needQty');
    expect(L.canSaveSale({ qty: 2, photo: null })).toBe('fld.needPhoto');
    expect(L.canSaveSale({ qty: 2, photo: { id: 'p' } })).toBe('');
  });
});

describe('recordSale never creates a sale twice', () => {
  const api = (markResults) => {
    const calls = { create: 0, mark: [] };
    return { calls, createSale: () => { calls.create += 1; return Promise.resolve({ id: 't' + calls.create }); },
      markStop: (id, b) => { calls.mark.push(b); const r = markResults.shift(); return r === 'ok' ? Promise.resolve({}) : Promise.reject(r); } };
  };
  const posErr = Object.assign(new Error('pos'), { body: { error: { message: 'Aktifkan lokasi', details: { code: 'POSITION_REQUIRED' } } } });
  it('POSITION_REQUIRED → ask for a reason, then retry only the marking', async () => {
    const a = api([posErr, 'ok']);
    const r1 = await L.recordSale(a, { stopId: 's1', body: { qty: 1 } });
    expect(r1).toEqual({ txnId: 't1', done: false, needReason: true });
    const r2 = await L.recordSale(a, { stopId: 's1', body: { qty: 1 }, txnId: r1.txnId, noLocationReason: 'GPS mati' });
    expect(r2).toEqual({ txnId: 't1', done: true });
    expect(a.calls.create).toBe(1);
    expect(a.calls.mark[1]).toEqual({ status: 'terkirim', transactionId: 't1', noLocationReason: 'GPS mati' });
  });
  it('a network error after the sale carries the saved id so the retry does not re-create it', async () => {
    const a = api([Object.assign(new Error('offline'), { offline: true }), 'ok']);
    let saved = null;
    await L.recordSale(a, { stopId: 's1', body: {} }).catch((e) => { saved = e.txnId; });
    expect(saved).toBe('t1');
    await L.recordSale(a, { stopId: 's1', body: {}, txnId: saved });
    expect(a.calls.create).toBe(1);
  });
});

it('closeCheck lists every pending stop still without a reason', () => {
  const pending = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  expect(L.closeCheck(pending, { a: 'Toko tutup', b: '  ' })).toEqual({ missing: ['b', 'c'], ok: false });
  expect(L.closeCheck([], {})).toEqual({ missing: [], ok: true });
});

describe('final review fixes', () => {
  const memStore = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, m }; };
  it('pendingSales remembers a saved-but-unmarked sale per stop, across screen visits', () => {
    const st = memStore();
    const a = L.pendingSales(st, 'k1');
    expect(a.get('s1')).toBeNull();
    a.set('s1', 't9');
    expect(L.pendingSales(st, 'k1').get('s1')).toBe('t9');   // a new screen visit sees it
    expect(L.pendingSales(st, 'k2').get('s1')).toBeNull();   // another mode/user key does not
    a.clear('s1');
    expect(a.get('s1')).toBeNull();
  });
  it('pendingSales survives a storage that throws (private mode) by remembering in memory', () => {
    const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    const a = L.pendingSales(bad, 'k');
    a.set('s1', 't1');
    expect(a.get('s1')).toBe('t1');
  });
  it('stepInput lets a field be cleared while typing and clamps only real numbers', () => {
    expect(L.stepInput('', 1, 999)).toEqual({ draft: '', value: null });
    expect(L.stepInput('4', 1, 999)).toEqual({ draft: '4', value: 4 });
    expect(L.stepInput('0', 1, 999)).toEqual({ draft: '0', value: null });
    expect(L.stepInput('12a3', 0, 999)).toEqual({ draft: '123', value: 123 });
    expect(L.stepInput('5000', 0, 120)).toEqual({ draft: '120', value: 120 });
  });
});
