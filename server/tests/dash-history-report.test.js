'use strict';
// A) Dashboard defaults to TODAY; earlier periods require distribusiDashHistory (server-enforced).
// B) Laporan Pengiriman (delivery report) — read-only per-fleet report, cap distribusiPengirimanReport.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const YESTERDAY = addDays(TODAY, -1);

let owner, custBiru;

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_hr', password: 'secret123', role: 'owner' })).token;
  custBiru = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'C Biru', type: 'reguler', masterPrice: 6000, armada: 'Biru' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('A — dashboard today-only default + history capability', () => {
  it('a helper WITHOUT distribusiDashHistory: today works, any other period/date is 403', async () => {
    const u = await reg({ name: 'Helper', username: 'help_hr', password: 'secret123', role: 'gm' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(owner)).send({ permissions: { distribusi: true, distribusiDashboard: true, distribusiDashHistory: false } });
    const h = await login('help_hr', 'secret123');
    // today (default) is allowed
    const t = await request(app).get('/api/v1/distribusi/dashboard/summary').set(auth(h));
    expect(t.status).toBe(200);
    expect(t.body.data.period).toBe('today');
    expect(t.body.data.canHistory).toBe(false);
    expect(t.body.data.from).toBe(TODAY);
    expect(t.body.data.to).toBe(TODAY);
    // explicit period=today is allowed
    expect((await request(app).get('/api/v1/distribusi/dashboard/summary?period=today').set(auth(h))).status).toBe(200);
    // any earlier period / date / range is REJECTED server-side (not just hidden)
    expect((await request(app).get('/api/v1/distribusi/dashboard/summary?period=week').set(auth(h))).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/dashboard/summary?period=month').set(auth(h))).status).toBe(403);
    expect((await request(app).get(`/api/v1/distribusi/dashboard/summary?date=${YESTERDAY}`).set(auth(h))).status).toBe(403);
    expect((await request(app).get(`/api/v1/distribusi/dashboard/summary?period=range&dateFrom=${YESTERDAY}&dateTo=${TODAY}`).set(auth(h))).status).toBe(403);
  });

  it('an owner (has the cap) switches periods freely; the window drives the KPIs', async () => {
    // sell today + yesterday so a 7-day window differs from today
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: custBiru, qty: 2, method: 'lunas', txnDate: TODAY });      // 12 000 today
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: custBiru, qty: 5, method: 'lunas', txnDate: YESTERDAY });  // 30 000 yesterday
    const today = (await request(app).get('/api/v1/distribusi/dashboard/summary?period=today').set(auth(owner))).body.data;
    expect(today.canHistory).toBe(true);
    expect(today.periodIn).toBe(12000);           // today only
    const week = (await request(app).get('/api/v1/distribusi/dashboard/summary?period=week').set(auth(owner))).body.data;
    expect(week.period).toBe('week');
    expect(week.periodIn).toBe(42000);            // today + yesterday within the 7-day window
    expect(week.from).toBe(addDays(TODAY, -6));
    expect(week.series.length).toBe(7);
  });
});

describe('B — Laporan Pengiriman (delivery report)', () => {
  let rid;
  it('builds a per-fleet report combining rits, stops, closeout, and cash — cap-gated', async () => {
    // a rit on Biru: muat 20, sell 2 (already sold 12 000 above today == 2 gallons via custBiru? no,
    // that sale预 wasn't tagged to this run). Open a fresh run and sell within it.
    const openR = await request(app).post('/api/v1/distribusi/runs/open').set(auth(owner)).send({ date: TODAY, fleet: 'Biru', gallonsOut: 20 });
    rid = openR.body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: custBiru, qty: 3, method: 'lunas', txnDate: TODAY });   // cash, tagged to the open run
    await request(app).post(`/api/v1/distribusi/runs/${rid}/close`).set(auth(owner)).send({ gallonsFullReturned: 17, gallonsEmptyReturned: 9 });
    // a field expense on Biru today
    await request(app).post('/api/v1/distribusi/expenses').set(auth(owner)).send({ date: TODAY, fleet: 'Biru', amount: 5000, category: 'bensin' });

    const r = await request(app).get(`/api/v1/distribusi/reports/delivery?date=${TODAY}`).set(auth(owner));
    expect(r.status).toBe(200);
    expect(r.body.data.from).toBe(TODAY);
    const biru = r.body.data.fleets.find((f) => f.fleetId === 'Biru');
    expect(biru).toBeTruthy();
    // rits
    expect(biru.runs.length).toBe(1);
    expect(biru.runTotals).toMatchObject({ out: 20, sold: 3, full: 17, empty: 9 });
    // cash: all today's Biru lunas is cash; net = cash − field expenses
    expect(biru.cash.tunai).toBeGreaterThanOrEqual(18000);   // ≥ the run's 3-gallon sale
    expect(biru.cash.expense).toBe(5000);
    expect(biru.cash.net).toBe(biru.cash.tunai - 5000);
    // combined totals present
    expect(r.body.data.totals.cash.expense).toBe(5000);
    expect(r.body.data.totals.runs.out).toBe(20);
  });

  it('respects fleet scope and is cap-enforced (403 without distribusiPengirimanReport)', async () => {
    // Merah-scoped user WITH the report cap sees only Merah (no Biru rits)
    const u = await reg({ name: 'Rep', username: 'rep_hr', password: 'secret123', role: 'gm' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(owner)).send({ permissions: { distribusi: true, distribusiPengirimanReport: true }, fleetScope: ['Merah'] });
    const rep = await login('rep_hr', 'secret123');
    const scoped = await request(app).get(`/api/v1/distribusi/reports/delivery?date=${TODAY}`).set(auth(rep));
    expect(scoped.status).toBe(200);
    expect(scoped.body.data.fleets.every((f) => f.fleetId === 'Merah')).toBe(true);   // no Biru leakage

    // a user WITHOUT the report cap → 403
    const noCap = (await reg({ name: 'Fin', username: 'fin_hr', password: 'secret123', role: 'finance' })).token;
    expect((await request(app).get(`/api/v1/distribusi/reports/delivery?date=${TODAY}`).set(auth(noCap))).status).toBe(403);
  });
});
