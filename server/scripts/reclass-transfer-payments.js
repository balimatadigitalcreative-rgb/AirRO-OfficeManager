'use strict';
// RECLASS LEGACY TRANSFER SETTLEMENTS (Kas → Bank). Before the payMethod column, a bon settlement paid by
// transfer was tagged "· Transfer" in its note but POSTED TO KAS. This script:
//   node scripts/reclass-transfer-payments.js          → LIST only (default; writes nothing)
//   node scripts/reclass-transfer-payments.js --apply  → set payMethod='transfer' + append an adjusting
//                                                        journal per row (reconcileDistTxn) Kas → Bank
// Run --apply ONLY with the owner's approval. Idempotent (a fixed row has payMethod set, so it is no
// longer a candidate). A production-looking DB needs --confirm-production (see _db-guard.js).
const guard = require('./_db-guard');   // FIRST: resolve + print DATABASE_URL, guard prod writes
const prisma = require('../src/lib/prisma');
const acc = require('../src/services/accounting.service');
const config = require('../src/config/env');

async function candidates() {
  const rows = await prisma.distTransaction.findMany({ where: { method: 'pelunasan', payMethod: '', status: { not: 'void' } } });
  return rows.filter((r) => { const parts = String(r.note || '').split(' · '); return parts[parts.length - 1].trim().toLowerCase() === 'transfer'; });
}

// A row whose month is closed/locked (Tutup Buku) is NEVER rewritten — the adjusting journal would post
// at its old date and change a closed month's Kas/Bank. It is listed (flagged) so the owner can decide
// to reopen that month or book the move by hand in an open period.
async function withPeriod(rows) {
  const period = require('../src/services/period.service');
  const status = {};
  for (const r of rows) { const k = period.monthOf(r.txnDate); if (!(k in status)) status[k] = await period.statusForKey(k); }
  return rows.map((r) => ({ row: r, closed: period.LOCKED.includes(status[period.monthOf(r.txnDate)]) }));
}

async function listLegacyTransfers() {
  const all = await withPeriod(await candidates());
  const open = all.filter((x) => !x.closed);
  return {
    count: open.length, total: open.reduce((s, x) => s + Number(x.row.amount || 0), 0),
    closedCount: all.length - open.length, closedTotal: all.filter((x) => x.closed).reduce((s, x) => s + Number(x.row.amount || 0), 0),
    rows: all.map((x) => ({ id: x.row.id, date: x.row.txnDate, amount: Number(x.row.amount), fleetId: x.row.fleetId, periodClosed: x.closed })),
  };
}

async function applyReclass(actor) {
  const all = await withPeriod(await candidates());
  const rows = all.filter((x) => !x.closed).map((x) => x.row);
  let changed = 0;
  for (const r of rows) {
    await prisma.$transaction(async (tx) => {
      const row = await tx.distTransaction.update({ where: { id: r.id }, data: { payMethod: 'transfer' } });
      if (config.accountingV2) await acc.reconcileDistTxn(row, 'reclass-bank', actor, tx);
    });
    changed++;
  }
  return { changed, skippedClosed: all.length - rows.length };
}

module.exports = { listLegacyTransfers, applyReclass };

if (require.main === module) {
  (async () => {
    const apply = process.argv.includes('--apply');
    guard.printBanner(apply ? 'WRITE (--apply)' : 'READ-ONLY (daftar saja)');
    const l = await listLegacyTransfers();
    console.log(`Pelunasan transfer lama yang tercatat ke Kas: ${l.count} baris bisa dipindah, total Rp ${l.total.toLocaleString('id-ID')}`);
    if (l.closedCount) console.log(`Di periode yang sudah DITUTUP/DIKUNCI (dilewati): ${l.closedCount} baris, total Rp ${l.closedTotal.toLocaleString('id-ID')}`);
    l.rows.forEach((r) => console.log(`  ${r.date}  ${r.fleetId}  Rp ${r.amount.toLocaleString('id-ID')}  ${r.id}${r.periodClosed ? '  [periode ditutup — dilewati]' : ''}`));
    if (!apply) { console.log('\nMode daftar saja. Jalankan dengan --apply setelah disetujui pemilik.'); process.exit(0); }
    guard.assertWriteAllowed();
    const a = await applyReclass({ id: null, name: 'script reclass-transfer-payments' });
    console.log(`Selesai: ${a.changed} baris dipindah Kas → Bank${a.skippedClosed ? `; ${a.skippedClosed} baris di periode tertutup dilewati` : ''}.`);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
