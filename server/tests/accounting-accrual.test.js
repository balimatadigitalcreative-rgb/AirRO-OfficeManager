'use strict';
// ACCRUAL MECHANICS (Part 2). PREPAID: a bill line covering a future period is capitalised to Beban
// Dibayar Di Muka (1-1600) on issue and amortised monthly into its expense account; the ledger reflects
// only the months consumed. ACCRUED: an expense recognised before its bill arrives is booked this period
// (Dr Beban · Cr 2-4000) and auto-reversed next period, so the timing is right and it isn't double-
// counted. Asserts the ledger effects, idempotency, rounding, and that the trial balance stays balanced.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const accrual = require('../src/services/accrual.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const bal = async (code, range) => { const r = (await acc.accountBalances(range)).find((x) => x.code === code); return r ? r.balance : 0; };
const balanced = async () => (await acc.trialBalance()).balanced === true;

let gm, supplierId;
beforeAll(async () => {
  await resetDb();
  await acc.seedChart();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'acr_gm', password: 'secret123', role: 'gm' })).body.token;
  supplierId = (await prisma.supplier.create({ data: { name: 'PT Asuransi' } })).id;
});
afterAll(() => prisma.$disconnect());

describe('PREPAID amortisation', () => {
  it('a prepaid bill line capitalises to 1-1600 on issue; amortises monthly; idempotent; balanced', async () => {
    // 12-month prepaid of 1.200.000 → 100.000/month, starting Aug 2026
    const c = await request(app).post('/api/v1/accounting/bills').set(auth(gm)).send({ supplierId, billDate: '2026-08-01', lines: [{ chartCode: '6-6000', unitPrice: 1200000, qty: 1, amortizeMonths: 12, amortizeStart: '2026-08-01' }] });
    const id = c.body.data.id;
    await request(app).post(`/api/v1/accounting/bills/${id}/issue`).set(auth(gm)).send({});
    expect(await bal('1-1600')).toBe(1200000);   // capitalised, not expensed
    expect(await bal('6-6000')).toBe(0);          // nothing consumed yet
    expect(await balanced()).toBe(true);
    const sch = (await request(app).get('/api/v1/accounting/amortization-schedules').set(auth(gm))).body.data;
    expect(sch.length).toBe(1);
    expect(sch[0]).toMatchObject({ months: 12, monthlyAmount: 100000, total: 1200000, remaining: 12 });

    // amortise through Oct 2026 → 3 months consumed
    const r = await request(app).post('/api/v1/accounting/amortize').set(auth(gm)).send({ asOf: '2026-10-15' });
    expect(r.body.data.posted).toBe(3);
    expect(await bal('6-6000')).toBe(300000);     // Aug+Sep+Oct expensed
    expect(await bal('1-1600')).toBe(900000);     // remainder still prepaid
    expect(await balanced()).toBe(true);

    // re-running to the same cut-off posts NOTHING new (idempotent)
    expect((await request(app).post('/api/v1/accounting/amortize').set(auth(gm)).send({ asOf: '2026-10-15' })).body.data.posted).toBe(0);
    expect(await bal('6-6000')).toBe(300000);

    // finish it — prepaid fully consumed, expense == total
    await request(app).post('/api/v1/accounting/amortize').set(auth(gm)).send({ asOf: '2027-12-31' });
    expect(await bal('1-1600')).toBe(0);
    expect(await bal('6-6000')).toBe(1200000);
    expect(await balanced()).toBe(true);
  });

  it('a schedule that does not divide evenly still amortises to the exact total (last month carries the remainder)', async () => {
    const s = await accrual.createManualSchedule({ chartCode: '6-5000', total: 1000000, months: 3, startDate: '2026-01-01', description: 'listrik prabayar' }, { id: 'u', name: 'U' });
    expect(s.monthlyAmount).toBe(333333);
    await accrual.postAmortization({ asOf: '2026-03-31' }, { id: 'u', name: 'U' });
    expect(await bal('6-5000')).toBe(1000000);    // 333333 + 333333 + 333334 (remainder) == exactly the total
    expect(await balanced()).toBe(true);
  });
});

describe('ACCRUED expense (reversing entries)', () => {
  it('books the expense THIS period and auto-reverses NEXT period, so it is not double-counted', async () => {
    const a = await request(app).post('/api/v1/accounting/accruals').set(auth(gm)).send({ chartCode: '6-1000', amount: 500000, date: '2026-08-31', description: 'gaji akhir bulan' });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ amount: 500000, date: '2026-08-31', reverseDate: '2026-09-01', status: 'aktif' });
    // AUGUST P&L includes the accrued expense (recognised before the bill)
    expect(await bal('6-1000', { dateTo: '2026-08-31' })).toBe(500000);
    expect(await bal('2-4000', { dateTo: '2026-08-31' })).toBe(500000);   // accrued liability shows the debt at Aug-end
    // the reversal lands in SEPTEMBER, so over all time it nets to zero (a pure timing shift)
    expect(await bal('6-1000')).toBe(0);
    expect(await bal('2-4000')).toBe(0);
    expect(await balanced()).toBe(true);

    // the real September bill of 500k then counts ONCE in September (accrual reversal −500 + bill +500 = the right net)
    const bill = await request(app).post('/api/v1/accounting/bills').set(auth(gm)).send({ supplierId, billDate: '2026-09-05', lines: [{ chartCode: '6-1000', unitPrice: 500000, qty: 1 }] });
    await request(app).post(`/api/v1/accounting/bills/${bill.body.data.id}/issue`).set(auth(gm)).send({});
    expect(await bal('6-1000', { dateFrom: '2026-09-01', dateTo: '2026-09-30' })).toBe(0);   // reversal (−500) + bill (+500)
    expect(await balanced()).toBe(true);
  });

  it('voiding an accrual removes the timing shift entirely', async () => {
    const a = await request(app).post('/api/v1/accounting/accruals').set(auth(gm)).send({ chartCode: '6-2000', amount: 90000, date: '2026-07-31', description: 'bbm belum ditagih' });
    expect(await bal('6-2000', { dateTo: '2026-07-31' })).toBe(90000);
    const v = await request(app).post(`/api/v1/accounting/accruals/${a.body.data.id}/void`).set(auth(gm)).send({ reason: 'dobel' });
    expect(v.status).toBe(200);
    expect(await bal('6-2000', { dateTo: '2026-07-31' })).toBe(0);   // July accrual undone
    expect(await bal('6-2000')).toBe(0);
    expect(await balanced()).toBe(true);
  });
});
