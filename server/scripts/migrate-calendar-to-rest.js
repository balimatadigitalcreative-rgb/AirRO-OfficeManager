'use strict';
/*
  One-time migration: move HR calendar events from the shared /state blob (Document
  key "airro_calendar_v1") into the per-record CalendarEvent table.

  RUN AFTER migrate-staff-to-rest.js — an event with an employeeId has a foreign key
  to Employee. Events whose employee is missing are SKIPPED and reported. Virtual
  holiday rows (id "h-*", computed at render) are never stored, so they're skipped.

  SAFE + idempotent: upserts by existing id; prints blob + table counts BEFORE/AFTER.

  Run on the server (after `deploy/backup-db.sh`):
    cd server && node scripts/migrate-calendar-to-rest.js
*/
const prisma = require('../src/lib/prisma');

const BLOB_KEY = 'airro_calendar_v1';
const TYPES = ['holiday', 'leave', 'permit'];
const isVirtual = (e) => /^h-/.test(String(e.id || ''));

async function main() {
  const before = await prisma.calendarEvent.count();
  const doc = await prisma.document.findUnique({ where: { key: BLOB_KEY } });
  if (!doc) { console.log(`No "${BLOB_KEY}" document found — nothing to migrate. CalendarEvent table count: ${before}`); return; }

  let rows;
  try { rows = JSON.parse(doc.value); } catch (e) { console.error('Blob is not valid JSON — aborting.'); process.exitCode = 1; return; }
  if (!Array.isArray(rows)) { console.error('Blob is not an array — aborting.'); process.exitCode = 1; return; }

  const valid = rows.filter((e) => e && e.id && e.startDate && TYPES.includes(e.type) && String(e.title || '').trim() && !isVirtual(e));
  console.log(`Blob "${BLOB_KEY}" holds ${rows.length} event(s) (${valid.length} real & valid).`);
  console.log(`CalendarEvent table BEFORE: ${before}`);

  let created = 0, updated = 0, missingEmp = 0; const missingIds = [];
  for (const e of valid) {
    if (e.employeeId) { const ok = await prisma.employee.count({ where: { id: String(e.employeeId) } }); if (!ok) { missingEmp++; missingIds.push(`${e.id}→emp:${e.employeeId}`); continue; } }
    const data = {
      type: e.type, title: String(e.title).trim(), employeeId: e.employeeId ? String(e.employeeId) : null,
      startDate: String(e.startDate), endDate: e.endDate ? String(e.endDate) : null,
      note: e.note != null ? String(e.note) : '', sourceId: e.sourceId != null ? String(e.sourceId) : null,
    };
    const existing = await prisma.calendarEvent.findUnique({ where: { id: String(e.id) } });
    if (existing) { await prisma.calendarEvent.update({ where: { id: String(e.id) }, data }); updated++; }
    else { await prisma.calendarEvent.create({ data: { id: String(e.id), ...data } }); created++; }
  }

  const after = await prisma.calendarEvent.count();
  console.log(`Created: ${created}, Updated: ${updated}, Skipped(invalid/virtual): ${rows.length - valid.length}, Skipped(missing employee): ${missingEmp}`);
  if (missingIds.length) console.log('  ⚠️  missing-employee events (run staff migration first, then re-run):', missingIds.join(', '));
  console.log(`CalendarEvent table AFTER: ${after}`);
  const migratable = valid.length - missingEmp;
  console.log(migratable <= after
    ? `✅ Verification OK: every real event with an existing employee (${migratable}) is present in the table.`
    : `⚠️  Verification WARNING: table has ${after} but expected ≥ ${migratable} — inspect before clearing the blob.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
