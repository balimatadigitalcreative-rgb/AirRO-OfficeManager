'use strict';
// VOID / RESET / HARD-DELETE for DEPOT gallon-stock entries (exposes GallonMovement.active).
//
// SAFETY INVARIANT under test: gallons AT CUSTOMERS derive only from rows WITH a customerId. Every
// action here is confined to customerId=null rows, so no customer's gallon count can ever change.
// Each test snapshots EVERY customer's held count and asserts byte-identical before == after.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let owner, cA, cB;
const gallon = (fleet) => request(app).get('/api/v1/distribusi/gallon' + (fleet ? '?fleet=' + fleet : '')).set(auth(owner)).then((r) => r.body.data);
// Snapshot every customer's held gallon count → { customerId: held }.
const balSnapshot = async () => { const d = await gallon('all'); const m = {}; (d.balances || []).forEach((b) => { m[b.customerId] = b.held; }); return m; };
const openingId = async (fleet) => { const d = await gallon(fleet); const o = (d.movements || []).find((m) => m.type === 'opening' && m.active !== false); return o && o.id; };
const makeOpening = (qty, fleet) => request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty, fleet, reason: 'stok awal test' });

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_gv', password: 'secret123', role: 'owner' })).token;
  cA = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'BU RIRIS', code: 'C-A', type: 'reguler', masterPrice: 13000, armada: 'Biru' })).body.data.id;
  cB = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'PAK ADI', code: 'C-B', type: 'reguler', masterPrice: 13000, armada: 'Merah' })).body.data.id;
  // Customer held balances come from customerId rows (deliveries) — the ONLY thing that may never move.
  await prisma.gallonMovement.createMany({ data: [
    { type: 'delivery_out', qty: 10, customerId: cA, transactionId: 'txA', fleetId: 'Biru', active: true, note: 'out' },
    { type: 'return_in', qty: 2, customerId: cA, transactionId: 'txA', fleetId: 'Biru', active: true, note: 'in' },   // cA held = 8
    { type: 'delivery_out', qty: 5, customerId: cB, transactionId: 'txB', fleetId: 'Merah', active: true, note: 'out' }, // cB held = 5
  ] });
});
afterAll(() => prisma.$disconnect());

describe('void a mistaken opening row', () => {
  it('depot drops by 500 and EVERY customer gallon count is byte-identical before → after', async () => {
    await makeOpening(500, 'D1');
    const before = await balSnapshot();
    const depotBefore = (await gallon('D1')).stock.atDepot;
    expect(depotBefore).toBe(500);
    const id = await openingId('D1');
    // server-computed impact preview shows customers unchanged
    const imp = (await request(app).get('/api/v1/distribusi/gallon/movements/' + id + '/impact').set(auth(owner))).body.data;
    expect(imp.customersUnchanged).toBe(true);
    expect(imp.depotAfter).toBe(depotBefore - 500);
    expect(imp.atCustomersBefore).toBe(imp.atCustomersAfter);
    // execute void
    const r = await request(app).post('/api/v1/distribusi/gallon/movements/' + id + '/void').set(auth(owner)).send({ note: 'salah input', reason: 'salah_input' });
    expect(r.status).toBe(200);
    expect(r.body.data.stock.atDepot).toBe(depotBefore - 500);
    const after = await balSnapshot();
    expect(after).toEqual(before);                       // per-customer equality (not just the total)
    expect(Object.keys(after).length).toBeGreaterThanOrEqual(2);
  });
});

describe('reset opening 500 → 120 via delta (history intact)', () => {
  it('appends a -380 opening row; both rows survive; classification + customer gallons unchanged', async () => {
    await makeOpening(500, 'D2');
    const before = await balSnapshot();
    const r = await request(app).post('/api/v1/distribusi/gallon/opening/reset').set(auth(owner)).send({ mode: 'delta', targetQty: 120, fleetId: 'D2', note: 'stok awal salah' });
    expect(r.status).toBe(201);
    // a NEW opening row of the delta exists; the original +500 is still there (append-only)
    const rows = await prisma.gallonMovement.findMany({ where: { fleetId: 'D2', type: 'opening', active: true } });
    expect(rows.some((x) => x.qty === -380)).toBe(true);
    expect(rows.some((x) => x.qty === 500)).toBe(true);
    // openingInfo (isOpeningRow) still classifies correctly → net 120
    const d = await gallon('D2');
    expect(d.opening.total).toBe(120);
    expect(d.stock.atDepot).toBe(120);
    expect(await balSnapshot()).toEqual(before);
  });
});

describe('linked rows are blocked / rejected', () => {
  it('void a purchase row (cashEntryId) → blocked with a clear reason', async () => {
    const p = await prisma.gallonMovement.create({ data: { type: 'purchase', qty: 50, cashEntryId: 'ce-1', fleetId: 'D3', active: true, note: 'beli' } });
    const r = await request(app).post('/api/v1/distribusi/gallon/movements/' + p.id + '/void').set(auth(owner)).send({ note: 'coba' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/kas|pembelian/i);
  });
  it('void a delivery row (customerId) via this endpoint → rejected outright', async () => {
    const del = await prisma.gallonMovement.create({ data: { type: 'delivery_out', qty: 3, customerId: cA, transactionId: 'txZ', fleetId: 'Biru', active: true, note: 'out' } });
    const before = await balSnapshot();
    const r = await request(app).post('/api/v1/distribusi/gallon/movements/' + del.id + '/void').set(auth(owner)).send({ note: 'coba' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Distribusi|pelanggan/i);
    expect(await balSnapshot()).toEqual(before);          // still untouched
  });
});

describe('fleet-scoped reset', () => {
  it('resetting Biru does not touch Merah, the global depot, or customer gallons', async () => {
    await makeOpening(300, 'Biru');
    await makeOpening(200, 'Merah');
    await makeOpening(90, 'all');                          // global depot
    const before = await balSnapshot();
    const merahBefore = (await gallon('Merah')).stock.atDepot;
    const globalBefore = (await prisma.gallonMovement.findMany({ where: { fleetId: '', type: 'opening', active: true } })).length;
    // delta reset Biru 300 → 150 (Biru has a customer holding gallons, so void_all would be correctly
    // blocked — that negative guard is covered in opening-reset.test.js; here we check scope isolation).
    const imp = (await request(app).get('/api/v1/distribusi/gallon/opening/reset/impact?mode=delta&targetQty=150&fleetId=Biru').set(auth(owner))).body.data;
    expect(imp.blocked).toBe(false);
    const r = await request(app).post('/api/v1/distribusi/gallon/opening/reset').set(auth(owner)).send({ mode: 'delta', targetQty: 150, fleetId: 'Biru', note: 'baseline Biru salah' });
    expect(r.status).toBe(201);
    expect((await gallon('Biru')).opening.total).toBe(150);   // baseline now 150 (delta appended, history kept)
    // …Merah + global depot untouched…
    expect((await gallon('Merah')).stock.atDepot).toBe(merahBefore);
    expect((await prisma.gallonMovement.findMany({ where: { fleetId: '', type: 'opening', active: true } })).length).toBe(globalBefore);
    // …and cA (a Biru customer) held is unchanged, per-customer.
    expect(await balSnapshot()).toEqual(before);
  });
  it('wrong typed count is rejected (void_all, clean fleet)', async () => {
    await makeOpening(50, 'Kuning');   // no customers on Kuning → void_all is not blocked; the confirm gate applies
    const r = await request(app).post('/api/v1/distribusi/gallon/opening/reset').set(auth(owner)).send({ mode: 'void_all', fleetId: 'Kuning', note: 'x', confirm: '99' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/jumlah baris/i);
  });
});

describe('restore a voided row', () => {
  it('restore returns depot to the prior figure; customers still unchanged', async () => {
    await makeOpening(500, 'D6');
    const before = await balSnapshot();
    const depotBefore = (await gallon('D6')).stock.atDepot;
    const id = await openingId('D6');
    await request(app).post('/api/v1/distribusi/gallon/movements/' + id + '/void').set(auth(owner)).send({ note: 'salah' });
    expect((await gallon('D6')).stock.atDepot).toBe(depotBefore - 500);
    const r = await request(app).post('/api/v1/distribusi/gallon/movements/' + id + '/restore').set(auth(owner)).send({});
    expect(r.status).toBe(200);
    expect((await gallon('D6')).stock.atDepot).toBe(depotBefore);
    expect(await balSnapshot()).toEqual(before);
  });
});

describe('reported bug: opening figure is changeable by a stock manager (no customer cap)', () => {
  // Regression for "the opening stock figure cannot be changed": a role that manages gallon stock
  // (distribusiGallonReset) but NOT customers (distribusiCustomers) must be able to set/adjust the
  // depot baseline — and doing so must not move any customer's gallons.
  let stockUser;
  beforeAll(async () => {
    const u = await reg({ name: 'Gudang', username: 'stk_gv', password: 'secret123', role: 'finance' });
    await prisma.user.update({ where: { id: u.user.id }, data: { permissions: JSON.stringify({ distribusiGallon: true, distribusiGallonReset: true, distribusiCustomers: false }) } });
    stockUser = (await request(app).post('/api/v1/auth/login').send({ username: 'stk_gv', password: 'secret123' })).body.token;
  });
  it('sets opening 400 then adjusts to 90 via the delta engine; customers byte-identical', async () => {
    const before = await balSnapshot();
    const set = await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(stockUser)).send({ qty: 400, fleet: 'D8', reason: 'stok awal awal' });
    expect(set.status).toBe(201);
    const adj = await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(stockUser)).send({ qty: 90, fleet: 'D8', reason: 'koreksi stok awal' });
    expect(adj.status).toBe(201);
    const d = await request(app).get('/api/v1/distribusi/gallon?fleet=D8').set(auth(owner)).then((r) => r.body.data);
    expect(d.opening.total).toBe(90);           // baseline became the target via the delta row
    expect(d.stock.atDepot).toBe(90);
    expect(await balSnapshot()).toEqual(before); // no customer gallon moved
  });
});

describe('hard delete (owner, narrow)', () => {
  it('rejects an ACTIVE row; deletes an already-voided unlinked row with an audit snapshot', async () => {
    await makeOpening(70, 'D7');
    const id = await openingId('D7');
    // active row → refused
    const bad = await request(app).delete('/api/v1/distribusi/gallon/movements/' + id).set(auth(owner)).send({ note: 'x' });
    expect(bad.status).toBe(400);
    // void then hard-delete
    await request(app).post('/api/v1/distribusi/gallon/movements/' + id + '/void').set(auth(owner)).send({ note: 'salah' });
    const before = await balSnapshot();
    const del = await request(app).delete('/api/v1/distribusi/gallon/movements/' + id).set(auth(owner)).send({ note: 'bersih-bersih' });
    expect(del.status).toBe(200);
    expect(await prisma.gallonMovement.findUnique({ where: { id } })).toBeNull();
    const snap = await prisma.distAuditLog.findFirst({ where: { kind: 'input', detail: { contains: 'galon-hapus' } }, orderBy: { createdAt: 'desc' } });
    expect(snap).toBeTruthy();
    expect(await balSnapshot()).toEqual(before);
  });
});
