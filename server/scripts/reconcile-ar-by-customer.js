'use strict';
/*
 * READ-ONLY — per-customer reconcile of journal AR (1-1200) vs Sisa Bon. Writes NOTHING, safe on a
 * production copy. Turns "AR is Rp X over Σ Sisa Bon" into a per-customer answer + the offending rows.
 *
 *   cd server && DATABASE_URL="file:./prod-copy.db" node scripts/reconcile-ar-by-customer.js
 *
 * For each customer it computes:
 *   journalAR = Σ (debit − credit) on 1-1200 attributed to that customer (via each entry's source),
 *   sisaBon   = max(0, customerBonRaw) — exactly what the reclass makes 1-1200 target,
 *   diff      = journalAR − sisaBon.
 * Lists only non-zero rows, sorted by |diff|, with a total that must equal the finance-AR gap, then
 * dumps every bon/pelunasan row of the differing customers with the flags that decide inclusion
 * (legacy, bonCounted, status, paymentNotReceived) and whether each still carries a journal.
 */
const guard = require('./_db-guard');
const prisma = require('../src/lib/prisma');
const acc = require('../src/services/accounting.service');

const rupiah = (v) => (v < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(v)).toLocaleString('id-ID');
const num = (b) => Number(b || 0);

async function run() {
  guard.printBanner('READ-ONLY (writes nothing)');
  const cm = await acc.chartMap();
  const arId = cm['1-1200'];
  if (!arId) { console.error('No 1-1200 (Piutang Usaha) account in the chart.'); return; }

  // 1. Every AR journal line + the source of its entry (to attribute it to a customer).
  const lines = await prisma.journalLine.findMany({ where: { chartAccountId: arId }, include: { journalEntry: { select: { sourceType: true, sourceId: true, ref: true } } } });

  // 2. Resolve dist_txn / dist_txn_adj → txn.customerId, dist_adjustment → adj.customerId (ar_reclass carries the customerId directly).
  const txnIds = new Set(), adjIds = new Set();
  for (const l of lines) {
    const e = l.journalEntry;
    if (e.sourceType === 'dist_txn') txnIds.add(e.sourceId);
    else if (e.sourceType === 'dist_txn_adj') txnIds.add(e.ref);
    else if (e.sourceType === 'dist_adjustment') adjIds.add(e.sourceId);
  }
  const txnCust = Object.fromEntries((await prisma.distTransaction.findMany({ where: { id: { in: [...txnIds] } }, select: { id: true, customerId: true } })).map((t) => [t.id, t.customerId]));
  const adjCust = Object.fromEntries((await prisma.distAdjustment.findMany({ where: { id: { in: [...adjIds] } }, select: { id: true, customerId: true } })).map((a) => [a.id, a.customerId]));

  const journalAR = {};
  let unattributed = 0;
  for (const l of lines) {
    const e = l.journalEntry; const net = num(l.debit) - num(l.credit);
    let cid = null;
    if (e.sourceType === 'ar_reclass') cid = e.sourceId;
    else if (e.sourceType === 'dist_txn') cid = txnCust[e.sourceId];
    else if (e.sourceType === 'dist_txn_adj') cid = txnCust[e.ref];
    else if (e.sourceType === 'dist_adjustment') cid = adjCust[e.sourceId];
    if (!cid) { unattributed += net; continue; }
    journalAR[cid] = (journalAR[cid] || 0) + net;
  }

  // 3. Sisa Bon per customer — every customer that has EITHER a journal AR balance OR a live bon.
  const custIds = new Set(Object.keys(journalAR));
  (await prisma.distTransaction.findMany({ where: { method: { in: ['bon', 'pelunasan'] }, status: { not: 'void' }, bonCounted: true }, select: { customerId: true }, distinct: ['customerId'] })).forEach((r) => custIds.add(r.customerId));
  const names = Object.fromEntries((await prisma.customer.findMany({ where: { id: { in: [...custIds] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));

  const rows = [];
  for (const cid of custIds) {
    const jar = journalAR[cid] || 0;
    const sisa = Math.max(0, await acc.customerBonRaw(cid));
    const diff = jar - sisa;
    if (Math.round(diff) !== 0) rows.push({ cid, name: names[cid] || '(unknown)', jar, sisa, diff });
  }
  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // ── summary ──
  console.log(`PER-CUSTOMER AR RECONCILE  ·  ${rows.length} customer(s) differ\n`);
  let total = 0;
  for (const r of rows) { total += r.diff; console.log(`  ${rupiah(r.diff).padStart(14)}   journalAR ${rupiah(r.jar).padStart(14)}   sisaBon ${rupiah(r.sisa).padStart(14)}   ${r.name} [${r.cid}]`); }
  if (Math.round(unattributed) !== 0) console.log(`\n  ⚠  AR journal lines with NO resolvable customer: ${rupiah(unattributed)}`);
  console.log(`\n  Σ difference = ${rupiah(total + unattributed)}   (must equal journal-AR minus Σ Sisa Bon)\n`);

  // ── row-level evidence for each differing customer ──
  for (const r of rows) {
    const txs = await prisma.distTransaction.findMany({ where: { customerId: r.cid, method: { in: ['bon', 'pelunasan'] } }, orderBy: { txnDate: 'asc' } });
    const hasJ = new Set((await prisma.journalEntry.findMany({ where: { sourceType: 'dist_txn', sourceId: { in: txs.map((t) => t.id) } }, select: { sourceId: true } })).map((j) => j.sourceId));
    console.log(`  ── ${r.name} [${r.cid}]  diff ${rupiah(r.diff)} ─────────────────────────────`);
    for (const t of txs) {
      const counts = t.status !== 'void' && t.bonCounted;   // whether Sisa Bon counts this row
      console.log(`     ${t.txnDate} ${t.method.padEnd(9)} ${rupiah(num(t.amount)).padStart(12)}  legacy=${t.legacy} bonCounted=${t.bonCounted} status=${t.status} PNR=${t.paymentNotReceived}` +
        `  hasJournal=${hasJ.has(t.id)}  ${hasJ.has(t.id) && !counts ? '← STALE AR (posted but excluded from Sisa Bon)' : (!hasJ.has(t.id) && counts ? '← counted but NO journal' : '')}`);
    }
    const adjR = await prisma.distAdjustment.findMany({ where: { customerId: r.cid, kind: 'bon' }, select: { delta: true, status: true } });
    if (adjR.length) console.log(`     adjustments(bon): ` + adjR.map((a) => `${a.status}:${rupiah(num(a.delta))}`).join(', '));
    console.log('');
  }
}

if (require.main === module) run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('RECONCILE FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
module.exports = { run };
