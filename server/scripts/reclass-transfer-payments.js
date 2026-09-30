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

async function listLegacyTransfers() {
  const rows = await candidates();
  return { count: rows.length, total: rows.reduce((s, r) => s + Number(r.amount || 0), 0), rows: rows.map((r) => ({ id: r.id, date: r.txnDate, amount: Number(r.amount), fleetId: r.fleetId })) };
}

async function applyReclass(actor) {
  const rows = await candidates();
  let changed = 0;
  for (const r of rows) {
    await prisma.$transaction(async (tx) => {
      const row = await tx.distTransaction.update({ where: { id: r.id }, data: { payMethod: 'transfer' } });
      if (config.accountingV2) await acc.reconcileDistTxn(row, 'reclass-bank', actor, tx);
    });
    changed++;
  }
  return { changed };
}

module.exports = { listLegacyTransfers, applyReclass };

if (require.main === module) {
  (async () => {
    const apply = process.argv.includes('--apply');
    guard.printBanner(apply ? 'WRITE (--apply)' : 'READ-ONLY (daftar saja)');
    const l = await listLegacyTransfers();
    console.log(`Pelunasan transfer lama yang tercatat ke Kas: ${l.count} baris, total Rp ${l.total.toLocaleString('id-ID')}`);
    l.rows.forEach((r) => console.log(`  ${r.date}  ${r.fleetId}  Rp ${r.amount.toLocaleString('id-ID')}  ${r.id}`));
    if (!apply) { console.log('\nMode daftar saja. Jalankan dengan --apply setelah disetujui pemilik.'); process.exit(0); }
    guard.assertWriteAllowed();
    const a = await applyReclass({ id: null, name: 'script reclass-transfer-payments' });
    console.log(`Selesai: ${a.changed} baris dipindah Kas → Bank.`);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
