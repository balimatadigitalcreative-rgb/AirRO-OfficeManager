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
    kasbon: false, kasbonApprove: false, manageUsers: true,
    manageBusinessUnits: true,   // owner-tier: add/rename/deactivate business units (Stage 1 labels)
    interUnitTransfer: true,     // owner-tier: record/void inter-unit money movements (Stage 4)
    // Distribusi — each view is its own cap (Pemilik = all).
    distribusiInput: true, distribusiKoreksi: true, distribusiCustomers: true, distribusiHargaMaster: true, distribusiAudit: true,
    distribusiDashboard: true, distribusiCashIntegrasi: true, distribusiGallon: true, distribusiPengiriman: true, distribusiOrder: true, distribusiRute: true, distribusiCustomerDelete: true, distribusiGallonReset: true, distribusiLegacyImport: true, distribusiCustomerImport: true, distribusiVoid: true, distribusiHardDelete: true, distribusiExpense: true,
    // Gudang (warehouse) — view / manage stock / write-off damage / report.
    gudangView: true, gudangKelola: true, gudangDamage: true, gudangReport: true,
    // Split per-action manage caps (gudangKelola above is now only a deprecated alias).
    gudangAddStock: true, gudangKoreksi: true, gudangBuffer: true, gudangItems: true, gudangSupplier: true,
  },
  gm: {
    company: true, cashflow: true, employees: true, empDetail: true, attendance: true, addEntry: true, edit: true,
    delete: true, seeMoney: true, allEntries: true, reports: true, advisor: true,
    payroll: true, approvals: true, settings: true, reset: true, setoran: true, setoranOnly: false,
    kasbon: true, kasbonApprove: true, manageUsers: true,
    manageBusinessUnits: true, interUnitTransfer: true,
    distribusiInput: true, distribusiKoreksi: true, distribusiCustomers: true, distribusiHargaMaster: true, distribusiAudit: true,
    distribusiDashboard: true, distribusiCashIntegrasi: true, distribusiGallon: true, distribusiPengiriman: true, distribusiOrder: true, distribusiRute: true, distribusiCustomerDelete: true, distribusiGallonReset: true, distribusiLegacyImport: true, distribusiCustomerImport: true, distribusiVoid: true, distribusiExpense: true,
    gudangView: true, gudangKelola: true, gudangDamage: true, gudangReport: true,
    // Split per-action manage caps (gudangKelola above is now only a deprecated alias).
    gudangAddStock: true, gudangKoreksi: true, gudangBuffer: true, gudangItems: true, gudangSupplier: true,
  },
  hrd: {
    company: false, cashflow: false, employees: true, empDetail: true, attendance: true, addEntry: false, edit: false,
    delete: false, seeMoney: true, allEntries: false, reports: false, advisor: false,
    payroll: true, approvals: true, settings: false, reset: false, setoran: false, setoranOnly: false,
    kasbon: true, kasbonApprove: true,
    distribusiInput: false, distribusiKoreksi: false, distribusiCustomers: false, distribusiHargaMaster: false, distribusiAudit: false,
  },
  finance: {
    company: false, cashflow: true, employees: false, empDetail: false, attendance: false, addEntry: true, edit: true,
    delete: true, seeMoney: true, allEntries: true, reports: true, advisor: true,
    payroll: true, approvals: true, settings: true, reset: false, setoran: true, setoranOnly: false,
    kasbon: true, kasbonApprove: false,
    distribusiInput: false, distribusiKoreksi: false, distribusiCustomers: false, distribusiHargaMaster: false, distribusiAudit: false,
  },
  adminfin: {
    company: false, cashflow: true, employees: false, empDetail: false, attendance: false, addEntry: false, edit: false,
    delete: false, seeMoney: true, allEntries: true, reports: false, advisor: false,
    payroll: false, approvals: false, settings: false, reset: false, setoran: true, setoranOnly: true,
    kasbon: false, kasbonApprove: false,
    distribusiInput: false, distribusiKoreksi: false, distribusiCustomers: false, distribusiHargaMaster: false, distribusiAudit: false,
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
        const merged = deriveGudangCaps(deriveDistribusiCaps(deriveKasbonCaps({ ...seed, ...cur })));
        await prisma.role.update({ where: { id }, data: { builtin: true, permissions: JSON.stringify(merged) } });
      } else {
        await prisma.role.create({ data: { id, name: meta.name, color: meta.color, permissions: JSON.stringify(deriveGudangCaps(deriveDistribusiCaps(deriveKasbonCaps(seed)))), builtin: true, sortOrder: i } });
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

// Distribusi used to be ONE coarse cap: `distribusi` (input + koreksi + module view
// lumped together). It is now split into `distribusiInput` (create transactions + open
// the module — given to helper staff) and `distribusiKoreksi` (append corrections). For
// backward compatibility every ABSENT split cap is derived from the legacy value, so old
// role rows, per-user overrides, and already-issued tokens keep working: whoever had
// `distribusi` can still BOTH input and correct. Explicit split values are never
// overridden — an admin can turn either action off. `distribusi` is kept as a live alias
// meaning "may open the module" = holds ANY distribusi capability (input/koreksi/
// customers/harga/audit), which is what the module-view routes and nav gate on.
// The module view is now split further into per-view caps: distribusiDashboard,
// distribusiCashIntegrasi, distribusiGallon (alongside input/koreksi/customers/harga/
// audit). Every ABSENT cap is derived from the legacy `distribusi` value, so a user/role
// that had the old combined access keeps ALL views. `distribusi` = "may open the module"
// = holds ANY distribusi capability (used only to show the sidebar group).
function deriveDistribusiCaps(perms) {
  if (!perms || typeof perms !== 'object') return perms;
  const p = { ...perms };
  const legacy = !!p.distribusi;
  if (p.distribusiInput === undefined) p.distribusiInput = legacy;
  if (p.distribusiKoreksi === undefined) p.distribusiKoreksi = legacy;
  if (p.distribusiDashboard === undefined) p.distribusiDashboard = legacy;
  if (p.distribusiCashIntegrasi === undefined) p.distribusiCashIntegrasi = legacy;
  if (p.distribusiGallon === undefined) p.distribusiGallon = legacy;
  if (p.distribusiPengiriman === undefined) p.distribusiPengiriman = legacy;
  if (p.distribusiOrder === undefined) p.distribusiOrder = legacy;
  // Route-ordering + customer-delete derive ONLY from the old combined `distribusi` (so a
  // user who had full distribusi access keeps them) — NOT from distribusiPengiriman/
  // Customers. Safe default: a plain view/run/manage user doesn't silently gain them.
  if (p.distribusiRute === undefined) p.distribusiRute = legacy;
  if (p.distribusiCustomerDelete === undefined) p.distribusiCustomerDelete = legacy;
  // distribusiGallonReset is DESTRUCTIVE (GM-tier): it is NEVER derived from the legacy combined
  // `distribusi` — a plain full-distribusi user must not silently gain it. Only the explicit
  // owner/gm seed (or an admin toggle) grants it.
  if (p.distribusiGallonReset === undefined) p.distribusiGallonReset = false;
  // Legacy import writes archive rows to a customer — a deliberate admin action, so it is never
  // derived from the legacy combined `distribusi` cap either.
  if (p.distribusiLegacyImport === undefined) p.distribusiLegacyImport = false;
  // BULK customer import (spreadsheet) used to ride along on `distribusiCustomers`, which also
  // gates ordinary create/edit. It is higher-risk (hundreds of rows at once), so it now has its
  // own cap — back-filled from distribusiCustomers so nobody loses access on upgrade.
  if (p.distribusiCustomerImport === undefined) p.distribusiCustomerImport = !!p.distribusiCustomers;
  // Field-expense logging is a field-staff action, so it back-fills from the legacy combined
  // `distribusi` cap (a full-distribusi user keeps it) — same as input/koreksi/pengiriman.
  if (p.distribusiExpense === undefined) p.distribusiExpense = legacy;
  p.distribusi = !!(p.distribusiInput || p.distribusiKoreksi || p.distribusiCustomers || p.distribusiHargaMaster
    || p.distribusiAudit || p.distribusiDashboard || p.distribusiCashIntegrasi || p.distribusiGallon
    || p.distribusiPengiriman || p.distribusiOrder || p.distribusiRute || p.distribusiCustomerDelete || p.distribusiGallonReset || p.distribusiLegacyImport || p.distribusiCustomerImport || p.distribusiExpense);
  return p;
}

// Gudang used to hang almost everything off ONE coarse cap: `gudangKelola` (add stock +
// stock corrections + buffer + item create/edit + suppliers + selling damaged gallons). It
// is now split PER-ACTION: gudangAddStock / gudangKoreksi / gudangBuffer / gudangItems /
// gudangSupplier. Exactly like the kasbon + distribusi splits before it, every ABSENT
// granular cap is derived from the legacy value, so old role rows, per-user overrides and
// already-issued JWTs keep working: whoever had `gudangKelola` still does everything.
// Explicit granular values are never overridden — that is how an admin narrows someone down.
// `gudangKelola` survives only as a DEPRECATED live alias ("holds any manage action") so
// stale clients and old tokens don't break; NO endpoint gates on it any more.
function deriveGudangCaps(perms) {
  if (!perms || typeof perms !== 'object') return perms;
  const p = { ...perms };
  const legacy = !!p.gudangKelola;
  if (p.gudangAddStock === undefined) p.gudangAddStock = legacy;
  if (p.gudangKoreksi === undefined) p.gudangKoreksi = legacy;
  if (p.gudangBuffer === undefined) p.gudangBuffer = legacy;
  if (p.gudangItems === undefined) p.gudangItems = legacy;
  if (p.gudangSupplier === undefined) p.gudangSupplier = legacy;
  p.gudangKelola = !!(p.gudangAddStock || p.gudangKoreksi || p.gudangBuffer || p.gudangItems || p.gudangSupplier);
  return p;
}

// Effective capability map for a user: their per-user override if set, otherwise the
// role's current defaults (from the live Role table, falling back to the seed). The
// kasbon granular caps are derived for backward compatibility.
// `manageUsers` is the explicit capability that gates the Pengguna screen + all user/role
// administration (via requireCap, NOT role===). It's a NEW cap, so any per-user override
// saved before it existed omits it — derive an ABSENT value from the legacy `reset` cap
// (which used to double as the "Kelola User" toggle) OR the role's default. This makes an
// upgrade non-disruptive and can never silently drop the only admin. An EXPLICIT per-user
// value (set via the Pengguna toggle) always wins.
function deriveManageUsers(perms, role) {
  if (!perms || typeof perms !== 'object' || perms.manageUsers !== undefined) return perms;
  const rd = rolePerms(role) || {};
  perms.manageUsers = !!(perms.reset || rd.manageUsers);
  return perms;
}

function resolvePerms(role, permsStrOrObj) {
  const override = parsePerms(permsStrOrObj);
  const resolved = deriveGudangCaps(deriveDistribusiCaps(deriveKasbonCaps(override || rolePerms(role) || ROLE_PERMS.finance)));
  return deriveManageUsers(resolved, role);
}

module.exports = { ROLE_PERMS, BUILTIN_META, BUILTIN_IDS, OWNER_ROLE, ROLES, hasPerm, parsePerms, resolvePerms, rolePerms, deriveKasbonCaps, deriveDistribusiCaps, deriveGudangCaps, refreshRoleCache, seedBuiltinRoles };
