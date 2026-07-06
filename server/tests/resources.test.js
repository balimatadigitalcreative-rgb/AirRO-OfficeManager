'use strict';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const tokens = {};

async function reg(creds) {
  await request(app).post('/api/v1/auth/register').send(creds);
  const res = await request(app).post('/api/v1/auth/login').send({ username: creds.username, password: creds.password });
  return res.body.token;
}
const auth = (role) => ({ Authorization: `Bearer ${tokens[role]}` });

beforeAll(async () => {
  await resetDb();
  tokens.gm = await reg({ name: 'GM', username: 'gm1', password: 'secret123', role: 'gm' });
  tokens.finance = await reg({ name: 'Fin', username: 'fin1', password: 'secret123', role: 'finance' });
  tokens.hrd = await reg({ name: 'Hrd', username: 'hrd1', password: 'secret123', role: 'hrd' });
  tokens.adminfin = await reg({ name: 'Adm', username: 'adm1', password: 'secret123', role: 'adminfin' });
  tokens.owner = await reg({ name: 'Own', username: 'own1', password: 'secret123', role: 'owner' });
  // Salaries category is required for payroll posting (FK on Entry.categoryKey).
  await prisma.category.create({ data: { key: 'Salaries', label: 'Salaries & Wages', icon: 'IconUsersGroup', type: 'expense' } });
});
afterAll(() => prisma.$disconnect());

describe('Accounts + balance', () => {
  let accId;
  it('gm creates an account', async () => {
    const res = await request(app).post('/api/v1/accounts').set(auth('gm')).send({ name: 'BCA', type: 'bank', opening: 1000000 });
    expect(res.status).toBe(201);
    accId = res.body.data.id;
  });
  it('computes balance from opening + entries', async () => {
    await request(app).post('/api/v1/entries').set(auth('finance')).send({ type: 'income', amount: 500000, date: '2026-06-01', accountId: accId });
    await request(app).post('/api/v1/entries').set(auth('finance')).send({ type: 'expense', amount: 200000, date: '2026-06-01', accountId: accId });
    const res = await request(app).get(`/api/v1/accounts/${accId}/balance`).set(auth('finance'));
    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(1300000); // 1,000,000 + 500,000 − 200,000
  });
  it('forbids adminfin (no settings perm) from creating accounts', async () => {
    const res = await request(app).post('/api/v1/accounts').set(auth('adminfin')).send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('bulk sync replaces the collection (upsert by id + delete missing)', async () => {
    const items = [
      { id: 'cash', name: 'Cash', type: 'cash', opening: 0, color: '#22A7A1', sortOrder: 0 },
      { id: 'bca', name: 'BCA', type: 'bank', bank: 'BCA', opening: 500000, color: '#065489', sortOrder: 1 },
    ];
    const res = await request(app).put('/api/v1/accounts/sync').set(auth('gm')).send({ items });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a.id).sort();
    expect(ids).toEqual(['bca', 'cash']); // the earlier ad-hoc accounts were deleted
    // Re-sync with one removed → it disappears.
    await request(app).put('/api/v1/accounts/sync').set(auth('gm')).send({ items: [items[0]] });
    const after = (await request(app).get('/api/v1/accounts').set(auth('gm'))).body.data;
    expect(after.map((a) => a.id)).toEqual(['cash']);
  });
});

describe('Transfers', () => {
  let a, b;
  beforeAll(async () => {
    a = (await request(app).post('/api/v1/accounts').set(auth('gm')).send({ name: 'Cash', type: 'cash', opening: 0 })).body.data.id;
    b = (await request(app).post('/api/v1/accounts').set(auth('gm')).send({ name: 'Bank', type: 'bank', opening: 0 })).body.data.id;
  });
  it('moves money and reflects in both balances', async () => {
    await request(app).post('/api/v1/entries').set(auth('finance')).send({ type: 'income', amount: 1000000, date: '2026-06-01', accountId: a });
    const t = await request(app).post('/api/v1/transfers').set(auth('finance')).send({ fromId: a, toId: b, amount: 400000, date: '2026-06-02' });
    expect(t.status).toBe(201);
    const balA = (await request(app).get(`/api/v1/accounts/${a}/balance`).set(auth('finance'))).body.data.balance;
    const balB = (await request(app).get(`/api/v1/accounts/${b}/balance`).set(auth('finance'))).body.data.balance;
    expect(balA).toBe(600000);
    expect(balB).toBe(400000);
  });
  it('rejects a transfer to the same account', async () => {
    const res = await request(app).post('/api/v1/transfers').set(auth('finance')).send({ fromId: a, toId: a, amount: 1, date: '2026-06-02' });
    expect(res.status).toBe(400);
  });
});

describe('Setoran (role: setoran)', () => {
  it('adminfin can create and deposit is computed', async () => {
    const res = await request(app).post('/api/v1/setoran').set(auth('adminfin')).send({ date: '2026-06-04', cash: 800000, bonPay: 150000, expense: 50000 });
    expect(res.status).toBe(201);
    expect(res.body.data.deposit).toBe(900000); // 800k + 150k − 50k
  });
  it('hrd (no setoran perm) is forbidden', async () => {
    const res = await request(app).get('/api/v1/setoran').set(auth('hrd'));
    expect(res.status).toBe(403);
  });
});

describe('Employees + payroll', () => {
  it('hrd manages employees', async () => {
    const res = await request(app).post('/api/v1/employees').set(auth('hrd')).send({ name: 'Budi', department: 'Driver', base: 4000000, allowance: 500000, risk: 'Medium' });
    expect(res.status).toBe(201);
  });
  it('stamps the creator from the token (name + role), not from the body', async () => {
    const res = await request(app).post('/api/v1/employees').set(auth('hrd'))
      .send({ name: 'Sari', department: 'Admin', createdBy: { name: 'Fake', role: 'owner' }, createdByName: 'Fake', createdByRole: 'owner' });
    expect(res.status).toBe(201);
    expect(res.body.data.createdBy).toEqual({ name: 'Hrd', role: 'hrd' });
    const list = await request(app).get('/api/v1/employees').set(auth('hrd'));
    const row = list.body.data.find((e) => e.id === res.body.data.id);
    expect(row.createdBy).toEqual({ name: 'Hrd', role: 'hrd' });   // survives round-trip, not forgeable
    await request(app).delete(`/api/v1/employees/${res.body.data.id}`).set(auth('hrd'));   // keep payroll count clean
  });
  it('finance can VIEW the roster (feeds payroll) but cannot create employees', async () => {
    const view = await request(app).get('/api/v1/employees').set(auth('finance'));
    expect(view.status).toBe(200);   // has `payroll` cap → allowed to read the roster
    const create = await request(app).post('/api/v1/employees').set(auth('finance')).send({ name: 'X' });
    expect(create.status).toBe(403); // but not the employees-manage capability
  });
  it('adminfin (no roster-consuming cap) cannot read employees', async () => {
    const res = await request(app).get('/api/v1/employees').set(auth('adminfin'));
    expect(res.status).toBe(403);
  });
  it('payroll run returns BPJS-laden totals', async () => {
    const res = await request(app).get('/api/v1/payroll').set(auth('hrd'));
    expect(res.status).toBe(200);
    expect(res.body.data.totals.count).toBe(1);
    // company cost must exceed gross (employer contributions added)
    expect(res.body.data.totals.companyCost).toBeGreaterThan(res.body.data.totals.gross);
  });
  it('finance can post payroll to the cash book; hrd cannot', async () => {
    const ok = await request(app).post('/api/v1/payroll/post').set(auth('finance')).send({ date: '2026-06-01' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.type).toBe('expense');
    const no = await request(app).post('/api/v1/payroll/post').set(auth('hrd')).send({ date: '2026-06-01' });
    expect(no.status).toBe(403);
  });
});

describe('Reports', () => {
  it('summary reflects income/expense', async () => {
    const res = await request(app).get('/api/v1/reports/summary').set(auth('finance'));
    expect(res.status).toBe(200);
    expect(res.body.data.revenue).toBeGreaterThan(0);
    expect(res.body.data).toHaveProperty('margin');
  });
  it('owner can read reports (read-only role)', async () => {
    const res = await request(app).get('/api/v1/reports/cashflow').set(auth('owner'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
  it('adminfin (no reports perm) is forbidden', async () => {
    const res = await request(app).get('/api/v1/reports/summary').set(auth('adminfin'));
    expect(res.status).toBe(403);
  });
});

describe('Users admin (gm only)', () => {
  it('gm lists users', async () => {
    const res = await request(app).get('/api/v1/users').set(auth('gm'));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
  });
  it('finance cannot administer users', async () => {
    const res = await request(app).get('/api/v1/users').set(auth('finance'));
    expect(res.status).toBe(403);
  });
});

describe('Settings', () => {
  it('any user reads settings with defaults', async () => {
    const res = await request(app).get('/api/v1/settings').set(auth('adminfin'));
    expect(res.status).toBe(200);
    expect(res.body.data.alerts.lowCash).toBe(20000000);
  });
  it('finance updates a setting; adminfin cannot', async () => {
    const ok = await request(app).put('/api/v1/settings/alerts').set(auth('finance')).send({ value: { lowCash: 99 } });
    expect(ok.status).toBe(200);
    const no = await request(app).put('/api/v1/settings/alerts').set(auth('adminfin')).send({ value: { lowCash: 1 } });
    expect(no.status).toBe(403);
  });
});
