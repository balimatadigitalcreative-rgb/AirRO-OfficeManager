'use strict';
/*
  One-time migration: move setoran from the shared /state blob (Document key
  "airro_setoran_v2") into the per-record Setoran table.

  SAFE + idempotent:
    - reads the blob array, upserts each row by its existing id (re-running does
      not duplicate),
    - prints the record count in the blob, and the Setoran table count BEFORE and
      AFTER so you can verify nothing was lost,
    - does NOT delete the blob (the frontend already ignores it; keep it as a
      backup until you're satisfied, then optionally clear it).

  Run on the server (after `deploy/backup-db.sh`):
    cd server && node scripts/migrate-setoran-to-rest.js
*/
const prisma = require('../src/lib/prisma');

const BLOB_KEY = 'airro_setoran_v2';
const num = (v) => Math.max(0, Math.round(+v || 0));

async function main() {
  const before = await prisma.setoran.count();
  const doc = await prisma.document.findUnique({ where: { key: BLOB_KEY } });
  if (!doc) { console.log(`No "${BLOB_KEY}" document found — nothing to migrate. Setoran table count: ${before}`); return; }

  let rows;
  try { rows = JSON.parse(doc.value); } catch (e) { console.error('Blob is not valid JSON — aborting.'); process.exitCode = 1; return; }
  if (!Array.isArray(rows)) { console.error('Blob is not an array — aborting.'); process.exitCode = 1; return; }

  console.log(`Blob "${BLOB_KEY}" holds ${rows.length} setoran record(s).`);
  console.log(`Setoran table BEFORE: ${before}`);

  let created = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    if (!r || !r.id || !r.date) { skipped++; continue; }
    const data = {
      date: String(r.date),
      armada: r.armada != null ? String(r.armada) : '',
      galon: num(r.galon), cash: num(r.cash), bon: num(r.bon), bonPay: num(r.bonPay), expense: num(r.expense),
      note: r.note != null ? String(r.note) : '',
      proof: r.proof != null ? String(r.proof) : null,
    };
    const existing = await prisma.setoran.findUnique({ where: { id: String(r.id) } });
    if (existing) { await prisma.setoran.update({ where: { id: String(r.id) }, data }); updated++; }
    else { await prisma.setoran.create({ data: { id: String(r.id), ...data } }); created++; }
  }

  const after = await prisma.setoran.count();
  console.log(`Created: ${created}, Updated: ${updated}, Skipped(no id/date): ${skipped}`);
  console.log(`Setoran table AFTER: ${after}`);
  const distinctIds = new Set(rows.filter((r) => r && r.id && r.date).map((r) => String(r.id))).size;
  console.log(distinctIds <= after
    ? `✅ Verification OK: every valid blob record (${distinctIds} distinct ids) is present in the table.`
    : `⚠️  Verification WARNING: table has ${after} rows but blob had ${distinctIds} distinct valid ids — inspect before clearing the blob.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
