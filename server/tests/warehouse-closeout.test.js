'use strict';
// Daily warehouse closeout (opname) — confirm/physical count, opname difference → correction
// with mandatory reason (append, no silent overwrite), saved report visible to supervisors.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { seedInventoryItems } = require('../src/services/gudang.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const DATE = '2026-11-03';
let owner;
const sys = (data, id) => data.items.find((i) => i.itemId === id).system;

beforeAll(async () => {
  await resetDb();
  await seedInventoryItems();
  owner = (await reg({ name: 'Owner', username: 'own_co', password: 'secret123', role: 'owner' })).token;
  // give the good-gallon item a system stock of 60 via opening
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 60, reason: 'stok awal' });
  // sticker system 100
  await request(app).post('/api/v1/gudang/items/sticker/stock').set(auth(owner)).send({ type: 'in', qty: 100, reason: 'beli' });
});
afterAll(() => prisma.$disconnect());

describe('Gudang — daily warehouse closeout (opname)', () => {
  it('preview shows the system stock per item + a day summary + not-yet-closed', async () => {
    const r = await request(app).get(`/api/v1/gudang/closeout?date=${DATE}`).set(auth(owner));
    expect(r.status).toBe(200);
    expect(r.body.data.closed).toBe(false);
    expect(sys(r.body.data, 'galon')).toBe(60);
    expect(sys(r.body.data, 'sticker')).toBe(100);
    expect(r.body.data.summary).toHaveProperty('runsOut');
  });

  it('a physical count that MATCHES needs no reason and closes cleanly (diff 0)', async () => {
    const r = await request(app).post('/api/v1/gudang/closeout').set(auth(owner)).send({
      date: '2026-11-01',
      items: [{ itemId: 'galon', physical: 60 }, { itemId: 'sticker', physical: 100 }],
      note: 'aman',
    });
    expect(r.status).toBe(201);
    expect(r.body.data.diffCount).toBe(0);
    expect(r.body.data.closedByName).toBe('Owner');
  });

  it('physical galon 58 vs system 60 → diff −2 is REJECTED without a reason', async () => {
    const r = await request(app).post('/api/v1/gudang/closeout').set(auth(owner)).send({
      date: DATE, items: [{ itemId: 'galon', physical: 58 }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/selisih|opname/i);
  });

  it('with a reason → closes, posts a −2 gallon correction (system now 58), records the opname', async () => {
    const before = (await request(app).get('/api/v1/distribusi/gallon').set(auth(owner))).body.data.stock.totalOwned;
    expect(before).toBe(60);
    const r = await request(app).post('/api/v1/gudang/closeout').set(auth(owner)).send({
      date: DATE,
      items: [{ itemId: 'galon', physical: 58, reason: 'hitung ulang fisik' }, { itemId: 'sticker', physical: 100 }],
      note: 'galon selisih -2',
    });
    expect(r.status).toBe(201);
    expect(r.body.data.diffCount).toBe(1);
    const galonRow = r.body.data.items.find((i) => i.itemId === 'galon');
    expect(galonRow).toMatchObject({ system: 60, physical: 58, diff: -2, reason: 'hitung ulang fisik' });
    // the correction was posted → the ledger now equals the physical count (append, not overwrite)
    const after = (await request(app).get('/api/v1/distribusi/gallon').set(auth(owner))).body.data;
    expect(after.stock.totalOwned).toBe(58);
    expect(after.movements.some((m) => m.type === 'correction' && /Opname/.test(m.note))).toBe(true);
  });

  it('a date can only be closed once', async () => {
    const r = await request(app).post('/api/v1/gudang/closeout').set(auth(owner)).send({ date: DATE, items: [] });
    expect(r.status).toBe(400);
  });

  it('the closeout report is saved & visible (supervisors), with the difference count', async () => {
    const list = await request(app).get('/api/v1/gudang/closeouts').set(auth(owner));
    expect(list.status).toBe(200);
    const co = list.body.data.find((c) => c.date === DATE);
    expect(co).toBeTruthy();
    expect(co.diffCount).toBe(1);
    expect(co.note).toBe('galon selisih -2');
    // preview now reports it as closed
    const p = await request(app).get(`/api/v1/gudang/closeout?date=${DATE}`).set(auth(owner));
    expect(p.body.data.closed).toBe(true);
  });

  it('closeout is gated by gudangReport — server-enforced', async () => {
    const u = await reg({ name: 'V', username: 'v_co', password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(owner)).send({ permissions: { gudangView: true, gudangReport: false } });
    const t = await login('v_co', 'secret123');
    expect((await request(app).get('/api/v1/gudang/closeout?date=2026-11-09').set(auth(t))).status).toBe(403);
    expect((await request(app).post('/api/v1/gudang/closeout').set(auth(t)).send({ date: '2026-11-09', items: [] })).status).toBe(403);
    expect((await request(app).get('/api/v1/gudang/closeouts').set(auth(t))).status).toBe(403);
  });
});
