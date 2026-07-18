'use strict';
// Supplier (Pemasok) system: server-allocated codes (S-0001), stock-in records the supplier,
// supplier detail shows purchase history, soft-delete keeps history, hard-delete only when
// never referenced, and everything is gated on gudangKelola.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { seedInventoryItems } = require('../src/services/gudang.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let mgr, viewer;
beforeAll(async () => {
  await resetDb();
  await seedInventoryItems();
  mgr = (await reg({ name: 'Warehouse Mgr', username: 'sup_mgr', password: 'secret123', role: 'gm' })).token;
  viewer = (await reg({ name: 'Viewer', username: 'sup_view', password: 'secret123', role: 'finance', permissions: { gudangView: true } })).token;
});
afterAll(() => prisma.$disconnect());

describe('Gudang — suppliers', () => {
  let s1, s2;
  it('creates a supplier with a server-allocated code S-0001', async () => {
    const r = await request(app).post('/api/v1/gudang/suppliers').set(auth(mgr)).send({ name: 'PT Sumber Air', phone: '0811', address: 'Denpasar' });
    expect(r.status).toBe(201);
    expect(r.body.data.code).toBe('S-0001');
    expect(r.body.data).toMatchObject({ name: 'PT Sumber Air', active: true, createdByName: 'Warehouse Mgr' });
    s1 = r.body.data.id;
    const r2 = await request(app).post('/api/v1/gudang/suppliers').set(auth(mgr)).send({ name: 'CV Tirta' });
    expect(r2.body.data.code).toBe('S-0002');
    s2 = r2.body.data.id;
  });

  it('lists + searches by name/code; gated on gudangKelola', async () => {
    const all = await request(app).get('/api/v1/gudang/suppliers').set(auth(mgr));
    expect(all.body.data.length).toBe(2);
    const byCode = await request(app).get('/api/v1/gudang/suppliers?q=S-0001').set(auth(mgr));
    expect(byCode.body.data.map((s) => s.code)).toEqual(['S-0001']);
    const byName = await request(app).get('/api/v1/gudang/suppliers?q=Tirta').set(auth(mgr));
    expect(byName.body.data.map((s) => s.name)).toEqual(['CV Tirta']);
    // a view-only user cannot see/manage suppliers
    expect((await request(app).get('/api/v1/gudang/suppliers').set(auth(viewer))).status).toBe(403);
    expect((await request(app).post('/api/v1/gudang/suppliers').set(auth(viewer)).send({ name: 'x' })).status).toBe(403);
  });

  it('a restock records the supplier on the StockMovement; detail shows it', async () => {
    const mov = await request(app).post('/api/v1/gudang/items/sticker/stock').set(auth(mgr))
      .send({ type: 'purchase', qty: 100, reason: 'beli stiker', supplierId: s1, refId: 'INV-77' });
    expect(mov.status).toBe(201);
    const row = await prisma.stockMovement.findFirst({ where: { itemId: 'sticker', type: 'purchase' } });
    expect(row.supplierId).toBe(s1);
    expect(row.refId).toBe('INV-77');
    // supplier detail shows that purchase (read-only history)
    const d = await request(app).get(`/api/v1/gudang/suppliers/${s1}`).set(auth(mgr));
    expect(d.body.data.purchases.length).toBe(1);
    expect(d.body.data.purchases[0]).toMatchObject({ itemName: 'Sticker', type: 'purchase', qty: 100 });
    // stock actually went up
    const sum = (await request(app).get('/api/v1/gudang/summary').set(auth(mgr))).body.data;
    expect(sum.items.find((i) => i.id === 'sticker').stock).toBe(100);
  });

  it('a bad supplierId on stock-in is rejected', async () => {
    const r = await request(app).post('/api/v1/gudang/items/sticker/stock').set(auth(mgr)).send({ type: 'purchase', qty: 1, reason: 'x', supplierId: 'nope' });
    expect(r.status).toBe(400);
  });

  it('edit + deactivate is audited and keeps history; a referenced supplier cannot be hard-deleted', async () => {
    const up = await request(app).patch(`/api/v1/gudang/suppliers/${s1}`).set(auth(mgr)).send({ note: 'utama' });
    expect(up.body.data.editedByName).toBe('Warehouse Mgr');
    const de = await request(app).patch(`/api/v1/gudang/suppliers/${s1}/active`).set(auth(mgr)).send({ active: false });
    expect(de.body.data.active).toBe(false);
    expect(de.body.data.deactivatedByName).toBe('Warehouse Mgr');
    // deactivated → hidden from the default (active) list, still there under 'all', history intact
    const active = await request(app).get('/api/v1/gudang/suppliers?status=active').set(auth(mgr));
    expect(active.body.data.find((s) => s.id === s1)).toBeUndefined();
    const detail = await request(app).get(`/api/v1/gudang/suppliers/${s1}`).set(auth(mgr));
    expect(detail.body.data.purchases.length).toBe(1);   // history kept
    // referenced → hard delete refused
    const del = await request(app).delete(`/api/v1/gudang/suppliers/${s1}`).set(auth(mgr));
    expect(del.status).toBe(400);
    expect(del.body.error.message).toMatch(/nonaktifkan/i);
  });

  it('an unreferenced supplier CAN be hard-deleted, and its code is never reused', async () => {
    const del = await request(app).delete(`/api/v1/gudang/suppliers/${s2}`).set(auth(mgr));   // S-0002, never used
    expect(del.status).toBe(204);
    // next new supplier gets S-0003, not S-0002 (monotonic)
    const r = await request(app).post('/api/v1/gudang/suppliers').set(auth(mgr)).send({ name: 'UD Baru' });
    expect(r.body.data.code).toBe('S-0003');
  });
});
