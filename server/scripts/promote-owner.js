'use strict';
/*
 * Promote a named user to the OWNER role — the controlled, server-side path to mint the first/only
 * owner. This exists because owner-role assignment is now owner-only over the API (user.service
 * assertOwnerRoleGrantAllowed), so a deployment whose initial account is NOT an owner (e.g. bootstrapped
 * as "gm") would otherwise have NOBODY able to grant owner-only capabilities such as
 * distribusiApproveSelf — a deadlock. This CLI is that escape hatch, and every promotion is recorded in
 * UserAuditLog (action 'role', via 'cli').
 *
 * It is a SCRIPT, never an HTTP endpoint — it must be run on the server box with DATABASE_URL set, so it
 * cannot be reached by a remote caller.
 *
 * Usage (from the server/ directory, with DATABASE_URL set as in production):
 *   node scripts/promote-owner.js --list          # DIAGNOSE — list every user's role + count of owners
 *   node scripts/promote-owner.js <username>       # promote <username> to owner
 *
 * After promotion the user must LOG OUT and back in (their session/token carries the old role until then).
 */
const guard = require('./_db-guard');   // FIRST: resolve+print DATABASE_URL, guard prod writes
const prisma = require('../src/lib/prisma');
const { OWNER_ROLE } = require('../src/config/permissions');

// Promote one user to owner + write the audit row. Exported so tests can exercise the exact logic the
// CLI runs. Returns { changed, from } (changed=false when already an owner or user missing).
async function promoteToOwner(username, { actorLabel = 'CLI (promote-owner)' } = {}) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) throw new Error('username is required');
  const user = await prisma.user.findUnique({ where: { username: uname } });
  if (!user) throw new Error(`no user with username "${uname}"`);
  if (user.role === OWNER_ROLE) return { changed: false, from: user.role, user };
  const from = user.role;
  const updated = await prisma.user.update({ where: { id: user.id }, data: { role: OWNER_ROLE } });
  await prisma.userAuditLog.create({ data: {
    targetUserId: user.id, targetName: user.name || '', actorId: null, actorName: actorLabel,
    action: 'role', detail: JSON.stringify({ from, to: OWNER_ROLE, via: 'cli' }),
  } });
  return { changed: true, from, user: updated };
}

// Every user's (username, role, active) + how many ACTIVE owners exist — the deadlock diagnostic.
async function listRoles() {
  const users = await prisma.user.findMany({ select: { username: true, name: true, role: true, active: true }, orderBy: { createdAt: 'asc' } });
  const activeOwners = users.filter((u) => u.role === OWNER_ROLE && u.active !== false);
  return { users, activeOwners };
}

module.exports = { promoteToOwner, listRoles };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const wantList = args.includes('--list') || args.length === 0;
    if (wantList) {
      guard.printBanner('READ-ONLY (--list)');
      const { users, activeOwners } = await listRoles();
      console.log('\nUsers (username · role · status):');
      users.forEach((u) => console.log(`  ${u.username.padEnd(20)} ${String(u.role).padEnd(14)} ${u.active === false ? 'inactive' : 'active'}${u.role === OWNER_ROLE ? '   ← OWNER' : ''}`));
      console.log(`\nActive owner-role accounts: ${activeOwners.length}`);
      if (activeOwners.length === 0) {
        console.warn('\n  ⚠  NO active account holds the "owner" role — nobody can grant owner-only capabilities');
        console.warn('     (e.g. "Setujui Pengajuan Sendiri"). Promote one:');
        console.warn('        node scripts/promote-owner.js <username>');
      }
      if (args.length === 0) console.log('\nTo promote a user:  node scripts/promote-owner.js <username>');
      await prisma.$disconnect();
      return;
    }
    const username = args.find((a) => !a.startsWith('--'));
    guard.assertWriteAllowed();   // refuse a prod-looking DB without --confirm-production (this branch WRITES)
    try {
      const res = await promoteToOwner(username);
      if (res.changed) console.log(`✔ Promoted "${username}" from "${res.from}" to "owner". Recorded in UserAuditLog.\n  They must LOG OUT and back in for the new role to take effect.`);
      else console.log(`• "${username}" is already an owner — no change.`);
    } catch (e) {
      console.error(`✖ ${e.message}`);
      process.exitCode = 1;
    }
    await prisma.$disconnect();
  })().catch(async (e) => { console.error('FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
}
