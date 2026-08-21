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
    distribusiDashboard: true, distribusiCashIntegrasi: true, distribusiGallon: true, distribusiPengiriman: true, distribusiOrder: true, distribusiRute: true, distribusiCustomerDelete: true, distribusiGallonReset: true, distribusiLegacyImport: true, distribusiCustomerImport: true, distribusiVoid: true, distribusiHardDelete: true, distribusiExpense: true, distribusiDashHistory: true, distribusiPengirimanReport: true, distribusiBonAdjust: true, distribusiPenyesuaianGalon: true, distribusiPenyesuaianBon: true, distribusiApprove: true,
    // View-window (time-restriction): Pemilik sees all history + Sisa Bon.
    'distribusi.lihat.semua': true, 'distribusi.lihat.sisa_bon': true, 'distribusi.lihat.hari_ini': true, 'distribusi.transaksi.hapus': true,
    'distribusi.galon.reset_total': true,   // OWNER ONLY — clean-slate reset of the whole gallon ledger
    // Gudang (warehouse) — view / manage stock / write-off damage / report.
    gudangView: true, gudangDamage: true, gudangReport: true,
    // Split per-action manage caps (the old gudangKelola alias is retired — see deriveGudangCaps).
    gudangAddStock: true, gudangKoreksi: true, gudangBuffer: true, gudangItems: true, gudangSupplier: true,
    // Gallon stock (Stok Galon page lives under GUDANG) — its OWN gudang* caps, not distribusi.
    gudangGalonView: true, gudangGalonKoreksi: true, gudangGalonOpname: true, gudangGalonReset: true, gudangGalonHardDelete: true, 'gudang.galon.reset_total': true,
  },
  gm: {
    company: true, cashflow: true, employees: true, empDetail: true, attendance: true, addEntry: true, edit: true,
    delete: true, seeMoney: true, allEntries: true, reports: true, advisor: true,
    payroll: true, approvals: true, settings: true, reset: true, setoran: true, setoranOnly: false,
    kasbon: true, kasbonApprove: true, manageUsers: true,
    manageBusinessUnits: true, interUnitTransfer: true,
    distribusiInput: true, distribusiKoreksi: true, distribusiCustomers: true, distribusiHargaMaster: true, distribusiAudit: true,
    distribusiDashboard: true, distribusiCashIntegrasi: true, distribusiGallon: true, distribusiPengiriman: true, distribusiOrder: true, distribusiRute: true, distribusiCustomerDelete: true, distribusiGallonReset: true, distribusiLegacyImport: true, distribusiCustomerImport: true, distribusiVoid: true, distribusiExpense: true, distribusiDashHistory: true, distribusiPengirimanReport: true, distribusiBonAdjust: true, distribusiPenyesuaianGalon: true, distribusiPenyesuaianBon: true, distribusiApprove: true,
    'distribusi.lihat.semua': true, 'distribusi.lihat.sisa_bon': true, 'distribusi.lihat.hari_ini': true, 'distribusi.transaksi.hapus': true,
    gudangView: true, gudangDamage: true, gudangReport: true,
    gudangAddStock: true, gudangKoreksi: true, gudangBuffer: true, gudangItems: true, gudangSupplier: true,
    // Gallon stock — GM manages + resets, but NOT owner-tier hard-delete / total-reset.
    gudangGalonView: true, gudangGalonKoreksi: true, gudangGalonOpname: true, gudangGalonReset: true,
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
        const merged = derivePayrollCaps(deriveGudangGalonCaps(deriveGudangCaps(deriveDistribusiCaps(deriveKasbonCaps({ ...seed, ...cur }), id)), id), id);
        await prisma.role.update({ where: { id }, data: { builtin: true, permissions: JSON.stringify(merged) } });
      } else {
        await prisma.role.create({ data: { id, name: meta.name, color: meta.color, permissions: JSON.stringify(derivePayrollCaps(deriveGudangGalonCaps(deriveGudangCaps(deriveDistribusiCaps(deriveKasbonCaps(seed), id)), id), id)), builtin: true, sortOrder: i } });
      }
    }
  } catch (e) { /* table may not exist yet on very first migrate; ignored */ }
  return refreshRoleCache();
}

// The single definition of "owner-tier" — the ONLY role that may grant owner-only capabilities
// (distribusiApproveSelf) or assign the owner role itself. Used by the server guards AND the
// promote-owner CLI so there is one source of truth. A deployment with zero active owner-role users
// has NO account able to grant owner-only caps → recover with scripts/promote-owner.js.
function isOwnerRole(role) { return role === OWNER_ROLE; }

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
function deriveDistribusiCaps(perms, role) {
  if (!perms || typeof perms !== 'object') return perms;
  const p = { ...perms };
  const legacy = !!p.distribusi;
  // Owner/GM hold every distribusi capability by default. The owner/GM-tier caps below are NEVER
  // derived from the legacy combined `distribusi` flag, so for a plain user an absent value means
  // false — but for an OWNER/GM an absent value must mean TRUE, or a cap added AFTER their account's
  // permissions blob was stored (a per-user override, or a custom role snapshot) silently vanishes.
  // This is exactly why the approval UI didn't show: existing owner/GM accounts had distribusiApprove
  // undefined → false, so the Pengajuan block never rendered. Default those caps by role here.
  const isOwnerGm = role === 'owner' || role === 'gm';
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
  // History access (view earlier dashboard periods) and the delivery report are OWNER/GM-tier
  // reporting caps — NEVER derived from the legacy combined `distribusi` (a plain field user must
  // not silently gain them). Only the explicit owner/gm seed or an admin toggle grants them.
  // Owner/GM-tier reporting + approval caps: default TRUE for owner/GM, FALSE for everyone else
  // (never derived from the legacy `distribusi` flag — a plain field user must not silently gain them,
  // but an owner/GM must never LOSE them just because their stored blob predates the cap).
  if (p.distribusiDashHistory === undefined) p.distribusiDashHistory = isOwnerGm;
  if (p.distribusiPengirimanReport === undefined) p.distribusiPengirimanReport = isOwnerGm;
  if (p.distribusiBonAdjust === undefined) p.distribusiBonAdjust = isOwnerGm;
  // Creating balance ADJUSTMENTS (penyesuaian). The old SINGLE cap `distribusiPenyesuaian` covered BOTH
  // gallon and bon, which forced handing helper staff the power to alter customer DEBT just to correct
  // gallon counts. It is now SPLIT per kind:
  //   • distribusiPenyesuaianGalon — adjust gallons held (routine, physically verifiable field work);
  //   • distribusiPenyesuaianBon   — adjust outstanding bon (changes money owed, NOT verifiable after
  //     the fact) — destructive/owner tier.
  // MIGRATION (mirrors the gudang* rename): every ABSENT new cap is DERIVED from the legacy combined
  // value, so anyone who held it keeps BOTH and nobody is widened. Explicit new values always win. The
  // old name survives as a READ-ONLY alias ("holds either kind") for one release so stale tokens/clients
  // and the module-open OR keep working; NO endpoint gates on it any more.
  if (p.distribusiPenyesuaian === undefined) p.distribusiPenyesuaian = isOwnerGm;   // legacy default (owner/GM)
  const legacyPeny = !!p.distribusiPenyesuaian;
  if (p.distribusiPenyesuaianGalon === undefined) p.distribusiPenyesuaianGalon = legacyPeny;
  if (p.distribusiPenyesuaianBon === undefined) p.distribusiPenyesuaianBon = legacyPeny;
  p.distribusiPenyesuaian = !!(p.distribusiPenyesuaianGalon || p.distribusiPenyesuaianBon);   // read-only alias
  // Approving correction/void requests: a plain input/koreksi user may REQUEST a change but must never
  // gain approval by derivation (least-privilege) — yet owner/GM get it by default.
  if (p.distribusiApprove === undefined) p.distribusiApprove = isOwnerGm;
  // SELF-APPROVAL — lifts the "you cannot approve your own submission" segregation rule (correction/
  // void + disputes). Deliberately NEVER defaulted true, not even for owner/GM: it is a conscious
  // waiver the owner grants per-user, so an absent value is ALWAYS false. It does NOT grant approval by
  // itself — the holder still needs distribusiApprove. Owner-only to grant (enforced in user.service).
  if (p.distribusiApproveSelf === undefined) p.distribusiApproveSelf = false;
  // maxSelfApproveAmount (a rupiah ceiling carried in the blob like maxLookbackDays; absent/0 =
  // unlimited) is NOT a boolean cap — it rides through untouched and is read by actorSnap.
  // BULK permanent deletion of transactions (owner/GM tier) — irreversible except by owner restore
  // from the audit snapshot; never derived from the legacy flag.
  if (p['distribusi.transaksi.hapus'] === undefined) p['distribusi.transaksi.hapus'] = isOwnerGm;
  // Reset Total Stok Galon is OWNER-ONLY — never derived for GM or any custom role.
  if (p['distribusi.galon.reset_total'] === undefined) p['distribusi.galon.reset_total'] = (role === 'owner');
  // ── VIEW-WINDOW (time-restriction) caps — govern how far back a user may READ distribusi data
  // (list, dashboard, customer history, reports, exports, search). SERVER-ENFORCED in
  // resolveViewWindow(); the UI only hides what these forbid. Owner/GM see all history (`semua`).
  // Everyone else defaults to TODAY ONLY (`hari_ini`), plus `sisa_bon` so collectors still see the
  // outstanding balance to chase — an admin then WIDENS them (7hari / bulan_ini / semua) explicitly.
  // Widening is NEVER derived from the legacy `distribusi` flag (that would silently grant history);
  // only the safe baseline (hari_ini + sisa_bon) and owner/GM `semua` are defaulted here.
  if (p['distribusi.lihat.semua'] === undefined) p['distribusi.lihat.semua'] = isOwnerGm;
  if (p['distribusi.lihat.bulan_ini'] === undefined) p['distribusi.lihat.bulan_ini'] = false;
  if (p['distribusi.lihat.7hari'] === undefined) p['distribusi.lihat.7hari'] = false;
  if (p['distribusi.lihat.hari_ini'] === undefined) p['distribusi.lihat.hari_ini'] = true;
  if (p['distribusi.lihat.sisa_bon'] === undefined) p['distribusi.lihat.sisa_bon'] = true;
  p.distribusi = !!(p.distribusiInput || p.distribusiKoreksi || p.distribusiCustomers || p.distribusiHargaMaster
    || p.distribusiAudit || p.distribusiDashboard || p.distribusiCashIntegrasi || p.distribusiGallon
    || p.distribusiPengiriman || p.distribusiOrder || p.distribusiRute || p.distribusiCustomerDelete || p.distribusiGallonReset || p.distribusiLegacyImport || p.distribusiCustomerImport || p.distribusiExpense || p.distribusiPengirimanReport || p.distribusiBonAdjust || p.distribusiPenyesuaian || p.distribusiApprove);
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
  const legacy = !!p.gudangKelola;   // BACKFILL ONLY (one release): old blobs may still carry it
  if (p.gudangAddStock === undefined) p.gudangAddStock = legacy;
  if (p.gudangKoreksi === undefined) p.gudangKoreksi = legacy;
  if (p.gudangBuffer === undefined) p.gudangBuffer = legacy;
  if (p.gudangItems === undefined) p.gudangItems = legacy;
  if (p.gudangSupplier === undefined) p.gudangSupplier = legacy;
  // gudangKelola is RETIRED: no route gates on it and it is no longer re-exposed as a live alias.
  // The backfill above still materialises the split caps from any stored gudangKelola for one release.
  delete p.gudangKelola;
  return p;
}

// GALLON STOCK capabilities live in the GUDANG namespace because the user SEES "Stok Galon" under the
// Gudang section — even though the ledger CODE lives in the distribusi service. Each new cap is derived
// from the OLD distribusi* gate so nobody's VIEW/RESET access changes on upgrade (the derive runs per
// request in requireCap, so in-flight sessions keep working with no re-login).
//   ┌── ACCESS-CONTROL FIX ─────────────────────────────────────────────────────────────────────────┐
//   │ gudangGalonKoreksi / gudangGalonOpname are NOT derived from distribusiCustomers — a CUSTOMER    │
//   │ capability must never grant a WAREHOUSE write. Owner/GM keep them by role default; everyone     │
//   │ else must be granted them EXPLICITLY. This intentionally NARROWS distribusiCustomers-only users │
//   │ (a fix, not a widening).                                                                        │
//   └────────────────────────────────────────────────────────────────────────────────────────────────┘
//   BOUNDARY (do NOT "fix" later): gallon movements produced BY a delivery are owned by the
//   DistTransaction (distribusi) and are gated by the transaction's caps — never by these gudang caps.
function deriveGudangGalonCaps(perms, role) {
  if (!perms || typeof perms !== 'object') return perms;
  const p = { ...perms };
  const isOwnerGm = role === 'owner' || role === 'gm';
  if (p.gudangGalonView === undefined) p.gudangGalonView = !!p.distribusiGallon;              // preserve viewers
  if (p.gudangGalonKoreksi === undefined) p.gudangGalonKoreksi = isOwnerGm;                   // NOT from distribusiCustomers (the defect)
  if (p.gudangGalonOpname === undefined) p.gudangGalonOpname = isOwnerGm;                     // NOT from distribusiCustomers
  if (p.gudangGalonReset === undefined) p.gudangGalonReset = !!p.distribusiGallonReset;       // GM-tier; destructive-false for others
  if (p.gudangGalonHardDelete === undefined) p.gudangGalonHardDelete = !!p.distribusiHardDelete;         // owner-tier
  if (p['gudang.galon.reset_total'] === undefined) p['gudang.galon.reset_total'] = !!p['distribusi.galon.reset_total'];   // owner-only
  return p;
}

// PAYROLL caps (SDM) — payroll figures are sensitive, so viewing/editing/approving each have their own
// capability. Owner/GM get all three by default; everyone else defaults FALSE (never derived from a
// broader cap), even on already-stored blobs. sdmPayrollKelola/Setujui imply the view.
function derivePayrollCaps(perms, role) {
  if (!perms || typeof perms !== 'object') return perms;
  const p = { ...perms };
  const isOwnerGm = role === 'owner' || role === 'gm';
  if (p.sdmPayrollLihat === undefined) p.sdmPayrollLihat = isOwnerGm;
  if (p.sdmPayrollKelola === undefined) p.sdmPayrollKelola = isOwnerGm;
  if (p.sdmPayrollSetujui === undefined) p.sdmPayrollSetujui = isOwnerGm;
  if (p.sdmPayrollKelola || p.sdmPayrollSetujui) p.sdmPayrollLihat = true;   // manage/approve implies view
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
  // Order matters: distribusi caps first (they seed distribusiGallon/Reset), THEN the gudang gallon
  // caps derive from them. Runs on EVERY request → in-flight tokens get the new caps with no re-login.
  const resolved = derivePayrollCaps(deriveGudangGalonCaps(deriveGudangCaps(deriveDistribusiCaps(deriveKasbonCaps(override || rolePerms(role) || ROLE_PERMS.finance), role)), role), role);
  return deriveManageUsers(resolved, role);
}

// ── VIEW-WINDOW math (pure; no DB) ───────────────────────────────────────────
// The assignable view-window capability keys, widest → narrowest.
const VIEW_CAPS = { all: 'distribusi.lihat.semua', month: 'distribusi.lihat.bulan_ini', week: 'distribusi.lihat.7hari', today: 'distribusi.lihat.hari_ini', sisaBon: 'distribusi.lihat.sisa_bon' };
function addDaysISO(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Resolve a caller's allowed READ window from a RESOLVED perms object + today (YYYY-MM-DD).
// Returns { unlimited, from (earliest allowed date, null if unlimited), to (today), canSisaBon,
// canAll }. `maxLookbackDays` (an integer stored inside the permissions blob) widens a restricted
// user by an exact number of days — whichever source grants the EARLIEST start wins.
function viewWindowFrom(perms, today) {
  const p = perms || {};
  const unlimited = !!p[VIEW_CAPS.all];
  if (unlimited) return { unlimited: true, from: null, to: today, canSisaBon: true, canAll: true };
  let from = today;                       // hari_ini baseline
  const earlier = (d) => { if (d && d < from) from = d; };
  if (p[VIEW_CAPS.week]) earlier(addDaysISO(today, -6));
  if (p[VIEW_CAPS.month]) earlier(today.slice(0, 8) + '01');
  const mlb = parseInt(p.maxLookbackDays, 10);
  if (Number.isFinite(mlb) && mlb > 0) earlier(addDaysISO(today, -mlb));
  return { unlimited: false, from, to: today, canSisaBon: !!p[VIEW_CAPS.sisaBon], canAll: false };
}

module.exports = { ROLE_PERMS, BUILTIN_META, BUILTIN_IDS, OWNER_ROLE, ROLES, hasPerm, parsePerms, resolvePerms, rolePerms, isOwnerRole, deriveKasbonCaps, deriveDistribusiCaps, deriveGudangCaps, deriveGudangGalonCaps, refreshRoleCache, seedBuiltinRoles, VIEW_CAPS, viewWindowFrom, addDaysISO };
