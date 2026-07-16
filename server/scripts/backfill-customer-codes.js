'use strict';
/*
 * One-time backfill: give every existing Customer a human-readable code (C-0001, C-0002, …),
 * oldest (by createdAt) first, and seed the CustomerCode counter so future allocations continue
 * from there.
 *
 * SAFETY:
 *   1. Backs up the SQLite DB file first (…/dev.db.bak-<timestamp>).
 *   2. Only fills customers whose code is NULL; already-coded rows are left as-is.
 *   3. New codes continue AFTER the highest CustomerCode.seq already allocated (never reused).
 *   4. Verifies the customer count is identical before and after.
 *   5. Idempotent — re-running does nothing once every customer has a code.
 *
 * Usage (from server/, with the production DATABASE_URL):
 *   node scripts/backfill-customer-codes.js            # apply
 *   node scripts/backfill-customer-codes.js --dry-run  # report only
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');

const DRY = process.argv.includes('--dry-run');
const codeOf = (seq) => 'C-' + String(seq).padStart(4, '0');

function backupSqlite() {
  const raw = process.env.DATABASE_URL || '';
  if (!raw.startsWith('file:')) { console.warn('! Not a file: (SQLite) URL — skipping auto-backup. BACK UP YOUR DB MANUALLY.'); return null; }
  let p = raw.replace(/^file:/, '');
  const dbPath = path.isAbsolute(p) ? p : path.resolve(__dirname, '..', 'prisma', p);
  if (!fs.existsSync(dbPath)) { console.warn(`! DB file not found at ${dbPath} — skipping auto-backup.`); return null; }
  const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const bak = `${dbPath}.bak-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  fs.copyFileSync(dbPath, bak);
  console.log(`✔ Backup written: ${bak}`);
  return bak;
}

(async () => {
  const before = await prisma.customer.count();
  console.log(`Customers before: ${before}${DRY ? '  (dry-run)' : ''}`);

  const uncoded = await prisma.customer.findMany({ where: { code: null }, select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  console.log(`Without a code: ${uncoded.length}`);
  if (!uncoded.length) { console.log('Nothing to backfill.'); await prisma.$disconnect(); return; }

  // Continue after the highest seq already allocated (so we never reuse a number).
  const maxRow = await prisma.customerCode.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } });
  let seq = maxRow ? maxRow.seq : 0;
  const plan = uncoded.map((c) => ({ id: c.id, name: c.name, code: codeOf(++seq) }));
  console.log(`Assigning ${plan.length} codes: ${plan[0].code} … ${plan[plan.length - 1].code}`);
  console.log(plan.slice(0, 8).map((p) => `${p.code} ← ${p.name}`).join('\n') + (plan.length > 8 ? `\n… (+${plan.length - 8} more)` : ''));

  if (DRY) { console.log('(dry-run — no changes written)'); await prisma.$disconnect(); return; }

  backupSqlite();
  for (const p of plan) {
    // record the allocation (counter) then stamp the customer — order keeps the counter authoritative
    await prisma.customerCode.create({ data: { code: p.code, seq: parseInt(p.code.slice(2), 10) } });
    await prisma.customer.update({ where: { id: p.id }, data: { code: p.code } });
  }
  console.log(`✔ Backfilled ${plan.length} customer code(s).`);

  const after = await prisma.customer.count();
  const stillNull = await prisma.customer.count({ where: { code: null } });
  console.log(`Customers after: ${after} · still without a code: ${stillNull}`);
  if (before !== after) console.error(`✖ CUSTOMER COUNT CHANGED (${before} → ${after}) — investigate!`);
  else console.log('✔ Customer count unchanged.');
  console.log('\nDone.');
  await prisma.$disconnect();
})().catch(async (e) => { console.error('BACKFILL FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
