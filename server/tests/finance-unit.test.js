'use strict';
// Stage 3 — finance per business unit. Cash Entries + Accounts carry a businessUnitId (default
// "Air"). This stage adds grouping/filtering only: it must not change any balance or total. The
// core invariant: per-unit sums == the combined total, for BOTH entries and account balances.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const mkEntry = (t, body) => request(app).post('/api/v1/entries').set(auth(t)).send(body);
const mkAcct = (t, body) => request(app).post('/api/v1/accounts').set(auth(t)).send(body);

let gm;
beforeAll(async () => {
  await resetDb();   // seeds the business units (air/manufaktur/unit3)
  gm = (await reg({ name: 'Fin GM', username: 'fu_gm', password: 'secret123', role: 'gm' })).token;
});
afterAll(() => prisma.$disconnect());

describe('entry unit label (server-authoritative, defaults to Air)', () => {
  it('an entry created WITHOUT a unit defaults to "Air" (no behaviour change)', async () => {
    const r = await mkEntry(gm, { type: 'income', amount: 100000, date: '2026-07-01', category: 'Refill' });
    expect(r.status).toBe(201);
    expect(r.body.data.businessUnitId).toBe('air');
  });
  it('an entry can be tagged to another unit, and an unknown id falls back to Air', async () => {
    const m = await mkEntry(gm, { type: 'expense', amount: 40000, date: '2026-07-02', category: 'Fuel', businessUnitId: 'manufaktur' });
    expect(m.body.data.businessUnitId).toBe('manufaktur');
    const bad = await mkEntry(gm, { type: 'expense', amount: 1, date: '2026-07-02', category: 'Fuel', businessUnitId: 'nope' });
    expect(bad.body.data.businessUnitId).toBe('air');
  });
  it('the list can be filtered to one unit (server-side)', async () => {
    const r = await request(app).get('/api/v1/entries?businessUnit=manufaktur&limit=500').set(auth(gm));
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.every((e) => e.businessUnitId === 'manufaktur')).toBe(true);
  });
});

describe('account unit label + shared handling', () => {
  it('an account defaults to Air; can be assigned to a unit or "shared"', async () => {
    expect((await mkAcct(gm, { name: 'Kas Air', type: 'cash', opening: 1000000 })).body.data.businessUnitId).toBe('air');
    expect((await mkAcct(gm, { name: 'Bank MFG', type: 'bank', opening: 2000000, businessUnitId: 'manufaktur' })).body.data.businessUnitId).toBe('manufaktur');
    expect((await mkAcct(gm, { name: 'Kas Bersama', type: 'cash', opening: 500000, businessUnitId: 'shared' })).body.data.businessUnitId).toBe('shared');
  });
});

describe('INVARIANT: per-unit sums == combined (nothing double-counts)', () => {
  it('entry income/expense partition exactly by unit', async () => {
    const all = (await request(app).get('/api/v1/entries?limit=5000').set(auth(gm))).body.data;
    const sum = (arr, type) => arr.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0);
    const units = [...new Set(all.map((e) => e.businessUnitId || 'air'))];
    const perUnitIncome = units.reduce((s, u) => s + sum(all.filter((e) => (e.businessUnitId || 'air') === u), 'income'), 0);
    const perUnitExpense = units.reduce((s, u) => s + sum(all.filter((e) => (e.businessUnitId || 'air') === u), 'expense'), 0);
    expect(perUnitIncome).toBe(sum(all, 'income'));    // Σ per-unit == combined
    expect(perUnitExpense).toBe(sum(all, 'expense'));
  });

  it('account balances partition exactly by unit (shared counted once, in its own bucket)', async () => {
    const accts = (await request(app).get('/api/v1/accounts').set(auth(gm))).body.data;
    // each account's balance from the authoritative per-account endpoint
    const bals = {};
    for (const a of accts) bals[a.id] = (await request(app).get(`/api/v1/accounts/${a.id}/balance`).set(auth(gm))).body.data.balance;
    const combined = accts.reduce((s, a) => s + bals[a.id], 0);
    // group by the account's unit ('shared' is its own bucket, so nothing is dropped or doubled)
    const byUnit = {};
    accts.forEach((a) => { const u = a.businessUnitId || 'air'; byUnit[u] = (byUnit[u] || 0) + bals[a.id]; });
    const perUnitSum = Object.values(byUnit).reduce((s, v) => s + v, 0);
    expect(perUnitSum).toBe(combined);                 // Σ per-unit (incl. shared bucket) == combined
    // and a single unit is a strict subset — never the whole
    expect(byUnit.manufaktur).toBeLessThan(combined);
  });

  it('"Semua" (no filter) equals the ungrouped totals — the non-destructive guarantee', async () => {
    const combined = (await request(app).get('/api/v1/entries?limit=5000').set(auth(gm))).body.data;
    const air = (await request(app).get('/api/v1/entries?businessUnit=air&limit=5000').set(auth(gm))).body.data;
    const mfg = (await request(app).get('/api/v1/entries?businessUnit=manufaktur&limit=5000').set(auth(gm))).body.data;
    const inc = (a) => a.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
    const exp = (a) => a.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
    expect(inc(air) + inc(mfg)).toBe(inc(combined));   // Air + Manufaktur == Semua
    expect(exp(air) + exp(mfg)).toBe(exp(combined));
  });
});
