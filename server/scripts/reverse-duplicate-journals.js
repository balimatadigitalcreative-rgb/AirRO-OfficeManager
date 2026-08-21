'use strict';
/*
 * REMEDIATION (WRITE) — neutralise DUPLICATE journals by REVERSING the extras (never hard-deletes a
 * source row, never deletes a journal). For each (sourceType, sourceId) with >1 live entry it keeps the
 * EARLIEST and posts, for every other, a 'dup_reversal' entry with swapped debit/credit and
 * reversalOf=<extra id> — so the extra's effect is cancelled and integrityCheck (which ignores reversed
 * extras) reads 0 duplicate, with the full audit trail intact. Then re-reclasses affected customers.
 *
 *   cd server && DATABASE_URL="file:./prod-copy.db" node scripts/reverse-duplicate-journals.js            # DRY RUN
 *   cd server && DATABASE_URL="file:./prod.db"      node scripts/reverse-duplicate-journals.js --apply --confirm-production
 */
const guard = require('./_db-guard');
const prisma = require('../src/lib/prisma');
const acc = require('../src/services/accounting.service');

const APPLY = process.argv.includes('--apply');
const rupiah = (v) => (v < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(v)).toLocaleString('id-ID');
const num = (b) => Number(b || 0);
const stamp = (d) => (d && d.toISOString ? d.toISOString().replace('T', ' ').slice(0, 19) : String(d));

// Resolve the customer a duplicated source belongs to (for the AR reclass) — only the AR-bearing types.
async function customerOf(sourceType, sourceId, ref) {
  if (sourceType === 'ar_reclass') return sourceId;
  if (sourceType === 'dist_txn') { const t = await prisma.distTransaction.findUnique({ where: { id: sourceId }, select: { customerId: true } }); return t && t.customerId; }
  if (sourceType === 'dist_txn_adj') { const t = ref && await prisma.distTransaction.findUnique({ where: { id: ref }, select: { customerId: true } }); return t && t.customerId; }
  if (sourceType === 'dist_adjustment') { const a = await prisma.distAdjustment.findUnique({ where: { id: sourceId }, select: { customerId: true } }); return a && a.customerId; }
  return null;
}

async function run() {
  guard.printBanner(APPLY ? 'WRITE (--apply)' : 'DRY RUN (writes nothing)');
  if (APPLY) guard.assertWriteAllowed();

  const arId = (await acc.chartMap())['1-1200'];
  const groups = await prisma.journalEntry.groupBy({ by: ['sourceType', 'sourceId'], where: { sourceId: { not: null } }, _count: { _all: true } });
  const dupGroups = groups.filter((g) => (g._count._all || 0) > 1);
  const reversed = new Set((await prisma.journalEntry.findMany({ where: { sourceType: 'dup_reversal', reversalOf: { not: null } }, select: { reversalOf: true } })).map((r) => r.reversalOf));

  const plan = [];   // { extra entry (with lines), sourceType, sourceId, ref }
  for (const g of dupGroups) {
    const rows = await prisma.journalEntry.findMany({ where: { sourceType: g.sourceType, sourceId: g.sourceId }, include: { lines: true }, orderBy: { postedAt: 'asc' } });
    const live = rows.filter((r) => !reversed.has(r.id));
    for (const extra of live.slice(1)) plan.push({ extra, sourceType: g.sourceType, sourceId: g.sourceId, ref: extra.ref });   // keep live[0], reverse the rest
  }

  console.log(`Duplicate sources: ${dupGroups.length}  ·  extra entries to reverse: ${plan.length}\n`);
  let arExcess = 0;
  for (const p of plan) {
    const arDelta = p.extra.lines.filter((l) => l.chartAccountId === arId).reduce((a, l) => a + num(l.debit) - num(l.credit), 0);   // AR impact of the extra
    arExcess += arDelta;
    console.log(`   ${p.sourceType}:${p.sourceId}  extra id=${p.extra.id}  postedAt=${stamp(p.extra.postedAt)}  AR impact=${rupiah(arDelta)}`);
  }
  console.log(`\n   Σ AR to be removed: ${rupiah(arExcess)}`);
  if (!plan.length) { console.log('\nNothing to do.\n'); return; }
  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply (and --confirm-production for a prod DB) to post the reversals.\n'); return; }

  const actor = (await prisma.user.findFirst({ where: { role: 'owner' }, select: { id: true, name: true } })) || { id: null, name: 'CLI reverse-duplicate-journals' };
  const custs = new Set();
  let done = 0;
  for (const p of plan) {
    await prisma.journalEntry.create({ data: {
      sourceType: 'dup_reversal', sourceId: p.extra.id, date: p.extra.date, ref: p.sourceId, reversalOf: p.extra.id,
      description: `Pembalik jurnal ganda (${p.sourceType}:${p.sourceId})`.slice(0, 500), postedById: actor.id || null, postedByName: actor.name || null,
      lines: { create: p.extra.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: BigInt(Math.round(num(l.credit))), credit: BigInt(Math.round(num(l.debit))), businessUnitId: l.businessUnitId || null, fleetId: l.fleetId || '' })) },   // swapped
    } });
    done++;
    const cid = await customerOf(p.sourceType, p.sourceId, p.ref);
    if (cid) custs.add(cid);
  }
  for (const cid of custs) await prisma.$transaction((tx) => acc.postReceivablesReclass(cid, { id: actor.id, name: actor.name, role: 'owner' }, tx));

  const ic = await acc.integrityCheck({});
  const ar = await acc.receivablesBalance();
  const aging = (await acc.agingReceivables({})).total;
  console.log(`\n✔ Reversed ${done} duplicate entr${done === 1 ? 'y' : 'ies'}; re-reclassed ${custs.size} customer(s).`);
  console.log(`   integrity: ${ic.missingCount} missing, ${ic.orphanCount} orphan, ${ic.duplicateCount} duplicate`);
  console.log(`   AR(1-1200) ${rupiah(ar)}  vs  Σ Sisa Bon ${rupiah(aging)}  (Δ ${rupiah(ar - aging)})\n`);
}

if (require.main === module) run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('REVERSAL FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
module.exports = { run };
