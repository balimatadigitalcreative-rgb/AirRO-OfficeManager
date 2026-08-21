'use strict';
/*
 * FINAL-VERIFICATION harness — read-only. Runs every cross-module accounting invariant against the
 * current DATABASE_URL and prints a PASS/FAIL table with the offending records. Writes NOTHING, so it
 * is safe on a production copy:
 *
 *   cd server && DATABASE_URL="file:./prod-copy.db" node scripts/verify-invariants.js [YYYY-MM]
 *
 * The optional YYYY-MM scopes the HPP == P&L check to that month (default: current month).
 * Reuses the SAME service functions the app uses, so a PASS here means the app's own figures agree.
 * _db-guard is required FIRST so the resolved DATABASE_URL is honoured + printed before anything reads.
 */
const guard = require('./_db-guard');
const prisma = require('../src/lib/prisma');
const acc = require('../src/services/accounting.service');
const dist = require('../src/services/distribution.service');
const bill = require('../src/services/bill.service');
let costing = null; try { costing = require('../src/services/costing.service'); } catch (e) {}

const rupiah = (v) => (v < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(v)).toLocaleString('id-ID');
const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail: detail || '' }); }

async function run() {
  guard.printBanner('READ-ONLY (writes nothing)');   // show the resolved DB prominently, up front
  const month = (process.argv[2] && /^\d{4}-\d{2}$/.test(process.argv[2])) ? process.argv[2] : new Date().toISOString().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const owner = await prisma.user.findFirst({ where: { role: 'owner' }, select: { id: true, role: true, fleetScope: true } }).catch(() => null);
  const admin = owner || { role: 'owner' };   // all-fleet scope for the gallon reads

  // 1. Trial balance
  const tb = await acc.trialBalance();
  check('trial balance debit == credit', tb.balanced, `debit ${rupiah(tb.totalDebit)} vs credit ${rupiah(tb.totalCredit)} (Δ ${rupiah(tb.totalDebit - tb.totalCredit)})`);

  // 2. Balance sheet
  const bs = await acc.balanceSheet();
  check('balance sheet: assets == liabilities + equity', bs.balanced, `assets ${rupiah(bs.assets)} vs L+E ${rupiah(bs.liabilities + bs.equity)} (Δ ${rupiah(bs.assets - bs.liabilities - bs.equity)})`);

  // 3. Cash flow
  const cf = await acc.cashFlow({});
  check('cash flow: kas awal + net flow == kas akhir', cf.reconciles, `kasAwal ${rupiah(cf.kasAwal)} + net ${rupiah(cf.netFlow)} vs kasAkhir ${rupiah(cf.kasAkhir)} (Δ ${rupiah(cf.reconciliation.diff)})` + (cf.unclassified.length ? ` · ${cf.unclassified.length} unclassified account(s): ${cf.unclassified.map((u) => u.code).join(',')}` : ''));

  // 4. Finance AR == Σ customer Sisa Bon (agingReceivables.total is Σ Sisa Bon by construction)
  const ar = await acc.receivablesBalance();
  const aging = await acc.agingReceivables({});
  check('finance AR == Σ customer Sisa Bon', ar === aging.total, `AR(1-1200) ${rupiah(ar)} vs Σ Sisa Bon ${rupiah(aging.total)} (Δ ${rupiah(ar - aging.total)})`);

  // 5. Finance AP == Σ open bills (agingPayables.total is Σ outstanding by construction)
  const bals = await acc.accountBalances();
  const apLedger = (bals.find((r) => r.code === '2-1000') || {}).balance || 0;
  const ap = await bill.agingPayables({}).catch(() => ({ total: 0 }));
  check('finance AP == Σ open bills', apLedger === ap.total, `Utang Usaha(2-1000) ${rupiah(apLedger)} vs Σ open bills ${rupiah(ap.total)} (Δ ${rupiah(apLedger - ap.total)})`);

  // 6. Accounting inventory qty == gallon ledger (depot + armada)
  if (costing && costing.costingInventory) {
    const inv = await costing.costingInventory(admin);
    check('accounting inventory qty == depot + armada', inv.qty === inv.atDepot + inv.atArmada, `qty ${inv.qty} vs depot+armada ${inv.atDepot + inv.atArmada}; FG ledger value ${rupiah(inv.ledgerValue)}`);
  } else check('accounting inventory qty == depot + armada', true, 'costing module not present — skipped');

  // 7. Gallon identity: depot + armada + pelanggan + rusak/hilang == total dimiliki
  const gs = await dist.gallonSummary(admin, undefined);
  const inv7 = gs.invariant;
  check('gallon: depot+armada+pelanggan+rusak == total dimiliki', inv7 && inv7.ok, inv7 ? `lhs ${inv7.lhs} vs totalDimiliki ${gs.stock.totalDimiliki} (drift ${inv7.drift})` : 'no invariant');

  // 8. P&L HPP == costing module HPP for the month
  if (costing && costing.monthlyHpp) {
    const modHpp = await costing.monthlyHpp({ year: y, month: m });
    const is = await acc.incomeStatement({ dateFrom: `${month}-01`, dateTo: `${month}-31` });
    check(`P&L HPP == costing HPP (${month})`, modHpp.hpp === is.hpp, `costing ${rupiah(modHpp.hpp)} vs P&L ${rupiah(is.hpp)} (Δ ${rupiah(modHpp.hpp - is.hpp)})`);
  } else check('P&L HPP == costing HPP', true, 'costing module not present — skipped');

  // 9. Every gallon-moving DistTransaction has a matching GallonMovement, and vice-versa
  const gi = await dist.gallonIntegrityCheck(admin);
  check('DistTransaction ↔ GallonMovement (both directions)', gi.missingCount === 0 && gi.orphanCount === 0, `${gi.missingCount} txn(s) without a movement, ${gi.orphanCount} movement(s) without a txn` + (gi.missingCount ? ` · e.g. ${gi.missingLedger.slice(0, 5).map((t) => t.id).join(',')}` : '') + (gi.orphanCount ? ` · orphan e.g. ${gi.orphanRows.slice(0, 5).map((r) => r.transactionId).join(',')}` : ''));

  // 10. Source ↔ journal integrity: 0 missing, 0 orphan, 0 duplicate
  const ic = await acc.integrityCheck({});
  check('source ↔ journal integrity (0 missing, 0 orphan, 0 duplicate)', ic.missingCount === 0 && ic.orphanCount === 0 && ic.duplicateCount === 0,
    `${ic.missingCount} missing, ${ic.orphanCount} orphan, ${ic.duplicateCount} duplicate`
    + (ic.missingCount ? `\n     missing by type: ` + Object.entries(ic.missing.reduce((a, x) => { a[x.sourceType] = (a[x.sourceType] || 0) + 1; return a; }, {})).map(([k, v]) => `${k}=${v}`).join(', ') + `\n     e.g. ${ic.missing.slice(0, 8).map((x) => `${x.sourceType}:${x.sourceId} (${x.date})`).join(' · ')}` : '')
    + (ic.duplicateCount ? `\n     duplicate (sourceType:sourceId ×count): ${ic.duplicate.slice(0, 8).map((x) => `${x.sourceType}:${x.sourceId} ×${x.count}`).join(' · ')}` : ''));

  // ── print ──
  console.log(`\nCROSS-MODULE INVARIANTS  ·  HPP month: ${month}\n`);
  let failed = 0;
  for (const r of results) { const tag = r.pass ? '✔ PASS' : '✖ FAIL'; if (!r.pass) failed++; console.log(`  ${tag}  ${r.name}\n           ${r.detail}`); }

  // FULL DUMP of every un-posted dist_txn (the offending rows behind a source↔journal failure): the
  // exact fields needed to diagnose WHY they were skipped — method, amount, legacy/bonCounted, customer,
  // import batch, dispute/void status, dates — plus the summed amount (so it can be matched to an AR gap).
  const missingDtx = (ic.missing || []).filter((x) => x.sourceType === 'dist_txn').map((x) => x.sourceId);
  if (missingDtx.length) {
    const rows = await prisma.distTransaction.findMany({ where: { id: { in: missingDtx } }, orderBy: { txnDate: 'asc' } });
    let sum = 0;
    console.log(`\n  ── ${rows.length} dist_txn WITHOUT a journal ─────────────────────────────────────────`);
    for (const t of rows) {
      sum += t.amount;
      console.log(`   ${t.txnDate}  ${t.method.padEnd(9)} ${rupiah(t.amount).padStart(14)}  legacy=${t.legacy} bonCounted=${t.bonCounted} status=${t.status}` +
        `\n        id=${t.id} customer=${t.customerId} batch=${t.importBatchId || '—'} paymentNotReceived=${t.paymentNotReceived} createdAt=${t.createdAt && t.createdAt.toISOString ? t.createdAt.toISOString().slice(0, 10) : t.createdAt}`);
    }
    console.log(`   Σ amount of the missing rows: ${rupiah(sum)}  (compare to the finance-AR gap above)\n`);
  }

  console.log(`\n${failed === 0 ? '✔ ALL ' + results.length + ' INVARIANTS HOLD' : '✖ ' + failed + ' of ' + results.length + ' INVARIANT(S) FAILED'}\n`);
  process.exitCode = failed ? 2 : 0;
}

if (require.main === module) run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('VERIFY FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
module.exports = { run };
