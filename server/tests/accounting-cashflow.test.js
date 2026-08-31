'use strict';
// ACCOUNTING v2 — ARUS KAS (cash flow statement). Indirect method computed from the journal, so the
// hard identity kas awal + arus kas bersih == kas akhir holds by construction. Tests: reconciliation,
// cash-to-cash transfers net to zero, a credit sale shows as a working-capital change (not cash
// revenue), gallon purchases classify as inventory (consistent with how they post), and an account
// with an unmapped subtype is REPORTED (still counted, so the statement always reconciles).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let gm, kasId, bankId, custId;
beforeAll(async () => {
  await resetDb();
  const o = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'cf_gm', password: 'secret123', role: 'gm' })).body;
  gm = o.token;
  kasId = (await request(app).post('/api/v1/accounts').set(auth(gm)).send({ name: 'Kas', type: 'cash', opening: 0 })).body.data.id;
  bankId = (await request(app).post('/api/v1/accounts').set(auth(gm)).send({ name: 'BCA', type: 'bank', opening: 0 })).body.data.id;
  const mkE = (type, amount, category, date, extra) => request(app).post('/api/v1/entries').set(auth(gm)).send({ type, amount, category, acct: kasId, date, note: category, ...(extra || {}) });
  // AUGUST — operating activity: a cash sale, a cash expense, a gallon (inventory) purchase, a credit
  // sale (bon, no cash) and a partial collection (pelunasan, cash in).
  await mkE('income', 500000, 'Refill', '2026-08-05');
  await mkE('expense', 200000, 'Fuel', '2026-08-06');
  await mkE('expense', 100000, 'Supplies', '2026-08-07', { gallonQty: 20 });   // → Persediaan (inventory)
  custId = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'BU RIRIS', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
  await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: custId, qty: 10, method: 'bon', txnDate: '2026-08-03' });            // +100k AR, no cash
  await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: custId, method: 'pelunasan', txnDate: '2026-08-10', payAmount: 60000 }); // +60k cash
  // SEPTEMBER — ONLY a cash↔cash transfer (must net to zero in the cash flow).
  await prisma.transfer.create({ data: { id: 'cf_tf1', amount: 100000n, date: '2026-09-15', fromId: kasId, toId: bankId } });
  await acc.backfill({ fromDate: '2026-01-01', actor: { id: o.user.id, name: 'GM' } });
  // OCTOBER — an account whose subtype has NO cash-flow section, to exercise the unclassified path.
  await prisma.chartAccount.create({ data: { code: '9-9999', name: 'Akun Misteri', type: 'asset', subtype: 'weird', sortOrder: 99 } });
  await acc.postJournal({ sourceType: 'manual', sourceId: 'cf_x', date: '2026-10-05', description: 'misc', lines: [{ code: '1-1000', debit: 50000 }, { code: '9-9999', credit: 50000 }] });
});
afterAll(() => prisma.$disconnect());

describe('Arus Kas — reconciliation (kas awal + arus kas bersih == kas akhir)', () => {
  it('the seeded August period reconciles to the real change in cash', async () => {
    const cf = await acc.cashFlow({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
    expect(cf.kasAwal).toBe(0);
    expect(cf.kasAkhir).toBe(260000);            // 500 − 200 − 100 + 60 (all in Kas)
    expect(cf.netFlow).toBe(260000);
    expect(cf.kasAwal + cf.netFlow).toBe(cf.kasAkhir);
    expect(cf.reconciles).toBe(true);
    expect(cf.operasi.netIncome).toBe(400000);   // rev 600 (500 Refill + 100 bon) − beban 200
    expect(cf.operasi.total).toBe(260000);
    expect(cf.investasi.total).toBe(0);
    expect(cf.pendanaan.total).toBe(0);
  });

  it('over all time the statement still reconciles exactly', async () => {
    const cf = await acc.cashFlow({});
    expect(cf.reconciles).toBe(true);
    expect(cf.reconciliation.diff).toBe(0);
  });
});

describe('Arus Kas — classification behaviour', () => {
  it('a period with only a cash↔cash transfer nets to zero', async () => {
    const cf = await acc.cashFlow({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(cf.netFlow).toBe(0);
    expect(cf.operasi.total).toBe(0);
    expect(cf.investasi.total).toBe(0);
    expect(cf.pendanaan.total).toBe(0);
    expect(cf.kasAwal).toBe(cf.kasAkhir);   // 260k in, 260k out — cash just moved between accounts
    expect(cf.reconciles).toBe(true);
  });

  it('a credit sale appears as a receivables working-capital change, not as cash revenue', async () => {
    const cf = await acc.cashFlow({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
    const ar = cf.operasi.workingCapital.find((r) => r.code === '1-1200');
    expect(ar).toBeTruthy();
    expect(ar.subtype).toBe('receivable');
    expect(ar.amount).toBe(-40000);   // bon 100k − pelunasan 60k = +40k AR → −40k cash (working capital)
    expect(cf.operasi.incomeItems.some((r) => r.code === '1-1200')).toBe(false);   // AR is NOT revenue
    expect(cf.operasi.incomeItems.some((r) => r.code === '4-1000')).toBe(true);    // revenue rolls into laba bersih
  });

  it('gallon purchases classify as inventory (operating), consistent with how they post', async () => {
    const cf = await acc.cashFlow({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
    const inv = cf.operasi.workingCapital.find((r) => r.code === '1-1300');
    expect(inv).toBeTruthy();
    expect(inv.subtype).toBe('inventory');
    expect(inv.amount).toBe(-100000);   // stock bought for cash → operating outflow
    expect(cf.investasi.rows.some((r) => r.code === '1-1300')).toBe(false);   // never investing
  });

  it('an account with an unmapped subtype is reported (not dropped into Operasi) yet still reconciles', async () => {
    const cf = await acc.cashFlow({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(cf.unclassified.some((r) => r.code === '9-9999')).toBe(true);
    expect(cf.operasi.rows.some((r) => r.code === '9-9999')).toBe(false);
    expect(cf.reconciles).toBe(true);   // still counted in netFlow, so the statement never silently breaks
  });
});
