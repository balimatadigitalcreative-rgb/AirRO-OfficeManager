'use strict';
// Dashboard bon KPI = BON BARU within the selected period + fleet (`piutang` = byMethod.bon), NOT the
// all-time outstanding debt. The all-time total (`receivable` = Σbon − Σpelunasan, fleet-scoped) is a
// DIFFERENT number kept alongside. This asserts both, the period/fleet scoping, and the invariant.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const sell = (t, cid, body) => request(app).post('/api/v1/distribusi/transactions').set(auth(t)).send({ customerId: cid, ...body });
const dash = async (t, qs) => (await request(app).get('/api/v1/distribusi/dashboard/summary' + (qs || '')).set(auth(t))).body.data;

// dates: TODAY (this month) and a day in the PREVIOUS month, both this year, so 'month' excludes the
// previous-month bon while a wide range includes it.
const TODAY = new Date().toISOString().slice(0, 10);
const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
const LAST_MONTH = d.toISOString().slice(0, 10);
const MONTH_START = TODAY.slice(0, 8) + '01';

let gm, cM, cB;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_bb', password: 'secret123', role: 'gm' })).token;   // owner/GM → has distribusiDashHistory
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 999, reason: 'stok awal', fleet: 'Merah' });
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 999, reason: 'stok awal', fleet: 'Biru' });
  cM = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Merah Cust', type: 'reguler', masterPrice: 1000, armada: 'Merah' })).body.data.id;
  cB = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Biru Cust', type: 'reguler', masterPrice: 1000, armada: 'Biru' })).body.data.id;
  // MERAH: bon 30.000 today + bon 20.000 last month + pelunasan 10.000 today
  await sell(gm, cM, { qty: 30, method: 'bon', txnDate: TODAY, gallonOut: 30 });
  await sell(gm, cM, { qty: 20, method: 'bon', txnDate: LAST_MONTH, gallonOut: 20 });
  await sell(gm, cM, { qty: 0, method: 'pelunasan', payAmount: 10000, payMethod: 'cash', txnDate: TODAY });
  // BIRU: bon 7.000 today
  await sell(gm, cB, { qty: 7, method: 'bon', txnDate: TODAY, gallonOut: 7 });
});
afterAll(() => prisma.$disconnect());

describe('dashboard — Bon Baru (period+fleet) vs all-time Total Piutang', () => {
  it('"Hari ini" (all fleets): bon baru = only today\'s new bon; total piutang = all-time outstanding', async () => {
    const s = await dash(gm, '?period=today&fleet=all');
    expect(s.piutang).toBe(37000);       // 30.000 (Merah today) + 7.000 (Biru today) — today's NEW bon
    // all-time outstanding = Σbon − Σpelunasan, floored per customer: Merah (30+20−10)=40.000, Biru 7.000
    expect(s.receivable).toBe(47000);    // the real money owed — a DIFFERENT, larger number
    expect(s.piutang).not.toBe(s.receivable);
  });

  it('"Bulan ini": bon baru = only THIS month\'s bon (last month\'s 20.000 excluded); total unchanged', async () => {
    const s = await dash(gm, `?period=range&dateFrom=${MONTH_START}&dateTo=${TODAY}&fleet=all`);
    expect(s.piutang).toBe(37000);       // 30.000 + 7.000 — this-month bon only
    expect(s.receivable).toBe(47000);    // all-time, unchanged by the period
  });

  it('fleet chip scopes bon baru: Merah vs Biru differ; the all-time total is fleet-scoped too', async () => {
    const merah = await dash(gm, '?period=today&fleet=Merah');
    const biru = await dash(gm, '?period=today&fleet=Biru');
    expect(merah.piutang).toBe(30000);   // Merah's today bon
    expect(biru.piutang).toBe(7000);     // Biru's today bon
    expect(merah.receivable).toBe(40000);   // Merah all-time (30+20−10)
    expect(biru.receivable).toBe(7000);     // Biru all-time
  });

  it('INVARIANT: a full range covering everything → bon baru = Σ ALL bon; total piutang = Σbon−Σpelunasan', async () => {
    const s = await dash(gm, '?period=range&dateFrom=2000-01-01&dateTo=2999-12-31&fleet=all');
    expect(s.piutang).toBe(57000);       // 30.000 + 20.000 + 7.000 — every bon created
    expect(s.receivable).toBe(47000);    // Σbon(57.000) − Σpelunasan(10.000) — the two are different BY DESIGN
    // per-fleet sums equal the combined bon baru
    const merah = await dash(gm, '?period=range&dateFrom=2000-01-01&dateTo=2999-12-31&fleet=Merah');
    const biru = await dash(gm, '?period=range&dateFrom=2000-01-01&dateTo=2999-12-31&fleet=Biru');
    expect(merah.piutang + biru.piutang).toBe(s.piutang);   // 50.000 + 7.000
  });

  it('history gating: a today-locked user gets today\'s bon baru; a crafted stale period is refused (403)', async () => {
    const u = await reg({ name: 'Staff', username: 'stf_bb', password: 'secret123', role: 'finance' });
    // distribusi + dashboard, but NO distribusiDashHistory → locked to today
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiDashboard: true, distribusiDashHistory: false } });
    const t = (await request(app).post('/api/v1/auth/login').send({ username: 'stf_bb', password: 'secret123' })).body.token;
    // the FRONTEND clamps to today for a non-history user (per = canHistory ? period : 'today'), so it
    // only ever sends "today" — which returns today's bon baru and never bricks the card.
    const s = await dash(t, '?period=today&fleet=all');
    expect(s.canHistory).toBe(false);
    expect(s.piutang).toBe(37000);       // today's new bon only
    // and the server is the backstop: a hand-crafted non-today range from this user is refused.
    const crafted = await request(app).get('/api/v1/distribusi/dashboard/summary?period=range&dateFrom=2000-01-01&dateTo=2999-12-31').set(auth(t));
    expect(crafted.status).toBe(403);
  });
});
