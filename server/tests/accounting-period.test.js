'use strict';
// ACCOUNTING v2 — Part 4 (period close). The NON-NEGOTIABLE: a closed period rejects edits/deletes AT
// THE API, not just in the UI. Enforcement is flag-gated, so we turn ACCOUNTING_V2 on for this file
// BEFORE requiring the app/config (jest gives each test file its own module registry).
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let gm, owner, julyId;
const mkEntry = (t, date, note) => request(app).post('/api/v1/entries').set(auth(gm)).send({ type: 'income', amount: 50000, category: 'Refill', acct: 'cash', date, note: note || 'x' });

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'per_gm', password: 'secret123', role: 'gm' })).body.token;
  owner = (await request(app).post('/api/v1/auth/register').send({ name: 'Owner', username: 'per_own', password: 'secret123', role: 'owner' })).body.token;
  julyId = (await mkEntry('income', '2026-07-15', 'july entry')).body.data.id;
  await mkEntry('income', '2026-08-10', 'aug entry');
});
afterAll(() => prisma.$disconnect());

describe('period close rejects edits at the API', () => {
  it('closing 2026-07 returns a period + checklist', async () => {
    const r = await request(app).post('/api/v1/accounting/periods/close').set(auth(owner)).send({ year: 2026, month: 7 });
    expect(r.status).toBe(200);
    expect(r.body.data.period.status).toBe('ditutup');
    expect(r.body.data.checklist).toHaveProperty('uncategorised');
  });

  it('a NEW entry dated in the closed period is rejected (400)', async () => {
    const r = await mkEntry('income', '2026-07-20', 'blocked');
    expect(r.status).toBe(400);
    expect(String(r.body.error.message)).toMatch(/ditutup|dikunci/i);
  });

  it('EDITING an entry in the closed period is rejected (400)', async () => {
    const r = await request(app).patch(`/api/v1/entries/${julyId}`).set(auth(gm)).send({ note: 'try edit' });
    expect(r.status).toBe(400);
  });

  it('DELETING an entry in the closed period is rejected (400)', async () => {
    const r = await request(app).delete(`/api/v1/entries/${julyId}`).set(auth(gm));
    expect(r.status).toBe(400);
  });

  it('an OPEN period (2026-08) still accepts new entries', async () => {
    const r = await mkEntry('income', '2026-08-15', 'still open');
    expect(r.status).toBe(201);
  });
});

describe('owner reopen (audited, reason required)', () => {
  it('reopen without a reason is rejected', async () => {
    const r = await request(app).post('/api/v1/accounting/periods/reopen').set(auth(owner)).send({ year: 2026, month: 7 });
    expect(r.status).toBe(400);
  });

  it('a GM cannot reopen (owner-only)', async () => {
    const r = await request(app).post('/api/v1/accounting/periods/reopen').set(auth(gm)).send({ year: 2026, month: 7, reason: 'x' });
    expect(r.status).toBe(403);
  });

  it('owner reopen with a reason unlocks the period and is audited', async () => {
    const r = await request(app).post('/api/v1/accounting/periods/reopen').set(auth(owner)).send({ year: 2026, month: 7, reason: 'koreksi salah input' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('terbuka');
    expect(r.body.data.reopenReason).toBe('koreksi salah input');
    expect(r.body.data.reopenedByName).toBe('Owner');
    // …and edits are allowed again
    const e = await mkEntry('income', '2026-07-25', 'after reopen');
    expect(e.status).toBe(201);
  });

  it('the periods list surfaces the reopened period with its audit trail', async () => {
    const r = await request(app).get('/api/v1/accounting/periods').set(auth(owner));
    const july = r.body.data.find((p) => p.periodKey === '2026-07');
    expect(july.status).toBe('terbuka');
    expect(july.reopenedAt).toBeTruthy();
  });
});
