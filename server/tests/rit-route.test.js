'use strict';
/*
 * RUTE RIT endpoint — plans the OPEN rit of an armada from the warehouse, with the gallons loaded for
 * that rit, over the day's pending stops; the next rit (opened after the truck returns) is planned
 * from the warehouse again over what is still pending.
 */
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const D = '/api/v1/distribusi';
const DEPOT = { lat: -8.65, lng: 115.2 };
const KM = 0.009;
const ALL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const today = todayISO();
let gm, driver;
const ids = {};

const mk = async (name, km, extra) => {
  const r = await request(app).post(`${D}/customers`).set(auth(gm)).send(Object.assign({ name, type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL, lat: DEPOT.lat + km * KM, lng: DEPOT.lng }, extra || {}));
  ids[name] = r.body.data.id;
};
const sell = (name, qty) => request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: ids[name], qty, method: 'lunas', txnDate: today });
const rit = (tok) => request(app).get(`${D}/deliveries/rit-route?date=${today}&fleet=${encodeURIComponent('DK 1')}`).set(auth(tok || gm));

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_rit', password: 'secret123', role: 'gm' })).token;
  const d = await reg({ name: 'Sopir', username: 'sopir_rit', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: d.user.id }, data: { permissions: JSON.stringify({ distribusiPengiriman: true }) } });
  driver = await login('sopir_rit', 'secret123');
  await mk('A', 1); await mk('B', 2); await mk('C', 3); await mk('Far', 8);
  await mk('NoPoint', 0, { lat: null, lng: null });
  // Demand history: A usually takes 4 (3 and 5), B 2; C and Far have none → 1.
  await sell('A', 3); await sell('A', 5); await sell('B', 2);
  await request(app).get(`${D}/deliveries?date=${today}`).set(auth(gm));   // generate today's stops
});
afterAll(() => prisma.$disconnect());

describe('warehouse location', () => {
  it('a driver cannot move the warehouse', async () => {
    const r = await request(app).put(`${D}/depot`).set(auth(driver)).send(DEPOT);
    expect(r.status).toBe(403);
  });

  it('without a warehouse location the rit cannot be planned — and the message says so', async () => {
    await request(app).post(`${D}/runs/open`).set(auth(gm)).send({ date: today, fleet: 'DK 1', gallonsOut: 7 });
    const r = await rit();
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/gudang/i);
  });

  it('rejects coordinates that are not a place', async () => {
    expect((await request(app).put(`${D}/depot`).set(auth(gm)).send({ lat: 0, lng: 0 })).status).toBe(400);
    expect((await request(app).put(`${D}/depot`).set(auth(gm)).send({ lat: 95, lng: 115 })).status).toBe(400);
  });

  it('the owner sets it; the zone map returns it', async () => {
    const r = await request(app).put(`${D}/depot`).set(auth(gm)).send(DEPOT);
    expect(r.status).toBe(200);
    const z = await request(app).get(`${D}/zones`).set(auth(gm));
    expect(z.body.data.depot).toEqual(DEPOT);
  });
});

describe('planning the open rit', () => {
  it('rit 1 (load 7): from the warehouse, nearest first, customer demand from history', async () => {
    const r = await rit(driver);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.run).toMatchObject({ runNo: 1, gallonsOut: 7 });
    expect(d.origin).toEqual(expect.objectContaining({ source: 'depot', lat: DEPOT.lat, lng: DEPOT.lng }));
    // A (4) → B (2) → 1 left → C (1). Far waits.
    expect(d.rit.map((s) => s.customerName)).toEqual(['A', 'B', 'C']);
    expect(d.rit.map((s) => s.qty)).toEqual([4, 2, 1]);
    expect(d.rit.map((s) => s.loadAfter)).toEqual([3, 1, 0]);
    expect(d.leftover.map((s) => s.customerName)).toEqual(['Far']);
    expect(d.unlocated.map((s) => s.customerName)).toEqual(['NoPoint']);
    expect(d.returnKm).toBeGreaterThan(0);
  });

  it('a stop with an ordered quantity uses it instead of the history', async () => {
    const stop = await prisma.delivery.findFirst({ where: { date: today, customerId: ids.A } });
    await prisma.delivery.update({ where: { id: stop.id }, data: { qty: 6 } });
    const d = (await rit()).body.data;
    expect(d.rit.find((s) => s.customerName === 'A').qty).toBe(6);
    await prisma.delivery.update({ where: { id: stop.id }, data: { qty: null } });
  });

  it('rit 2 starts from the warehouse again and skips what rit 1 delivered', async () => {
    const run1 = await prisma.deliveryRun.findFirst({ where: { date: today, fleetId: 'DK 1', runNo: 1 } });
    await prisma.deliveryRun.update({ where: { id: run1.id }, data: { status: 'closed', closedAt: new Date() } });
    await prisma.delivery.updateMany({ where: { date: today, customerId: { in: [ids.A, ids.B, ids.C] } }, data: { status: 'terkirim' } });
    await request(app).post(`${D}/runs/open`).set(auth(gm)).send({ date: today, fleet: 'DK 1', gallonsOut: 10 });
    const d = (await rit()).body.data;
    expect(d.run.runNo).toBe(2);
    expect(d.rit.map((s) => s.customerName)).toEqual(['Far']);
    expect(d.rit[0].legKm).toBeCloseTo(8, 0);                 // measured from the warehouse
  });

  it('no open rit → 400 asking to open one first', async () => {
    const open = await prisma.deliveryRun.findMany({ where: { date: today, fleetId: 'DK 1', status: 'open' } });
    await prisma.deliveryRun.updateMany({ where: { id: { in: open.map((r) => r.id) } }, data: { status: 'closed', closedAt: new Date() } });
    const r = await rit();
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Buka rit/);
  });
});
