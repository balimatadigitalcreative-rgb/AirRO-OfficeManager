'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');
const { hasPerm } = require('../config/permissions');

// Verifies the Bearer token and attaches { id, role, username } to req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = { id: payload.sub, role: payload.role, username: payload.username };
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

// Restricts a route to roles that hold the given capability (see
// config/permissions.js). Use after requireAuth.
function requireCap(perm) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!hasPerm(req.user.role, perm)) {
      return next(ApiError.forbidden(`Your role (${req.user.role}) lacks permission: ${perm}`));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requireCap };
