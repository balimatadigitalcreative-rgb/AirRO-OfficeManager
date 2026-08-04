'use strict';
// Business unit (unit bisnis) — STAGE 1: an editable dictionary of LABELS on one company.
// Core records (Entry/Account/Employee/Setoran) carry a nullable businessUnitId; existing rows
// are backfilled to "Air" and null is treated as "Air" everywhere. Nothing is filtered or split
// by unit yet — this stage only stores the label. See the migration for the backfill.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

// Fixed seed ids — MUST match the ids the migration inserted, so app-level seeding stays
// idempotent (never a duplicate) and the "Air" default keeps the same id across environments.
const DEFAULT_UNIT_ID = 'air';
// `officeCode` is the NIP <OFFICE> prefix for staff placed in this unit (see BusinessUnit.officeCode).
// It is DISTINCT from `code` (a display chip): AIR/U3 are labels, AIRRO/NSN are NIP prefixes.
const SEED_UNITS = [
  { id: 'air', name: 'Air', code: 'AIR', officeCode: 'AIRRO', sortOrder: 0 },
  { id: 'manufaktur', name: 'Manufaktur', code: 'MFG', officeCode: 'MFG', sortOrder: 1 },
  { id: 'unit3', name: 'Unit Bisnis 3', code: 'U3', officeCode: 'NSN', sortOrder: 2 },   // placeholder — owner renames later
];
// The valid NIP office prefixes. Mirrors employee.service OFFICES (kept here to avoid a cycle).
const OFFICE_CODES = ['AIRRO', 'NSN', 'MFG'];
const DEFAULT_OFFICE = 'AIRRO';
// The core records that carry the label. Adding a table here later is all it takes to widen
// the backfill; the delegate name is the Prisma model accessor.
const LABELLED_MODELS = ['entry', 'account', 'employee', 'setoran'];

// ── PER-UNIT MODULE TOGGLE ────────────────────────────────────────────────────
// The fixed registry of toggleable app modules, keyed by the nav groups already in use. Overview,
// company, settings, users and business-unit management are NOT modules — they are always available
// (so a unit can never be made unmanageable and the owner is never locked out). Adding a new module
// is: add its key here + tag its nav group + gate its endpoints.
const MODULES = ['finance', 'hr', 'distribusi', 'gudang'];

// Parse a unit's stored enabledModules ("all" | JSON array) → null (= every module) or a clean array.
function parseEnabledModules(str) {
  if (str == null || str === 'all' || str === '') return null;
  try { const a = JSON.parse(str); if (Array.isArray(a)) return a.filter((m) => MODULES.includes(m)); if (a === 'all') return null; } catch (e) {}
  return null;   // unrecognised → treat as ALL enabled (never silently disable a module)
}
// Store form: 'all' | array-of-known-keys → the string persisted on the column.
function serializeEnabledModules(v) {
  if (v === 'all' || v == null) return 'all';
  const arr = (Array.isArray(v) ? v : []).filter((m) => MODULES.includes(m));
  // A unit with EVERY module enabled is stored as 'all' (canonical) so the default and an explicit
  // full selection are indistinguishable.
  return arr.length >= MODULES.length ? 'all' : JSON.stringify(arr);
}
// Is `moduleKey` enabled given a unit's stored enabledModules value? null/all/unknown → true.
function moduleEnabledFor(enabledModulesStr, moduleKey) {
  const arr = parseEnabledModules(enabledModulesStr);
  return arr === null ? true : arr.includes(moduleKey);
}
// Load a unit and report whether `moduleKey` is enabled for it (default true for an unknown unit, so
// a missing/blank unit never over-restricts). Used by the server enforcement in the write paths.
async function isModuleEnabled(unitId, moduleKey) {
  const id = unitId || DEFAULT_UNIT_ID;
  const u = await prisma.businessUnit.findUnique({ where: { id: String(id) }, select: { enabledModules: true } });
  return u ? moduleEnabledFor(u.enabledModules, moduleKey) : true;
}
// Assert a module is enabled for a unit; 403 otherwise. Server-side enforcement of the toggle so a
// disabled module can't be written to even by a crafted request (not just hidden in the nav).
async function assertModuleEnabled(unitId, moduleKey) {
  if (!(await isModuleEnabled(unitId, moduleKey))) {
    throw ApiError.forbidden('Modul ini tidak aktif untuk unit bisnis terkait.');
  }
}

// FULL-ACCESS BYPASS for WRITES — mirrors the client: a user with all-unit access (unitScope 'all'
// → null) is never blocked by module toggles; the per-target-unit check applies only to unit-scoped
// users. So an owner/GM keeps full use of every capability regardless of how units are configured.
async function assertModuleEnabledForUser(user, unitId, moduleKey) {
  const { unitScopeOf } = require('../lib/scope');
  if (unitScopeOf(user) === null) return;   // full access → toggles never block them
  await assertModuleEnabled(unitId, moduleKey);
}

// SINGLE SOURCE OF TRUTH for whole-module availability (distribusi/gudang — the "air-mapped" modules
// with no per-row unit). A module is AVAILABLE to a user if it is enabled for ANY unit that user can
// access — exactly the UNION the client nav uses (activeModules), so the nav gate and this server
// gate never disagree. Default-on: a unit whose enabledModules is null/'all' counts as enabled, and
// a user with no matching unit is never over-restricted. `unitScopeOf` is required lazily to avoid a
// load-order cycle (scope.js ← auth.js ← this module's consumers).
async function moduleEnabledForAnyAccessible(user, moduleKey) {
  const { unitScopeOf } = require('../lib/scope');
  const scope = unitScopeOf(user);   // null = full access (every unit)
  if (scope === null) return true;   // FULL-ACCESS BYPASS — owner/GM are never blocked by toggles
  const units = await prisma.businessUnit.findMany({ select: { id: true, enabledModules: true } });
  const pool = units.filter((u) => scope.includes(u.id));
  const effective = pool.length ? pool : units;   // scoped user with no matching unit → don't over-restrict
  if (!effective.length) return true;              // no units at all → default-on
  return effective.some((u) => moduleEnabledFor(u.enabledModules, moduleKey));
}

// Ensure the seed units exist (idempotent — create-if-absent by fixed id). Safe on every boot.
async function seedBusinessUnits() {
  try {
    for (const u of SEED_UNITS) {
      const existing = await prisma.businessUnit.findUnique({ where: { id: u.id } });
      if (!existing) await prisma.businessUnit.create({ data: { ...u, active: true } });
    }
  } catch (e) { /* table may not exist yet on a very first migrate; ignored */ }
}

// One-time backfill of any row still missing a unit → "Air". Idempotent: only touches nulls,
// so it is a no-op after the migration already ran (and covers rows created by an older build
// between deploy and migrate). Returns a per-model count of rows it set, for logging/verify.
async function backfillBusinessUnit() {
  const filled = {};
  try {
    for (const m of LABELLED_MODELS) {
      const r = await prisma[m].updateMany({ where: { businessUnitId: null }, data: { businessUnitId: DEFAULT_UNIT_ID } });
      if (r.count) filled[m] = r.count;
    }
  } catch (e) { /* table/column may not exist yet on first migrate; ignored */ }
  return filled;
}

// Resolve a unit id to a REAL, existing unit id — or fall back to the default "Air". Used
// when stamping a record's placement so an unknown/blank id can never orphan a row (mirrors
// distribution.validTypeId). Returns 'air' for null/blank/unknown.
async function resolveUnitId(id) {
  if (!id) return DEFAULT_UNIT_ID;
  const u = await prisma.businessUnit.findUnique({ where: { id: String(id) } });
  return u ? u.id : DEFAULT_UNIT_ID;
}

// The NIP office prefix for a unit id. Single source of truth for the unit → office derivation:
// employees no longer choose "Posisi kantor", it is read from their business unit. Unknown/blank
// unit, or a unit whose officeCode was cleared → the AIRRO default, so a NIP can always be issued.
async function officeCodeFor(unitId) {
  const id = unitId || DEFAULT_UNIT_ID;
  const u = await prisma.businessUnit.findUnique({ where: { id: String(id) } });
  const code = u && u.officeCode ? String(u.officeCode).trim().toUpperCase() : '';
  return OFFICE_CODES.includes(code) ? code : DEFAULT_OFFICE;
}

// Report (NEVER rewrite) employees whose stored `office` disagrees with the office implied by their
// business unit. Since "Posisi kantor" was removed from the form, office is derived going forward —
// but for EXISTING staff the stored office is the source of truth for the NIP they already carry, so
// silently "fixing" either field would change what a historical NIP means. We surface the list for
// the owner to review; a deliberate edit (or Regenerasi NIP) is what resolves it.
async function auditOfficeUnitMismatch() {
  const out = [];
  try {
    const units = await prisma.businessUnit.findMany();
    const officeOf = {}; units.forEach((u) => { officeOf[u.id] = OFFICE_CODES.includes(String(u.officeCode || '').toUpperCase()) ? String(u.officeCode).toUpperCase() : DEFAULT_OFFICE; });
    const rows = await prisma.employee.findMany({ select: { id: true, name: true, nip: true, office: true, businessUnitId: true } });
    rows.forEach((e) => {
      const expected = officeOf[e.businessUnitId || DEFAULT_UNIT_ID] || DEFAULT_OFFICE;
      const actual = e.office || DEFAULT_OFFICE;
      if (actual !== expected) out.push({ id: e.id, name: e.name, nip: e.nip || null, unit: e.businessUnitId || DEFAULT_UNIT_ID, office: actual, expected });
    });
  } catch (e) { /* table/column may not exist yet on a very first migrate; ignored */ }
  return out;
}

// Shape a unit row for the API: enabledModules returned parsed ('all' | array of module keys) so the
// client can intersect the nav without re-parsing the stored string.
function shapeUnit(u) {
  const arr = parseEnabledModules(u.enabledModules);
  return { ...u, enabledModules: arr === null ? 'all' : arr };
}

async function listUnits(includeInactive = true) {
  const data = await prisma.businessUnit.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return (includeInactive ? data : data.filter((u) => u.active)).map(shapeUnit);
}

async function createUnit(body) {
  const name = String(body.name || '').trim();
  if (!name) throw ApiError.badRequest('Nama unit bisnis tidak boleh kosong.');
  const code = String(body.code || '').trim().toUpperCase().slice(0, 12);
  const all = await prisma.businessUnit.findMany();
  if (all.some((u) => u.name.toLowerCase() === name.toLowerCase())) throw ApiError.badRequest(`Unit "${name}" sudah ada.`);
  const officeCode = OFFICE_CODES.includes(String(body.officeCode || '').toUpperCase()) ? String(body.officeCode).toUpperCase() : DEFAULT_OFFICE;
  return prisma.businessUnit.create({ data: { name, code, officeCode, sortOrder: all.length, active: true } });
}

async function updateUnit(id, body) {
  const cur = await prisma.businessUnit.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Unit bisnis tidak ditemukan');
  const data = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw ApiError.badRequest('Nama unit bisnis tidak boleh kosong.');
    const all = await prisma.businessUnit.findMany();
    if (all.some((u) => u.id !== id && u.name.toLowerCase() === name.toLowerCase())) throw ApiError.badRequest(`Unit "${name}" sudah ada.`);
    data.name = name;   // records keep the same unit id → rename is safe, changes no numbers
  }
  if (body.code !== undefined) data.code = String(body.code || '').trim().toUpperCase().slice(0, 12);
  // NIP prefix for this unit — owner-editable so a new unit can get its own. Changing it affects
  // only NEWLY generated NIPs; existing employee NIPs are historical identifiers and never rewritten.
  if (body.officeCode !== undefined) {
    const oc = String(body.officeCode || '').trim().toUpperCase();
    if (!OFFICE_CODES.includes(oc)) throw ApiError.badRequest(`Kode kantor NIP harus salah satu dari: ${OFFICE_CODES.join(', ')}.`);
    data.officeCode = oc;
  }
  if (body.active !== undefined) {
    // Deactivate, never delete — a unit may already label historical rows. The default "Air"
    // unit must always stay active so null-as-Air always resolves to a live unit.
    if (body.active === false && id === DEFAULT_UNIT_ID) throw ApiError.badRequest('Unit "Air" (default) tidak bisa dinonaktifkan.');
    if (body.active === false && cur.active) {
      const others = await prisma.businessUnit.count({ where: { active: true, id: { not: id } } });
      if (others === 0) throw ApiError.badRequest('Minimal satu unit bisnis harus aktif.');
    }
    data.active = !!body.active;
  }
  // Per-unit module toggle. Management (users/settings/business-units) is never a module, so even a
  // unit with ZERO operational modules stays fully manageable by the owner/GM.
  if (body.enabledModules !== undefined) data.enabledModules = serializeEnabledModules(body.enabledModules);
  const updated = await prisma.businessUnit.update({ where: { id }, data });
  return shapeUnit(updated);
}

module.exports = {
  DEFAULT_UNIT_ID, SEED_UNITS, LABELLED_MODELS, MODULES,
  seedBusinessUnits, backfillBusinessUnit, listUnits, createUnit, updateUnit, resolveUnitId,
  officeCodeFor, OFFICE_CODES, DEFAULT_OFFICE, auditOfficeUnitMismatch,
  parseEnabledModules, serializeEnabledModules, moduleEnabledFor, isModuleEnabled, assertModuleEnabled,
  assertModuleEnabledForUser, moduleEnabledForAnyAccessible,
};
