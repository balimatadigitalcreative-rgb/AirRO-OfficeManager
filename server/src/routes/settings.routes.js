'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/settings.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireAnyCap } = require('../middleware/auth');
const ApiError = require('../utils/ApiError');

const router = Router();
router.use(requireAuth);

// Write caps are per-key: finance settings/categories need 'settings', but HR-owned
// config (rates/budget/departments) is edited by HR (payroll/attendance/employees),
// and projects by company/payroll. Unknown keys default to 'settings'.
const KEY_WRITE_CAPS = {
  airro_settings: ['settings'],
  airro_cats: ['settings'],
  airro_hrd_rates: ['settings', 'payroll', 'attendance'],
  airro_hr_budget: ['settings', 'payroll'],
  airro_departments: ['settings', 'payroll', 'employees'],
  airro_positions: ['settings', 'payroll', 'employees'],
  airro_projects: ['settings', 'company', 'payroll'],
  airro_fleet: ['settings', 'setoran'],
  airro_attendance: ['attendance', 'payroll', 'employees', 'settings'],
  airro_oriatt: ['attendance', 'payroll', 'employees', 'settings'],
};
// Keys that have their OWN validated + audited endpoint and must never be written raw through here.
// fieldRules (aturan lapangan) → PUT /distribusi/field-rules (cap distribusiAturanLapangan, audited):
// writing it here would skip both, including the switch that releases the new field UI.
const OWN_ENDPOINT_KEYS = { fieldRules: '/api/v1/distribusi/field-rules' };
const gateByKey = (req, res, next) => {
  const own = OWN_ENDPOINT_KEYS[req.params.key];
  if (own) return next(ApiError.forbidden(`Pengaturan ini diubah lewat ${own}.`));
  return requireAnyCap(KEY_WRITE_CAPS[req.params.key] || ['settings'])(req, res, next);
};

// Any authenticated user may read settings; write caps depend on the key.
router.get('/', ctrl.getAll);
router.get('/:key', validate({ params: ctrl.schemas.keyParams }), ctrl.getOne);
router.put('/:key', gateByKey, validate({ params: ctrl.schemas.keyParams, body: ctrl.schemas.putSchema }), ctrl.set);

module.exports = router;
