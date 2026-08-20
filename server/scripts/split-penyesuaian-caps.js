'use strict';
/*
 * MIGRATION VERIFICATION — the split of the single `distribusiPenyesuaian` capability into
 * `distribusiPenyesuaianGalon` (gallons) + `distribusiPenyesuaianBon` (receivable/money).
 *
 * Like the gudang* rename, the split is handled by DERIVE at read-time (permissions.js
 * deriveDistribusiCaps): every ABSENT new cap is derived from the legacy combined value, the old name
 * survives as a read-only alias for one release, and NOTHING is written to stored blobs. So there is
 * no data to migrate — this script PROVES the invariant the brief demands: every user who held the
 * combined cap now holds BOTH new caps, and NOBODY's access widens.
 *
 * It is READ-ONLY (writes nothing) and exits non-zero if any user would gain access, so it is safe to
 * run in a deploy gate.
 *
 * Usage (from server/, with production DATABASE_URL):
 *   node scripts/split-penyesuaian-caps.js
 */
const prisma = require('../src/lib/prisma');
const { resolvePerms, parsePerms } = require('../src/config/permissions');

// The user's OLD combined ability, computed independently of the new derive: explicit user override,
// else the (raw) role's explicit value, else the old role default (owner/GM had it; nobody else).
function oldCombined(user, rawRolePerms) {
  const ob = parsePerms(user.permissions);
  if (ob && Object.prototype.hasOwnProperty.call(ob, 'distribusiPenyesuaian')) return !!ob.distribusiPenyesuaian;
  const rr = rawRolePerms[user.role];
  if (rr && Object.prototype.hasOwnProperty.call(rr, 'distribusiPenyesuaian')) return !!rr.distribusiPenyesuaian;
  return user.role === 'owner' || user.role === 'gm';
}

async function run() {
  const roles = await prisma.role.findMany({ select: { id: true, permissions: true } });
  const rawRolePerms = {}; roles.forEach((r) => { rawRolePerms[r.id] = parsePerms(r.permissions) || {}; });
  const users = await prisma.user.findMany({ select: { id: true, username: true, name: true, role: true, permissions: true } });

  const widened = [], narrowed = [];
  console.log('\nBEFORE → AFTER effective permissions (penyesuaian split):');
  console.log('  username             role        combined → galon / bon');
  for (const u of users) {
    const before = oldCombined(u, rawRolePerms);
    const eff = resolvePerms(u.role, u.permissions);
    const galon = !!eff.distribusiPenyesuaianGalon;
    const bon = !!eff.distribusiPenyesuaianBon;
    const flag = ((galon || bon) && !before) ? '  ✖ WIDENED' : ((before && !(galon && bon)) ? '  ! narrowed' : '');
    console.log(`  ${String(u.username).padEnd(20)} ${String(u.role).padEnd(11)} ${String(before).padEnd(5)}   → ${galon ? 'galon' : '·····'} / ${bon ? 'bon' : '···'}${flag}`);
    if ((galon || bon) && !before) widened.push(u.username);
    if (before && !(galon && bon)) narrowed.push(u.username);
  }

  console.log(`\nUsers: ${users.length}  ·  widened: ${widened.length}  ·  narrowed: ${narrowed.length}`);
  if (narrowed.length) console.warn('  ! narrowed (had combined, missing one new cap — check for an explicit split override):\n     ' + narrowed.join(', '));
  if (widened.length) {
    console.error('\n✖ MIGRATION FAILED — these users would GAIN access (widening is forbidden):\n     ' + widened.join(', '));
    process.exitCode = 2;
  } else {
    console.log('\n✔ No widening. Everyone who held distribusiPenyesuaian now holds BOTH new caps; nobody gained access.');
  }
  return { widened, narrowed, users: users.length };
}

if (require.main === module) {
  run().then(() => prisma.$disconnect())
    .catch(async (e) => { console.error('FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
}
module.exports = { oldCombined, run };
