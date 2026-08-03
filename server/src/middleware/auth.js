'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');
const { resolvePerms } = require('../config/permissions');
const { canAccessUnit } = require('../lib/scope');

// Verifies the Bearer token and attaches { id, role, username, permissions } to req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = { id: payload.sub, role: payload.role, username: payload.username, permissions: payload.permissions, fleetScope: payload.fleetScope, unitScope: payload.unitScope };
    next();
  } catch (e) {
    next(ApiError.unauthorized('Invalid or expired token'));
  }
}

// Restricts a route to the given roles. Use after requireAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}

// Restricts a route to users that hold the given capability — using their
// per-user permission override if set, otherwise their role defaults.
// (Changing a user's permissions takes effect on their next login.)
function requireCap(perm) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const perms = resolvePerms(req.user.role, req.user.permissions);
    if (!perms[perm]) {
      return next(ApiError.forbidden(`Akun kamu tidak punya akses: ${perm}`));
    }
    next();
  };
}

// Pass if the user holds ANY of the listed capabilities. Used for shared READ
// resources that several roles legitimately view (e.g. the employee roster feeds
// payroll/reports/kasbon/approvals — not just the `employees` manage screen).
// Does NOT grant write access; writes keep their own requireCap.
function requireAnyCap(perms) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const have = resolvePerms(req.user.role, req.user.permissions);
    if (!perms.some((p) => have[p])) {
      return next(ApiError.forbidden(`Akun kamu tidak punya akses: ${perms.join('/')}`));
    }
    next();
  };
}

// STAGE B — business-unit gate. Restricts a whole route/router to users who may access `unitId`.
// Distribution is keyed by fleetId (no businessUnitId), so the project's ONE consistent mapping is:
// "all distribution data belongs to unit 'air' (the water business)". A user scoped to only
// mfg/nsn therefore has no distribution access (403 → the client shows a clear "no access" state);
// an "air"/all user is unaffected. Use after requireAuth.
function requireUnit(unitId) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!canAccessUnit(req.user, unitId)) {
      return next(ApiError.forbidden(`Akun kamu tidak punya akses ke unit bisnis untuk modul ini.`));
    }
    next();
  };
}

// PER-UNIT MODULE TOGGLE — router-level gate for a whole module that is NOT unit-scoped in the data
// (distribusi + gudang are keyed by fleetId, not businessUnitId). The module is AVAILABLE when it is
// enabled for ANY unit the caller can access — the SAME union the client nav uses (activeModules),
// so the nav gate and this server gate never disagree, and an unconfigured (default-'all') unit is
// always available. If the GM turns the module off for one unit but leaves it on for another the
// caller can see, it stays available; it only 403s when off for every unit they can access.
// Finance/HR modules are enforced per-target-unit inside their services instead (the record's own
// businessUnitId decides). Use after requireAuth.
function requireModule(moduleKey) {
  return async (req, res, next) => {
    try {
      const bu = require('../services/businessUnit.service');   // lazy require avoids any load-order cycle
      if (!(await bu.moduleEnabledForAnyAccessible(req.user, moduleKey))) {
        return next(ApiError.forbidden('Modul ini tidak aktif untuk unit bisnis terkait.'));
      }
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { requireAuth, requireRole, requireCap, requireAnyCap, requireUnit, requireModule };
