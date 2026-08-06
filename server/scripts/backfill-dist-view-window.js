'use strict';
/*
 * One-time backfill for the DISTRIBUSI VIEW-WINDOW (time-restriction) feature.
 *
 * The feature restricts how far back a non-GM user may READ distribusi data. The server already
 * DEFAULTS every non-owner/GM user to "today only" (distribusi.lihat.hari_ini) at resolve time, so
 * the restriction is live even without this script. This script MATERIALIZES that default into each
 * user's stored permissions (so an admin sees the explicit checkbox in Kelola Pengguna) and — most
 * importantly — LOGS what window each user ends up with, so the rollout is auditable.
 *
 * SAFETY / RULES:
 *   1. NEVER widens access. It only ADDS the narrowest cap (hari_ini + sisa_bon) where NO view-window
 *      cap is present; any existing lihat.* choice (7hari / bulan_ini / semua) is left untouched.
 *   2. Owner/GM are skipped entirely — they keep full history (semua).
 *   3. Only users who ALREADY have a per-user permissions override are materialized; pure role-based
 *      users (permissions = null) are left on their role defaults (the derive layer still enforces
 *      hari_ini for them live) so we don't freeze them out of future role changes.
 *   4. Idempotent — re-running changes nothing once every user has an explicit window cap.
 *   5. Prints a per-user report: name · role · resulting window · action taken.
 *
 * Usage (from server/, with the production DATABASE_URL):
 *   node scripts/backfill-dist-view-window.js            # apply
 *   node scripts/backfill-dist-view-window.js --dry-run  # report only, no writes
 */
const prisma = require('../src/lib/prisma');
const { resolvePerms, viewWindowFrom, parsePerms } = require('../src/config/permissions');

const DRY = process.argv.includes('--dry-run');
const VIEW_KEYS = ['distribusi.lihat.hari_ini', 'distribusi.lihat.7hari', 'distribusi.lihat.bulan_ini', 'distribusi.lihat.semua'];
const todayISO = () => new Date().toISOString().slice(0, 10);

(async () => {
  const today = todayISO();
  const users = await prisma.user.findMany({ select: { id: true, name: true, username: true, role: true, permissions: true } });
  let materialized = 0, skippedRole = 0, skippedNoOverride = 0, alreadySet = 0;
  console.log(`\n=== Distribusi view-window backfill (${DRY ? 'DRY-RUN' : 'APPLY'}) · today=${today} · ${users.length} users ===\n`);
  for (const u of users) {
    const resolved = resolvePerms(u.role, u.permissions);
    const win = viewWindowFrom(resolved, today);
    const windowLabel = win.unlimited ? 'SEMUA (all history)' : `${win.from} → ${win.to}` + (win.canSisaBon ? ' +sisaBon' : ' (no sisaBon)');
    // Owner/GM (or anyone already unlimited): never touched.
    if (u.role === 'owner' || u.role === 'gm' || win.unlimited) {
      skippedRole++;
      console.log(`  SKIP  ${u.name} (${u.username}) · ${u.role} · window=${windowLabel} · full-history role`);
      continue;
    }
    const override = parsePerms(u.permissions);
    if (!override) {   // pure role user — leave on role defaults (derive enforces hari_ini live)
      skippedNoOverride++;
      console.log(`  LIVE  ${u.name} (${u.username}) · ${u.role} · window=${windowLabel} · role-default (not frozen)`);
      continue;
    }
    const hasExplicit = VIEW_KEYS.some((k) => override[k] !== undefined);
    if (hasExplicit) {
      alreadySet++;
      console.log(`  KEEP  ${u.name} (${u.username}) · ${u.role} · window=${windowLabel} · explicit cap present`);
      continue;
    }
    // Materialize the narrowest safe default (never widens).
    const next = { ...override, 'distribusi.lihat.hari_ini': true };
    if (next['distribusi.lihat.sisa_bon'] === undefined) next['distribusi.lihat.sisa_bon'] = true;
    if (!DRY) await prisma.user.update({ where: { id: u.id }, data: { permissions: JSON.stringify(next) } });
    materialized++;
    const after = viewWindowFrom(resolvePerms(u.role, JSON.stringify(next)), today);
    console.log(`  SET   ${u.name} (${u.username}) · ${u.role} · window=${after.from} → ${after.to} +sisaBon · hari_ini materialized`);
  }
  console.log(`\n--- Summary ---`);
  console.log(`  materialized hari_ini : ${materialized}`);
  console.log(`  already explicit      : ${alreadySet}`);
  console.log(`  role-default (live)   : ${skippedNoOverride}`);
  console.log(`  full-history (owner/gm/semua): ${skippedRole}`);
  console.log(DRY ? '\n(DRY-RUN — no changes written)\n' : '\nDone.\n');
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
