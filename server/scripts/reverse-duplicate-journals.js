'use strict';
/*
 * REMEDIATION (WRITE) — neutralise DUPLICATE journals by REVERSING the extras (never hard-deletes a
 * source row, never deletes a journal). Drives off integrityCheck().duplicate, covering BOTH classes:
 *   • cardinality     — same (sourceType, sourceId) posted twice: keep the earliest, reverse the rest.
 *   • full_amount_adj — a dist_txn_adj with no baseline (reversalOf=null) that posted the FULL parent
 *                       amount instead of a delta: reverse the whole entry.
 * Each reversal is a 'dup_reversal' with swapped debit/credit + reversalOf=<extra id>, so the extra is
 * cancelled and integrityCheck (which ignores reversed extras) reads 0 duplicate, audit trail intact.
 * Then re-reclasses affected customers.
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
  // Drive off the SAME detector the invariant uses, so both classes are covered and stay in sync:
  //   • cardinality        — same (sourceType, sourceId) posted twice (keep earliest, reverse the rest)
  //   • full_amount_adj    — a dist_txn_adj with no baseline that carries the full parent amount
  // Each finding carries reverseIds: exactly the entries to neutralise.
  const findings = (await acc.integrityCheck({})).duplicate || [];
  const targets = [];
  for (const f of findings) for (const id of (f.reverseIds || [])) targets.push({ id, type: f.type });
  const entries = Object.fromEntries((await prisma.journalEntry.findMany({ where: { id: { in: targets.map((t) => t.id) } }, include: { lines: true } })).map((e) => [e.id, e]));

  const nCard = findings.filter((f) => f.type === 'cardinality').length;
  const nAdj = findings.filter((f) => f.type === 'full_amount_adj').length;
  console.log(`Duplicate findings: ${findings.length} (${nCard} cardinality, ${nAdj} full-amount-adj)  ·  entries to reverse: ${targets.length}\n`);
  let arExcess = 0;
  for (const t of targets) {
    const e = entries[t.id]; if (!e) continue;
    const arDelta = e.lines.filter((l) => l.chartAccountId === arId).reduce((a, l) => a + num(l.debit) - num(l.credit), 0);
    arExcess += arDelta;
    console.log(`   [${t.type}] ${e.sourceType}:${e.sourceId}  id=${e.id}  postedAt=${stamp(e.postedAt)}  AR impact=${rupiah(arDelta)}`);
  }
  console.log(`\n   Σ AR to be removed: ${rupiah(arExcess)}`);
  if (!targets.length) { console.log('\nNothing to do.\n'); return; }
  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply (and --confirm-production for a prod DB) to post the reversals.\n'); return; }

  const actor = (await prisma.user.findFirst({ where: { role: 'owner' }, select: { id: true, name: true } })) || { id: null, name: 'CLI reverse-duplicate-journals' };
  const custs = new Set();
  let done = 0;
  for (const t of targets) {
    const e = entries[t.id]; if (!e) continue;
    await prisma.journalEntry.create({ data: {
      sourceType: 'dup_reversal', sourceId: e.id, date: e.date, ref: e.sourceId, reversalOf: e.id,
      description: `Pembalik jurnal ganda (${t.type} · ${e.sourceType}:${e.sourceId})`.slice(0, 500), postedById: actor.id || null, postedByName: actor.name || null,
      lines: { create: e.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: BigInt(Math.round(num(l.credit))), credit: BigInt(Math.round(num(l.debit))), businessUnitId: l.businessUnitId || null, fleetId: l.fleetId || '' })) },   // swapped
    } });
    done++;
    const cid = await customerOf(e.sourceType, e.sourceId, e.ref);
    if (cid) custs.add(cid);
  }
  for (const cid of custs) await prisma.$transaction((tx) => acc.postReceivablesReclass(cid, { id: actor.id, name: actor.name, role: 'owner' }, tx));

  const ic2 = await acc.integrityCheck({});
  const ar = await acc.receivablesBalance();
  const aging = (await acc.agingReceivables({})).total;
  console.log(`\n✔ Reversed ${done} entr${done === 1 ? 'y' : 'ies'}; re-reclassed ${custs.size} customer(s).`);
  console.log(`   integrity: ${ic2.missingCount} missing, ${ic2.orphanCount} orphan, ${ic2.duplicateCount} duplicate`);
  console.log(`   AR(1-1200) ${rupiah(ar)}  vs  Σ Sisa Bon ${rupiah(aging)}  (Δ ${rupiah(ar - aging)})\n`);
}

if (require.main === module) run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('REVERSAL FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
module.exports = { run };
