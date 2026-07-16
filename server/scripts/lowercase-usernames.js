'use strict';
/*
 * One-time data migration: lowercase every existing User.username so logins become
 * case-insensitive (matches the new register/login normalisation).
 *
 * SAFETY:
 *   1. Backs up the SQLite DB file first (…/dev.db.bak-<timestamp>).
 *   2. Detects COLLISIONS — two distinct users whose usernames only differ by case
 *      (e.g. "Gusde17" and "gusde17"). Collisions are REPORTED and left untouched
 *      (never silently merged/overwritten); resolve them by hand, then re-run.
 *   3. Verifies the user count is identical before and after.
 *   4. Idempotent — safe to run repeatedly (already-lowercase rows are skipped).
 *
 * Usage (from the server/ directory, with DATABASE_URL set as in production):
 *   node scripts/lowercase-usernames.js            # apply
 *   node scripts/lowercase-usernames.js --dry-run  # report only, change nothing
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');

const DRY = process.argv.includes('--dry-run');

function backupSqlite() {
  const raw = process.env.DATABASE_URL || '';
  if (!raw.startsWith('file:')) {
    console.warn('! DATABASE_URL is not a file: (SQLite) URL — skipping auto-backup. BACK UP YOUR DB MANUALLY before running without --dry-run.');
    return null;
  }
  let p = raw.replace(/^file:/, '');
  // Prisma resolves a relative file: path against the schema directory (prisma/).
  const dbPath = path.isAbsolute(p) ? p : path.resolve(__dirname, '..', 'prisma', p);
  if (!fs.existsSync(dbPath)) { console.warn(`! DB file not found at ${dbPath} — skipping auto-backup.`); return null; }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const bak = `${dbPath}.bak-${stamp}`;
  fs.copyFileSync(dbPath, bak);
  console.log(`✔ Backup written: ${bak}`);
  return bak;
}

(async () => {
  const before = await prisma.user.count();
  console.log(`Users before: ${before}${DRY ? '  (dry-run)' : ''}`);

  const users = await prisma.user.findMany({ select: { id: true, username: true, name: true } });

  // Group by lowercased username to find collisions.
  const byLower = new Map();
  for (const u of users) {
    const lo = String(u.username || '').toLowerCase();
    if (!byLower.has(lo)) byLower.set(lo, []);
    byLower.get(lo).push(u);
  }
  const collisions = [...byLower.entries()].filter(([, list]) => list.length > 1);
  if (collisions.length) {
    console.error('\n✖ COLLISIONS — these lowercased usernames map to >1 user. NOT changed (resolve manually):');
    for (const [lo, list] of collisions) {
      console.error(`   "${lo}": ` + list.map((u) => `${u.username} (id=${u.id}, name=${u.name})`).join('  |  '));
    }
    console.error('   Rename or delete the duplicates, then re-run.\n');
  }
  const collidingIds = new Set(collisions.flatMap(([, list]) => list.map((u) => u.id)));

  // Rows that need changing: not in a collision group AND not already lowercase.
  const toFix = users.filter((u) => !collidingIds.has(u.id) && u.username !== u.username.toLowerCase());
  console.log(`To lowercase: ${toFix.length}` + (toFix.length ? '  → ' + toFix.map((u) => `${u.username}→${u.username.toLowerCase()}`).join(', ') : ''));

  if (!DRY && toFix.length) {
    backupSqlite();
    for (const u of toFix) {
      await prisma.user.update({ where: { id: u.id }, data: { username: u.username.toLowerCase() } });
    }
    console.log(`✔ Updated ${toFix.length} username(s) to lowercase.`);
  } else if (DRY) {
    console.log('(dry-run — no changes written)');
  } else {
    console.log('Nothing to change.');
  }

  const after = await prisma.user.count();
  console.log(`Users after: ${after}`);
  if (before !== after) console.error(`✖ USER COUNT CHANGED (${before} → ${after}) — investigate!`);
  else console.log('✔ User count unchanged.');
  if (collisions.length) { console.error('\nDone WITH UNRESOLVED COLLISIONS — the colliding users were left as-is.'); process.exitCode = 2; }
  else console.log('\nDone.');

  await prisma.$disconnect();
})().catch(async (e) => { console.error('MIGRATION FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
