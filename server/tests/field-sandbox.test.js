'use strict';
// MODE LATIHAN ENGINE — mirrors the server's field rules on a copy of real data, entirely offline.
// Nothing here may ever reach the server: the file must not even mention the API, fetch or XHR.
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..', '..');
const SB = require(path.join(root, 'dist-field-sandbox.js'));
const { planRit } = require(path.join(root, 'rit-plan.js'));

const SNAP = () => ({
  context: { today: '2026-10-01', fleet: 'DK 1', fleets: ['DK 1'], depot: { lat: -8.65, lng: 115.2 },
    rules: { ritSop: { enabled: true, minLoad: 80 }, fleetCapacity: { 'DK 1': 120 }, wajibFotoTransaksi: true, wajibFotoPengeluaran: true, wajibAlasanBatal: true, hargaGantiRugiGalon: 45000, fieldUiDefault: 'old' },
    demand: { s1: 4, s2: 2 } },
  board: [
    { id: 's1', date: '2026-10-01', fleetId: 'DK 1', customerId: 'c1', seq: 0, pinned: false, status: 'pending', qty: null, pendingReason: '', customerName: 'Pak Wayan' },
    { id: 's2', date: '2026-10-01', fleetId: 'DK 1', customerId: 'c2', seq: 1, pinned: false, status: 'pending', qty: null, pendingReason: '', customerName: 'Bu Ketut' },
  ],
  customers: [
    { id: 'c1', name: 'Pak Wayan', armada: 'DK 1', masterPrice: 18000, phone: '', lat: -8.66, lng: 115.21, locationPhotoId: null, sisaBon: 45000, gallonsHeld: 6, active: true },
    { id: 'c2', name: 'Bu Ketut', armada: 'DK 1', masterPrice: 18000, phone: '0812', lat: -8.64, lng: 115.19, locationPhotoId: 'p', sisaBon: 0, gallonsHeld: 3, active: true },
  ],
  runs: [], myRequests: [],
});
const make = () => { const saved = []; const api = SB.createSandbox(SB.fromSnapshot(SNAP(), { key: 'u1' }), { planRit, onChange: (s) => saved.push(s) }); return { api, saved }; };
const code = async (p) => { try { await p; return 'OK'; } catch (e) { return (e.body && e.body.error && e.body.error.details && e.body.error.details.code) || e.status; } };

it('never mentions the server', () => {
  const src = fs.readFileSync(path.join(root, 'dist-field-sandbox.js'), 'utf8');
  ['window.API', 'fetch(', 'XMLHttpRequest', 'API.'].forEach((s) => expect(src.includes(s)).toBe(false));
});

describe('sales + bon payments', () => {
  it('a sale needs a photo (rule on), prices at the customer\'s master price, moves gallons and bon', async () => {
    const { api, saved } = make();
    expect(await code(api.createSale({ customerId: 'c1', qty: 4, method: 'bon', gallonOut: 4, gallonIn: 6 }))).toBe('PROOF_REQUIRED');
    const ph = await api.uploadPhoto({ data: 'data:image/jpeg;base64,xx' });
    const t = await api.createSale({ customerId: 'c1', qty: 4, method: 'bon', gallonOut: 4, gallonIn: 6, proofPhotoId: ph.id });
    expect(t.amount).toBe(72000);
    expect(t.sisaBon).toBe(45000 + 72000);
    expect(t.gallonsHeld).toBe(4);
    expect(saved.length).toBeGreaterThan(0);
    const c = (await api.customers()).find((x) => x.id === 'c1');
    expect(c.sisaBon).toBe(117000);
  });
  it('a missing photo id is refused like the server (PROOF_MISSING)', async () => {
    const { api } = make();
    expect(await code(api.createSale({ customerId: 'c1', qty: 1, method: 'lunas', proofPhotoId: 'lat-photo-999' }))).toBe('PROOF_MISSING');
  });
  it('transfer sale is lunas + payMethod transfer and never adds bon', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    const t = await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', payMethod: 'transfer', gallonOut: 2, proofPhotoId: ph.id });
    expect(t.method).toBe('lunas'); expect(t.payMethod).toBe('transfer'); expect(t.sisaBon).toBe(0);
  });
  it('bon payment cannot exceed sisa bon and needs a photo', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    expect(await code(api.payBon({ customerId: 'c1', payAmount: 50000, payMethod: 'tunai', proofPhotoId: ph.id }))).toBe(400);
    expect(await code(api.payBon({ customerId: 'c1', payAmount: 5000, payMethod: 'tunai' }))).toBe('PROOF_REQUIRED');
    const r = await api.payBon({ customerId: 'c1', payAmount: 45000, payMethod: 'tunai', proofPhotoId: ph.id });
    expect(r.sisaBon).toBe(0);
  });
});

describe('stops', () => {
  it('hold needs a reason; cancel needs one when the rule is on; pending clears it', async () => {
    const { api } = make();
    expect(await code(api.holdStop('s1', ''))).toBe('REASON_REQUIRED');
    await api.holdStop('s1', 'Toko tutup');
    expect((await api.board()).find((s) => s.id === 's1')).toMatchObject({ status: 'ditunda', pendingReason: 'Toko tutup' });
    expect(await code(api.cancelStop('s2', ''))).toBe('REASON_REQUIRED');
    await api.markStop('s1', { status: 'pending' });
    expect((await api.board()).find((s) => s.id === 's1').pendingReason).toBe('');
  });
});

describe('rit', () => {
  it('capacity and SOP like the server; the rit route is planned offline from the warehouse', async () => {
    const { api } = make();
    expect(await code(api.openRun({ gallonsOut: 121 }))).toBe('OVER_CAPACITY');
    expect(await code(api.openRun({ gallonsOut: 60 }))).toBe('UNDER_SOP');
    const run = await api.openRun({ gallonsOut: 60, underSopReason: 'Rit terakhir' });
    expect(run).toMatchObject({ runNo: 1, gallonsOut: 60, status: 'open', underSopReason: 'Rit terakhir' });
    expect(await code(api.openRun({ gallonsOut: 90 }))).toBe(400);   // one open rit per armada
    const route = await api.ritRoute();
    expect(route.run.runNo).toBe(1);
    expect(route.rit.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(route.used).toBe(6);
  });
  it('closing a rit with a difference needs a reason', async () => {
    const { api } = make();
    const run = await api.openRun({ gallonsOut: 80 });
    expect(await code(api.closeRun(run.id, { gallonsFullReturned: 70, gallonsEmptyReturned: 0 }))).toBe(400);
    const closed = await api.closeRun(run.id, { gallonsFullReturned: 70, gallonsEmptyReturned: 0, diffReason: 'hitung ulang' });
    expect(closed.status).toBe('closed');
  });
});

describe('customer data, stops, gallons, expenses', () => {
  it('location, phone and location photo', async () => {
    const { api } = make();
    await api.setLocation('c1', { lat: -8.67, lng: 115.22, method: 'geser' });
    await api.setPhone('c1', '0812 999');
    const ph = await api.uploadPhoto({ data: 'x' });
    await api.setLocationPhoto('c1', ph.id);
    const c = (await api.customers()).find((x) => x.id === 'c1');
    expect(c).toMatchObject({ lat: -8.67, lng: 115.22, phone: '0812999', locationPhotoId: ph.id });
    expect(await code(api.setLocationPhoto('c1', 'nope'))).toBe(400);
  });
  it('add a stop once per customer per day', async () => {
    const { api } = make();
    const st = await api.addStop({ customerId: 'c2', qty: 3 });
    expect(st).toMatchObject({ source: 'tambahan', status: 'pending', customerId: 'c2' });
    expect(await code(api.addStop({ customerId: 'c2' }))).toBe(400);
  });
  it('ganti rugi: photo, held limit, price rule, money-only row, bon raises sisa bon', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    expect(await code(api.gallonDamage('c2', { qty: 1, kind: 'pecah', payMethod: 'bon' }))).toBe('PROOF_REQUIRED');
    expect(await code(api.gallonDamage('c2', { qty: 4, kind: 'pecah', payMethod: 'bon', photoId: ph.id }))).toBe(400);
    const r = await api.gallonDamage('c2', { qty: 1, kind: 'pecah', payMethod: 'bon', photoId: ph.id });
    expect(r.transaction).toMatchObject({ kind: 'ganti_rugi', qty: 0, gallonQty: 1, amount: 45000, method: 'bon' });
    expect(r.gallonsHeld).toBe(2);
    expect(r.sisaBon).toBe(45000);
  });
  it('gallon adjustment waits for approval; expenses need a receipt photo', async () => {
    const { api } = make();
    const a = await api.adjustGallon('c1', { value: 5, reason: 'rekonsiliasi_fisik' });
    expect(a.status).toBe('pending');
    expect(await code(api.addExpense({ amount: 150000, category: 'bensin' }))).toBe('PROOF_REQUIRED');
    const ph = await api.uploadPhoto({ data: 'x' });
    expect((await api.addExpense({ amount: 150000, category: 'bensin', photoId: ph.id })).amount).toBe(150000);
  });
});

describe('corrections + day', () => {
  it('request, list, withdraw; ganti rugi cannot be corrected', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    const t = await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', proofPhotoId: ph.id });
    const req = await api.requestCorrection(t.id, { reason: 'salah ketik', qty: 1 });
    expect(req.status).toBe('pending');
    expect(await code(api.requestCorrection(t.id, { reason: 'lagi', qty: 3 }))).toBe(400);   // one pending per txn
    expect((await api.myChangeRequests())[0].id).toBe(req.id);
    expect((await api.withdrawRequest(req.id)).status).toBe('withdrawn');
    const g = await api.gallonDamage('c2', { qty: 1, kind: 'pecah', payMethod: 'tunai', photoId: ph.id });
    expect(await code(api.requestCorrection(g.transaction.id, { reason: 'x', amount: 1 }))).toBe(400);
  });
  it('day summary mirrors the server and closing the day needs a reason per pending stop', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', gallonOut: 2, proofPhotoId: ph.id });                       // 36.000 tunai
    await api.createSale({ customerId: 'c2', qty: 1, method: 'lunas', payMethod: 'transfer', gallonOut: 1, proofPhotoId: ph.id }); // 18.000 transfer
    await api.payBon({ customerId: 'c1', payAmount: 10000, payMethod: 'tunai', proofPhotoId: ph.id });                             // 10.000 tunai
    await api.addExpense({ amount: 5000, category: 'parkir', photoId: ph.id });
    const s = await api.daySummary();
    expect(s).toMatchObject({ tunaiPenjualan: 36000, tunaiPelunasan: 10000, transfer: 18000, pengeluaran: 5000, wajibSetor: 41000 });
    expect(await code(api.closeDay({ reasons: {} }))).toBe(400);
    const r = await api.closeDay({ reasons: { s1: 'tutup', s2: 'tutup' } });
    expect(r.pending).toBe(2);
    expect((await api.board()).every((x) => x.status === 'ditunda')).toBe(true);
  });
  it('the state is JSON and round-trips', async () => {
    const { api } = make();
    await api.holdStop('s1', 'x');
    const st = api.exportState();
    const again = SB.createSandbox(JSON.parse(JSON.stringify(st)), { planRit });
    expect((await again.board()).find((x) => x.id === 's1').status).toBe('ditunda');
  });
  it('results are copies: changing a returned row never changes the practice state', async () => {
    const { api } = make();
    const b = await api.board();
    b[0].status = 'terkirim';
    expect((await api.board())[0].status).toBe('pending');
  });
});
describe('closer to the server', () => {
  it('markStop accepts the four statuses with the server\'s reason rules', async () => {
    const { api } = make();
    expect(await code(api.markStop('s1', { status: 'ditunda' }))).toBe('REASON_REQUIRED');
    expect(await code(api.markStop('s1', { status: 'batal' }))).toBe('REASON_REQUIRED');   // wajibAlasanBatal on in SNAP
    expect(await code(api.markStop('s1', { status: 'hilang' }))).toBe(400);
    expect((await api.markStop('s1', { status: 'ditunda', reason: 'Toko tutup' })).pendingReason).toBe('Toko tutup');
    expect((await api.markStop('s1', { status: 'pending' })).pendingReason).toBe('');
  });
  it('closeDay returns the closeout like the server', async () => {
    const { api } = make();
    const co = await api.closeDay({ reasons: { s1: 'tutup', s2: 'tutup' }, generalNote: 'hujan' });
    expect(co).toMatchObject({ date: '2026-10-01', fleetId: 'DK 1', pending: 2, delivered: 0, generalNote: 'hujan' });
  });
  it('an open rit from yesterday blocks a new one and is not today\'s route', async () => {
    const snap = SNAP(); snap.context.openRun = { id: 'r-old', date: '2026-09-30', fleetId: 'DK 1', runNo: 2, gallonsOut: 80, sold: 10, status: 'open' };
    const api = SB.createSandbox(SB.fromSnapshot(snap), { planRit });
    expect(await code(api.openRun({ gallonsOut: 90 }))).toBe(400);
    expect(await code(api.ritRoute())).toBe(400);
    expect((await api.closeRun('r-old', { gallonsFullReturned: 70, gallonsEmptyReturned: 0 })).status).toBe('closed');
    expect((await api.openRun({ gallonsOut: 90 })).runNo).toBe(1);
  });
  it('a customer\'s unknown sisa bon falls back to the board\'s', async () => {
    const snap = SNAP(); snap.customers[0].sisaBon = null; snap.board[0].sisaBon = 45000;
    const api = SB.createSandbox(SB.fromSnapshot(snap), { planRit });
    expect((await api.customers()).find((c) => c.id === 'c1').sisaBon).toBe(45000);
  });
  it('outstanding comes from the copy', async () => {
    const snap = SNAP(); snap.outstanding = [{ id: 'o1', date: '2026-09-29', customerName: 'Lama', umur: 2 }];
    const api = SB.createSandbox(SB.fromSnapshot(snap), { planRit });
    expect((await api.outstanding())[0].id).toBe('o1');
  });
  it('photos go to the photo store; the state keeps only a marker', async () => {
    const box = {};
    const api = SB.createSandbox(SB.fromSnapshot(SNAP()), { planRit, photoStore: { put: (id, d) => { box[id] = d; return Promise.resolve(); }, get: (id) => Promise.resolve(box[id] || null) } });
    const ph = await api.uploadPhoto({ data: 'data:image/jpeg;base64,AAA' });
    expect(api.exportState().photos[ph.id]).toBe(true);
    expect(box[ph.id]).toBe('data:image/jpeg;base64,AAA');
    expect(await api.photo(ph.id)).toBe('data:image/jpeg;base64,AAA');
    expect(SB.VERSION).toBe(2);
  });
});

describe('practice context reports the open rit like the server', () => {
  it('context().openRun follows opening, selling and closing a rit', async () => {
    const { api } = make();
    expect((await api.context()).openRun).toBeNull();
    const run = await api.openRun({ gallonsOut: 80 });
    const ph = await api.uploadPhoto({ data: 'x' });
    await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', proofPhotoId: ph.id });
    expect((await api.context()).openRun).toMatchObject({ id: run.id, runNo: 1, gallonsOut: 80, sold: 2, expectedRemaining: 78, status: 'open', date: '2026-10-01' });
    await api.closeRun(run.id, { gallonsFullReturned: 78, gallonsEmptyReturned: 0 });
    expect((await api.context()).openRun).toBeNull();
  });
});

describe('Plan 3B: practice follows the server on field inputs', () => {
  it('clientRef: a retried sale / payment / damage returns the saved row, state unchanged', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    const a = await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', proofPhotoId: ph.id, clientRef: 'ref-s-0001' });
    const b = await api.createSale({ customerId: 'c2', qty: 2, method: 'lunas', proofPhotoId: ph.id, clientRef: 'ref-s-0001' });
    expect(b).toMatchObject({ id: a.id, replay: true });
    const p1 = await api.payBon({ customerId: 'c1', payAmount: 5000, payMethod: 'tunai', proofPhotoId: ph.id, clientRef: 'ref-p-0001' });
    const p2 = await api.payBon({ customerId: 'c1', payAmount: 5000, payMethod: 'tunai', proofPhotoId: ph.id, clientRef: 'ref-p-0001' });
    expect(p2.id).toBe(p1.id);
    expect((await api.customers()).find((c) => c.id === 'c1').sisaBon).toBe(40000);
    const d1 = await api.gallonDamage('c2', { qty: 1, kind: 'pecah', payMethod: 'tunai', photoId: ph.id, clientRef: 'ref-d-0001' });
    const d2 = await api.gallonDamage('c2', { qty: 1, kind: 'pecah', payMethod: 'tunai', photoId: ph.id, clientRef: 'ref-d-0001' });
    expect(d2.transaction.id).toBe(d1.transaction.id);
    expect(api.exportState().txns.length).toBe(3);
    expect(await code(api.createSale({ customerId: 'c1', qty: 1, method: 'lunas', proofPhotoId: ph.id, clientRef: 'ref-s-0001' }))).toBe(409);
  });
  it('customerDetail lists the practice transactions, newest first', async () => {
    const { api } = make();
    const ph = await api.uploadPhoto({ data: 'x' });
    await api.createSale({ customerId: 'c1', qty: 1, method: 'bon', proofPhotoId: ph.id });
    await api.payBon({ customerId: 'c1', payAmount: 1000, payMethod: 'tunai', proofPhotoId: ph.id });
    const d = await api.customerDetail('c1');
    expect(d).toMatchObject({ id: 'c1', name: 'Pak Wayan' });
    expect(d.transactions.map((t) => t.method)).toEqual(['pelunasan', 'bon']);
  });
  it('phone stored as 08…, adjustment reason from the server list, damage/expense fields required', async () => {
    const { api } = make();
    expect((await api.setPhone('c1', '+62 812-3456-789')).phone).toBe('08123456789');
    expect((await api.setPhone('c1', '812 999')).phone).toBe('0812999');
    expect(await code(api.adjustGallon('c1', { value: 5, reason: 'Hitung ulang' }))).toBe(400);
    expect((await api.adjustGallon('c1', { value: 5, reason: 'rekonsiliasi_fisik' })).status).toBe('pending');
    const ph = await api.uploadPhoto({ data: 'x' });
    expect(await code(api.gallonDamage('c2', { qty: 1, payMethod: 'tunai', photoId: ph.id }))).toBe(400);
    expect(await code(api.gallonDamage('c2', { qty: 1, kind: 'pecah', photoId: ph.id }))).toBe(400);
    expect(await code(api.addExpense({ amount: 1000, photoId: ph.id }))).toBe(400);
  });
});
