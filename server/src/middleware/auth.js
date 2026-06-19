'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');
const { resolvePerms } = require('../config/permissions');

// Verifies the Bearer token and attaches { id, role, username, permissions } to req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = { id: payload.sub, role: payload.role, username: payload.username, permissions: payload.permissions };
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

module.exports = { requireAuth, requireRole, requireCap };
