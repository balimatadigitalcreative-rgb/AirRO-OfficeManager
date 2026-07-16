'use strict';
// Bulk customer import: sequential codes, defensive name+phone dedup, skipped count in the audit.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const imp = (t, customers, skipped) => request(app).post('/api/v1/distribusi/customers/import').set(auth(t)).send({ customers, skipped });

let gm;
beforeAll(async () => { await resetDb(); gm = (await reg({ name: 'Boss', username: 'gm_imp', password: 'secret123', role: 'gm' })).token; });
afterAll(() => prisma.$disconnect());

describe('Distribusi — bulk customer import', () => {
  it('imports rows, assigns sequential codes, and returns imported/skipped/received', async () => {
    const r = await imp(gm, [
      { name: 'Alpha', phone: '0811', masterPrice: 5000, deliveryDays: ['Sen'], armada: 'Merah', address: 'Jl A', mapsUrl: 'https://maps.app.goo.gl/x' },
      { name: 'Bravo', phone: '0822', masterPrice: 6000 },
    ], 0);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ imported: 2, skipped: 0, received: 2 });
    expect(r.body.data.map((c) => c.code).sort()).toEqual(['C-0001', 'C-0002']);
    const alpha = r.body.data.find((c) => c.name === 'Alpha');
    expect(alpha).toMatchObject({ armada: 'Merah', address: 'Jl A' });
    expect(alpha.deliveryDays).toEqual(['Sen']);
    expect(alpha.mapsLink).toMatch(/goo\.gl/);
  });

  it('dedupes by name+phone against EXISTING customers (defensive server-side)', async () => {
    // Alpha/0811 already exists → skipped; same name but a DIFFERENT phone is a new customer
    const r = await imp(gm, [
      { name: 'Alpha', phone: '0811', masterPrice: 5000 },   // exact dup → skip
      { name: 'Alpha', phone: '0899', masterPrice: 5000 },   // same name, new phone → import
    ], 0);
    expect(r.body.imported).toBe(1);
    expect(r.body.skipped).toBe(1);
    const total = (await request(app).get('/api/v1/distribusi/customers').set(auth(gm))).body.data.length;
    expect(total).toBe(3);   // Alpha/0811, Bravo/0822, Alpha/0899
  });

  it('dedupes duplicates WITHIN the same batch', async () => {
    const r = await imp(gm, [
      { name: 'Charlie', phone: '0833', masterPrice: 5000 },
      { name: 'Charlie', phone: '0833', masterPrice: 5000 },   // same batch dup → skip
    ], 0);
    expect(r.body).toMatchObject({ imported: 1, skipped: 1 });
  });

  it('skips rows with no price (defensive; empty names are already rejected by validation)', async () => {
    const r = await imp(gm, [
      { name: 'Delta', phone: '0844', masterPrice: 0 },   // price 0 → skip
      { name: 'Echo', phone: '0855', masterPrice: 7000 }, // ok
    ], 0);
    expect(r.body).toMatchObject({ imported: 1, skipped: 1 });
  });

  it('the audit records who + imported/skipped (client-skipped folded in)', async () => {
    await imp(gm, [{ name: 'Foxtrot', phone: '0866', masterPrice: 5000 }], 7);   // client skipped 7 in preview
    const audit = (await request(app).get('/api/v1/distribusi/audit?kind=impor').set(auth(gm))).body.data;
    const row = audit.find((a) => /Impor pelanggan: 1 ditambah/.test(a.title));
    expect(row).toBeTruthy();
    expect(row.detail).toMatch(/1 ditambah · 7 dilewati/);   // 7 client-skipped + 0 server-skipped
    expect(row.actorName).toBe('Boss');
  });

  it('is gated by distribusiCustomers', async () => {
    const u = await reg({ name: 'V', username: 'v_imp', password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ permissions: { distribusiCustomers: false } });
    const t = (await request(app).post('/api/v1/auth/login').send({ username: 'v_imp', password: 'secret123' })).body.token;
    expect((await imp(t, [{ name: 'X', phone: '1', masterPrice: 5000 }], 0)).status).toBe(403);
  });
});
