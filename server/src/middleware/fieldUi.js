'use strict';
// MODE LAPANGAN DEMO GUARD. The new phone UI sends `X-Airro-Ui: field` on every request. While the new
// UI is a demo, WRITING real data through it (Mode asli) needs the owner-granted distribusiDemoPenuh.
// Reads always pass (Mode latihan copies real data once, read-only). Once the owner releases the new UI
// (fieldRules.fieldUiDefault === 'new') the header no longer demands anything beyond the normal caps.
// This is a demo fence, not the security boundary — every route keeps its own requireCap.
const ApiError = require('../utils/ApiError');
const { resolvePerms } = require('../config/permissions');

const READ = new Set(['GET', 'HEAD', 'OPTIONS']);

async function fieldUiGuard(req, res, next) {
  try {
    if (READ.has(req.method)) return next();
    if (String(req.headers['x-airro-ui'] || '').toLowerCase() !== 'field') return next();
    if (!req.user) return next(ApiError.unauthorized());
    const perms = resolvePerms(req.user.role, req.user.permissions) || {};
    if (perms.distribusiDemoPenuh) return next();
    const rules = await require('../services/fieldRules.service').getRules();
    if (rules.fieldUiDefault === 'new') return next();
    return next(ApiError.forbidden('Akses Mode asli belum diberikan — pakai Mode latihan, atau minta Pemilik memberi akses Demo penuh.'));
  } catch (e) { return next(e); }
}

module.exports = { fieldUiGuard };
