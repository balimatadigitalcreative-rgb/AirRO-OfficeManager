'use strict';
// Delivery runs (rit) — per-trip gallon out/in tracking + auto reconciliation + fleet scope.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);

let owner, custMerah;
const DATE = '2026-10-05';

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_run', password: 'secret123', role: 'owner' })).token;
  const c = await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Cust Merah', type: 'reguler', masterPrice: 5000, armada: 'Merah' });
  custMerah = c.body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — delivery runs (rit) out/in + reconciliation', () => {
  let runId;
  it('MUAT: open rit-1 for Merah loading 100 gallons → status open, runNo 1', async () => {
    const r = await request(app).post('/api/v1/distribusi/runs/open').set(auth(owner)).send({ date: DATE, fleet: 'Merah', gallonsOut: 100 });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ runNo: 1, fleetId: 'Merah', gallonsOut: 100, status: 'open', sold: 0, expectedRemaining: 100 });
    runId = r.body.data.id;
  });

  it('cannot open a second run for the same fleet while one is open', async () => {
    expect((await request(app).post('/api/v1/distribusi/runs/open').set(auth(owner)).send({ date: DATE, fleet: 'Merah', gallonsOut: 50 })).status).toBe(400);
  });

  it('sales during the run auto-link to it and count toward "sold"', async () => {
    // sell 60 gallons across two transactions (40 + 20) — both auto-tagged with the open run
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: custMerah, qty: 40, method: 'lunas', txnDate: DATE });
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: custMerah, qty: 20, method: 'bon', txnDate: DATE });
    const list = await request(app).get(`/api/v1/distribusi/runs?date=${DATE}&fleet=Merah`).set(auth(owner));
    const run = list.body.data.find((x) => x.id === runId);
    expect(run.sold).toBe(60);
    expect(run.expectedRemaining).toBe(40);   // 100 loaded − 60 sold
    const txns = await prisma.distTransaction.findMany({ where: { deliveryRunId: runId } });
    expect(txns.length).toBe(2);
  });

  it('TUTUP with returned 40 = expected 40 → reconciles (diff 0), no reason needed', async () => {
    const r = await request(app).post(`/api/v1/distribusi/runs/${runId}/close`).set(auth(owner)).send({ gallonsFullReturned: 40, gallonsEmptyReturned: 55 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'closed', sold: 60, expectedRemaining: 40, gallonsFullReturned: 40, gallonsEmptyReturned: 55, diff: 0 });
  });

  it('a mismatch (returned 38, expected 40) is REJECTED without a reason, accepted with one (diff −2)', async () => {
    // new run: load 100, sell 60 again
    const open = await request(app).post('/api/v1/distribusi/runs/open').set(auth(owner)).send({ date: DATE, fleet: 'Merah', gallonsOut: 100 });
    const rid = open.body.data.id;
    expect(open.body.data.runNo).toBe(2);
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: custMerah, qty: 60, method: 'lunas', txnDate: DATE });
    // returned 38 vs expected 40 → diff −2, no reason → 400
    const bad = await request(app).post(`/api/v1/distribusi/runs/${rid}/close`).set(auth(owner)).send({ gallonsFullReturned: 38, gallonsEmptyReturned: 50 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/selisih|-2/i);
    // with a reason → accepted, diff −2 recorded
    const ok = await request(app).post(`/api/v1/distribusi/runs/${rid}/close`).set(auth(owner)).send({ gallonsFullReturned: 38, gallonsEmptyReturned: 50, diffReason: '2 galon pecah di jalan' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ diff: -2, diffReason: '2 galon pecah di jalan', status: 'closed' });
  });

  it('the day report lists both runs with reconciliation; audit records muat + tutup', async () => {
    const list = await request(app).get(`/api/v1/distribusi/runs?date=${DATE}`).set(auth(owner));
    const runs = list.body.data.filter((r) => r.fleetId === 'Merah');
    expect(runs.length).toBe(2);
    expect(runs.map((r) => r.runNo).sort()).toEqual([1, 2]);
    const audit = await request(app).get('/api/v1/distribusi/audit').set(auth(owner));
    expect(audit.body.data.some((a) => /Muat rit-1: Merah/.test(a.title))).toBe(true);
    expect(audit.body.data.some((a) => /Tutup rit-2: Merah/.test(a.title))).toBe(true);
  });

  it('gallon STOCK is unaffected by runs (still driven by per-customer movements — no second number)', async () => {
    // set opening 500; the two runs sold 120 gallons total via delivery_out (per customer).
    // totalOwned only changes on purchase/opening/correction/damage — NOT on run open/close.
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 500, reason: 'stok awal', fleet: 'Merah' });
    const g = await request(app).get('/api/v1/distribusi/gallon?fleet=Merah').set(auth(owner));
    expect(g.body.data.stock.totalOwned).toBe(500);   // runs did not add/remove owned gallons
  });

  it('fleet scope + capability are server-enforced', async () => {
    // a Biru-scoped helper cannot open/see Merah runs
    const u = await reg({ name: 'Helper', username: 'help_run', password: 'secret123', role: 'gm' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(owner)).send({ fleetScope: ['Biru'] });
    const h = await login('help_run', 'secret123');
    expect((await request(app).post('/api/v1/distribusi/runs/open').set(auth(h)).send({ date: DATE, fleet: 'Merah', gallonsOut: 10 })).status).toBe(403);
    const seen = await request(app).get(`/api/v1/distribusi/runs?date=${DATE}`).set(auth(h));
    expect(seen.body.data.every((r) => r.fleetId !== 'Merah')).toBe(true);   // Merah runs hidden
    // no distribusiPengiriman at all → 403
    const f = (await reg({ name: 'Fin', username: 'fin_run', password: 'secret123', role: 'finance' })).token;
    expect((await request(app).get('/api/v1/distribusi/runs').set(auth(f))).status).toBe(403);
  });
});
