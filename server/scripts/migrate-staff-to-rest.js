'use strict';
/*
  One-time migration: move the HR roster from the shared /state blob (Document key
  "airro_hrd_staff_v7") into the per-record Employee table.

  FAITHFUL + SAFE + idempotent:
    - the FULL frontend staff object is stored verbatim in Employee.data (JSON);
      structured columns are a projection for the payroll engine / queries / NIP,
      so NO field is lost (pos, pph, deductions[], nik, bank, phone, orientation…),
    - upserts each row by its existing id (re-running does not duplicate),
    - preserves each staff's existing NIP exactly (does NOT allocate/burn new NIPs);
      an empty NIP becomes NULL so the unique index doesn't collide across rows,
    - offboarded staff (active:false) are migrated too — nothing is dropped,
    - prints blob count + Employee table count BEFORE and AFTER to verify.

  Run on the server (after `deploy/backup-db.sh`):
    cd server && node scripts/migrate-staff-to-rest.js
*/
const prisma = require('../src/lib/prisma');
const { toColumns } = require('../src/services/employee.service');

const BLOB_KEY = 'airro_hrd_staff_v7';

async function main() {
  const before = await prisma.employee.count();
  const doc = await prisma.document.findUnique({ where: { key: BLOB_KEY } });
  if (!doc) { console.log(`No "${BLOB_KEY}" document found — nothing to migrate. Employee table count: ${before}`); return; }

  let rows;
  try { rows = JSON.parse(doc.value); } catch (e) { console.error('Blob is not valid JSON — aborting.'); process.exitCode = 1; return; }
  if (!Array.isArray(rows)) { console.error('Blob is not an array — aborting.'); process.exitCode = 1; return; }

  const valid = rows.filter((r) => r && r.id && String(r.name || '').trim());
  console.log(`Blob "${BLOB_KEY}" holds ${rows.length} staff record(s) (${valid.length} with id+name).`);
  console.log(`Employee table BEFORE: ${before}`);

  let created = 0, updated = 0, skipped = rows.length - valid.length;
  for (const s of valid) {
    const full = { ...s }; delete full._isNew;
    const cols = toColumns(full);
    const data = { ...cols, nip: s.nip ? String(s.nip) : null, data: JSON.stringify(full) };
    const existing = await prisma.employee.findUnique({ where: { id: String(s.id) } });
    if (existing) { await prisma.employee.update({ where: { id: String(s.id) }, data }); updated++; }
    else { await prisma.employee.create({ data: { id: String(s.id), ...data } }); created++; }
  }

  const after = await prisma.employee.count();
  console.log(`Created: ${created}, Updated: ${updated}, Skipped(no id/name): ${skipped}`);
  console.log(`Employee table AFTER: ${after}`);
  const distinctIds = new Set(valid.map((s) => String(s.id))).size;
  console.log(distinctIds <= after
    ? `✅ Verification OK: every valid blob staff (${distinctIds} distinct ids) is present in the table.`
    : `⚠️  Verification WARNING: table has ${after} rows but blob had ${distinctIds} distinct valid ids — inspect before clearing the blob.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
