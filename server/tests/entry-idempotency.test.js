'use strict';
// OFFLINE-RETRY IDEMPOTENCY: the client sends a STABLE id per entry and retries a write when the
// connection drops. If the entry was ACTUALLY saved before the drop, the retry must NOT create a second
// copy. The scenario "submit → API dies mid-request → restart → client resends the same request" must
// end with EXACTLY one record. The cash-book id is the idempotency key; the server returns the existing
// row for a repeat instead of a duplicate (or a 500 unique-constraint error).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let gm, kasId;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_idem', password: 'secret123', role: 'gm' })).token;
  kasId = (await request(app).post('/api/v1/accounts').set(auth(gm)).send({ name: 'Kas', type: 'cash', opening: 0 })).body.data.id;
});
afterAll(() => prisma.$disconnect());

const mk = (over) => Object.assign({ id: 'e_retry_1', type: 'income', amount: 250000, date: '2026-09-01', category: 'Refill', acct: kasId, note: 'first save' }, over || {});

describe('a retried create with the same client id yields exactly one record', () => {
  it('the first POST creates the entry (201)', async () => {
    const r = await request(app).post('/api/v1/entries').set(auth(gm)).send(mk());
    expect(r.status).toBe(201);
    expect(r.body.data.id).toBe('e_retry_1');
  });

  it('the RETRY (same id) succeeds and returns the SAME row — never a duplicate, never a 500', async () => {
    const r = await request(app).post('/api/v1/entries').set(auth(gm)).send(mk({ note: 'retry payload — ignored' }));
    expect([200, 201]).toContain(r.status);          // idempotent success, not a P2002 crash
    expect(r.body.data.id).toBe('e_retry_1');
    expect(r.body.data.note).toBe('first save');     // the original row is returned; the retry does not overwrite
    // The ledger has exactly ONE row for this id.
    expect(await prisma.entry.count({ where: { id: 'e_retry_1' } })).toBe(1);
    expect(await prisma.entry.count({ where: { note: { in: ['first save', 'retry payload — ignored'] } } })).toBe(1);
  });

  it('two CONCURRENT identical retries still leave exactly one row (race handled)', async () => {
    const send = () => request(app).post('/api/v1/entries').set(auth(gm)).send(mk({ id: 'e_retry_2', note: 'race' }));
    const [a, b] = await Promise.all([send(), send()]);
    expect([200, 201]).toContain(a.status);
    expect([200, 201]).toContain(b.status);
    expect(await prisma.entry.count({ where: { id: 'e_retry_2' } })).toBe(1);
  });

  it('a gallon-purchase retry does not double the stock movement', async () => {
    const body = { id: 'e_retry_gal', type: 'expense', amount: 100000, date: '2026-09-01', category: 'Supplies', acct: kasId, gallonQty: 20 };
    await request(app).post('/api/v1/entries').set(auth(gm)).send(body);
    await request(app).post('/api/v1/entries').set(auth(gm)).send(body);   // retry
    expect(await prisma.entry.count({ where: { id: 'e_retry_gal' } })).toBe(1);
    // exactly one purchase movement for this source entry (no double-count of stock)
    expect(await prisma.gallonMovement.count({ where: { cashEntryId: 'e_retry_gal' } })).toBe(1);
  });
});
