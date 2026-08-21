'use strict';
// REGRESSION — an approved correction must post an AR DELTA (new − old), never the full amount again.
//  • 612k → 500k posts −112k, AR == Σ Sisa Bon.
//  • a correction on a not-yet-posted bon ESTABLISHES the original (no full-amount adjustment), so a
//    later backfill no-ops instead of double-counting (the BALI HOLIDAY INN bug).
//  • integrityCheck flags a pre-existing full-amount adjustment (dist_txn_adj, reversalOf=null), and
//    reversing it clears the flag and reconciles AR.
process.env.ACCOUNTING_V2 = 'true';
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const dist = require('../src/services/distribution.service');

const rnd = () => Math.random().toString(36).slice(2, 8);
const num = (b) => Number(b || 0);
let actor, arId;

beforeEach(async () => {
  await resetDb();
  await acc.seedChart();
  const u = await prisma.user.create({ data: { name: 'O', username: 'adj_' + rnd(), passwordHash: 'x', role: 'owner' } });
  actor = { id: u.id, role: 'owner', name: 'O' };
  arId = (await acc.chartMap())['1-1200'];
});
afterAll(() => prisma.$disconnect());

const mkCust = (price = 612000) => prisma.customer.create({ data: { name: 'C ' + rnd(), code: 'C' + rnd(), armada: 'Merah', masterPrice: price, active: true } });
const arNet = (e) => e.lines.filter((l) => l.chartAccountId === arId).reduce((a, l) => a + num(l.debit) - num(l.credit), 0);
const gap = async () => (await acc.receivablesBalance()) - (await acc.agingReceivables({})).total;

describe('adjustment posts a DELTA, never the full amount', () => {
  it('a correction 612k → 500k posts an AR delta of −112k (not a second 612k)', async () => {
    const c = await mkCust(612000);
    const t = await dist.createTransaction({ customerId: c.id, method: 'bon', qty: 1, txnDate: '2026-08-15' }, actor);
    expect(await acc.receivablesBalance()).toBe(612000);
    // what decideChangeRequest does: update the row, then reconcile against the original.
    await prisma.distTransaction.update({ where: { id: t.id }, data: { amount: 500000, unitPriceLocked: 500000 } });
    const updated = await prisma.distTransaction.findUnique({ where: { id: t.id } });
    await acc.reconcileDistTxn(updated, 'req1', actor, prisma);
    await acc.postReceivablesReclass(c.id, actor, prisma);

    const adj = await prisma.journalEntry.findFirst({ where: { sourceType: 'dist_txn_adj', ref: t.id }, include: { lines: true } });
    expect(arNet(adj)).toBe(-112000);           // the DELTA, not a second 612k
    expect(adj.reversalOf).toBeTruthy();         // reconciled against the original
    expect(await acc.receivablesBalance()).toBe(500000);
    expect(await gap()).toBe(0);
    expect((await acc.integrityCheck({})).duplicateCount).toBe(0);
  });

  it('a correction on a not-yet-posted bon establishes the original instead of double-counting', async () => {
    const c = await mkCust(612000);
    // bon row with NO journal (created while posting was off).
    const t = await prisma.distTransaction.create({ data: { customerId: c.id, fleetId: 'Merah', qty: 1, unitPriceLocked: 612000, amount: 612000, method: 'bon', bonCounted: true, status: 'active', txnDate: '2026-08-15' } });
    await acc.reconcileDistTxn(t, 'req1', actor, prisma);   // no original → establishes it, posts NO adjustment
    await acc.postDistTransaction(t, actor, prisma);         // the backfill, later → idempotent no-op

    expect(await acc.receivablesBalance()).toBe(612000);     // counted exactly ONCE
    expect(await gap()).toBe(0);
    expect(await prisma.journalEntry.count({ where: { sourceType: 'dist_txn_adj', ref: t.id } })).toBe(0);
    expect((await acc.integrityCheck({})).duplicateCount).toBe(0);
  });

  it('integrityCheck flags a pre-existing full-amount adjustment; reversing it reconciles AR', async () => {
    const c = await mkCust(612000);
    const t = await dist.createTransaction({ customerId: c.id, method: 'bon', qty: 1, txnDate: '2026-08-15' }, actor);
    // the historical bug: a dist_txn_adj with reversalOf=null that re-posted the FULL amount (copy the original's lines).
    const orig = await prisma.journalEntry.findFirst({ where: { sourceType: 'dist_txn', sourceId: t.id }, include: { lines: true } });
    await prisma.journalEntry.create({ data: {
      sourceType: 'dist_txn_adj', sourceId: `${t.id}:badreq`, ref: t.id, date: orig.date, reversalOf: null, description: 'full-amount bug',
      lines: { create: orig.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: BigInt(Math.round(num(l.debit))), credit: BigInt(Math.round(num(l.credit))), fleetId: l.fleetId || '' })) },
    } });
    expect(await acc.receivablesBalance()).toBe(1224000);

    const ic = await acc.integrityCheck({});
    expect(ic.duplicateCount).toBe(1);
    expect(ic.duplicate[0].type).toBe('full_amount_adj');
    expect(ic.duplicate[0].reverseIds.length).toBe(1);

    // remediate: reverse the flagged entry (mirror reverse-duplicate-journals).
    for (const f of ic.duplicate) for (const id of f.reverseIds) {
      const e = await prisma.journalEntry.findUnique({ where: { id }, include: { lines: true } });
      await prisma.journalEntry.create({ data: {
        sourceType: 'dup_reversal', sourceId: e.id, date: e.date, reversalOf: e.id, description: 'reverse full-amount adj',
        lines: { create: e.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: BigInt(Math.round(num(l.credit))), credit: BigInt(Math.round(num(l.debit))), fleetId: l.fleetId || '' })) },
      } });
    }
    await acc.postReceivablesReclass(c.id, actor, prisma);

    expect(await acc.receivablesBalance()).toBe(612000);
    expect((await acc.integrityCheck({})).duplicateCount).toBe(0);
    expect(await gap()).toBe(0);
    expect((await acc.trialBalance()).balanced).toBe(true);
  });

  it('the detector flags ONLY the full-amount-on-bon defect, not lunas / zero-AR baseline-less adjustments', async () => {
    // (a) REAL defect: a bon + a no-baseline adj that re-posted the FULL amount to AR.
    const cbon = await mkCust(612000);
    const tbon = await dist.createTransaction({ customerId: cbon.id, method: 'bon', qty: 1, txnDate: '2026-08-15' }, actor);
    const bonJ = await prisma.journalEntry.findFirst({ where: { sourceType: 'dist_txn', sourceId: tbon.id }, include: { lines: true } });
    await prisma.journalEntry.create({ data: { sourceType: 'dist_txn_adj', sourceId: `${tbon.id}:bad`, ref: tbon.id, date: bonJ.date, reversalOf: null, description: 'defect',
      lines: { create: bonJ.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: BigInt(Math.round(num(l.debit))), credit: BigInt(Math.round(num(l.credit))), fleetId: l.fleetId || '' })) } } });

    // (b) FALSE POSITIVE — lunas parent: a no-baseline adj that touches NO receivable (Kas/Pendapatan).
    const clun = await mkCust(300000);
    const tlun = await dist.createTransaction({ customerId: clun.id, method: 'lunas', qty: 1, txnDate: '2026-08-15' }, actor);
    const lunJ = await prisma.journalEntry.findFirst({ where: { sourceType: 'dist_txn', sourceId: tlun.id }, include: { lines: true } });
    await prisma.journalEntry.create({ data: { sourceType: 'dist_txn_adj', sourceId: `${tlun.id}:info`, ref: tlun.id, date: '2026-08-15', reversalOf: null, description: 'lunas info',
      lines: { create: lunJ.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: BigInt(Math.round(num(l.debit))), credit: BigInt(Math.round(num(l.credit))), fleetId: l.fleetId || '' })) } } });

    // (c) FALSE POSITIVE — bon parent but ZERO AR effect (copy the lunas Kas/Pendapatan pair, no AR line).
    const cbon2 = await mkCust(500000);
    const tbon2 = await dist.createTransaction({ customerId: cbon2.id, method: 'bon', qty: 1, txnDate: '2026-08-15' }, actor);
    await prisma.journalEntry.create({ data: { sourceType: 'dist_txn_adj', sourceId: `${tbon2.id}:info`, ref: tbon2.id, date: '2026-08-15', reversalOf: null, description: 'zero-AR info',
      lines: { create: lunJ.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: BigInt(Math.round(num(l.debit))), credit: BigInt(Math.round(num(l.credit))), fleetId: l.fleetId || '' })) } } });

    const ic = await acc.integrityCheck({});
    expect(ic.duplicateCount).toBe(1);                       // only the real overstatement fails the invariant
    expect(ic.duplicate[0].type).toBe('full_amount_adj');
    expect(ic.duplicate[0].ref).toBe(tbon.id);
    expect(ic.baselinelessAdjustments).toBe(2);              // the two harmless ones — counted, not failing
  });
});
