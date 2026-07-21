'use strict';
// Editing InventoryItem DETAILS (name/unit/form/description/photo/buffer): built-in items
// are editable, renaming never breaks the ledger (movements key on the stable id), the photo
// is stored as an Attachment ref (never base64 in the item), and edits are audited.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { seedInventoryItems } = require('../src/services/gudang.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const sum = async (t) => (await request(app).get('/api/v1/gudang/summary').set(auth(t))).body.data;
const itemOf = (d, id) => d.items.find((i) => i.id === id);

let owner, ownerId, viewer;
beforeAll(async () => {
  await resetDb();
  await seedInventoryItems();
  const o = await reg({ name: 'Gudang Admin', username: 'gie_admin', password: 'secret123', role: 'gm' });
  owner = o.token; ownerId = o.user.id;
  // a user WITHOUT gudangKelola
  const v = await reg({ name: 'Viewer', username: 'gie_view', password: 'secret123', role: 'finance', permissions: { gudangView: true } });
  viewer = v.token;
});
afterAll(() => prisma.$disconnect());

describe('Gudang — edit item details', () => {
  it('edits a built-in item (name/unit/form/description) and records the audit', async () => {
    // NOTE: bufferMin is NOT part of item details any more — it is its own action/capability
    // (gudangBuffer, PATCH /items/:id/buffer), so it is set separately here.
    await request(app).patch('/api/v1/gudang/items/sticker/buffer').set(auth(owner)).send({ bufferMin: 25 });
    const r = await request(app).patch('/api/v1/gudang/items/sticker').set(auth(owner))
      .send({ name: 'Stiker Galon', unit: 'lembar', form: 'roll', description: 'stiker merek' });
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d).toMatchObject({ id: 'sticker', name: 'Stiker Galon', unit: 'lembar', form: 'roll', description: 'stiker merek', bufferMin: 25 });
    expect(d.editedByName).toBe('Gudang Admin');
    expect(typeof d.editedAt).toBe('number');
    // persisted
    const row = await prisma.inventoryItem.findUnique({ where: { id: 'sticker' } });
    expect(row.form).toBe('roll'); expect(row.editedById).toBe(ownerId);
  });

  it('galon (system-managed) is still editable for its details', async () => {
    const r = await request(app).patch('/api/v1/gudang/items/galon').set(auth(owner)).send({ form: 'Galon 19L', description: 'galon isi ulang' });
    expect(r.status).toBe(200);
    expect(r.body.data.form).toBe('Galon 19L');
  });

  it('renaming does NOT break the ledger — movements stay linked by id, stock unchanged', async () => {
    // add stock to tutup, then rename it
    await request(app).post('/api/v1/gudang/items/tutup/stock').set(auth(owner)).send({ type: 'opening', qty: 40, reason: 'stok awal' });
    const before = itemOf(await sum(owner), 'tutup');
    expect(before.stock).toBe(40);
    const r = await request(app).patch('/api/v1/gudang/items/tutup').set(auth(owner)).send({ name: 'Tutup Galon Baru' });
    expect(r.status).toBe(200);
    const after = itemOf(await sum(owner), 'tutup');
    expect(after.name).toBe('Tutup Galon Baru');
    expect(after.stock).toBe(40);   // ledger intact
    const movs = await prisma.stockMovement.findMany({ where: { itemId: 'tutup' } });
    expect(movs.length).toBe(1);    // still linked to the same id
  });

  it('stores the photo as an Attachment REF — never base64 in the item payload', async () => {
    const up = await request(app).post('/api/v1/attachments').set(auth(owner)).send({ data: PNG, name: 'segel.png', mime: 'image/png', isImg: true });
    const photoId = up.body.data.id;
    const r = await request(app).patch('/api/v1/gudang/items/segel').set(auth(owner)).send({ photoId });
    expect(r.status).toBe(200);
    expect(r.body.data.photoId).toBe(photoId);
    // the item row stores only the id, not the bytes
    const row = await prisma.inventoryItem.findUnique({ where: { id: 'segel' } });
    expect(row.photoId).toBe(photoId);
    expect(JSON.stringify(row)).not.toContain('base64');
    // the bytes are fetched separately from the attachment store
    const bytes = await request(app).get(`/api/v1/attachments/${photoId}`).set(auth(owner));
    expect(bytes.body.data.data).toContain('base64');
    // removing the photo (photoId=null) clears it
    const clr = await request(app).patch('/api/v1/gudang/items/segel').set(auth(owner)).send({ photoId: null });
    expect(clr.body.data.photoId).toBeNull();
  });

  it('requires gudangKelola — a view-only user cannot edit', async () => {
    const r = await request(app).patch('/api/v1/gudang/items/sticker').set(auth(viewer)).send({ name: 'Nope' });
    expect(r.status).toBe(403);
  });
});
