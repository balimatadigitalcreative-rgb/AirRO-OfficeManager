'use strict';
// Gudang (warehouse) — ledger-based inventory: seeded items, stock-in, buffer/restock,
// signed corrections, galon-is-read-only, and per-endpoint capability gating.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { seedInventoryItems } = require('../src/services/gudang.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);

let owner, viewer;
const sum = async (t) => (await request(app).get('/api/v1/gudang/summary').set(auth(t))).body.data;
const itemOf = (data, id) => data.items.find((i) => i.id === id);

beforeAll(async () => {
  await resetDb();
  await seedInventoryItems();
  owner = (await reg({ name: 'Owner', username: 'own_g', password: 'secret123', role: 'owner' })).token;
});
afterAll(() => prisma.$disconnect());

describe('Gudang — inventory ledger, buffer/restock, permissions', () => {
  it('seeds the built-in items (Galon/Galon Rusak/Sticker/Tutup/Segel), each starting at 0', async () => {
    const d = await sum(owner);
    const ids = d.items.map((i) => i.id).sort();
    expect(ids).toEqual(['galon', 'galon_rusak', 'segel', 'sticker', 'tutup']);
    expect(itemOf(d, 'sticker').stock).toBe(0);
    expect(itemOf(d, 'galon').managed).toBe(false);   // galon is read-only here
  });

  it('add sticker stock 500 → stock 500, recorded in the ledger with a reason + actor', async () => {
    const r = await request(app).post('/api/v1/gudang/items/sticker/stock').set(auth(owner)).send({ type: 'in', qty: 500, reason: 'nota #1' });
    expect(r.status).toBe(201);
    expect(r.body.data.stock).toBe(500);
    const d = await sum(owner);
    expect(itemOf(d, 'sticker').stock).toBe(500);
    const mv = d.movements.find((m) => m.itemId === 'sticker');
    expect(mv).toMatchObject({ type: 'in', qty: 500, reason: 'nota #1' });
    expect(mv.actorName).toBe('Owner');
  });

  it('buffer 100 with stock 500 = OK; lowering stock to 80 flags "perlu restock"', async () => {
    // buffer has its own endpoint + capability (gudangBuffer) since the per-action split
    await request(app).patch('/api/v1/gudang/items/sticker/buffer').set(auth(owner)).send({ bufferMin: 100 });
    let d = await sum(owner);
    expect(itemOf(d, 'sticker').needsRestock).toBe(false);   // 500 > 100
    // consume 420 → stock 80 (≤ buffer 100)
    const out = await request(app).post('/api/v1/gudang/items/sticker/stock').set(auth(owner)).send({ type: 'correction', qty: -420, reason: 'pemakaian produksi' });
    expect(out.status).toBe(201);
    d = await sum(owner);
    expect(itemOf(d, 'sticker').stock).toBe(80);
    expect(itemOf(d, 'sticker').needsRestock).toBe(true);
    expect(d.restock.some((i) => i.id === 'sticker')).toBe(true);
  });

  it('a correction is signed + reason-required and appends (never overwrites)', async () => {
    expect((await request(app).post('/api/v1/gudang/items/tutup/stock').set(auth(owner)).send({ type: 'correction', qty: 5 })).status).toBe(400);   // reason required
    expect((await request(app).post('/api/v1/gudang/items/tutup/stock').set(auth(owner)).send({ type: 'correction', qty: 0, reason: 'x' })).status).toBe(400);   // non-zero
    await request(app).post('/api/v1/gudang/items/tutup/stock').set(auth(owner)).send({ type: 'in', qty: 30, reason: 'beli' });
    await request(app).post('/api/v1/gudang/items/tutup/stock').set(auth(owner)).send({ type: 'correction', qty: -4, reason: 'rusak saat cek' });
    const d = await sum(owner);
    expect(itemOf(d, 'tutup').stock).toBe(26);   // 30 − 4, both rows kept
    expect(d.movements.filter((m) => m.itemId === 'tutup').length).toBe(2);
  });

  it('damage/loss lives behind gudangDamage and subtracts from stock', async () => {
    await request(app).post('/api/v1/gudang/items/segel/stock').set(auth(owner)).send({ type: 'in', qty: 100, reason: 'beli' });
    const r = await request(app).post('/api/v1/gudang/items/segel/damage').set(auth(owner)).send({ type: 'damage', qty: 10, reason: 'sobek' });
    expect(r.status).toBe(201);
    expect((await sum(owner)).items.find((i) => i.id === 'segel').stock).toBe(90);
  });

  it('galon stock is READ-ONLY here (managed by Distribusi) — writes are rejected', async () => {
    const r = await request(app).post('/api/v1/gudang/items/galon/stock').set(auth(owner)).send({ type: 'in', qty: 10, reason: 'x' });
    expect(r.status).toBe(400);
  });

  it('galon card mirrors the Distribusi gallon total (single source, not a second number)', async () => {
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 250, reason: 'stok awal' });
    const d = await sum(owner);
    expect(itemOf(d, 'galon').stock).toBe(250);   // comes from GallonMovement, not StockMovement
  });

  it('creating a new goods type works (generic — easy to add kinds)', async () => {
    const r = await request(app).post('/api/v1/gudang/items').set(auth(owner)).send({ name: 'Label 19L', kind: 'lainnya', unit: 'roll', bufferMin: 5 });
    expect(r.status).toBe(201);
    const d = await sum(owner);
    expect(d.items.some((i) => i.name === 'Label 19L' && i.unit === 'roll')).toBe(true);
  });

  it('report 3 broken gallons → good gallon stock −3 and 3 booked into Galon Rusak', async () => {
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 100, reason: 'stok awal' });
    const before = (await sum(owner)).items.find((i) => i.id === 'galon').stock;   // 100
    const r = await request(app).post('/api/v1/gudang/gallon/damage').set(auth(owner)).send({ kind: 'pecah', qty: 3, reason: 'jatuh saat muat', culprit: 'sopir A' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ kind: 'pecah', qty: 3, goodStock: before - 3, rusakStock: 3 });
    const d = await sum(owner);
    expect(d.items.find((i) => i.id === 'galon').stock).toBe(before - 3);      // good −3
    expect(d.items.find((i) => i.id === 'galon_rusak').stock).toBe(3);          // recoverable +3
    // audited in the distribusi trail (who/when/why), with the reason + culprit
    const audit = await request(app).get('/api/v1/distribusi/audit').set(auth(owner));
    expect(audit.body.data.some((a) => /Galon pecah/i.test(a.title))).toBe(true);
    // reason mandatory
    expect((await request(app).post('/api/v1/gudang/gallon/damage').set(auth(owner)).send({ kind: 'pecah', qty: 1 })).status).toBe(400);
  });

  it('a LOST gallon (hilang) reduces good stock but adds nothing to Galon Rusak', async () => {
    const g0 = (await sum(owner)).items.find((i) => i.id === 'galon').stock;
    const r0 = (await sum(owner)).items.find((i) => i.id === 'galon_rusak').stock;
    const r = await request(app).post('/api/v1/gudang/gallon/damage').set(auth(owner)).send({ kind: 'hilang', qty: 2, reason: 'hilang di jalan' });
    expect(r.status).toBe(201);
    expect(r.body.data.rusak).toBeNull();
    const d = await sum(owner);
    expect(d.items.find((i) => i.id === 'galon').stock).toBe(g0 - 2);
    expect(d.items.find((i) => i.id === 'galon_rusak').stock).toBe(r0);   // unchanged
  });

  it('sell 2 damaged gallons → damaged stock −2 + money recorded separately (not water sales)', async () => {
    const before = (await sum(owner)).items.find((i) => i.id === 'galon_rusak').stock;   // 3
    const r = await request(app).post('/api/v1/gudang/gallon-rusak/sell').set(auth(owner)).send({ qty: 2, price: 5000, method: 'Cash', reason: 'ke pengepul' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ stock: before - 2, amount: 10000, method: 'Cash' });
    const d = await sum(owner);
    expect(d.items.find((i) => i.id === 'galon_rusak').stock).toBe(before - 2);
    expect(d.rusakSales).toMatchObject({ count: 1, qty: 2, total: 10000 });   // dedicated figure
    // can't oversell
    expect((await request(app).post('/api/v1/gudang/gallon-rusak/sell').set(auth(owner)).send({ qty: 999, price: 5000 })).status).toBe(400);
    // audited
    const audit = await request(app).get('/api/v1/distribusi/audit').set(auth(owner));
    expect(audit.body.data.some((a) => /Jual galon rusak/i.test(a.title))).toBe(true);
  });

  it('report + sell are server-gated (gudangDamage / gudangKelola)', async () => {
    const u = await reg({ name: 'V2', username: 'v2_wh', password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(owner)).send({ permissions: { gudangView: true, gudangKelola: false, gudangDamage: false } });
    const t = await login('v2_wh', 'secret123');
    expect((await request(app).post('/api/v1/gudang/gallon/damage').set(auth(t)).send({ kind: 'pecah', qty: 1, reason: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/v1/gudang/gallon-rusak/sell').set(auth(t)).send({ qty: 1, price: 1000 })).status).toBe(403);
  });

  it('every endpoint is server-gated by its capability', async () => {
    const u = await reg({ name: 'Viewer', username: 'view_wh', password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(owner)).send({ permissions: { gudangView: true, gudangKelola: false, gudangDamage: false, gudangReport: false } });
    viewer = await login('view_wh', 'secret123');
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(viewer))).status).toBe(200);   // may view
    expect((await request(app).post('/api/v1/gudang/items/sticker/stock').set(auth(viewer)).send({ type: 'in', qty: 1, reason: 'x' })).status).toBe(403);   // not manage
    expect((await request(app).post('/api/v1/gudang/items/sticker/damage').set(auth(viewer)).send({ type: 'damage', qty: 1, reason: 'x' })).status).toBe(403); // not damage
    expect((await request(app).get('/api/v1/gudang/report').set(auth(viewer))).status).toBe(403);     // not report
    // a role without gudangView at all is blocked from the dashboard
    const h = (await reg({ name: 'Hrd', username: 'hrd_wh', password: 'secret123', role: 'hrd' })).token;
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(h))).status).toBe(403);
  });
});
