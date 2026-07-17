'use strict';
// Deploy gate helper: print record counts for the tables that matter, in a
// shell-friendly one-liner:  user=5 entry=1284 employee=19 setoran=342
//
// update.sh records these BEFORE and AFTER a deploy — a drop means the deploy
// destroyed data (bad migration, wrong DB restored) and triggers a rollback.
// Lives under server/ so it resolves @prisma/client + the app's own .env wiring,
// which guarantees it reads the SAME database the running API uses.
const prisma = require('../src/lib/prisma');

const TABLES = ['user', 'entry', 'employee', 'setoran'];

(async () => {
  const parts = [];
  for (const t of TABLES) parts.push(`${t}=${await prisma[t].count()}`);
  console.log(parts.join(' '));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(`db-counts failed: ${e.message}`);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
