'use strict';
/*
 * READ-ONLY — per-customer reconcile of journal AR (1-1200) vs Sisa Bon. Writes NOTHING, safe on a
 * production copy.
 *
 *   cd server && DATABASE_URL="file:./prod-copy.db" node scripts/reconcile-ar-by-customer.js
 *   cd server && DATABASE_URL="file:./prod-copy.db" node scripts/reconcile-ar-by-customer.js --customer <id>
 *
 * Default: every customer whose journal AR != Σ Sisa Bon, and — for each — EVERY 1-1200 line grouped by
 * source, NOT just the bon/pelunasan rows. A non-dist_txn source (reclass, bon adjustment, correction,
 * opening balance, manual) is flagged, because that is exactly where a gap hides when the transaction
 * list looks balanced.
 *
 * --customer <id>: the deep dive — lists EVERY 1-1200 JournalLine for one customer (journalEntryId,
 * date, sourceType, sourceId, debit, credit, description, postedAt, reversalOf), sums debit/credit, and
 * joins each line to its source (transaction nominal vs journal), flagging mismatches and every AR line
 * whose source is NOT a dist_txn.
 */
const guard = require('./_db-guard');
const prisma = require('../src/lib/prisma');
const acc = require('../src/services/accounting.service');

const rupiah = (v) => (v < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(v)).toLocaleString('id-ID');
const num = (b) => Number(b || 0);
const stamp = (d) => (d && d.toISOString ? d.toISOString().replace('T', ' ').slice(0, 19) : String(d));
const argCustomer = () => { const i = process.argv.indexOf('--customer'); return i >= 0 ? process.argv[i + 1] : null; };

// EVERY 1-1200 line attributed to one customer — across ALL source types, not just dist_txn. Each line
// carries its entry metadata + the source row it came from (txn / adjustment) for a nominal comparison.
async function customerARLines(cid, arId) {
  const txns = await prisma.distTransaction.findMany({ where: { customerId: cid }, select: { id: true, amount: true, method: true, txnDate: true, bonCounted: true, status: true, legacy: true, openingBon: true } });
  const txnById = Object.fromEntries(txns.map((t) => [t.id, t]));
  const adjs = await prisma.distAdjustment.findMany({ where: { customerId: cid }, select: { id: true, delta: true, kind: true, status: true } });
  const adjById = Object.fromEntries(adjs.map((a) => [a.id, a]));
  const txnIds = txns.map((t) => t.id);
  const adjIds = adjs.map((a) => a.id);
  const entries = await prisma.journalEntry.findMany({
    where: { OR: [
      { sourceType: 'dist_txn', sourceId: { in: txnIds } },
      { sourceType: 'dist_txn_adj', ref: { in: txnIds } },
      { sourceType: 'dist_adjustment', sourceId: { in: adjIds } },
      { sourceType: 'ar_reclass', sourceId: cid },
    ] },
    include: { lines: { where: { chartAccountId: arId } } },
    orderBy: { postedAt: 'asc' },
  });
  const out = [];
  for (const e of entries) {
    for (const l of e.lines) {
      const txn = txnById[e.sourceType === 'dist_txn' ? e.sourceId : e.sourceType === 'dist_txn_adj' ? e.ref : null];
      out.push({ jeId: e.id, date: e.date, sourceType: e.sourceType, sourceId: e.sourceId, ref: e.ref, description: e.description, postedAt: e.postedAt, reversalOf: e.reversalOf, debit: num(l.debit), credit: num(l.credit), txn, adj: adjById[e.sourceId] });
    }
  }
  return out;
}

// Deep dive for ONE customer (points 1 + 2).
async function deepDive(cid, arId) {
  const c = await prisma.customer.findUnique({ where: { id: cid }, select: { name: true } });
  const lines = await customerARLines(cid, arId);
  const sisa = Math.max(0, await acc.customerBonRaw(cid));
  console.log(`CUSTOMER ${c ? c.name : '(unknown)'} [${cid}]\n`);

  // (1) EVERY line, flat, no grouping.
  console.log('  ── every 1-1200 line (flat) ─────────────────────────────────────────────');
  console.log('     date       sourceType     debit          credit         reversalOf  sourceId / description');
  let sumD = 0, sumC = 0;
  for (const l of lines) {
    sumD += l.debit; sumC += l.credit;
    console.log(`     ${l.date}  ${l.sourceType.padEnd(13)} ${rupiah(l.debit).padStart(13)}  ${rupiah(l.credit).padStart(13)}  ${(l.reversalOf ? 'yes' : '—').padEnd(9)}  ${l.sourceId || ''}${l.description ? '  · ' + l.description : ''}`);
  }
  console.log(`     ${''.padEnd(13)}${''.padEnd(2)}Σ debit ${rupiah(sumD).padStart(13)}  Σ credit ${rupiah(sumC).padStart(12)}   net ${rupiah(sumD - sumC)}`);
  console.log(`     journal AR (net) = ${rupiah(sumD - sumC)}   ·   Sisa Bon = ${rupiah(sisa)}   ·   gap = ${rupiah(sumD - sumC - sisa)}\n`);

  // (2) Source join + flags: non-dist_txn, and dist_txn where nominal != journal net.
  console.log('  ── source join · flags (what Sisa Bon does NOT count) ───────────────────');
  let flagged = 0;
  for (const l of lines) {
    const netAR = l.debit - l.credit;
    let note = '';
    if (l.sourceType !== 'dist_txn') { note = `← NON-dist_txn (${l.sourceType}) — verify Sisa Bon accounts for it`; flagged++; }
    else if (l.txn) {
      const counts = l.txn.status !== 'void' && l.txn.bonCounted;
      if (!counts) { note = `← dist_txn NOT counted in Sisa Bon (bonCounted=${l.txn.bonCounted} status=${l.txn.status}) but posts AR`; flagged++; }
      else if (Math.round(num(l.txn.amount)) !== Math.round(netAR) && l.txn.method === 'bon') note = `nominal ${rupiah(num(l.txn.amount))} vs journal ${rupiah(netAR)} (corrections/disputes?)`;
    }
    if (note) console.log(`     ${l.date}  ${l.sourceType.padEnd(13)} AR ${rupiah(netAR).padStart(13)}  ${l.sourceId || ''}  ${note}`);
  }
  console.log(`\n  ${flagged} AR line(s) flagged as NOT reflected in Sisa Bon — these account for the gap of ${rupiah(sumD - sumC - sisa)}.\n`);
}

// Condensed per-customer dump for the all-customer run — ALL sources, grouped by sourceType.
async function dumpAllSources(cid, name, arId, diff) {
  const lines = await customerARLines(cid, arId);
  const byType = {};
  for (const l of lines) { const k = l.sourceType; (byType[k] || (byType[k] = { d: 0, c: 0, n: 0 })); byType[k].d += l.debit; byType[k].c += l.credit; byType[k].n++; }
  console.log(`  ── ${name} [${cid}]  gap ${rupiah(diff)} ─────────────────────────────`);
  for (const [t, v] of Object.entries(byType)) {
    const netT = v.d - v.c;
    const flag = t !== 'dist_txn' ? '   ← NON-dist_txn source (not in the bon list)' : '';
    console.log(`     ${t.padEnd(14)} ${v.n} line(s)   net AR ${rupiah(netT).padStart(14)}${flag}`);
  }
  console.log('');
}

async function run() {
  guard.printBanner('READ-ONLY (writes nothing)');
  const cm = await acc.chartMap();
  const arId = cm['1-1200'];
  if (!arId) { console.error('No 1-1200 (Piutang Usaha) account in the chart.'); return; }

  const only = argCustomer();
  if (only) { await deepDive(only, arId); return; }

  // ── all-customer summary (unchanged attribution: every source type counts) ──
  const lines = await prisma.journalLine.findMany({ where: { chartAccountId: arId }, include: { journalEntry: { select: { sourceType: true, sourceId: true, ref: true } } } });
  const txnIds = new Set(), adjIds = new Set();
  for (const l of lines) { const e = l.journalEntry; if (e.sourceType === 'dist_txn') txnIds.add(e.sourceId); else if (e.sourceType === 'dist_txn_adj') txnIds.add(e.ref); else if (e.sourceType === 'dist_adjustment') adjIds.add(e.sourceId); }
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

  const custIds = new Set(Object.keys(journalAR));
  (await prisma.distTransaction.findMany({ where: { method: { in: ['bon', 'pelunasan'] }, status: { not: 'void' }, bonCounted: true }, select: { customerId: true }, distinct: ['customerId'] })).forEach((r) => custIds.add(r.customerId));
  const names = Object.fromEntries((await prisma.customer.findMany({ where: { id: { in: [...custIds] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));

  const rowsOut = [];
  for (const cid of custIds) {
    const jar = journalAR[cid] || 0;
    const sisa = Math.max(0, await acc.customerBonRaw(cid));
    const diff = jar - sisa;
    if (Math.round(diff) !== 0) rowsOut.push({ cid, name: names[cid] || '(unknown)', jar, sisa, diff });
  }
  rowsOut.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log(`PER-CUSTOMER AR RECONCILE  ·  ${rowsOut.length} customer(s) differ\n`);
  let total = 0;
  for (const r of rowsOut) { total += r.diff; console.log(`  ${rupiah(r.diff).padStart(14)}   journalAR ${rupiah(r.jar).padStart(14)}   sisaBon ${rupiah(r.sisa).padStart(14)}   ${r.name} [${r.cid}]`); }
  if (Math.round(unattributed) !== 0) console.log(`\n  ⚠  AR journal lines with NO resolvable customer: ${rupiah(unattributed)}`);
  console.log(`\n  Σ difference = ${rupiah(total + unattributed)}\n`);

  // ALL AR sources per differing customer (the fix: no longer dist_txn-only).
  for (const r of rowsOut) await dumpAllSources(r.cid, r.name, arId, r.diff);
  console.log(`  For a full line-by-line breakdown of one customer:  node scripts/reconcile-ar-by-customer.js --customer <id>\n`);
}

if (require.main === module) run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('RECONCILE FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
module.exports = { run };
