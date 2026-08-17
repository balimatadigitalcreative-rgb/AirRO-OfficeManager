'use strict';
// BACKFILL is now STREAMED + CHUNKED + IDEMPOTENT + ASYNC — the old blocking run 502'd on a large
// dataset. This asserts: re-running never duplicates; an interrupted run resumes and reaches the source
// count; a 3000-source dataset completes without loading it all or timing out; and the async job's
// status endpoint reports accurate progress + a sound result (integrity + trial balance).
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const actor = { id: 'sys', name: 'sys' };

// Seed N bon transactions for one customer straight into the DB (fast; backfill will journal them).
async function seedBon(n, price = 10000) {
  const c = await prisma.customer.create({ data: { name: 'Seed ' + Math.random().toString(36).slice(2, 7), code: 'C' + Math.random().toString(36).slice(2, 7), armada: 'Merah', masterPrice: price } });
  const data = Array.from({ length: n }, (_, i) => ({ customerId: c.id, fleetId: 'Merah', qty: 1, unitPriceLocked: BigInt(price), amount: BigInt(price), method: 'bon', bonCounted: true, txnDate: '2026-07-' + String((i % 27) + 1).padStart(2, '0'), actorName: 'seed' }));
  await prisma.distTransaction.createMany({ data });
  return c.id;
}

describe('idempotency + resume', () => {
  beforeEach(async () => { await resetDb(); await acc.seedChart(); });

  it('running backfill twice on a clean dataset produces identical results — no duplicates', async () => {
    await seedBon(30);
    await acc.backfill({ actor });
    const c1 = await prisma.journalEntry.count();
    expect(c1).toBeGreaterThan(0);
    await acc.backfill({ actor });                     // second run
    expect(await prisma.journalEntry.count()).toBe(c1);   // idempotent — nothing new
  });

  it('an interrupted run resumes: journals removed mid-way are re-created, none duplicated', async () => {
    await seedBon(40);
    await acc.backfill({ actor });
    const full = await prisma.journalEntry.count();
    // simulate an interruption that only got part-way: drop 8 journals (+ their lines)
    const some = await prisma.journalEntry.findMany({ take: 8, select: { id: true } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: some.map((s) => s.id) } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: some.map((s) => s.id) } } });
    expect(await prisma.journalEntry.count()).toBe(full - 8);
    await acc.backfill({ actor });                     // re-run continues where it stopped
    expect(await prisma.journalEntry.count()).toBe(full);   // exactly restored — no duplicates
  });
});

describe('scale', () => {
  it('a 3000-source dataset completes (streamed, not loaded whole) without timing out', async () => {
    await resetDb(); await acc.seedChart();
    await seedBon(3000);
    const res = await acc.backfill({ actor });
    expect(res.failed).toBe(0);
    expect(await prisma.journalEntry.count()).toBeGreaterThanOrEqual(3000);
    // a re-run over 3000 still posts nothing new
    const before = await prisma.journalEntry.count();
    await acc.backfill({ actor });
    expect(await prisma.journalEntry.count()).toBe(before);
  }, 180000);
});

describe('async job + status endpoint', () => {
  let gm;
  beforeAll(async () => {
    await resetDb(); await acc.seedChart();
    gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'bf_gm', password: 'secret123', role: 'gm' })).body.token;
    await seedBon(25);
  });

  it('POST returns a jobId immediately; polling reports accurate progress and a sound result', async () => {
    const start = await request(app).post('/api/v1/accounting/backfill').set(auth(gm)).send({});
    expect(start.status).toBe(200);
    expect(start.body.data.jobId).toBeTruthy();
    expect(start.body.data.total).toBeGreaterThan(0);
    const jobId = start.body.data.jobId;
    let s = null;
    for (let i = 0; i < 200; i++) { s = (await request(app).get(`/api/v1/accounting/backfill/status/${jobId}`).set(auth(gm))).body.data; if (s.status !== 'running') break; await sleep(50); }
    expect(s.status).toBe('done');
    expect(s.processed).toBe(s.total);                 // progress reached 100%
    expect(s.failed).toBe(0);
    expect(s.result.trialBalanced).toBe(true);         // integrity check ran automatically
    expect(s.result.integrity.ok).toBe(true);
    expect(await prisma.journalEntry.count()).toBeGreaterThan(0);
  });

  it('a dry-run returns preview counts synchronously (never a job)', async () => {
    const r = await request(app).post('/api/v1/accounting/backfill').set(auth(gm)).send({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.data.dryRun).toBe(true);
    expect(typeof r.body.data.total).toBe('number');
    expect(r.body.data.jobId).toBeUndefined();          // dry-run is synchronous, not a job
  });

  it('status for an unknown job id is 404', async () => {
    expect((await request(app).get('/api/v1/accounting/backfill/status/nope').set(auth(gm))).status).toBe(404);
  });
});
