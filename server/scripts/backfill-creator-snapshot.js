'use strict';
/*
  One-time backfill: fill the creator SNAPSHOT columns (createdByName / createdByRole)
  for records that predate creator tracking.

  - Entry: rows that already carry a `createdById` (i.e. were created through the REST
    path) but have no snapshot get createdByName/createdByRole from the LINKED user's
    CURRENT name+role. This is a best-effort HISTORICAL APPROXIMATION — the role the
    user held at the original input time was not recorded before this feature, so the
    closest available value (their current role) is used. New records snapshot the
    real values at input time and are unaffected.
  - Employee: the roster never stored a creator id, so there is nothing to derive
    from — those rows keep "—" (added-by unknown). Reported for transparency.
  - Cashbon: the JSON trail recorded the requester's USERNAME (requestedBy); rows are
    matched to that user and filled with their current name+role (best-effort).
  - Approval: legacy rows recorded only a routing ROLE (not a specific submitter), so
    they cannot be backfilled — they stay "—". Reported for transparency.

  SAFE + idempotent:
    - only fills rows whose snapshot is still empty (re-running changes nothing new),
    - NEVER overwrites an existing snapshot,
    - prints BEFORE / AFTER counts so you can verify.

  Run on the server AFTER a backup:
    bash deploy/backup-db.sh
    cd server && node scripts/backfill-creator-snapshot.js
*/
const prisma = require('../src/lib/prisma');

async function main() {
  // ── Entry ──────────────────────────────────────────────────────────────────
  const entryTotal = await prisma.entry.count();
  const snapBefore = await prisma.entry.count({ where: { NOT: { createdByName: null } } });
  const candidates = await prisma.entry.findMany({
    where: { createdById: { not: null }, createdByName: null },
    select: { id: true, createdById: true },
  });
  console.log(`Entry: ${entryTotal} total; ${snapBefore} already had a creator snapshot.`);
  console.log(`Entry: ${candidates.length} row(s) have a createdById but no snapshot — backfilling from the linked user.`);

  const userCache = new Map();   // id → {name, role} | null
  let filled = 0, missingUser = 0;
  for (const e of candidates) {
    if (!userCache.has(e.createdById)) {
      userCache.set(e.createdById, await prisma.user.findUnique({ where: { id: e.createdById }, select: { name: true, role: true } }));
    }
    const u = userCache.get(e.createdById);
    if (!u) { missingUser++; continue; }   // creator user was deleted → leave as "—"
    await prisma.entry.update({ where: { id: e.id }, data: { createdByName: u.name, createdByRole: u.role } });
    filled++;
  }
  const snapAfter = await prisma.entry.count({ where: { NOT: { createdByName: null } } });
  const stillNone = await prisma.entry.count({ where: { createdByName: null } });
  console.log(`Entry: filled ${filled}; skipped ${missingUser} (creator user no longer exists).`);
  console.log(`Entry: snapshot present BEFORE ${snapBefore} → AFTER ${snapAfter}.`);
  console.log(`Entry: ${stillNone} row(s) still without a creator (blob-migrated, no createdById) → shown as "—".`);

  // ── Employee ───────────────────────────────────────────────────────────────
  const empTotal = await prisma.employee.count();
  const empSnap = await prisma.employee.count({ where: { NOT: { createdByName: null } } });
  console.log(`Employee: ${empTotal} total; ${empSnap} with a creator snapshot; ${empTotal - empSnap} without ` +
    `(no creator id was ever stored → shown as "—"). Nothing to backfill.`);

  // ── Cashbon ── (match the trail's requestedBy username/id to a user)
  const cbTotal = await prisma.cashbon.count();
  const cbSnapBefore = await prisma.cashbon.count({ where: { NOT: { createdByName: null } } });
  const cbCandidates = await prisma.cashbon.findMany({ where: { createdByName: null }, select: { id: true, data: true } });
  const requesterCache = new Map();   // requestedBy → {name, role} | null
  let cbFilled = 0, cbUnmatched = 0;
  for (const c of cbCandidates) {
    let trail = {}; try { trail = c.data ? JSON.parse(c.data) : {}; } catch (e) {}
    const rb = trail.requestedBy;
    if (!rb) { cbUnmatched++; continue; }
    if (!requesterCache.has(rb)) {
      requesterCache.set(rb, await prisma.user.findFirst({ where: { OR: [{ username: String(rb) }, { id: String(rb) }] }, select: { name: true, role: true } }));
    }
    const u = requesterCache.get(rb);
    if (!u) { cbUnmatched++; continue; }
    await prisma.cashbon.update({ where: { id: c.id }, data: { createdByName: u.name, createdByRole: u.role } });
    cbFilled++;
  }
  const cbSnapAfter = await prisma.cashbon.count({ where: { NOT: { createdByName: null } } });
  console.log(`Cashbon: ${cbTotal} total; snapshot present BEFORE ${cbSnapBefore} → AFTER ${cbSnapAfter}.`);
  console.log(`Cashbon: filled ${cbFilled} from the trail's requestedBy; ${cbUnmatched} unmatched (no/unknown requester) → "—".`);

  // ── Approval ── (only a routing role was recorded → not backfillable)
  const apTotal = await prisma.approval.count();
  const apSnap = await prisma.approval.count({ where: { NOT: { createdByName: null } } });
  console.log(`Approval: ${apTotal} total; ${apSnap} with a creator snapshot; ${apTotal - apSnap} without ` +
    `(legacy rows recorded only a routing role, not a specific submitter → shown as "—"). Not backfillable.`);

  console.log('✅ Backfill complete (idempotent — safe to re-run).');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
