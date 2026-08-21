'use strict';
/*
 * ONE-TIME REMEDIATION — reverse stale Piutang left by bons that were archived to bonCounted=false
 * BEFORE setTransactionArchive learned to reconcile the ledger. With distTxnLines now honouring
 * bonCounted, reconcileDistTxn on each such row yields desired=[] and posts the reversing entry, then
 * the customer is re-reclassed. Idempotent: a row already reconciled produces no delta.
 *
 *   cd server && DATABASE_URL="file:./prod-copy.db" node scripts/reconcile-stale-ar.js            # DRY RUN (writes nothing)
 *   cd server && DATABASE_URL="file:./prod.db"      node scripts/reconcile-stale-ar.js --apply --confirm-production
 *
 * Dry run is the default and writes NOTHING; --apply performs the reversals (and the _db-guard refuses
 * a production-looking DB without --confirm-production).
 */
const guard = require('./_db-guard');
const prisma = require('../src/lib/prisma');
const acc = require('../src/services/accounting.service');

const APPLY = process.argv.includes('--apply');
const rupiah = (v) => (v < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(v)).toLocaleString('id-ID');
const num = (b) => Number(b || 0);

async function run() {
  guard.printBanner(APPLY ? 'WRITE (--apply)' : 'DRY RUN (writes nothing)');
  if (APPLY) guard.assertWriteAllowed();

  const cm = await acc.chartMap();
  const arId = cm['1-1200'];
  if (!arId) { console.error('No 1-1200 account in the chart.'); return; }

  // Candidates: bon/pelunasan rows that no longer count toward Sisa Bon (bonCounted=false OR void) yet
  // still carry a dist_txn journal — the exact fingerprint of a stale Piutang.
  const rows = await prisma.distTransaction.findMany({
    where: { method: { in: ['bon', 'pelunasan'] }, OR: [{ bonCounted: false }, { status: 'void' }] },
    select: { id: true, customerId: true, method: true, amount: true, txnDate: true, legacy: true, bonCounted: true, status: true },
    orderBy: { txnDate: 'asc' },
  });

  // Net Piutang currently posted for each candidate (its dist_txn entry + any dist_txn_adj on it).
  const ids = rows.map((r) => r.id);
  const arLines = ids.length ? await prisma.journalLine.findMany({ where: { chartAccountId: arId, journalEntry: { OR: [{ sourceType: 'dist_txn', sourceId: { in: ids } }, { sourceType: 'dist_txn_adj', ref: { in: ids } }] } }, include: { journalEntry: { select: { sourceType: true, sourceId: true, ref: true } } } }) : [];
  const postedAR = {};
  for (const l of arLines) { const e = l.journalEntry; const key = e.sourceType === 'dist_txn' ? e.sourceId : e.ref; postedAR[key] = (postedAR[key] || 0) + num(l.debit) - num(l.credit); }

  const stale = rows.filter((r) => Math.round(postedAR[r.id] || 0) !== 0);
  let total = 0;
  console.log(`Stale-AR candidates: ${stale.length} row(s) with residual Piutang\n`);
  for (const r of stale) {
    const p = postedAR[r.id] || 0; total += p;
    console.log(`   ${r.txnDate} ${r.method.padEnd(9)} residual ${rupiah(p).padStart(14)}  legacy=${r.legacy} bonCounted=${r.bonCounted} status=${r.status}  id=${r.id}`);
  }
  console.log(`\n   Σ stale Piutang to reverse: ${rupiah(total)}\n`);

  if (!APPLY) { console.log('DRY RUN — re-run with --apply (and --confirm-production for a prod DB) to post the reversals.\n'); return; }

  const actor = (await prisma.user.findFirst({ where: { role: 'owner' }, select: { id: true, name: true } })) || { id: null, name: 'CLI reconcile-stale-ar' };
  const custs = new Set();
  let reversed = 0;
  for (const r of stale) {
    await prisma.$transaction(async (tx) => {
      const row = await tx.distTransaction.findUnique({ where: { id: r.id } });
      const nArch = await tx.journalEntry.count({ where: { sourceType: 'dist_txn_adj', sourceId: { startsWith: `${r.id}:arch` } } });
      const res = await acc.reconcileDistTxn(row, `arch${nArch}`, { id: actor.id, name: actor.name, role: 'owner' }, tx);
      if (res) { reversed++; custs.add(r.customerId); }
    });
  }
  for (const cid of custs) await prisma.$transaction((tx) => acc.postReceivablesReclass(cid, { id: actor.id, name: actor.name, role: 'owner' }, tx));
  console.log(`✔ Reversed ${reversed} stale entr${reversed === 1 ? 'y' : 'ies'}; re-reclassed ${custs.size} customer(s).`);
  const ar = await acc.receivablesBalance();
  const aging = (await acc.agingReceivables({})).total;
  console.log(`   AR(1-1200) ${rupiah(ar)}  vs  Σ Sisa Bon ${rupiah(aging)}  (Δ ${rupiah(ar - aging)})\n`);
}

if (require.main === module) run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('REMEDIATION FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
module.exports = { run };
