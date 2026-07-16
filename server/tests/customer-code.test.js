'use strict';
// Customer human-readable code (C-0001, sequential, never reused) + shared completeness flag.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const mkCust = (t, body) => request(app).post('/api/v1/distribusi/customers').set(auth(t)).send(body);

let gm;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_cc', password: 'secret123', role: 'gm' })).token;
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — customer code + completeness', () => {
  let firstId;
  it('new customers get sequential codes C-0001, C-0002, … (server-allocated)', async () => {
    const a = await mkCust(gm, { name: 'Alpha', phone: '0811', type: 'reguler', masterPrice: 5000, armada: 'Merah', deliveryDays: ['Sen'], mapsUrl: 'https://maps.google.com/?q=1,1' });
    const b = await mkCust(gm, { name: 'Bravo', type: 'reguler', masterPrice: 5000 });
    const c = await mkCust(gm, { name: 'Charlie', type: 'reguler', masterPrice: 5000 });
    expect(a.body.data.code).toBe('C-0001');
    expect(b.body.data.code).toBe('C-0002');
    expect(c.body.data.code).toBe('C-0003');
    firstId = a.body.data.id;
  });

  it('a code is NOT reused after a customer is deleted (monotonic counter)', async () => {
    // delete Charlie (C-0003) then create a new one → next is C-0004, not C-0003
    const list = await request(app).get('/api/v1/distribusi/customers').set(auth(gm));
    const charlie = list.body.data.find((c) => c.name === 'Charlie');
    // deletion needs the delete cap (gm has it)
    await request(app).delete(`/api/v1/distribusi/customers/${charlie.id}`).set(auth(gm));
    const d = await mkCust(gm, { name: 'Delta', type: 'reguler', masterPrice: 5000 });
    expect(d.body.data.code).toBe('C-0004');
  });

  it('the code is STABLE across edits (rename / change fleet)', async () => {
    const before = (await request(app).get(`/api/v1/distribusi/customers/${firstId}`).set(auth(gm))).body.data.code;
    await request(app).patch(`/api/v1/distribusi/customers/${firstId}`).set(auth(gm)).send({ name: 'Alpha Renamed', armada: 'Biru' });
    const after = (await request(app).get(`/api/v1/distribusi/customers/${firstId}`).set(auth(gm))).body.data.code;
    expect(after).toBe(before);
    expect(after).toBe('C-0001');
  });

  it('completeness: complete = phone AND location; missing lists every gap', async () => {
    const list = (await request(app).get('/api/v1/distribusi/customers').set(auth(gm))).body.data;
    const alpha = list.find((c) => c.code === 'C-0001');   // phone + mapsUrl → complete
    expect(alpha.complete).toBe(true);
    expect(alpha.missing).toEqual([]);
    const bravo = list.find((c) => c.code === 'C-0002');   // no phone, no location, no armada, no days
    expect(bravo.complete).toBe(false);
    expect(bravo.missing).toEqual(expect.arrayContaining(['phone', 'location', 'armada', 'deliveryDays']));
  });

  it('filling phone + location flips complete → true (single shared rule)', async () => {
    const list = (await request(app).get('/api/v1/distribusi/customers').set(auth(gm))).body.data;
    const bravo = list.find((c) => c.code === 'C-0002');
    await request(app).patch(`/api/v1/distribusi/customers/${bravo.id}`).set(auth(gm)).send({ phone: '0822', mapsUrl: 'https://maps.google.com/?q=2,2' });
    const after = (await request(app).get(`/api/v1/distribusi/customers/${bravo.id}`).set(auth(gm))).body.data;
    expect(after.complete).toBe(true);
    expect(after.missing).not.toContain('phone');
    expect(after.missing).not.toContain('location');
  });

  it('the code appears in transaction rows + delivery board', async () => {
    const alpha = (await request(app).get('/api/v1/distribusi/customers').set(auth(gm))).body.data.find((c) => c.code === 'C-0001');
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: alpha.id, qty: 3, method: 'lunas', txnDate: '2026-10-01' });
    const txns = (await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).body.data;
    expect(txns[0].customer.code).toBe('C-0001');
  });
});
