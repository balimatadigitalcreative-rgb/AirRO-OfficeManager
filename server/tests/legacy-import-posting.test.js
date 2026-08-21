'use strict';
// REGRESSION — a legacy HISTORY import (importLegacyTransactions) of bon/pelunasan must post its
// journals LIVE, exactly like createOpeningBon, so that BOTH cross-module invariants hold:
//   • source ↔ journal integrity — no legacy bon/pelunasan is left without a journal;
//   • finance AR (1-1200) == Σ customer Sisa Bon.
// Before the fix the import created legacy rows with NO journal at all: Sisa Bon dropped by the
// imported pelunasan but AR did not, so AR read TOO HIGH by the un-posted Cr Piutang (the exact
// shape of the production failure: 8 dist_txn missing + AR Rp525k over Σ Sisa Bon).
process.env.ACCOUNTING_V2 = 'true';
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const dist = require('../src/services/distribution.service');

const owner = { id: 'own1', name: 'Owner', role: 'owner' };
const rnd = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  await resetDb();
  await acc.seedChart();
});
afterAll(() => prisma.$disconnect());

const mkCustomer = () => prisma.customer.create({ data: { name: 'Warung ' + rnd(), code: 'C' + rnd(), armada: 'Merah', masterPrice: 20000, active: true } });

describe('Legacy history import posts journals (accrual)', () => {
  it('a legacy bon + pelunasan import leaves 0 missing journals and AR == Σ Sisa Bon', async () => {
    const c = await mkCustomer();
    // Historical debt of 200.000 partly paid down by 75.000 → Sisa Bon 125.000.
    const rows = [
      { txnDate: '04/03/2026', price: 20000, bonQty: 10, paymentAmount: 0, note: 'bon historis' },
      { txnDate: '24/03/2026', price: 0, bonQty: 0, paymentAmount: 75000, note: 'bayar historis' },
    ];
    const res = await dist.importLegacyTransactions(c.id, rows, owner, 0, true);
    expect(res.imported).toBe(2);

    // Sisa Bon (the receivable math counts legacy bon/pelunasan) = 200.000 − 75.000
    const aging = await acc.agingReceivables({});
    expect(aging.total).toBe(125000);

    // INVARIANT A — source ↔ journal integrity: nothing left un-posted.
    const ic = await acc.integrityCheck({});
    expect(ic.missingCount).toBe(0);

    // INVARIANT B — finance AR (1-1200) == Σ customer Sisa Bon.
    const ar = await acc.receivablesBalance();
    expect(ar).toBe(aging.total);

    // Ledger stays balanced end-to-end.
    expect((await acc.trialBalance()).balanced).toBe(true);
  });

  it('a payment-only legacy import (bon already on the books) reduces AR to match Sisa Bon', async () => {
    const c = await mkCustomer();
    // First establish the debt via the normal opening-bon path (which already posts).
    await dist.createOpeningBon(c.id, { amount: 300000, note: 'saldo awal', txnDate: '2026-02-01' }, owner);
    expect(await acc.receivablesBalance()).toBe(300000);
    // Now a legacy import brings in only historical payments (the production scenario: back-dated
    // pelunasan entered while ACCOUNTING_V2 is on, previously never posted).
    const res = await dist.importLegacyTransactions(c.id, [
      { txnDate: '10/04/2026', price: 0, bonQty: 0, paymentAmount: 120000, note: 'cicilan' },
    ], owner, 0, true);
    expect(res.imported).toBe(1);

    const aging = await acc.agingReceivables({});
    expect(aging.total).toBe(180000);              // 300k − 120k
    const ic = await acc.integrityCheck({});
    expect(ic.missingCount).toBe(0);
    expect(await acc.receivablesBalance()).toBe(aging.total);
    expect((await acc.trialBalance()).balanced).toBe(true);
  });
});
