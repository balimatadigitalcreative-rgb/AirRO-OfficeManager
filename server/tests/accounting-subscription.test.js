'use strict';
// RECURRING SUBSCRIPTIONS (Part 3) — a recurring supplier cost that auto-generates a Bill (AP) each
// cycle. Running the job catches up every missed cycle up to a cut-off and is IDEMPOTENT (a
// SubscriptionRun per cycle), auto-issuing posts the accrual, and pause / resume / skip / cancel /
// end-date all gate generation. Asserts generation, catch-up, idempotency, the lifecycle, and draft mode.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const bal = async (code) => { const r = (await acc.accountBalances()).find((x) => x.code === code); return r ? r.balance : 0; };

let gm;
beforeAll(async () => {
  await resetDb();
  await acc.seedChart();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'sub_gm', password: 'secret123', role: 'gm' })).body.token;
});
afterAll(() => prisma.$disconnect());

const mkSupplier = async (name) => (await prisma.supplier.create({ data: { name } })).id;
const mkSub = (body) => request(app).post('/api/v1/accounting/subscriptions').set(auth(gm)).send(body);
const run = (asOf) => request(app).post('/api/v1/accounting/subscriptions/run').set(auth(gm)).send({ asOf });
const billsOf = async (supplierId) => (await request(app).get(`/api/v1/accounting/bills?supplierId=${supplierId}`).set(auth(gm))).body.data;

describe('generation + catch-up + idempotency', () => {
  it('running catches up every missed monthly cycle, issues each, and never duplicates', async () => {
    const sup = await mkSupplier('PT Internet');
    const c = await mkSub({ supplierId: sup, name: 'Internet kantor', chartCode: '6-5000', amount: 250000, cadence: 'monthly', startDate: '2026-06-01', dueDays: 10 });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ cadence: 'monthly', nextRunDate: '2026-06-01', status: 'aktif', autoIssue: true });

    const r = await run('2026-08-15');                 // Jun, Jul, Aug cycles all due
    expect(r.body.data.generated).toBe(3);
    const bills = await billsOf(sup);
    expect(bills.length).toBe(3);
    expect(bills.every((b) => b.status === 'terbuka' && b.total === 250000)).toBe(true);
    expect(bills.map((b) => b.dueDate).sort()).toEqual(['2026-06-11', '2026-07-11', '2026-08-11']);
    expect(await bal('6-5000')).toBe(750000);          // accrued 3 × 250k (issued)
    expect(await bal('2-1000')).toBe(750000);          // Utang Usaha
    const sub = (await request(app).get(`/api/v1/accounting/subscriptions/${c.body.data.id}`).set(auth(gm))).body.data;
    expect(sub.nextRunDate).toBe('2026-09-01');
    expect(sub.runs.length).toBe(3);

    // re-running to the same cut-off generates NOTHING new
    expect((await run('2026-08-15')).body.data.generated).toBe(0);
    expect((await billsOf(sup)).length).toBe(3);
  });
});

describe('lifecycle: pause · resume · skip · cancel · end date · draft mode', () => {
  it('pause stops generation; resume + run resumes it', async () => {
    const sup = await mkSupplier('PT Software');
    const c = await mkSub({ supplierId: sup, name: 'SaaS', chartCode: '6-3000', amount: 100000, cadence: 'monthly', startDate: '2026-06-01' });
    await request(app).post(`/api/v1/accounting/subscriptions/${c.body.data.id}/pause`).set(auth(gm)).send({});
    expect((await run('2026-08-15')).body.data.generated).toBe(0);   // paused → nothing
    expect((await billsOf(sup)).length).toBe(0);
    await request(app).post(`/api/v1/accounting/subscriptions/${c.body.data.id}/resume`).set(auth(gm)).send({});
    expect((await run('2026-08-15')).body.data.generated).toBe(3);   // Jun/Jul/Aug catch up
    expect((await billsOf(sup)).length).toBe(3);
  });

  it('skip advances the cursor without a bill; cancel stops permanently', async () => {
    const sup = await mkSupplier('PT Sewa');
    const c = await mkSub({ supplierId: sup, name: 'Sewa', chartCode: '6-6000', amount: 400000, cadence: 'monthly', startDate: '2026-06-01' });
    const id = c.body.data.id;
    const sk = await request(app).post(`/api/v1/accounting/subscriptions/${id}/skip`).set(auth(gm)).send({});
    expect(sk.body.data.nextRunDate).toBe('2026-07-01');            // June skipped
    await run('2026-07-15');                                        // only July now
    expect((await billsOf(sup)).length).toBe(1);
    await request(app).post(`/api/v1/accounting/subscriptions/${id}/cancel`).set(auth(gm)).send({});
    await run('2027-01-01');                                        // (global run — other subs may generate)
    expect((await billsOf(sup)).length).toBe(1);                   // this cancelled sub generated nothing more
  });

  it('autoIssue:false leaves generated bills as DRAFT (no accrual until issued); endDate finishes it', async () => {
    const sup = await mkSupplier('PT Tahunan');
    const before = await bal('6-4000');
    const c = await mkSub({ supplierId: sup, name: 'Lisensi', chartCode: '6-4000', amount: 600000, cadence: 'monthly', startDate: '2026-06-01', endDate: '2026-07-31', autoIssue: false });
    const r = await run('2026-12-31');
    expect(r.body.data.generated).toBe(2);                          // Jun + Jul only (endDate stops it)
    const bills = await billsOf(sup);
    expect(bills.every((b) => b.status === 'draft')).toBe(true);    // not issued → no journal
    expect(await bal('6-4000')).toBe(before);                       // expense unchanged until a bill is issued
    const sub = (await request(app).get(`/api/v1/accounting/subscriptions/${c.body.data.id}`).set(auth(gm))).body.data;
    expect(sub.status).toBe('selesai');                            // past endDate
  });
});
