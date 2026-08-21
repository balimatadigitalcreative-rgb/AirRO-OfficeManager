'use strict';
/*
 * READ-ONLY — list DUPLICATE journals (a source posted more than once). Writes NOTHING.
 *
 *   cd server && DATABASE_URL="file:./prod-copy.db" node scripts/list-duplicate-journals.js
 *   cd server && DATABASE_URL="file:./prod-copy.db" node scripts/list-duplicate-journals.js --customer <customerId>
 *
 * Default (DB-WIDE): every (sourceType, sourceId) carrying >1 JournalEntry — the cardinality violation
 * the missing/orphan checks never see — with each entry's id, date, postedAt and reversalOf, and the
 * net 1-1200 (AR) each posts, so the double-counted amount is explicit.
 *
 * --customer <id> (CONFIRM one customer): every AR journal touching that customer's bon/pelunasan rows,
 * grouped by the underlying transaction, with the entries side by side (postedAt distinguishes a
 * re-post from a correction from the legacy-import posting fix). Flags any transaction with >1
 * non-reversing AR posting.
 */
const guard = require('./_db-guard');
const prisma = require('../src/lib/prisma');
const acc = require('../src/services/accounting.service');

const rupiah = (v) => (v < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(v)).toLocaleString('id-ID');
const num = (b) => Number(b || 0);
const stamp = (d) => (d && d.toISOString ? d.toISOString().replace('T', ' ').slice(0, 19) : String(d));

// Net 1-1200 (debit − credit) posted by a set of journal-entry ids.
async function arByEntry(arId, entryIds) {
  if (!entryIds.length) return {};
  const ls = await prisma.journalLine.findMany({ where: { chartAccountId: arId, journalEntryId: { in: entryIds } }, select: { journalEntryId: true, debit: true, credit: true } });
  const m = {}; for (const l of ls) m[l.journalEntryId] = (m[l.journalEntryId] || 0) + num(l.debit) - num(l.credit);
  return m;
}

async function run() {
  guard.printBanner('READ-ONLY (writes nothing)');
  const cm = await acc.chartMap();
  const arId = cm['1-1200'];
  const custArg = (() => { const i = process.argv.indexOf('--customer'); return i >= 0 ? process.argv[i + 1] : null; })();

  if (custArg) {
    const c = await prisma.customer.findUnique({ where: { id: custArg }, select: { name: true } });
    const txs = await prisma.distTransaction.findMany({ where: { customerId: custArg, method: { in: ['bon', 'pelunasan'] } }, select: { id: true, method: true, amount: true, txnDate: true, legacy: true, bonCounted: true, status: true }, orderBy: { txnDate: 'asc' } });
    const ids = txs.map((t) => t.id);
    const entries = await prisma.journalEntry.findMany({ where: { OR: [{ sourceType: 'dist_txn', sourceId: { in: ids } }, { sourceType: 'dist_txn_adj', ref: { in: ids } }] }, select: { id: true, sourceType: true, sourceId: true, ref: true, date: true, postedAt: true, reversalOf: true } });
    const arMap = await arByEntry(arId, entries.map((e) => e.id));
    const byTxn = {}; for (const e of entries) { const k = e.sourceType === 'dist_txn' ? e.sourceId : e.ref; (byTxn[k] || (byTxn[k] = [])).push(e); }
    console.log(`CUSTOMER ${c ? c.name : '(unknown)'} [${custArg}]  ·  ${txs.length} bon/pelunasan row(s)\n`);
    let flagged = 0;
    for (const t of txs) {
      const es = byTxn[t.id] || [];
      const nonRev = es.filter((e) => !e.reversalOf && Math.round(arMap[e.id] || 0) !== 0);
      const dup = nonRev.length > 1;
      if (dup) flagged++;
      console.log(`  ${t.txnDate} ${t.method.padEnd(9)} ${rupiah(num(t.amount)).padStart(12)}  legacy=${t.legacy} bonCounted=${t.bonCounted} status=${t.status}${dup ? '   ← DUPLICATE: ' + nonRev.length + ' non-reversing AR postings' : ''}`);
      for (const e of es.sort((a, b) => stamp(a.postedAt).localeCompare(stamp(b.postedAt)))) {
        console.log(`        ${e.sourceType.padEnd(13)} AR ${rupiah(arMap[e.id] || 0).padStart(12)}  postedAt=${stamp(e.postedAt)}  reversalOf=${e.reversalOf || '—'}  id=${e.id}  sourceId=${e.sourceId}`);
      }
    }
    console.log(`\n  ${flagged} transaction(s) with a duplicate AR posting for this customer.\n`);
    return;
  }

  // DB-WIDE
  const groups = await prisma.journalEntry.groupBy({ by: ['sourceType', 'sourceId'], where: { sourceId: { not: null } }, _count: { _all: true } });
  const dups = groups.filter((g) => (g._count._all || 0) > 1);
  console.log(`DUPLICATE JOURNALS (DB-wide)  ·  ${dups.length} source(s) posted more than once\n`);
  let excess = 0;
  for (const g of dups) {
    const rows = await prisma.journalEntry.findMany({ where: { sourceType: g.sourceType, sourceId: g.sourceId }, select: { id: true, date: true, postedAt: true, reversalOf: true }, orderBy: { postedAt: 'asc' } });
    const arMap = await arByEntry(arId, rows.map((r) => r.id));
    // Excess = every posting BEYOND the first (the extras that should not exist).
    const extraAR = rows.slice(1).reduce((a, r) => a + (arMap[r.id] || 0), 0);
    excess += extraAR;
    console.log(`  ${g.sourceType}:${g.sourceId}  ×${g._count._all}   extra AR ${rupiah(extraAR)}`);
    for (const r of rows) console.log(`        postedAt=${stamp(r.postedAt)}  date=${r.date}  AR=${rupiah(arMap[r.id] || 0)}  reversalOf=${r.reversalOf || '—'}  id=${r.id}`);
  }
  console.log(`\n  Σ extra AR from duplicates: ${rupiah(excess)}   (the amount by which AR is overstated)\n`);

  // FULL-AMOUNT ADJUSTMENTS — dist_txn_adj with no baseline (reversalOf=null) that carry the FULL parent
  // amount instead of a delta. Cardinality misses them (their "parent:child" sourceId differs from the
  // parent's). Join each to its parent dist_txn and show adj AR vs the parent's nominal.
  const noBase = await prisma.journalEntry.findMany({ where: { sourceType: 'dist_txn_adj', reversalOf: null }, include: { lines: { where: { chartAccountId: arId } } }, orderBy: { postedAt: 'asc' } });
  const reversed = new Set((await prisma.journalEntry.findMany({ where: { sourceType: 'dup_reversal', reversalOf: { not: null } }, select: { reversalOf: true } })).map((r) => r.reversalOf));
  const live = noBase.filter((e) => !reversed.has(e.id));
  console.log(`FULL-AMOUNT ADJUSTMENTS (dist_txn_adj with no baseline)  ·  ${live.length} entr${live.length === 1 ? 'y' : 'ies'}\n`);
  const parentIds = live.map((e) => e.ref).filter(Boolean);
  const parents = Object.fromEntries((await prisma.distTransaction.findMany({ where: { id: { in: parentIds } }, select: { id: true, amount: true, method: true, customerId: true } })).map((t) => [t.id, t]));
  let adjExcess = 0;
  for (const e of live) {
    const adjAR = e.lines.reduce((a, l) => a + num(l.debit) - num(l.credit), 0);
    const p = parents[e.ref];
    const eq = p && Math.round(Math.abs(adjAR)) === Math.round(num(p.amount)) ? '  ← EQUALS parent full amount (delta expected, not full)' : '';
    adjExcess += adjAR;
    console.log(`  ${e.sourceId}  postedAt=${stamp(e.postedAt)}  adj AR ${rupiah(adjAR)}  parent ${e.ref} ${p ? rupiah(num(p.amount)) + ' (' + p.method + ')' : '(missing)'}${eq}`);
  }
  console.log(`\n  Σ AR from full-amount adjustments: ${rupiah(adjExcess)}\n`);
}

if (require.main === module) run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('LIST FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
module.exports = { run };
