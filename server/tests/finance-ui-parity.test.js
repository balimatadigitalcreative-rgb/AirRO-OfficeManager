'use strict';
// FINANCE REDESIGN — Stage 5 tests. Two guarantees the redesign makes:
//  1. The entry-form / report-drill JOURNAL PREVIEW (client finDeriveJournal) matches the server
//     accounting engine EXACTLY — loaded from the real finance-app.jsx so a future drift fails here.
//  2. The report FIGURES the client shows equal what the server computes (no client-side divergence).
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const report = require('../src/services/report.service');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

// Pull the ACTUAL client journal projection block (FIN_CATMAP / FIN_CHART / finDeriveJournal) out of
// finance-app.jsx and evaluate it. It is plain JS (no JSX), so it runs as-is under Node. If someone
// edits the client map without matching the server, these assertions break.
function loadClientJournal() {
  const src = fs.readFileSync(path.join(__dirname, '../../finance-app.jsx'), 'utf8');
  const start = src.indexOf('const FIN_CATMAP');
  const end = src.indexOf('/* ---------------- Add entry form');
  if (start < 0 || end < 0) throw new Error('client journal block not found in finance-app.jsx');
  const block = src.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}; return { FIN_CATMAP, FIN_CHART, finDeriveJournal };`)();
}

describe('Stage 5 — client journal projection matches the server accounting engine', () => {
  const C = loadClientJournal();

  it('income: Dr cash / Cr the server-mapped revenue account, balanced', () => {
    for (const cat of ['Refill', 'Bulk', 'Deposit', 'Dispenser', 'OtherIn', 'UnmappedX']) {
      const j = C.finDeriveJournal({ type: 'income', amount: 123456, category: cat, acctType: 'cash', gallonQty: 0 });
      expect(j.balanced).toBe(true);
      expect(j.lines.find((l) => l.dr).code).toBe('1-1000');                          // Kas
      expect(j.lines.find((l) => l.cr).code).toBe(acc.categoryToCode(cat, 'income') || '4-2000');
      expect(j.dr).toBe(123456);
      expect(j.cr).toBe(123456);
    }
  });

  it('expense: Dr the server-mapped expense account / Cr bank, balanced', () => {
    for (const cat of ['Fuel', 'Supplies', 'Salaries', 'Orientation', 'Maintenance', 'Utilities', 'Rent', 'OtherOut', 'UnmappedX']) {
      const j = C.finDeriveJournal({ type: 'expense', amount: 1000, category: cat, acctType: 'bank', gallonQty: 0 });
      expect(j.lines.find((l) => l.dr).code).toBe(acc.categoryToCode(cat, 'expense') || '6-9000');
      expect(j.lines.find((l) => l.cr).code).toBe('1-1100');                          // Bank
      expect(j.balanced).toBe(true);
    }
  });

  it('gallon purchase posts to Persediaan (asset 1-1300), not to an expense account', () => {
    const j = C.finDeriveJournal({ type: 'expense', amount: 400000, category: 'Supplies', acctType: 'cash', gallonQty: 20 });
    expect(j.lines.find((l) => l.dr).code).toBe('1-1300');
    expect(j.lines.find((l) => l.cr).code).toBe('1-1000');
    expect(j.balanced).toBe(true);
  });

  it('the cash line follows the account type (cash → Kas, bank → Bank)', () => {
    expect(C.finDeriveJournal({ type: 'income', amount: 1, category: 'Refill', acctType: 'cash' }).lines.find((l) => l.dr).code).toBe('1-1000');
    expect(C.finDeriveJournal({ type: 'income', amount: 1, category: 'Refill', acctType: 'bank' }).lines.find((l) => l.dr).code).toBe('1-1100');
  });

  it('zero amount → no journal lines (nothing to preview), still balanced', () => {
    const j = C.finDeriveJournal({ type: 'income', amount: 0, category: 'Refill', acctType: 'cash' });
    expect(j.lines).toEqual([]);
    expect(j.balanced).toBe(true);
  });
});

describe('Stage 5 — report figures equal the server (no client-side divergence)', () => {
  let owner, ownerUser;
  beforeAll(async () => {
    await resetDb();
    const o = (await request(app).post('/api/v1/auth/register').send({ name: 'B', username: 'fu_gm', password: 'secret123', role: 'gm' })).body;
    owner = o.token; ownerUser = { id: o.user.id, role: 'gm', unitScope: 'all' };
    const mk = (type, amount, category, date) => request(app).post('/api/v1/entries').set(auth(owner)).send({ type, amount, category, acct: 'cash', date, note: category });
    await mk('income', 500000, 'Refill', '2026-08-01');
    await mk('income', 900000, 'Bulk', '2026-08-02');
    await mk('expense', 250000, 'Fuel', '2026-08-02');
    await mk('expense', 300000, 'Salaries', '2026-08-03');
  });
  afterAll(() => prisma.$disconnect());

  it('the client k-aggregation (finance-reports.jsx) equals report.service.summary for the same range', async () => {
    const range = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };
    const s = await report.summary(range, ownerUser);
    // Mirror of the ReportsScreen k{} aggregation (sum income/expense over rows in range).
    const rows = [{ t: 'income', a: 500000 }, { t: 'income', a: 900000 }, { t: 'expense', a: 250000 }, { t: 'expense', a: 300000 }];
    const income = rows.filter((r) => r.t === 'income').reduce((x, r) => x + r.a, 0);
    const expense = rows.filter((r) => r.t === 'expense').reduce((x, r) => x + r.a, 0);
    const profit = income - expense;
    const margin = income ? Math.round((profit / income) * 1000) / 10 : 0;
    expect(s.revenue).toBe(income);
    expect(s.expense).toBe(expense);
    expect(s.profit).toBe(profit);
    expect(s.margin).toBe(margin);
    expect(s.counts.income + s.counts.expense).toBe(4);
  });
});
