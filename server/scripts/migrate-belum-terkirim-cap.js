'use strict';
/*
 * MIGRATION VERIFICATION — split the "Belum Terkirim" (carry-over) feature out from distribusiPengiriman
 * into its OWN back-office capability `distribusiBelumTerkirim`.
 *
 * The new cap is handled by DERIVE at read-time (permissions.js deriveDistribusiCaps): it defaults TRUE
 * only for owner/GM and is NEVER derived from distribusiPengiriman, so a field user who holds only
 * distribusiPengiriman resolves it to FALSE. NOTHING is written to stored blobs — there is no data to
 * migrate. This script PROVES the invariant the brief demands: nobody's effective access widens, and in
 * particular NO account that holds only distribusiPengiriman gains the new cap.
 *
 * READ-ONLY (writes nothing). Prints a per-user BEFORE → AFTER diff and exits NON-ZERO if any
 * field/plain account gained the capability — safe in a deploy gate.
 *
 * Usage (from server/, with the production DATABASE_URL):
 *   node scripts/migrate-belum-terkirim-cap.js
 */
const prisma = require('../src/lib/prisma');
const { resolvePerms, refreshRoleCache } = require('../src/config/permissions');

async function run() {
  await refreshRoleCache();   // so custom roles resolve from the live Role table, not just the seed
  const users = await prisma.user.findMany({ select: { id: true, username: true, role: true, permissions: true }, orderBy: { username: 'asc' } });

  const gained = [];   // non-owner/GM accounts that ended up with the new cap (must be empty)
  console.log('\nBEFORE → AFTER effective access (distribusiBelumTerkirim):');
  console.log('  username             role         pengiriman   belumTerkirim(before→after)');
  for (const u of users) {
    const after = resolvePerms(u.role, u.permissions) || {};
    const hasPengiriman = !!after.distribusiPengiriman;
    const hasNew = !!after.distribusiBelumTerkirim;   // BEFORE the cap existed this was universally false
    const isOwnerGm = u.role === 'owner' || u.role === 'gm';
    const flag = hasNew && !isOwnerGm ? '  ⚠ WIDENED' : '';
    console.log(`  ${String(u.username).padEnd(20)} ${String(u.role).padEnd(12)} ${hasPengiriman ? 'yes' : 'no '}          false → ${hasNew ? 'true ' : 'false'}${flag}`);
    // The feature was previously visible to ANYONE with distribusiPengiriman; the whole point of the
    // split is that those users must NOT keep access. Any non-owner/GM that now resolves the cap true —
    // most importantly an account holding only distribusiPengiriman — is a widening and fails the gate.
    if (hasNew && !isOwnerGm) gained.push(u.username);
  }

  console.log('');
  if (gained.length) {
    console.error(`✖ REFUSING: ${gained.length} non-owner/GM account(s) gained distribusiBelumTerkirim: ${gained.join(', ')}`);
    console.error('  The split must not widen anyone. Investigate the derive default (should be owner/GM only).');
    process.exitCode = 2;
  } else {
    console.log(`✔ OK — no account widened. distribusiBelumTerkirim is held only by owner/GM; every field/plain`);
    console.log('  account (incl. those with distribusiPengiriman) resolves it to FALSE. Grant it per-role in the UI.');
  }
}

run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('MIGRATION CHECK FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
