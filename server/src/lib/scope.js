'use strict';
// Per-user BUSINESS-UNIT access control (Stage A) — a shared helper mirroring the proven
// fleetScope pattern (distribution.service.fleetScopeOf/fleetWhere), but for core finance
// records (Entry / Account / Employee / Setoran) that carry a `businessUnitId`.
//
//   User.unitScope := "all" | JSON array of businessUnitIds (e.g. ["air"] or ["mfg","nsn"]).
//   "all"/null/"" ............ every unit (no restriction; existing users default here).
//   ["air", ...] ............. only those units.
//
// This lives in src/lib (not distribution.service) because four non-distribution services
// need it. Distribusi transactions are keyed by fleetId, NOT businessUnitId, so they are
// deliberately OUT OF SCOPE here (see Stage B).

// The Stage-1 backfill rule: core rows created before businessUnitId existed have it null and
// are treated as the DEFAULT "air" unit everywhere. So a scope that includes "air" must ALSO
// match null rows, or those legacy rows would be orphaned (invisible to an air-only user).
const DEFAULT_UNIT_ID = 'air';

// Normalise a user's stored unitScope to null (= full access) or a clean string array.
function unitScopeOf(user) {
  const raw = user && user.unitScope;
  if (raw == null || raw === 'all' || raw === '') return null;
  if (Array.isArray(raw)) { const a = raw.filter((x) => typeof x === 'string' && x.trim()); return a.length ? a : null; }
  try {
    const a = JSON.parse(raw);
    if (a === 'all') return null;
    if (Array.isArray(a)) { const b = a.filter((x) => typeof x === 'string' && x.trim()); return b.length ? b : null; }
  } catch (e) {}
  return null;   // anything unrecognised → treat as full access (never silently over-restrict)
}

// Can this user access `unitId`? (unitId null/blank ⇒ the DEFAULT_UNIT_ID row.)
function canAccessUnit(user, unitId) {
  const scope = unitScopeOf(user);
  if (scope === null) return true;
  const id = unitId == null || unitId === '' ? DEFAULT_UNIT_ID : unitId;
  return scope.includes(id);
}

// A Prisma where-fragment restricting `col` (the businessUnitId column) to the user's units.
//   full access ............... {}  (no restriction)
//   scope includes "air" ...... { OR: [ {col: {in: allowed}}, {col: null} ] }  (null rows ⇒ air)
//   scope excludes "air" ...... { col: {in: allowed} }
// `col` defaults to 'businessUnitId'.
function unitWhere(user, col) {
  const c = col || 'businessUnitId';
  const scope = unitScopeOf(user);
  if (scope === null) return {};
  const base = { [c]: { in: scope } };
  if (scope.includes(DEFAULT_UNIT_ID)) return { OR: [base, { [c]: null }] };
  return base;
}

module.exports = { unitScopeOf, unitWhere, canAccessUnit, DEFAULT_UNIT_ID };
