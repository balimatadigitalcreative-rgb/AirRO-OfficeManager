'use strict';
// PAYROLL — accrual + double-entry. Asserts:
//  • approving a period posts a BALANCED journal and raises Utang Gaji; paying clears it to exactly 0;
//  • a cashbon deduction drops the employee's balance by that amount and posts NO revenue;
//  • production staff salaries land in the COGS labour account and appear once in the costing overhead;
//  • an approved period rejects edits at the API (crafted request);
//  • the balance sheet balances after each step;
//  • closing a period with an approved-but-unposted payroll is blocked and the reason names it;
//  • a user without sdmPayrollLihat is rejected server-side.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const cashbon = require('../src/services/cashbon.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const bal = async (code) => { const r = await acc.accountBalances(); const a = r.find((x) => x.code === code); return a ? a.balance : 0; };

let owner, gm, empProd, empOffice;
beforeEach(async () => {
  await resetDb();
  await acc.seedChart();
  owner = (await request(app).post('/api/v1/auth/register').send({ name: 'Owner', username: 'pr_owner', password: 'secret123', role: 'owner' })).body.token;
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'pr_gm', password: 'secret123', role: 'gm' })).body.token;
  empProd = await prisma.employee.create({ data: { name: 'Prod Staff', base: 5000000n, active: true, isProduction: true, businessUnitId: 'mfg' } });
  empOffice = await prisma.employee.create({ data: { name: 'Office Staff', base: 4000000n, active: true, isProduction: false, businessUnitId: 'air' } });
});
afterAll(() => prisma.$disconnect());

const mkPeriod = () => request(app).post('/api/v1/payroll-accrual/periods').set(auth(gm)).send({ year: 2026, month: 3 });
const approve = (id) => request(app).post(`/api/v1/payroll-accrual/periods/${id}/approve`).set(auth(owner)).send({});
const pay = (id, b) => request(app).post(`/api/v1/payroll-accrual/periods/${id}/pay`).set(auth(owner)).send(b || { account: 'bank' });
const getPeriod = (id) => request(app).get(`/api/v1/payroll-accrual/periods/${id}`).set(auth(owner)).then((r) => r.body.data);

describe('Accrual + journal', () => {
  it('approving posts a balanced journal and raises Utang Gaji; paying clears it to zero', async () => {
    const p = (await mkPeriod()).body.data;
    const ap = await approve(p.id);
    expect(ap.status).toBe(200);
    expect((await acc.trialBalance()).balanced).toBe(true);
    expect(await bal('2-2000')).toBe(9000000);   // Utang Gaji = 5jt + 4jt net
    expect(await bal('6-1000')).toBe(4000000);    // office salary → Beban Gaji
    // pay
    const pd = await pay(p.id);
    expect(pd.status).toBe(200);
    expect(await bal('2-2000')).toBe(0);          // liability cleared to exactly zero
    expect(await bal('1-1100')).toBe(-9000000);   // Bank credited (paid out)
    const bs = (await request(app).get('/api/v1/accounting/balance-sheet').set(auth(owner))).body.data;
    expect(bs.balanced).toBe(true);
  });

  it('the balance sheet balances after approve AND after pay', async () => {
    const p = (await mkPeriod()).body.data;
    await approve(p.id);
    expect((await request(app).get('/api/v1/accounting/balance-sheet').set(auth(owner))).body.data.balanced).toBe(true);
    await pay(p.id);
    expect((await request(app).get('/api/v1/accounting/balance-sheet').set(auth(owner))).body.data.balanced).toBe(true);
  });
});

describe('Cashbon deduction', () => {
  it('reduces the employee balance by exactly the deducted amount and posts no revenue', async () => {
    // give Office Staff a 1jt cashbon (approved → Dr Piutang Karyawan / Cr Kas)
    const cb = await prisma.cashbon.create({ data: { employeeId: empOffice.id, amount: 1000000n, date: '2026-03-01', status: 'pending' } });
    await cashbon.decide(cb.id, 'approved', { id: 'x', name: 'Owner' }, null, '2026-03-01');
    expect(await cashbon.outstandingFor(empOffice.id)).toBe(1000000);
    expect(await bal('1-1250')).toBe(1000000);   // Piutang Karyawan raised on disbursement
    const p = (await mkPeriod()).body.data;
    const line = (await getPeriod(p.id)).lines.find((l) => l.employeeId === empOffice.id);
    await request(app).patch(`/api/v1/payroll-accrual/lines/${line.id}`).set(auth(gm)).send({ cashbonDeduction: 1000000 });
    await approve(p.id);
    expect(await cashbon.outstandingFor(empOffice.id)).toBe(0);   // dropped by exactly 1jt
    expect(await bal('1-1250')).toBe(0);                          // Piutang Karyawan settled
    const is = (await request(app).get('/api/v1/accounting/income-statement').set(auth(owner))).body.data;
    expect(is.revenue).toBe(0);                                   // NEVER counted as revenue
    expect((await acc.trialBalance()).balanced).toBe(true);
  });
});

describe('Production labour → COGS', () => {
  it('production salaries land in the COGS labour account and appear once in the costing overhead', async () => {
    const p = (await mkPeriod()).body.data;
    await approve(p.id);
    expect(await bal('5-1500')).toBe(5000000);   // production staff salary → COGS labour
    const hpp = (await request(app).get('/api/v1/accounting/costing/monthly-hpp?year=2026&month=3').set(auth(owner))).body.data;
    expect(hpp.rows.some((r) => r.code === '5-1500' && r.amount === 5000000)).toBe(true);   // picked up by costing, entered once
    // production labour reported by payroll matches the ledger (no double entry)
    const rep = (await request(app).get('/api/v1/payroll-accrual/report?year=2026&month=3').set(auth(owner))).body.data;
    expect(rep.productionLabour).toBe(5000000);
    expect(rep.prodGross).toBe(5000000);
  });
});

describe('Immutability + close + access', () => {
  it('an approved period rejects edits at the API', async () => {
    const p = (await mkPeriod()).body.data;
    const line = (await getPeriod(p.id)).lines[0];
    await approve(p.id);
    const edit = await request(app).patch(`/api/v1/payroll-accrual/lines/${line.id}`).set(auth(gm)).send({ bonus: 500000 });
    expect(edit.status).toBe(400);
    expect(edit.body.error.message).toMatch(/disetujui/i);
  });

  it('closing a period with an approved-but-unposted payroll is blocked and the reason names it', async () => {
    const p = (await mkPeriod()).body.data;
    // simulate an approved period whose journal never posted (e.g. accounting was off at approval)
    await prisma.payrollPeriod.update({ where: { id: p.id }, data: { status: 'disetujui', journalEntryId: null } });
    const chk = (await request(app).get('/api/v1/accounting/periods/checklist?year=2026&month=3').set(auth(owner))).body.data;
    expect(chk.payrollUnposted).toBe(1);
    expect(chk.clean).toBe(false);
    const close = await request(app).post('/api/v1/accounting/periods/close').set(auth(owner)).send({ year: 2026, month: 3 });
    expect(close.status).toBe(400);
    expect(close.body.error.message).toMatch(/payroll disetujui/i);
    expect(close.body.error.details.payrollUnposted).toBe(1);
  });

  it('a user without sdmPayrollLihat is rejected server-side', async () => {
    const fin = (await request(app).post('/api/v1/auth/register').send({ name: 'Fin', username: 'pr_fin', password: 'secret123', role: 'finance' })).body.token;
    const r = await request(app).get('/api/v1/payroll-accrual/periods').set(auth(fin));
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/sdmPayrollLihat/);
  });
});
