'use strict';
// Tutup Buku — a period may not be closed while the books don't balance. Enforced at the API (not just
// the disabled button), so a crafted request is rejected too. The double-entry engine keeps the trial
// balance balanced by construction, so we force imbalance by inserting a one-sided journal directly.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let owner;
beforeAll(async () => {
  await resetDb();
  owner = (await request(app).post('/api/v1/auth/register').send({ name: 'O', username: 'cg_own', password: 'secret123', role: 'owner' })).body.token;
  await acc.seedChart();
});
afterAll(() => prisma.$disconnect());

describe('period close requires a balanced trial balance', () => {
  it('a balanced ledger closes normally', async () => {
    const r = await request(app).post('/api/v1/accounting/periods/close').set(auth(owner)).send({ year: 2026, month: 5 });
    expect(r.status).toBe(200);
    expect(r.body.data.period.status).toBe('ditutup');
  });

  it('an UNBALANCED journal blocks the close at the API (400), even with a crafted request', async () => {
    const cm = await acc.chartMap();
    const je = await prisma.journalEntry.create({ data: { sourceType: 'manual', sourceId: 'unbal', date: '2026-06-01', ref: '', description: 'one-sided' } });
    await prisma.journalLine.create({ data: { journalEntryId: je.id, chartAccountId: cm['1-1000'], debit: 100n, credit: 0n } });   // debit only → imbalance
    expect((await acc.trialBalance()).balanced).toBe(false);
    const r = await request(app).post('/api/v1/accounting/periods/close').set(auth(owner)).send({ year: 2026, month: 6 });
    expect(r.status).toBe(400);
    expect(String(r.body.error.message)).toMatch(/seimbang|balance/i);
    // …and the period was NOT closed
    const periods = (await request(app).get('/api/v1/accounting/periods').set(auth(owner))).body.data;
    expect((periods.find((p) => p.periodKey === '2026-06') || {}).status).not.toBe('ditutup');
  });
});
