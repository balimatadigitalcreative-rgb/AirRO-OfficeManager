'use strict';
// Coarse capabilities split per action:
//   gudangKelola      → gudangAddStock / gudangKoreksi / gudangBuffer / gudangItems / gudangSupplier
//   distribusiCustomers → keeps create/edit, but bulk import moves to distribusiCustomerImport
// Two things must hold at once: a narrow grant unlocks ONLY its own action (server-side, not
// just hidden buttons), and nobody who held the old coarse cap loses anything.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { resolvePerms } = require('../src/config/permissions');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

// Register a user, overwrite their permissions, then log in so the JWT carries them.
async function userWith(username, perms) {
  const r = await request(app).post('/api/v1/auth/register').send({ name: username, username, password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: r.body.user.id }, data: { permissions: JSON.stringify(perms) } });
  const l = await request(app).post('/api/v1/auth/login').send({ username, password: 'secret123' });
  return l.body.token;
}

let gm, itemId;
beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'gc_gm', password: 'secret123', role: 'gm' })).body.token;
  const it = await request(app).post('/api/v1/gudang/items').set(auth(gm)).send({ name: 'Sticker Uji', kind: 'sticker', unit: 'pcs' });
  itemId = it.body.data.id;
});
afterAll(() => prisma.$disconnect());

// ── PART A: gudang ──────────────────────────────────────────────────────────
describe('gudang caps are per-action', () => {
  const ONLY = (cap) => ({ gudangView: true, gudangAddStock: false, gudangKoreksi: false, gudangBuffer: false, gudangItems: false, gudangSupplier: false, [cap]: true });

  it('gudangAddStock alone: can add stock, nothing else', async () => {
    const t = await userWith('gc_add', ONLY('gudangAddStock'));
    expect((await request(app).post(`/api/v1/gudang/items/${itemId}/stock`).set(auth(t))
      .send({ type: 'in', qty: 10, reason: 'kiriman' })).status).toBe(201);
    // the SAME endpoint, but a correction — different capability, so rejected
    expect((await request(app).post(`/api/v1/gudang/items/${itemId}/stock`).set(auth(t))
      .send({ type: 'correction', qty: -3, reason: 'selisih' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/gudang/items/${itemId}/buffer`).set(auth(t)).send({ bufferMin: 50 })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/gudang/items/${itemId}`).set(auth(t)).send({ name: 'X' })).status).toBe(403);
    expect((await request(app).post('/api/v1/gudang/items').set(auth(t)).send({ name: 'Y' })).status).toBe(403);
    expect((await request(app).get('/api/v1/gudang/suppliers').set(auth(t))).status).toBe(403);
    expect((await request(app).post('/api/v1/gudang/suppliers').set(auth(t)).send({ name: 'PT A' })).status).toBe(403);
  });

  it('gudangKoreksi alone: can correct stock but not add it', async () => {
    const t = await userWith('gc_kor', ONLY('gudangKoreksi'));
    expect((await request(app).post(`/api/v1/gudang/items/${itemId}/stock`).set(auth(t))
      .send({ type: 'correction', qty: -2, reason: 'opname' })).status).toBe(201);
    expect((await request(app).post(`/api/v1/gudang/items/${itemId}/stock`).set(auth(t))
      .send({ type: 'in', qty: 5, reason: 'kiriman' })).status).toBe(403);
  });

  it('gudangBuffer alone: can set the buffer but not correct stock', async () => {
    const t = await userWith('gc_buf', ONLY('gudangBuffer'));
    const r = await request(app).patch(`/api/v1/gudang/items/${itemId}/buffer`).set(auth(t)).send({ bufferMin: 40 });
    expect(r.status).toBe(200);
    expect(r.body.data.bufferMin).toBe(40);
    expect((await request(app).post(`/api/v1/gudang/items/${itemId}/stock`).set(auth(t))
      .send({ type: 'correction', qty: -1, reason: 'x' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/gudang/items/${itemId}`).set(auth(t)).send({ name: 'X' })).status).toBe(403);
  });

  it('gudangItems alone: may edit item details but NOT move the buffer', async () => {
    const t = await userWith('gc_item', ONLY('gudangItems'));
    const before = (await request(app).get(`/api/v1/gudang/items/${itemId}`).set(auth(gm))).body.data.bufferMin;
    const r = await request(app).patch(`/api/v1/gudang/items/${itemId}`).set(auth(t))
      .send({ name: 'Sticker Uji 2', description: 'ket' });
    expect(r.status).toBe(200);
    expect(r.body.data.name).toBe('Sticker Uji 2');
    // the dedicated endpoint is closed to them...
    expect((await request(app).patch(`/api/v1/gudang/items/${itemId}/buffer`).set(auth(t)).send({ bufferMin: 999 })).status).toBe(403);
    // ...and smuggling bufferMin through the item-edit body must not work either
    await request(app).patch(`/api/v1/gudang/items/${itemId}`).set(auth(t)).send({ name: 'Sticker Uji 2', bufferMin: 999 });
    expect((await request(app).get(`/api/v1/gudang/items/${itemId}`).set(auth(gm))).body.data.bufferMin).toBe(before);
    // creating an item with a buffer likewise ignores the field instead of failing
    const c = await request(app).post('/api/v1/gudang/items').set(auth(t)).send({ name: 'Baru', kind: 'tutup', bufferMin: 500 });
    expect(c.status).toBe(201);
    expect(c.body.data.bufferMin).toBe(0);
  });

  it('gudangSupplier alone: suppliers + selling damaged gallons, no stock rights', async () => {
    const t = await userWith('gc_sup', ONLY('gudangSupplier'));
    expect((await request(app).get('/api/v1/gudang/suppliers').set(auth(t))).status).toBe(200);
    const c = await request(app).post('/api/v1/gudang/suppliers').set(auth(t)).send({ name: 'PT Sumber' });
    expect(c.status).toBe(201);
    expect((await request(app).post(`/api/v1/gudang/items/${itemId}/stock`).set(auth(t))
      .send({ type: 'in', qty: 1, reason: 'x' })).status).toBe(403);
  });

  it('a view-only user can do none of it', async () => {
    const t = await userWith('gc_view', { gudangView: true, gudangAddStock: false, gudangKoreksi: false, gudangBuffer: false, gudangItems: false, gudangSupplier: false });
    expect((await request(app).get('/api/v1/gudang/summary').set(auth(t))).status).toBe(200);
    for (const call of [
      request(app).post(`/api/v1/gudang/items/${itemId}/stock`).set(auth(t)).send({ type: 'in', qty: 1, reason: 'x' }),
      request(app).patch(`/api/v1/gudang/items/${itemId}/buffer`).set(auth(t)).send({ bufferMin: 1 }),
      request(app).post('/api/v1/gudang/items').set(auth(t)).send({ name: 'Z' }),
      request(app).get('/api/v1/gudang/suppliers').set(auth(t)),
      request(app).post('/api/v1/gudang/gallon-rusak/sell').set(auth(t)).send({ qty: 1, price: 1000 }),
    ]) expect((await call).status).toBe(403);
  });
});

// ── PART B: distribusi bulk import ──────────────────────────────────────────
describe('bulk customer import is its own capability', () => {
  it('distribusiCustomers without the import cap: create/edit yes, bulk import 403', async () => {
    const t = await userWith('gc_cust', { distribusiCustomers: true, distribusiCustomerImport: false });
    const c = await request(app).post('/api/v1/distribusi/customers').set(auth(t)).send({ name: 'Bu Satu', masterPrice: 6000 });
    expect(c.status).toBe(201);
    expect((await request(app).patch('/api/v1/distribusi/customers/' + c.body.data.id).set(auth(t)).send({ name: 'Bu Satu B' })).status).toBe(200);
    const imp = await request(app).post('/api/v1/distribusi/customers/import').set(auth(t))
      .send({ customers: [{ name: 'Impor A', masterPrice: 6000 }] });
    expect(imp.status).toBe(403);
  });

  it('the import cap opens exactly that endpoint', async () => {
    const t = await userWith('gc_imp', { distribusiCustomers: true, distribusiCustomerImport: true });
    const imp = await request(app).post('/api/v1/distribusi/customers/import').set(auth(t))
      .send({ customers: [{ name: 'Impor B', masterPrice: 6000 }] });
    expect(imp.status).toBe(201);
  });
});

// ── BACK-COMPAT: nobody loses access on upgrade ─────────────────────────────
describe('back-compat for users stored before the split', () => {
  it('a legacy gudangKelola user still has every warehouse action', async () => {
    // exactly what an old per-user override looks like: no granular keys at all
    const t = await userWith('gc_legacy', { gudangView: true, gudangKelola: true, gudangDamage: true });
    expect((await request(app).post(`/api/v1/gudang/items/${itemId}/stock`).set(auth(t)).send({ type: 'in', qty: 4, reason: 'x' })).status).toBe(201);
    expect((await request(app).post(`/api/v1/gudang/items/${itemId}/stock`).set(auth(t)).send({ type: 'correction', qty: -1, reason: 'x' })).status).toBe(201);
    expect((await request(app).patch(`/api/v1/gudang/items/${itemId}/buffer`).set(auth(t)).send({ bufferMin: 25 })).status).toBe(200);
    expect((await request(app).patch(`/api/v1/gudang/items/${itemId}`).set(auth(t)).send({ name: 'Sticker Uji 3' })).status).toBe(200);
    expect((await request(app).get('/api/v1/gudang/suppliers').set(auth(t))).status).toBe(200);
  });

  it('a legacy distribusiCustomers user still gets bulk import', async () => {
    const t = await userWith('gc_legacycust', { distribusiCustomers: true });   // no import key
    expect((await request(app).post('/api/v1/distribusi/customers/import').set(auth(t))
      .send({ customers: [{ name: 'Impor C', masterPrice: 6000 }] })).status).toBe(201);
  });

  it('resolvePerms derives the split caps and keeps explicit denials', () => {
    const legacy = resolvePerms('finance', JSON.stringify({ gudangKelola: true }));
    ['gudangAddStock', 'gudangKoreksi', 'gudangBuffer', 'gudangItems', 'gudangSupplier'].forEach((c) => expect(legacy[c]).toBe(true));
    const narrowed = resolvePerms('finance', JSON.stringify({ gudangKelola: true, gudangKoreksi: false }));
    expect(narrowed.gudangKoreksi).toBe(false);      // an explicit off is never re-derived
    expect(narrowed.gudangAddStock).toBe(true);
    // the alias stays truthy while ANY manage action remains, so old clients still work
    expect(narrowed.gudangKelola).toBe(true);
    expect(resolvePerms('finance', JSON.stringify({ gudangView: true })).gudangKelola).toBe(false);
  });

  it('owner and GM hold every new capability', () => {
    ['owner', 'gm'].forEach((role) => {
      const p = resolvePerms(role, null);
      ['gudangAddStock', 'gudangKoreksi', 'gudangBuffer', 'gudangItems', 'gudangSupplier', 'distribusiCustomerImport']
        .forEach((c) => expect(`${role}.${c}=${p[c]}`).toBe(`${role}.${c}=true`));
    });
  });
});
