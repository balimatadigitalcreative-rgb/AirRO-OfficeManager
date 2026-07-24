'use strict';
// DAILY CLOSEOUT ACCESS — a delivery helper must be able to close their own day.
// The two reads are deliberately SEPARATE:
//   • the day's closeout state for the fleets in scope rides along on the BOARD response
//     (GET /deliveries, cap distribusiPengiriman) — that is what the Pengiriman screen uses;
//   • GET /closeouts is the ADMIN cross-fleet report and stays on distribusiDashboard.
// Creating a closeout (POST /deliveries/close) is gated on distribusiPengiriman — the people who
// actually run the deliveries — and is fleet-scoped server-side.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const DAY = '2026-07-24';
const board = (t, qs) => request(app).get('/api/v1/distribusi/deliveries?' + qs).set(auth(t));
const close = (t, body) => request(app).post('/api/v1/distribusi/deliveries/close').set(auth(t)).send(body);

let gm, helper, helperId;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_co', password: 'secret123', role: 'gm' })).token;
  // a HELPER: only distribusiPengiriman, scoped to Merah. `distribusi` is NOT stored, so the
  // derive back-fill (which reads the legacy combined flag) leaves distribusiDashboard FALSE.
  const h = await reg({ name: 'Helper Merah', username: 'helper_co', password: 'secret123', role: 'finance' });
  helperId = h.user.id;
  await prisma.user.update({ where: { id: helperId }, data: {
    permissions: JSON.stringify({ distribusiPengiriman: true }),
    fleetScope: JSON.stringify(['Merah']),
  } });
  helper = await login('helper_co', 'secret123');
  // one customer per fleet, each with a stop on DAY (Wed) so the boards are non-empty
  const cM = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Merah Cust', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
  const cB = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Biru Cust', type: 'reguler', masterPrice: 6000, armada: 'Biru' })).body.data.id;
  await request(app).post('/api/v1/distribusi/deliveries/order').set(auth(gm)).send({ customerId: cM, date: DAY, qty: 2 });
  await request(app).post('/api/v1/distribusi/deliveries/order').set(auth(gm)).send({ customerId: cB, date: DAY, qty: 2 });
});
afterAll(() => prisma.$disconnect());

describe('daily closeout — helper access', () => {
  it('the helper can READ their day/fleet closeout state via the board (no admin cap needed)', async () => {
    const r = await board(helper, 'date=' + DAY);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.closeouts)).toBe(true);   // the scoped closeout read rides on the board
    expect(r.body.closeouts).toHaveLength(0);             // not closed yet
    // fleet scope: they only ever see their own armada's stops
    expect(r.body.data.every((s) => s.fleetId === 'Merah')).toBe(true);
    expect(r.body.data.length).toBeGreaterThan(0);
  });

  it('the helper CANNOT read the cross-fleet admin report (403)', async () => {
    expect((await request(app).get('/api/v1/distribusi/closeouts?date=' + DAY).set(auth(helper))).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/closeouts').set(auth(helper))).status).toBe(403);
    // …while an admin still can
    expect((await request(app).get('/api/v1/distribusi/closeouts?date=' + DAY).set(auth(gm))).status).toBe(200);
  });

  it('the helper can CREATE the closeout for their own fleet, and it records who/when', async () => {
    const stops = (await board(helper, 'date=' + DAY)).body.data;
    const reasons = {}; stops.filter((s) => s.status === 'pending').forEach((s) => { reasons[s.id] = 'belum sempat'; });
    const r = await close(helper, { date: DAY, generalNote: 'hujan deras', reasons });
    expect(r.status).toBe(201);
    // the response IS the closeout record
    expect(r.body.data).toMatchObject({ date: DAY, fleetId: 'Merah', closedByName: 'Helper Merah', generalNote: 'hujan deras' });
    expect(r.body.data.closedAt).toBeTruthy();
  });

  it('after closing, the helper SEES the closeout state on their board (who + when)', async () => {
    const r = await board(helper, 'date=' + DAY);
    expect(r.status).toBe(200);
    expect(r.body.closeouts).toHaveLength(1);
    expect(r.body.closeouts[0]).toMatchObject({ date: DAY, fleetId: 'Merah', closedByName: 'Helper Merah', generalNote: 'hujan deras' });
    expect(r.body.closeouts[0].closedAt).toBeTruthy();
    // still no access to the admin report
    expect((await request(app).get('/api/v1/distribusi/closeouts').set(auth(helper))).status).toBe(403);
  });

  it('the helper cannot close another fleet — the write is scoped server-side (403)', async () => {
    expect((await close(helper, { date: DAY, fleet: 'Biru' })).status).toBe(403);
    // and Biru is genuinely still open (visible to the admin report)
    const adm = await request(app).get('/api/v1/distribusi/closeouts?date=' + DAY).set(auth(gm));
    expect(adm.body.data.some((c) => c.fleetId === 'Biru')).toBe(false);
  });

  it('an EMPTY board still exposes closeout state + allows closing (the bug: no stops → no button)', async () => {
    const EMPTY = '2026-07-25';
    const r = await board(helper, 'date=' + EMPTY);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(0);              // nothing scheduled that day…
    expect(r.body.closeouts).toHaveLength(0);
    // …the helper can still close the day (the fleet comes from their scope, not from the board)
    const c = await close(helper, { date: EMPTY });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ date: EMPTY, fleetId: 'Merah', closedByName: 'Helper Merah' });
    expect((await board(helper, 'date=' + EMPTY)).body.closeouts).toHaveLength(1);
  });

  it('a user without distribusiPengiriman can neither read the board nor close (403)', async () => {
    const u = await reg({ name: 'NoPeng', username: 'nopeng_co', password: 'secret123', role: 'finance' });
    await prisma.user.update({ where: { id: u.user.id }, data: { permissions: JSON.stringify({ distribusiInput: true, distribusiPengiriman: false }) } });
    const t = await login('nopeng_co', 'secret123');
    expect((await board(t, 'date=' + DAY)).status).toBe(403);
    expect((await close(t, { date: DAY })).status).toBe(403);
  });
});
