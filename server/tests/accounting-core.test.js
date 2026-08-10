'use strict';
// ACCOUNTING v2 core invariants: every journal balances (debit==credit), the trial balance balances,
// the balance-sheet equation holds, and finance receivables == Σ customer Sisa Bon.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let owner, actor;
beforeAll(async () => {
  await resetDb();
  const o = await reg({ name: 'Boss', username: 'own_ac', password: 'secret123', role: 'gm' });   // gm holds `settings` (account mgmt); owner does not
  owner = o.token; actor = { id: o.user.id, name: 'Boss' };
  // Plain cash-book shape (category/acct as strings, not the legacy FK relations).
  const mkE = (type, amount, category, date, extra) => request(app).post('/api/v1/entries').set(auth(owner)).send({ type, amount, category, acct: 'cash', date, note: category, ...(extra || {}) });
  await mkE('income', 500000, 'Refill', '2026-08-01');
  await mkE('expense', 250000, 'Fuel', '2026-08-02');
  await mkE('expense', 400000, 'Supplies', '2026-08-02', { gallonQty: 20, note: 'Pembelian Galon' });   // → inventory, not expense
  // distribution: customers with real bon + a pelunasan (drives Sisa Bon)
  const cA = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'BU RIRIS', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
  const cB = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'PAK ADI', type: 'reguler', masterPrice: 10000, armada: 'Biru' })).body.data.id;
  await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cA, qty: 10, method: 'bon', txnDate: '2026-08-03' });     // +100k AR
  await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cB, qty: 8, method: 'bon', txnDate: '2026-08-03' });      // +80k AR
  await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cA, qty: 5, method: 'lunas', txnDate: '2026-08-04' });    // cash sale
  await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cA, qty: 3, method: 'pelunasan', txnDate: '2026-08-05', payAmount: 30000 });   // −30k AR (pelunasan reads payAmount, not amount)
  await acc.backfill({ fromDate: '2026-01-01', actor });
});
afterAll(() => prisma.$disconnect());

describe('hard invariant: every journal balances', () => {
  it('postJournal rejects an unbalanced entry', async () => {
    await expect(acc.postJournal({ sourceType: 'manual', sourceId: 'bad1', date: '2026-08-01', lines: [{ code: '1-1000', debit: 100 }, { code: '4-1000', credit: 90 }] })).rejects.toThrow(/not balanced/i);
  });
  it('every posted journal has sum(debit) == sum(credit)', async () => {
    const jes = await prisma.journalEntry.findMany({ include: { lines: true } });
    expect(jes.length).toBeGreaterThan(0);
    for (const j of jes) { const d = j.lines.reduce((s, l) => s + Number(l.debit), 0); const c = j.lines.reduce((s, l) => s + Number(l.credit), 0); expect(d).toBe(c); }
  });
});

describe('trial balance + balance sheet', () => {
  it('the trial balance balances', async () => { const tb = await acc.trialBalance(); expect(tb.balanced).toBe(true); expect(tb.totalDebit).toBe(tb.totalCredit); expect(tb.totalDebit).toBeGreaterThan(0); });
  it('assets = liabilities + equity (incl. current net income)', async () => { const bs = await acc.balanceSheet(); expect(bs.balanced).toBe(true); expect(bs.assets).toBe(bs.liabilities + bs.equity); });
  it('the gallon purchase landed in Persediaan (asset), not expense', async () => {
    const rows = await acc.accountBalances();
    expect(rows.find((r) => r.code === '1-1300').balance).toBe(400000);
  });
});

describe('finance receivables == Σ customer Sisa Bon', () => {
  it('the Piutang Usaha journal balance equals the sum of every customer Sisa Bon', async () => {
    const custs = (await request(app).get('/api/v1/distribusi/customers').set(auth(owner))).body.data;
    const sumSisaBon = custs.reduce((s, c) => s + (c.sisaBon || 0), 0);
    expect(sumSisaBon).toBe(150000);   // 100k + 80k − 30k
    expect(await acc.receivablesBalance()).toBe(sumSisaBon);
  });
});

describe('unmapped categories are reported, not silently guessed', () => {
  it('a custom category with no chart mapping is surfaced', async () => {
    await request(app).post('/api/v1/entries').set(auth(owner)).send({ type: 'expense', amount: 50000, category: 'MyCustomCat', acct: 'bank', date: '2026-08-06', note: 'x' });
    const unmapped = await acc.unmappedCategories();
    expect(unmapped.some((u) => u.category === 'MyCustomCat')).toBe(true);
    // it still posts (to Beban Lain-lain) so the books stay balanced
    await acc.backfill({ fromDate: '2026-01-01', actor });
    expect((await acc.trialBalance()).balanced).toBe(true);
  });
});
