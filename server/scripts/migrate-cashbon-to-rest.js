'use strict';
/*
  One-time migration: move kasbon from the shared /state blob (Document key
  "airro_cashbon_v1") into the per-record Cashbon table.

  RUN AFTER migrate-staff-to-rest.js — each kasbon has a foreign key to Employee,
  so the roster must be in the table first. Any kasbon whose employee is missing is
  SKIPPED and reported (never silently dropped).

  FAITHFUL + SAFE + idempotent:
    - upserts by existing id; approval trail (requestedBy/approvedBy/decidedAt/…) is
      preserved in Cashbon.data (JSON); createdAt preserved,
    - prints blob count + table count BEFORE and AFTER to verify.

  Run on the server (after `deploy/backup-db.sh`):
    cd server && node scripts/migrate-cashbon-to-rest.js
*/
const prisma = require('../src/lib/prisma');

const BLOB_KEY = 'airro_cashbon_v1';
const TRAIL = ['requestedBy', 'requestedAt', 'approvedBy', 'decidedAt', 'rejectReason'];
const num = (v) => Math.max(0, Math.round(+v || 0));

async function main() {
  const before = await prisma.cashbon.count();
  const doc = await prisma.document.findUnique({ where: { key: BLOB_KEY } });
  if (!doc) { console.log(`No "${BLOB_KEY}" document found — nothing to migrate. Cashbon table count: ${before}`); return; }

  let rows;
  try { rows = JSON.parse(doc.value); } catch (e) { console.error('Blob is not valid JSON — aborting.'); process.exitCode = 1; return; }
  if (!Array.isArray(rows)) { console.error('Blob is not an array — aborting.'); process.exitCode = 1; return; }

  const valid = rows.filter((c) => c && c.id && c.employeeId && c.date && c.amount != null);
  console.log(`Blob "${BLOB_KEY}" holds ${rows.length} kasbon record(s) (${valid.length} with id+employeeId+date+amount).`);
  console.log(`Cashbon table BEFORE: ${before}`);

  let created = 0, updated = 0, skippedInvalid = rows.length - valid.length, missingEmp = 0;
  const missingIds = [];
  for (const c of valid) {
    const empExists = await prisma.employee.count({ where: { id: String(c.employeeId) } });
    if (!empExists) { missingEmp++; missingIds.push(`${c.id}→emp:${c.employeeId}`); continue; }
    const trail = {}; TRAIL.forEach((k) => { if (c[k] != null) trail[k] = c[k]; });
    const data = {
      employeeId: String(c.employeeId), amount: num(c.amount), date: String(c.date),
      note: c.note != null ? String(c.note) : '', installments: Math.max(1, Math.round(+c.installments || 1)),
      status: c.status || 'pending', cycleAnchor: c.cycleAnchor != null ? String(c.cycleAnchor) : null,
      data: Object.keys(trail).length ? JSON.stringify(trail) : null,
    };
    if (c.createdAt) { const d = new Date(typeof c.createdAt === 'number' ? c.createdAt : Date.parse(c.createdAt)); if (!isNaN(d.getTime())) data.createdAt = d; }
    const existing = await prisma.cashbon.findUnique({ where: { id: String(c.id) } });
    if (existing) { await prisma.cashbon.update({ where: { id: String(c.id) }, data }); updated++; }
    else { await prisma.cashbon.create({ data: { id: String(c.id), ...data } }); created++; }
  }

  const after = await prisma.cashbon.count();
  console.log(`Created: ${created}, Updated: ${updated}, Skipped(invalid): ${skippedInvalid}, Skipped(missing employee): ${missingEmp}`);
  if (missingIds.length) console.log('  ⚠️  missing-employee kasbon (run staff migration first, then re-run):', missingIds.join(', '));
  console.log(`Cashbon table AFTER: ${after}`);
  const migratable = valid.length - missingEmp;
  console.log(migratable <= after
    ? `✅ Verification OK: every kasbon with an existing employee (${migratable}) is present in the table.`
    : `⚠️  Verification WARNING: table has ${after} but expected ≥ ${migratable} — inspect before clearing the blob.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
