'use strict';
// TUTUP BUKU + accrual awareness, and SUBSCRIPTION DUE REMINDERS.
//  • closing a period with UNPOSTED amortisation is rejected (would overstate profit); posting it via
//    the checklist action clears the block;
//  • an accrued expense pending reversal WARNS but does not block;
//  • a subscription due within the reminder window shows in the card + the AlertBell count; one due
//    later does not; a paused subscription never reminds.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let gm;
beforeEach(async () => {
  await resetDb();
  await acc.seedChart();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'ca_gm', password: 'secret123', role: 'gm' })).body.token;
});
afterAll(() => prisma.$disconnect());
const close = (year, month) => request(app).post('/api/v1/accounting/periods/close').set(auth(gm)).send({ year, month });
const checklist = (year, month) => request(app).get(`/api/v1/accounting/periods/checklist?year=${year}&month=${month}`).set(auth(gm)).then((r) => r.body.data);

describe('Tutup Buku — amortisation blocks the close', () => {
  it('an unposted amortisation month rejects the close (reason names the count); posting clears it', async () => {
    // a 12-month prepaid starting in Aug 2026 → Aug is due but unposted
    await request(app).post('/api/v1/accounting/amortization-schedules').set(auth(gm)).send({ chartCode: '6-5000', total: 1200000, months: 12, startDate: '2026-08-01', description: 'listrik prabayar' });
    const chk = await checklist(2026, 8);
    expect(chk.amortPending).toBe(1);
    expect(chk.clean).toBe(false);
    const blocked = await close(2026, 8);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/1 amortisasi/);   // the count is named
    expect(blocked.body.error.details.amortPending).toBe(1);

    // the checklist's one-click action posts the period's amortisation
    await request(app).post('/api/v1/accounting/amortize').set(auth(gm)).send({ asOf: '2026-08-31' });
    expect((await checklist(2026, 8)).amortPending).toBe(0);
    const ok = await close(2026, 8);
    expect(ok.status).toBe(200);
    expect(ok.body.data.period.status).toBe('ditutup');
  });

  it('an accrued expense pending reversal WARNS but does not block the close', async () => {
    await request(app).post('/api/v1/accounting/accruals').set(auth(gm)).send({ chartCode: '6-1000', amount: 300000, date: '2026-09-20', description: 'gaji akhir bulan' });   // reverses 2026-10-01
    const chk = await checklist(2026, 9);
    expect(chk.accruedOpen).toBe(1);        // surfaced as a warning
    const r = await close(2026, 9);
    expect(r.status).toBe(200);             // but the close still succeeds
  });
});

describe('Subscription due reminders', () => {
  const mkSub = async (startDate) => {
    const sup = (await prisma.supplier.create({ data: { name: 'PT ' + startDate } })).id;
    return (await request(app).post('/api/v1/accounting/subscriptions').set(auth(gm)).send({ supplierId: sup, name: 'Sub ' + startDate, chartCode: '6-5000', amount: 200000, cadence: 'monthly', startDate })).body.data;
  };
  it('a subscription due in 3 days appears in the card + the AlertBell count; one due in 10 days does not', async () => {
    await mkSub('2026-08-23');   // due in 3 days (asOf 2026-08-20)
    await mkSub('2026-08-30');   // due in 10 days
    const card = (await request(app).get('/api/v1/accounting/subscriptions-due?asOf=2026-08-20&days=7').set(auth(gm))).body.data;
    expect(card.count).toBe(1);
    expect(card.rows[0].nextRunDate).toBe('2026-08-23');
    const status = (await request(app).get('/api/v1/accounting/status?asOf=2026-08-20').set(auth(gm))).body.data;
    expect(status.subsRemind).toBe(1);      // default remindDays 3 → only the 3-day one
    expect(status.subsRemindTotal).toBe(200000);
  });

  it('a PAUSED subscription never reminds', async () => {
    const s = await mkSub('2026-08-22');
    await request(app).post(`/api/v1/accounting/subscriptions/${s.id}/pause`).set(auth(gm)).send({});
    expect((await request(app).get('/api/v1/accounting/subscriptions-due?asOf=2026-08-20&days=7').set(auth(gm))).body.data.count).toBe(0);
    expect((await request(app).get('/api/v1/accounting/status?asOf=2026-08-20').set(auth(gm))).body.data.subsRemind).toBe(0);
  });

  it('an active subscription past its cycle date is flagged overdue on the list', async () => {
    await mkSub('2026-08-10');   // cycle already passed by 2026-08-20 (no bill run)
    const list = (await request(app).get('/api/v1/accounting/subscriptions').set(auth(gm))).body.data;
    // overdue is computed against the server's today; the seed date is well in the past
    expect(list.some((x) => x.overdue === true)).toBe(true);
  });
});
