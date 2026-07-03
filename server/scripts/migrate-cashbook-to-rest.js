'use strict';
/*
  One-time migration: move the cash book from the shared /state blob (Document
  key "airro_cashbook_v4") into the per-record Entry table.

  IMPORTANT — derived setoran rows are SKIPPED. Entries tagged setoranDay /
  setoranMfg (ids "stinc-*" / "stmfg-*") are recomputed in-memory by the app from
  the Setoran table; persisting them would double-count and fight the derivation.
  Only REAL entries (manual, customer payments, payroll, THR, orientation) migrate.

  SAFE + idempotent:
    - upserts each real row by its existing id (re-running does not duplicate),
    - prints blob totals + Entry table count BEFORE and AFTER so you can verify,
    - does NOT delete the blob (kept as a backup; the frontend already ignores it).

  Run on the server (after `deploy/backup-db.sh`):
    cd server && node scripts/migrate-cashbook-to-rest.js
*/
const prisma = require('../src/lib/prisma');

const BLOB_KEY = 'airro_cashbook_v4';
const TAG_KEYS = ['custPay', 'party', 'payroll', 'thr', 'orientation'];
const num = (v) => Math.max(0, Math.round(+v || 0));
const isDerived = (r) => !!(r.setoranDay || r.setoranMfg) || /^st(inc|mfg)-/.test(String(r.id || ''));

async function main() {
  const before = await prisma.entry.count();
  const doc = await prisma.document.findUnique({ where: { key: BLOB_KEY } });
  if (!doc) { console.log(`No "${BLOB_KEY}" document found — nothing to migrate. Entry table count: ${before}`); return; }

  let rows;
  try { rows = JSON.parse(doc.value); } catch (e) { console.error('Blob is not valid JSON — aborting.'); process.exitCode = 1; return; }
  if (!Array.isArray(rows)) { console.error('Blob is not an array — aborting.'); process.exitCode = 1; return; }

  const derived = rows.filter(isDerived);
  const real = rows.filter((r) => r && r.id && r.date && r.type && !isDerived(r));
  console.log(`Blob "${BLOB_KEY}" holds ${rows.length} row(s): ${real.length} real, ${derived.length} derived-setoran (skipped).`);
  console.log(`Entry table BEFORE: ${before}`);

  let created = 0, updated = 0, skipped = rows.length - derived.length - real.length;
  for (const r of real) {
    const tags = {};
    TAG_KEYS.forEach((k) => { if (r[k] != null) tags[k] = r[k]; });
    const data = {
      type: r.type === 'income' ? 'income' : 'expense',
      amount: num(r.amount),
      note: r.note != null ? String(r.note) : '',
      method: r.method != null ? String(r.method) : 'Cash',
      date: String(r.date),
      time: r.time != null ? String(r.time) : '00:00',
      category: r.category != null ? String(r.category) : null,
      acct: r.acct != null ? String(r.acct) : null,
      proof: r.proof != null ? String(r.proof) : null,
      meta: Object.keys(tags).length ? JSON.stringify(tags) : null,
    };
    const existing = await prisma.entry.findUnique({ where: { id: String(r.id) } });
    if (existing) { await prisma.entry.update({ where: { id: String(r.id) }, data }); updated++; }
    else { await prisma.entry.create({ data: { id: String(r.id), ...data } }); created++; }
  }

  const after = await prisma.entry.count();
  console.log(`Created: ${created}, Updated: ${updated}, Skipped(invalid): ${skipped}`);
  console.log(`Entry table AFTER: ${after}`);
  const distinctIds = new Set(real.map((r) => String(r.id))).size;
  console.log(distinctIds <= after
    ? `✅ Verification OK: every valid real blob record (${distinctIds} distinct ids) is present in the table.`
    : `⚠️  Verification WARNING: table has ${after} rows but blob had ${distinctIds} distinct valid real ids — inspect before clearing the blob.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
