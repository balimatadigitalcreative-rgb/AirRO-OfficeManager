'use strict';

// Built-in role capability matrix — the SEED for the editable Role table (roles are
// now data, managed via /roles). Mirrors ROLES[...].perms in finance-store.js and
// carries the complete capability set the UI + API check. These seed the DB on
// first run; after that the live values come from the Role table (roleCache below).
const ROLE_PERMS = {
  owner: {
    company: true, cashflow: true, employees: false, empDetail: false, attendance: false, addEntry: false, edit: false,
    delete: false, seeMoney: true, allEntries: false, reports: true, advisor: false,
    payroll: false, approvals: false, settings: false, reset: false, setoran: false, setoranOnly: false,
    kasbon: false, kasbonApprove: false,
    // Distribusi (Pemilik = all four)
    distribusi: true, distribusiCustomers: true, distribusiHargaMaster: true, distribusiAudit: true,
  },
  gm: {
    company: true, cashflow: true, employees: true, empDetail: true, attendance: true, addEntry: true, edit: true,
    delete: true, seeMoney: true, allEntries: true, reports: true, advisor: true,
    payroll: true, approvals: true, settings: true, reset: true, setoran: true, setoranOnly: false,
    kasbon: true, kasbonApprove: true,
    distribusi: true, distribusiCustomers: true, distribusiHargaMaster: true, distribusiAudit: true,
  },
  hrd: {
    company: false, cashflow: false, employees: true, empDetail: true, attendance: true, addEntry: false, edit: false,
    delete: false, seeMoney: true, allEntries: false, reports: false, advisor: false,
    payroll: true, approvals: true, settings: false, reset: false, setoran: false, setoranOnly: false,
    kasbon: true, kasbonApprove: true,
    distribusi: false, distribusiCustomers: false, distribusiHargaMaster: false, distribusiAudit: false,
  },
  finance: {
    company: false, cashflow: true, employees: false, empDetail: false, attendance: false, addEntry: true, edit: true,
    delete: true, seeMoney: true, allEntries: true, reports: true, advisor: true,
    payroll: true, approvals: true, settings: true, reset: false, setoran: true, setoranOnly: false,
    kasbon: true, kasbonApprove: false,
    distribusi: false, distribusiCustomers: false, distribusiHargaMaster: false, distribusiAudit: false,
  },
  adminfin: {
    company: false, cashflow: true, employees: false, empDetail: false, attendance: false, addEntry: false, edit: false,
    delete: false, seeMoney: true, allEntries: true, reports: false, advisor: false,
    payroll: false, approvals: false, settings: false, reset: false, setoran: true, setoranOnly: true,
    kasbon: false, kasbonApprove: false,
    distribusi: false, distribusiCustomers: false, distribusiHargaMaster: false, distribusiAudit: false,
  },
};
// Display metadata used when seeding the built-in roles into the Role table.
const BUILTIN_META = {
  owner:   { name: 'Owner',           color: '#065489' },
  gm:      { name: 'General Manager', color: '#0B7EB1' },
  hrd:     { name: 'HRD',             color: '#138FB3' },
  finance: { name: 'Finance',         color: '#22A7A1' },
  adminfin:{ name: 'Admin Finance',   color: '#3FB8B2' },
};
const BUILTIN_IDS = Object.keys(ROLE_PERMS);
const OWNER_ROLE = 'owner';   // the always-present, never-deletable admin role

const ROLES = BUILTIN_IDS;   // legacy export (built-in ids); dynamic ids live in the Role table

// Live role→perms cache, loaded from the Role table. Null until first load; every
// resolvePerms falls back to the hard-coded seed while cold, so auth never breaks.
let roleCache = null;
async function refreshRoleCache() {
  try {
    const prisma = require('../lib/prisma');
    const rows = await prisma.role.findMany();
    const map = {};
    rows.forEach((r) => { map[r.id] = parsePerms(r.permissions) || {}; });
    roleCache = map;
  } catch (e) { /* keep whatever we had; hard-coded fallback still applies */ }
  return roleCache;
}
// Ensure the built-in roles exist in the Role table (idempotent). Run at startup so
// upgrades of an existing DB get seeded, then refresh the cache.
async function seedBuiltinRoles() {
  try {
    const prisma = require('../lib/prisma');
    for (let i = 0; i < BUILTIN_IDS.length; i++) {
      const id = BUILTIN_IDS[i];
      const meta = BUILTIN_META[id] || { name: id, color: '#22A7A1' };
      const seed = ROLE_PERMS[id];
      const existing = await prisma.role.findUnique({ where: { id } });
      if (existing) {
        // Preserve admin edits, but ADD any NEW seed capabilities the stored role is
        // missing (e.g. the distribusi caps on an already-seeded DB). Existing values
        // win; only absent keys are filled — so an admin's on/off choices are kept.
        // Then materialize the split kasbon caps from the (merged) legacy value so the
        // Role editor shows them as explicit checkboxes, consistent with old behaviour.
        const cur = parsePerms(existing.permissions) || {};
        const merged = deriveKasbonCaps({ ...seed, ...cur });
        await prisma.role.update({ where: { id }, data: { builtin: true, permissions: JSON.stringify(merged) } });
      } else {
        await prisma.role.create({ data: { id, name: meta.name, color: meta.color, permissions: JSON.stringify(deriveKasbonCaps(seed)), builtin: true, sortOrder: i } });
      }
    }
  } catch (e) { /* table may not exist yet on very first migrate; ignored */ }
  return refreshRoleCache();
}

function rolePerms(role) {
  return (roleCache && roleCache[role]) || ROLE_PERMS[role] || null;
}
function hasPerm(role, perm) {
  const p = rolePerms(role);
  return !!(p && p[perm]);
}

// Parse a stored permissions JSON string into an object (or null on absent/bad).
function parsePerms(str) {
  if (!str) return null;
  if (typeof str === 'object') return str;
  try {
    const o = JSON.parse(str);
    return o && typeof o === 'object' ? o : null;
  } catch (e) {
    return null;
  }
}

// Kasbon capabilities used to be TWO coarse caps: `kasbon` (request) and
// `kasbonApprove` (approve + reject + update + delete lumped together). They are now
// split PER-ACTION: kasbonRequest / kasbonApprove / kasbonReject / kasbonCancel /
// kasbonDelete. For backward compatibility every ABSENT granular cap is derived from
// the legacy pair, so old role rows, per-user overrides, and already-issued tokens all
// keep working: whoever had `kasbonApprove` can still approve/reject/cancel/delete,
// whoever had `kasbon` can still request. Explicit granular values are never
// overridden — an admin can turn any single action off. `kasbon` is kept as a live
// alias of `kasbonRequest` so legacy checks (nav gating, etc.) stay correct.
function deriveKasbonCaps(perms) {
  if (!perms || typeof perms !== 'object') return perms;
  const p = { ...perms };
  const legacyApprove = !!p.kasbonApprove;
  if (p.kasbonRequest === undefined) p.kasbonRequest = !!p.kasbon;
  if (p.kasbonReject === undefined) p.kasbonReject = legacyApprove;
  if (p.kasbonCancel === undefined) p.kasbonCancel = legacyApprove;
  if (p.kasbonDelete === undefined) p.kasbonDelete = legacyApprove;
  p.kasbon = !!p.kasbonRequest;   // legacy alias, always mirrors the request cap
  return p;
}

// Effective capability map for a user: their per-user override if set, otherwise the
// role's current defaults (from the live Role table, falling back to the seed). The
// kasbon granular caps are derived for backward compatibility.
function resolvePerms(role, permsStrOrObj) {
  const override = parsePerms(permsStrOrObj);
  return deriveKasbonCaps(override || rolePerms(role) || ROLE_PERMS.finance);
}

module.exports = { ROLE_PERMS, BUILTIN_META, BUILTIN_IDS, OWNER_ROLE, ROLES, hasPerm, parsePerms, resolvePerms, rolePerms, deriveKasbonCaps, refreshRoleCache, seedBuiltinRoles };
