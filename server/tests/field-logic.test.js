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

describe('Plan 3B logic', () => {
  it('newRef is long and unique', () => {
    const a = L.newRef(); const b = L.newRef();
    expect(a.length).toBeGreaterThanOrEqual(16); expect(a).not.toBe(b);
  });
  const custs = [
    { id: '1', name: 'Warung Bu Sari', code: 'C-0516', phone: '0812', lat: 1, lng: 2, locationPhotoId: null, sisaBon: 126000, fixedDays: false, active: true },
    { id: '2', name: 'Hotel Sanur Asri', code: 'C-0402', phone: '0813', lat: 1, lng: 2, locationPhotoId: 'p', sisaBon: 0, fixedDays: true, active: true },
    { id: '3', name: 'Pak Wayan', code: 'C-0511', phone: '', lat: null, lng: null, locationPhotoId: null, sisaBon: 45000, fixedDays: false, active: true },
  ];
  it('customerList: counts, filters, search by name / code / phone digits, sorted by name', () => {
    const all = L.customerList(custs, { q: '', filter: 'all' });
    expect(all.counts).toEqual({ all: 3, warn: 2, bon: 2, fixed: 1 });
    expect(all.rows.map((r) => r.id)).toEqual(['2', '3', '1']);
    expect(L.customerList(custs, { filter: 'warn' }).rows.map((r) => r.id)).toEqual(['3', '1']);
    expect(L.customerList(custs, { filter: 'fixed' }).rows.map((r) => r.id)).toEqual(['2']);
    expect(L.customerList(custs, { q: 'c-0511' }).rows.map((r) => r.id)).toEqual(['3']);
    expect(L.customerList(custs, { q: '0813' }).rows.map((r) => r.id)).toEqual(['2']);
  });
  it('openBons: payments settle the oldest bon first', () => {
    const txns = [
      { id: 'p1', txnDate: '2026-09-25', method: 'pelunasan', amount: 9000, status: 'active' },
      { id: 'b2', txnDate: '2026-09-23', method: 'bon', qty: 3, effectiveAmount: 54000, status: 'active' },
      { id: 'b1', txnDate: '2026-09-16', method: 'bon', qty: 1, effectiveAmount: 18000, status: 'active' },
      { id: 'bv', txnDate: '2026-09-10', method: 'bon', qty: 9, effectiveAmount: 99000, status: 'void' },
    ];
    expect(L.openBons(txns)).toEqual([
      { id: 'b1', txnDate: '2026-09-16', qty: 1, amount: 9000, partial: true },
      { id: 'b2', txnDate: '2026-09-23', qty: 3, amount: 54000, partial: false },
    ]);
  });
  it('payPreview: never more than the bon', () => {
    expect(L.payPreview({ sisaBon: 45000, pay: 20000 })).toEqual({ rest: 25000, over: 0, ok: true });
    expect(L.payPreview({ sisaBon: 45000, pay: 50000 })).toEqual({ rest: 0, over: 5000, ok: false });
    expect(L.payPreview({ sisaBon: 45000, pay: 0 }).ok).toBe(false);
  });
  it('adjustBody maps the shown reason to the server list and keeps the shown words in the note', () => {
    expect(L.adjustBody({ counted: 8, reasonKey: 'fld.adj_kembali', reasonLabel: 'Dikembalikan pelanggan', note: '2 galon', photo: { id: 'p9' } }))
      .toEqual({ value: 8, reason: 'rekonsiliasi_fisik', note: 'Dikembalikan pelanggan · 2 galon', evidenceUrl: 'p9' });
    expect(L.adjustBody({ counted: 5, reasonKey: 'fld.adj_salah', reasonLabel: 'Salah input kemarin', note: '', photo: null }))
      .toEqual({ value: 5, reason: 'salah_input', note: 'Salah input kemarin' });
  });
  it('damagePreview explains instead of failing', () => {
    expect(L.damagePreview({ qty: 2, price: 45000, held: 6, payMethod: 'tunai' })).toEqual({ total: 90000, heldAfter: 4, blocked: '', totalKey: 'fld.cashIn' });
    expect(L.damagePreview({ qty: 1, price: 0, held: 6, payMethod: 'tunai' }).blocked).toBe('fld.dmgNoPrice');
    expect(L.damagePreview({ qty: 1, price: 45000, held: 0, payMethod: 'bon' }).blocked).toBe('fld.dmgNoHeld');
    expect(L.damagePreview({ qty: 1, price: 45000, held: 3, payMethod: 'bon' }).totalKey).toBe('fld.toBon');
  });
  it('expenseBody: cash is implied, fuel litres + odometer go into the note', () => {
    expect(L.expenseBody({ category: 'bensin', amount: 150000, liters: '15', odometer: '45210', note: 'Pertalite', photo: { id: 'p1' } }))
      .toEqual({ amount: 150000, category: 'bensin', note: '15 L · odometer 45210 km · Pertalite', photoId: 'p1' });
    expect(L.expenseBody({ category: 'parkir', amount: 5000, note: '', photo: null })).toEqual({ amount: 5000, category: 'parkir', note: '' });
  });
  it('pinMove: metres from the phone and the 150 m warning', () => {
    expect(L.pinMove({ device: null, pin: { lat: 1, lng: 1 } })).toEqual({ meters: null, far: false });
    const near = L.pinMove({ device: { lat: -8.65, lng: 115.2 }, pin: { lat: -8.6505, lng: 115.2 } });
    expect(near.meters).toBeGreaterThan(50); expect(near.meters).toBeLessThan(60); expect(near.far).toBe(false);
    expect(L.pinMove({ device: { lat: -8.65, lng: 115.2 }, pin: { lat: -8.652, lng: 115.2 } }).far).toBe(true);
  });
  it('addStopCandidates: today\'s stops without a pin + active customers not on today\'s board', () => {
    const board = [{ id: 's1', customerId: '3', status: 'pending', lat: null, lng: null }, { id: 's2', customerId: '1', status: 'pending', lat: 1, lng: 2 }];
    const r = L.addStopCandidates({ board, customers: custs.concat([{ id: '4', name: 'Nonaktif', active: false }]), q: '' });
    expect(r.noPin.map((s) => s.id)).toEqual(['s1']);
    expect(r.others.map((c) => c.id)).toEqual(['2']);
    expect(L.addStopCandidates({ board, customers: custs, q: 'zzz' }).others).toEqual([]);
  });
  it('a manual sale (no stop) is created once and never marks a stop', async () => {
    let marks = 0;
    const api = { createSale: () => Promise.resolve({ id: 't1' }), markStop: () => { marks += 1; return Promise.resolve(); } };
    expect(await L.recordSale(api, { stopId: null, body: {} })).toEqual({ txnId: 't1', done: true });
    expect(marks).toBe(0);
    expect(L.saleBody({ customerId: 'c', qty: 1, gallonIn: 0, method: 'lunas', photo: null, clientRef: 'r-123456789' }).clientRef).toBe('r-123456789');
  });
});

describe('Final review fixes (logic)', () => {
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, m }; };
  it('refStore: the same slot keeps ONE ref across screen visits until the save succeeds', () => {
    const st = mem();
    const r1 = L.refStore(st, 'k').take('bon:c1');
    expect(r1).toMatch(/^f[0-9a-z]{8,}$/);
    expect(L.refStore(st, 'k').take('bon:c1')).toBe(r1);          // left the screen and came back: same ref
    expect(L.refStore(st, 'k').take('bon:c2')).not.toBe(r1);      // another customer: its own ref
    L.refStore(st, 'k').done('bon:c1');
    expect(L.refStore(st, 'k').take('bon:c1')).not.toBe(r1);      // after success a new payment gets a new ref
    const blocked = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    const b = L.refStore(blocked, 'k'); const x = b.take('exp'); expect(b.take('exp')).toBe(x);   // blocked storage → memory
  });
  it('pinStart: old pin, else the phone, else the warehouse — a fallback start must be moved before saving', () => {
    expect(L.pinStart({ cust: { lat: 1, lng: 2 }, device: { lat: 3, lng: 4 }, depot: { lat: 5, lng: 6 } })).toEqual({ pin: { lat: 1, lng: 2 }, fallback: false });
    expect(L.pinStart({ cust: {}, device: { lat: 3, lng: 4 }, depot: { lat: 5, lng: 6 } })).toEqual({ pin: { lat: 3, lng: 4 }, fallback: false });
    expect(L.pinStart({ cust: {}, device: null, depot: { lat: 5, lng: 6 } })).toEqual({ pin: { lat: 5, lng: 6 }, fallback: true });
    const none = L.pinStart({ cust: {}, device: null, depot: null });
    expect(none.fallback).toBe(true); expect(typeof none.pin.lat).toBe('number');   // Bali, never a dead end
  });
  it('saleStopFor: a customer with a pending stop today is sold THROUGH that stop (marked delivered)', () => {
    const board = [stop({ id: 's1', customerId: 'c1', status: 'terkirim' }), stop({ id: 's2', customerId: 'c1', status: 'pending', qty: 3 }), stop({ id: 's3', customerId: 'c2' })];
    const s = L.saleStopFor({ board, customer: { id: 'c1', gallonsHeld: 4 }, demand: {} });
    expect(s).toMatchObject({ id: 's2', customerId: 'c1', planQty: 3, gallonsHeld: 4 });
    expect(L.saleStopFor({ board, customer: { id: 'c9' }, demand: {} })).toBeNull();
    expect(L.saleStopFor({ board: [stop({ id: 's1', customerId: 'c1', status: 'terkirim' })], customer: { id: 'c1' } })).toBeNull();
  });
});

it('Final fix: recordSale reports a replay (the server returned a sale already saved), with or without a stop', async () => {
  const api = { createSale: () => Promise.resolve({ id: 't1', replay: true }), markStop: () => Promise.resolve({}) };
  expect(await L.recordSale(api, { body: {} })).toEqual({ txnId: 't1', done: true, replay: true });
  expect(await L.recordSale(api, { stopId: 's1', body: {} })).toEqual({ txnId: 't1', done: true, replay: true });
  const fresh = { createSale: () => Promise.resolve({ id: 't2' }), markStop: () => Promise.resolve({}) };
  expect(await L.recordSale(fresh, { stopId: 's1', body: {} })).toEqual({ txnId: 't2', done: true });
});

describe('Plan 3C: koreksi logic', () => {
  const sale = (o) => Object.assign({ id: 't1', kind: 'jual', method: 'lunas', payMethod: 'tunai', qty: 3, unitPriceLocked: 18000, amount: 54000, gallonOut: 3, gallonIn: 1, status: 'active' }, o);
  it('pay method of a row', () => {
    expect(L.payOf(sale())).toBe('lunas');
    expect(L.payOf(sale({ payMethod: 'transfer' }))).toBe('transfer');
    expect(L.payOf(sale({ method: 'bon', payMethod: '' }))).toBe('bon');
    expect(L.payOf({ method: 'pelunasan' })).toBe('pelunasan');
  });
  it('what may be corrected, by kind of row and by right', () => {
    const both = { correct: true, void: true };
    expect(L.koreksiOptions(sale(), both)).toEqual(['pelanggan', 'jumlah', 'bayar', 'batal']);
    expect(L.koreksiOptions(sale(), { void: true })).toEqual(['batal']);
    expect(L.koreksiOptions(sale(), { correct: true })).toEqual(['pelanggan', 'jumlah', 'bayar']);
    expect(L.koreksiOptions({ id: 'p', method: 'pelunasan', kind: 'jual', qty: 0, amount: 5000, status: 'active' }, both)).toEqual(['nominal', 'batal']);
    expect(L.koreksiOptions(sale({ kind: 'ganti_rugi', qty: 0 }), both)).toEqual(['batal']);
    expect(L.koreksiOptions(sale({ status: 'void' }), both)).toEqual([]);
  });
  it('the payload is always complete (missing gallon fields would become 0 on the server)', () => {
    expect(L.correctionBody(sale(), { pay: 'transfer', photo: { id: 'ph' } })).toEqual({ qty: 3, unitPrice: 18000, gallonOut: 3, gallonIn: 1, method: 'lunas', payMethod: 'transfer', proofPhotoId: 'ph' });
    expect(L.correctionBody(sale(), { pay: 'bon' })).toEqual({ qty: 3, unitPrice: 18000, gallonOut: 3, gallonIn: 1, method: 'bon', payMethod: '' });
    expect(L.correctionBody(sale(), { qty: 4, gallonIn: 2 })).toEqual({ qty: 4, unitPrice: 18000, gallonOut: 4, gallonIn: 2, method: 'lunas' });
    expect(L.correctionBody(sale({ gallonOut: 5 }), { qty: 2 })).toMatchObject({ qty: 2, gallonOut: 4 });   // extra gallons out stay extra
    expect(L.correctionBody({ method: 'pelunasan', amount: 5000 }, { amount: 7000 })).toEqual({ amount: 7000 });
  });
  it('what still blocks sending', () => {
    const t = sale();
    expect(L.koreksiCheck({ t, kind: 'jumlah', change: { qty: 3, gallonIn: 1 } })).toBe('fld.kNoChange');
    expect(L.koreksiCheck({ t, kind: 'jumlah', change: { qty: 0, gallonIn: 1 } })).toBe('fld.kQtyMin');
    expect(L.koreksiCheck({ t, kind: 'jumlah', change: { qty: 4, gallonIn: 1 } })).toBe('');
    expect(L.koreksiCheck({ t, kind: 'bayar', change: { pay: 'lunas' } })).toBe('fld.kNoChange');
    expect(L.koreksiCheck({ t, kind: 'bayar', change: { pay: 'transfer' } })).toBe('fld.kNeedTransferPhoto');
    expect(L.koreksiCheck({ t, kind: 'bayar', change: { pay: 'transfer' }, preview: true })).toBe('');
    expect(L.koreksiCheck({ t, kind: 'bayar', change: { pay: 'transfer', photo: { id: 'p' } } })).toBe('');
    expect(L.koreksiCheck({ t: { method: 'pelunasan', amount: 5000 }, kind: 'nominal', change: { amount: 5000 } })).toBe('fld.kNoChange');
    expect(L.koreksiCheck({ t: { method: 'pelunasan', amount: 5000 }, kind: 'nominal', change: { amount: null } })).toBe('fld.kAmountMin');
    expect(L.koreksiCheck({ t, kind: 'pelanggan', change: {} })).toBe('fld.kPickCust');
    expect(L.koreksiCheck({ t, kind: 'batal', change: {} })).toBe('');
  });
  it('the reason tells the office a pay change in Indonesian (the old inbox shows no pay method)', () => {
    expect(L.koreksiReason('bayar', sale(), { pay: 'transfer' }, ' dibayar transfer ')).toBe('dibayar transfer [cara bayar: Lunas → Transfer]');
    expect(L.koreksiReason('jumlah', sale(), { qty: 4 }, 'salah hitung')).toBe('salah hitung');
  });
  it('customers nearest to where the photo was taken', () => {
    const cs = [{ id: 'a', lat: -8.6001, lng: 115.2 }, { id: 'b', lat: -8.7, lng: 115.3 }, { id: 'c' }, { id: 'me', lat: -8.6, lng: 115.2 }];
    const n = L.nearCustomers(cs, { lat: -8.6, lng: 115.2 }, 'me', 2);
    expect(n.map((c) => c.id)).toEqual(['a', 'b']);
    expect(n[0].meters).toBeLessThan(20);
  });
  it('Koreksi saya rows', () => {
    const v = L.requestView({ id: 'r', kind: 'correction', status: 'rejected', transactionId: 't1', customerId: 'c1', current: { qty: 3, method: 'lunas', payMethod: 'tunai', amount: 54000 }, requested: { qty: 4, method: 'lunas', payMethod: 'transfer' } });
    expect(v).toMatchObject({ statusKey: 'fld.rq_rejected', tone: 'neg', kindKey: 'fld.rk_correction', canWithdraw: false, canResubmit: true, target: { transactionId: 't1', customerId: 'c1' } });
    expect(v.lines).toEqual([['fld.rl_qty', { a: 3, b: 4 }], ['fld.rl_pay', { a: 'lunas', b: 'transfer' }]]);
    const m = L.requestView({ kind: 'reassign', status: 'pending', transactionIds: ['t9'], fromCustomerId: 'c1', toCustomerName: 'Bu Ketut' });
    expect(m).toMatchObject({ canWithdraw: true, canResubmit: false, target: { transactionId: 't9', customerId: 'c1' }, lines: [['fld.rl_to', { name: 'Bu Ketut' }]] });
  });
  it('after a pin is saved, the screen we go back to has the new point', () => {
    expect(L.afterPin({ name: 'complete', cust: { id: 'c1', lat: null } }, 'c1', { lat: 1, lng: 2 })).toEqual({ name: 'complete', cust: { id: 'c1', lat: 1, lng: 2 } });
    expect(L.afterPin({ name: 'addStop', preset: { id: 'c1' } }, 'c1', { lat: 1, lng: 2 }).preset).toEqual({ id: 'c1', lat: 1, lng: 2 });
    expect(L.afterPin({ name: 'addStop' }, 'c1', { lat: 1, lng: 2 })).toEqual({ name: 'addStop' });
  });
  it('archived (not counted) bons are not listed as open', () => {
    expect(L.openBons([{ id: 'a', method: 'bon', amount: 1000, txnDate: '2026-09-01', bonCounted: false }, { id: 'b', method: 'bon', amount: 2000, txnDate: '2026-09-02' }]).map((b) => b.id)).toEqual(['b']);
  });
});
