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

async function listUnits(includeInactive = true) {
  const data = await prisma.businessUnit.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return includeInactive ? data : data.filter((u) => u.active);
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
  return prisma.businessUnit.update({ where: { id }, data });
}

module.exports = {
  DEFAULT_UNIT_ID, SEED_UNITS, LABELLED_MODELS,
  seedBusinessUnits, backfillBusinessUnit, listUnits, createUnit, updateUnit, resolveUnitId,
  officeCodeFor, OFFICE_CODES, DEFAULT_OFFICE, auditOfficeUnitMismatch,
};
