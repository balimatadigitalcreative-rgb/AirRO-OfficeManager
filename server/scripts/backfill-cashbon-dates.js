'use strict';
/*
  One-time backfill for the expanded Kasbon (ACC → auto-deduction) flow:
    - legacy status 'active' → 'approved'
    - approved rows without a disbursedDate → disbursedDate = date (the request date),
      so the deduction cycle stays where it was before this change.
  `date` already IS the request date (requestDate), so nothing to move there.

  SAFE + idempotent — only touches rows that still need it. Prints counts.
  Run on the server AFTER a backup:
    bash deploy/backup-db.sh
    cd server && node scripts/backfill-cashbon-dates.js
*/
const prisma = require('../src/lib/prisma');

async function main() {
  const total = await prisma.cashbon.count();
  const act = await prisma.cashbon.updateMany({ where: { status: 'active' }, data: { status: 'approved' } });
  const rows = await prisma.cashbon.findMany({ where: { status: 'approved', disbursedDate: null }, select: { id: true, date: true } });
  let filled = 0;
  for (const r of rows) { await prisma.cashbon.update({ where: { id: r.id }, data: { disbursedDate: r.date } }); filled++; }
  const withDisb = await prisma.cashbon.count({ where: { NOT: { disbursedDate: null } } });
  console.log(`Cashbon: ${total} total; 'active'→'approved': ${act.count}; disbursedDate backfilled from the request date: ${filled}; ${withDisb} now have a disbursedDate.`);
  console.log('✅ Backfill complete (idempotent — safe to re-run).');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
