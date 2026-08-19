'use strict';
// ACCOUNTS PAYABLE (Utang Usaha) — accrual purchases on the existing double-entry engine. A bill
// recognises the expense when INCURRED (Dr expense · Cr Utang Usaha), independent of payment; partial
// payments (Dr Utang · Cr Kas/Bank) settle it and the status derives from Σ paid. Asserts the accrual
// P&L effect, the ledger balances (2-1000 == Σ outstanding), AP aging, the due-this-week card, tax
// posting, void reversal, and that the trial balance stays balanced throughout.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const bal = async (code) => { const r = (await acc.accountBalances()).find((x) => x.code === code); return r ? r.balance : 0; };
const balanced = async () => (await acc.trialBalance()).balanced === true;

let gm, supplierId, cashId;
beforeAll(async () => {
  await resetDb();
  await acc.seedChart();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'ap_gm', password: 'secret123', role: 'gm' })).body.token;   // reports cap
  supplierId = (await prisma.supplier.create({ data: { name: 'PT Sumber Air' } })).id;
  cashId = (await prisma.account.create({ data: { name: 'Kas', type: 'cash' } })).id;
});
afterAll(() => prisma.$disconnect());

const mkBill = (body) => request(app).post('/api/v1/accounting/bills').set(auth(gm)).send(body);
const issue = (id) => request(app).post(`/api/v1/accounting/bills/${id}/issue`).set(auth(gm)).send({});
const pay = (id, body) => request(app).post(`/api/v1/accounting/bills/${id}/payments`).set(auth(gm)).send(body);

describe('bill → accrual → payment lifecycle', () => {
  let billId;
  it('a draft bill posts NOTHING; issuing it accrues the expense (Dr Beban / Cr Utang Usaha)', async () => {
    const c = await mkBill({ supplierId, billNumber: 'INV-9', billDate: '2026-08-01', dueDate: '2026-08-20', tax: 0, lines: [{ chartCode: '6-6000', description: 'Sewa gudang', qty: 1, unitPrice: 500000 }] });
    expect(c.status).toBe(201);
    billId = c.body.data.id;
    expect(c.body.data).toMatchObject({ status: 'draft', total: 500000, outstanding: 500000 });
    expect(await bal('2-1000')).toBe(0);                 // draft → no journal yet
    // issue → accrual posts, even though NOTHING has been paid (this is the accrual point)
    const r = await issue(billId);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('terbuka');
    expect(await bal('6-6000')).toBe(500000);            // Beban Sewa recognised on incur, not on pay
    expect(await bal('2-1000')).toBe(500000);            // Utang Usaha (liability) shows the debt (normal-balance positive)
    expect(await balanced()).toBe(true);
    const j = await acc.journalFor({ sourceType: 'bill', sourceId: billId });
    expect(j.lines.find((l) => l.code === '6-6000').debit).toBe(500000);
    expect(j.lines.find((l) => l.code === '2-1000').credit).toBe(500000);
  });

  it('a partial payment sets status sebagian and moves Utang → Kas; a second clears it to lunas', async () => {
    const p1 = await pay(billId, { date: '2026-08-10', amount: 200000, accountId: cashId });
    expect(p1.status).toBe(200);
    expect(p1.body.data).toMatchObject({ status: 'sebagian', paid: 200000, outstanding: 300000 });
    expect(await bal('2-1000')).toBe(300000);            // debt down to 300k
    expect(await bal('1-1000')).toBe(-200000);           // Kas paid out (asset credit)
    expect(await balanced()).toBe(true);

    // over-payment is refused
    expect((await pay(billId, { date: '2026-08-11', amount: 999999, accountId: cashId })).status).toBe(400);

    const p2 = await pay(billId, { date: '2026-08-15', amount: 300000, accountId: cashId });
    expect(p2.body.data).toMatchObject({ status: 'lunas', outstanding: 0 });
    expect(await bal('2-1000')).toBe(0);                 // fully settled — Utang Usaha back to zero
    expect(await balanced()).toBe(true);
    const got = (await request(app).get(`/api/v1/accounting/bills/${billId}`).set(auth(gm))).body.data;
    expect(got).toMatchObject({ status: 'lunas', paid: 500000, outstanding: 0 });
    expect(got.payments.length).toBe(2);
  });
});

describe('supplier picker (for the AP screens)', () => {
  it('lists active suppliers and creates one inline (reports cap, no gudang access needed)', async () => {
    const c = await request(app).post('/api/v1/accounting/suppliers').set(auth(gm)).send({ name: 'PT Baru' });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ name: 'PT Baru' });
    const list = (await request(app).get('/api/v1/accounting/suppliers').set(auth(gm))).body.data;
    expect(list.some((s) => s.id === c.body.data.id && s.name === 'PT Baru')).toBe(true);
  });
});

describe('tax, AP aging, due-this-week, void', () => {
  it('a bill with tax posts Dr Beban + Dr PPN Masukan / Cr Utang (total), balanced', async () => {
    const c = await mkBill({ supplierId, billDate: '2026-08-02', tax: 55000, lines: [{ chartCode: '6-3000', unitPrice: 500000, qty: 1 }] });   // subtotal 500k + 11% VAT
    await issue(c.body.data.id);
    const j = await acc.journalFor({ sourceType: 'bill', sourceId: c.body.data.id });
    expect(j.lines.find((l) => l.code === '6-3000').debit).toBe(500000);
    expect(j.lines.find((l) => l.code === '1-1500').debit).toBe(55000);   // PPN Masukan (recoverable)
    expect(j.lines.find((l) => l.code === '2-1000').credit).toBe(555000);
    expect(await balanced()).toBe(true);
  });

  it('AP aging buckets the outstanding by bill date and Σ buckets == the Utang Usaha ledger balance', async () => {
    const cid = supplierId;
    // an old unpaid bill (90+) and a recent one (0-30) on a fresh supplier so the totals are clean
    const s2 = (await prisma.supplier.create({ data: { name: 'PT Lama' } })).id;
    const oldB = await mkBill({ supplierId: s2, billDate: '2026-04-01', lines: [{ chartCode: '6-4000', unitPrice: 100000, qty: 1 }] }); await issue(oldB.body.data.id);
    const newB = await mkBill({ supplierId: s2, billDate: '2026-08-10', lines: [{ chartCode: '6-4000', unitPrice: 40000, qty: 1 }] }); await issue(newB.body.data.id);
    const ag = (await request(app).get('/api/v1/accounting/aging-payable?asOf=2026-08-18').set(auth(gm))).body.data;
    const row = ag.rows.find((r) => r.supplierId === s2);
    expect(row.d90p).toBe(100000);   // Apr → 90+
    expect(row.d0_30).toBe(40000);   // Aug → 0-30
    // Σ buckets == Utang Usaha ledger balance (normal-balance positive) — the same money, aged
    expect(ag.total).toBe(await bal('2-1000'));
  });

  it('"jatuh tempo minggu ini" lists unpaid bills due within 7 days and flags overdue', async () => {
    const s3 = (await prisma.supplier.create({ data: { name: 'PT Tempo' } })).id;
    const soon = await mkBill({ supplierId: s3, billDate: '2026-08-15', dueDate: '2026-08-20', lines: [{ chartCode: '6-5000', unitPrice: 70000, qty: 1 }] }); await issue(soon.body.data.id);
    const overdue = await mkBill({ supplierId: s3, billDate: '2026-07-01', dueDate: '2026-08-05', lines: [{ chartCode: '6-5000', unitPrice: 30000, qty: 1 }] }); await issue(overdue.body.data.id);
    const due = (await request(app).get('/api/v1/accounting/payables-due?asOf=2026-08-18').set(auth(gm))).body.data;
    const ids = due.rows.map((r) => r.id);
    expect(ids).toContain(soon.body.data.id);
    expect(due.rows.find((r) => r.id === overdue.body.data.id).overdue).toBe(true);
  });

  it('void reverses the accrual (only when unpaid); a paid bill cannot be voided', async () => {
    const c = await mkBill({ supplierId, billDate: '2026-08-03', lines: [{ chartCode: '6-9000', unitPrice: 80000, qty: 1 }] });
    await issue(c.body.data.id);
    const before = await bal('2-1000');
    // pay then try to void → blocked
    await pay(c.body.data.id, { date: '2026-08-12', amount: 10000, accountId: cashId });
    expect((await request(app).post(`/api/v1/accounting/bills/${c.body.data.id}/void`).set(auth(gm)).send({ reason: 'salah' })).status).toBe(400);
    // a clean unpaid bill voids and fully reverses its accrual
    const c2 = await mkBill({ supplierId, billDate: '2026-08-03', lines: [{ chartCode: '6-9000', unitPrice: 25000, qty: 1 }] });
    await issue(c2.body.data.id);
    const mid = await bal('2-1000');
    const v = await request(app).post(`/api/v1/accounting/bills/${c2.body.data.id}/void`).set(auth(gm)).send({ reason: 'dobel input' });
    expect(v.status).toBe(200);
    expect(await bal('2-1000')).toBe(mid - 25000);   // reversed — the 25k payable removed
    expect(await balanced()).toBe(true);
  });
});
