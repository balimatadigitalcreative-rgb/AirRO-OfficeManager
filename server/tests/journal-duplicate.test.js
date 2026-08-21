'use strict';
// REGRESSION — journal idempotency + DUPLICATE detection.
//  • postJournal posts a given (sourceType, sourceId) at most once (second call is a no-op).
//  • integrityCheck flags a duplicate the missing/orphan checks cannot see (existence vs cardinality).
//  • reversing the extra (dup_reversal) clears the duplicate AND restores AR == Σ Sisa Bon.
// The duplicate is created by DROPPING the unique index first — reproducing the production condition
// where idempotency was never enforced at the DB level. The index is restored at the end so the rest of
// the suite is unaffected.
process.env.ACCOUNTING_V2 = 'true';
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const dist = require('../src/services/distribution.service');

const rnd = () => Math.random().toString(36).slice(2, 8);
const num = (b) => Number(b || 0);
let actor;

beforeEach(async () => {
  await resetDb();
  await acc.seedChart();
  const u = await prisma.user.create({ data: { name: 'O', username: 'dup_' + rnd(), passwordHash: 'x', role: 'owner' } });
  actor = { id: u.id, role: 'owner', name: 'O' };
});
afterAll(() => prisma.$disconnect());

describe('journal idempotency + duplicate detection', () => {
  it('posting the same source twice creates exactly ONE journal', async () => {
    const lines = [{ code: '1-1000', debit: 1000 }, { code: '4-1000', credit: 1000 }];
    const a = await acc.postJournal({ sourceType: 'manual', sourceId: 'DUP-S1', date: '2026-05-01', description: 'x', actor, lines });
    const b = await acc.postJournal({ sourceType: 'manual', sourceId: 'DUP-S1', date: '2026-05-01', description: 'x', actor, lines });
    expect(a).toBeTruthy();
    expect(b).toBeNull();
    expect(await prisma.journalEntry.count({ where: { sourceType: 'manual', sourceId: 'DUP-S1' } })).toBe(1);
  });

  it('integrityCheck flags a duplicate; reversing it clears the flag and reconciles AR', async () => {
    const c = await prisma.customer.create({ data: { name: 'Dup Cust', code: 'D' + rnd(), armada: 'Merah', masterPrice: 200000, active: true } });
    const t = await dist.createTransaction({ customerId: c.id, method: 'bon', qty: 1, txnDate: '2026-05-10' }, actor);
    expect(await acc.receivablesBalance()).toBe(200000);
    expect((await acc.integrityCheck({})).duplicateCount).toBe(0);

    // Reproduce the PROD condition: no unique index → a re-post slips through as a duplicate of the exact
    // original entry (same sourceType/sourceId, same lines).
    await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "JournalEntry_sourceType_sourceId_key"');
    const orig = await prisma.journalEntry.findFirst({ where: { sourceType: 'dist_txn', sourceId: t.id }, include: { lines: true } });
    await prisma.journalEntry.create({ data: {
      sourceType: 'dist_txn', sourceId: t.id, date: orig.date, description: 'DUPLICATE',
      lines: { create: orig.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: BigInt(Math.round(num(l.debit))), credit: BigInt(Math.round(num(l.credit))), fleetId: l.fleetId || '' })) },
    } });

    expect(await acc.receivablesBalance()).toBe(400000);   // AR inflated by the duplicate
    let ic = await acc.integrityCheck({});
    expect(ic.missingCount).toBe(0);
    expect(ic.orphanCount).toBe(0);
    expect(ic.duplicateCount).toBe(1);                     // caught by CARDINALITY where existence could not
    expect(ic.duplicate[0].sourceType).toBe('dist_txn');

    // Reverse the extra (mirror reverse-duplicate-journals): swapped lines + reversalOf.
    const rows = await prisma.journalEntry.findMany({ where: { sourceType: 'dist_txn', sourceId: t.id }, include: { lines: true }, orderBy: { postedAt: 'asc' } });
    const extra = rows[1];
    await prisma.journalEntry.create({ data: {
      sourceType: 'dup_reversal', sourceId: extra.id, date: extra.date, reversalOf: extra.id, description: 'reverse dup',
      lines: { create: extra.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: BigInt(Math.round(num(l.credit))), credit: BigInt(Math.round(num(l.debit))), fleetId: l.fleetId || '' })) },
    } });

    expect(await acc.receivablesBalance()).toBe(200000);   // AR restored
    ic = await acc.integrityCheck({});
    expect(ic.duplicateCount).toBe(0);                     // reversed extra no longer counts
    expect(await acc.receivablesBalance()).toBe((await acc.agingReceivables({})).total);   // AR == Σ Sisa Bon
    expect((await acc.trialBalance()).balanced).toBe(true);

    // Restore the unique index for the rest of the suite (dups gone once we clear journals in reset).
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "JournalEntry_sourceType_sourceId_key" ON "JournalEntry"("sourceType", "sourceId")');
  });
});
