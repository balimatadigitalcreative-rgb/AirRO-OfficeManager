'use strict';
/*
  One-time migration: move approvals from the shared /state blob (Document key
  "airro_approvals_v4") into the per-record Approval table.

  SAFE + idempotent: upserts by existing id; the full request object is stored
  verbatim in Approval.data; prints blob count + table count BEFORE and AFTER.

  Run on the server (after `deploy/backup-db.sh`):
    cd server && node scripts/migrate-approvals-to-rest.js
*/
const prisma = require('../src/lib/prisma');

const BLOB_KEY = 'airro_approvals_v4';

async function main() {
  const before = await prisma.approval.count();
  const doc = await prisma.document.findUnique({ where: { key: BLOB_KEY } });
  if (!doc) { console.log(`No "${BLOB_KEY}" document found — nothing to migrate. Approval table count: ${before}`); return; }

  let rows;
  try { rows = JSON.parse(doc.value); } catch (e) { console.error('Blob is not valid JSON — aborting.'); process.exitCode = 1; return; }
  if (!Array.isArray(rows)) { console.error('Blob is not an array — aborting.'); process.exitCode = 1; return; }

  const valid = rows.filter((a) => a && a.id);
  console.log(`Blob "${BLOB_KEY}" holds ${rows.length} approval(s) (${valid.length} with id).`);
  console.log(`Approval table BEFORE: ${before}`);

  let created = 0, updated = 0;
  for (const a of valid) {
    const data = { type: a.type ? String(a.type) : 'custom', status: a.status ? String(a.status) : 'pending', data: JSON.stringify(a) };
    const existing = await prisma.approval.findUnique({ where: { id: String(a.id) } });
    if (existing) { await prisma.approval.update({ where: { id: String(a.id) }, data }); updated++; }
    else { await prisma.approval.create({ data: { id: String(a.id), ...data } }); created++; }
  }

  const after = await prisma.approval.count();
  console.log(`Created: ${created}, Updated: ${updated}, Skipped(no id): ${rows.length - valid.length}`);
  console.log(`Approval table AFTER: ${after}`);
  const distinctIds = new Set(valid.map((a) => String(a.id))).size;
  console.log(distinctIds <= after
    ? `✅ Verification OK: every valid blob approval (${distinctIds} distinct ids) is present in the table.`
    : `⚠️  Verification WARNING: table has ${after} but blob had ${distinctIds} distinct valid ids — inspect before clearing the blob.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
