'use strict';
// Reset Jumlah Galon (GM-only). Mode (a) balanced appends corrections → numbers hit the target,
// ledger history kept. Mode (b) purge deletes the gallon ledger. Server enforces the capability.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const stock = async (t) => (await request(app).get('/api/v1/distribusi/gallon').set(auth(t))).body.data;

let gm, cid;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_gr', password: 'secret123', role: 'gm' })).token;
  const c = await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'C1', type: 'reguler', masterPrice: 5000 });
  cid = c.body.data.id;
  // build some stock: opening 200 at depot + a sale that pushes 60 to the customer
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 200, reason: 'stok awal' });
  await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 60, method: 'lunas', txnDate: '2026-10-01' });
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — Reset Jumlah Galon (GM only)', () => {
  it('starts with total 200, at-customers 60, at-depot 140', async () => {
    const s = await stock(gm);
    expect(s.stock).toMatchObject({ totalOwned: 200, atCustomers: 60, atDepot: 140 });
  });

  it('mode (a) balanced → all three become 0, ledger KEEPS history + adds reset rows', async () => {
    const movBefore = (await stock(gm)).movements.length;
    const r = await request(app).post('/api/v1/distribusi/gallon/reset').set(auth(gm)).send({ mode: 'balanced', fleet: 'all', target: 0, reason: 'reset akhir tahun' });
    expect(r.status).toBe(201);
    expect(r.body.data.before).toMatchObject({ totalOwned: 200, atCustomers: 60 });
    expect(r.body.data.after).toMatchObject({ totalOwned: 0, atCustomers: 0, atDepot: 0 });
    const s = await stock(gm);
    expect(s.stock).toMatchObject({ totalOwned: 0, atCustomers: 0, atDepot: 0 });     // recomputed from ledger
    expect(s.movements.length).toBeGreaterThan(movBefore);                             // history intact + reset rows
    expect(s.movements.some((m) => /Reset stok galon/i.test(m.note || ''))).toBe(true);
    expect((s.balances || []).length).toBe(0);                                         // no customer holds gallons now
    // reason wajib
    expect((await request(app).post('/api/v1/distribusi/gallon/reset').set(auth(gm)).send({ mode: 'balanced' })).status).toBe(400);
  });

  it('mode (a) can reset TO A VALUE (target 500) — total & depot become 500, customers 0', async () => {
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 10, method: 'lunas', txnDate: '2026-10-02' });
    const r = await request(app).post('/api/v1/distribusi/gallon/reset').set(auth(gm)).send({ mode: 'balanced', fleet: 'all', target: 500, reason: 'set ulang' });
    expect(r.status).toBe(201);
    const s = await stock(gm);
    expect(s.stock).toMatchObject({ totalOwned: 500, atCustomers: 0, atDepot: 500 });
  });

  it('mode (b) purge requires confirm="RESET", then empties the gallon ledger', async () => {
    const noConfirm = await request(app).post('/api/v1/distribusi/gallon/reset').set(auth(gm)).send({ mode: 'purge', fleet: 'all', reason: 'wipe' });
    expect(noConfirm.status).toBe(400);
    const r = await request(app).post('/api/v1/distribusi/gallon/reset').set(auth(gm)).send({ mode: 'purge', fleet: 'all', confirm: 'RESET', reason: 'wipe total' });
    expect(r.status).toBe(201);
    expect(r.body.data.deleted).toBeGreaterThan(0);
    const s = await stock(gm);
    expect(s.stock).toMatchObject({ totalOwned: 0, atCustomers: 0, atDepot: 0 });
    expect((await prisma.gallonMovement.count())).toBe(0);   // ledger empty
  });

  it('the reset is written to the Distribusi audit log (who/mode/scope/before→after/reason)', async () => {
    const audit = await request(app).get('/api/v1/distribusi/audit').set(auth(gm));
    expect(audit.body.data.some((a) => /Reset stok galon \(tercatat\)/i.test(a.title))).toBe(true);
    expect(audit.body.data.some((a) => /Reset stok galon — HAPUS PERMANEN/i.test(a.title))).toBe(true);
  });

  it('is GM/owner-only: a user WITHOUT distribusiGallonReset is rejected 403 (not just a hidden button)', async () => {
    const u = await reg({ name: 'Helper', username: 'help_gr', password: 'secret123', role: 'finance' });
    // give full distribusi (incl. gallon view) but explicitly NOT the reset cap
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiGallon: true, distribusiGallonReset: false } });
    const t = await login('help_gr', 'secret123');
    expect((await request(app).get('/api/v1/distribusi/gallon').set(auth(t))).status).toBe(200);          // may view
    expect((await request(app).post('/api/v1/distribusi/gallon/reset').set(auth(t)).send({ mode: 'balanced', reason: 'x' })).status).toBe(403);   // may NOT reset
  });

  it('legacy full-distribusi does NOT silently grant reset (derives false)', async () => {
    const u = await reg({ name: 'Legacy', username: 'leg_gr', password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ permissions: { distribusi: true } });   // only the legacy combined cap
    const t = await login('leg_gr', 'secret123');
    expect((await request(app).post('/api/v1/distribusi/gallon/reset').set(auth(t)).send({ mode: 'balanced', reason: 'x' })).status).toBe(403);
  });
});
