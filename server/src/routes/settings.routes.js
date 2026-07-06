'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/settings.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireAnyCap } = require('../middleware/auth');

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
  airro_projects: ['settings', 'company', 'payroll'],
  airro_fleet: ['settings', 'setoran'],
};
const gateByKey = (req, res, next) => requireAnyCap(KEY_WRITE_CAPS[req.params.key] || ['settings'])(req, res, next);

// Any authenticated user may read settings; write caps depend on the key.
router.get('/', ctrl.getAll);
router.get('/:key', validate({ params: ctrl.schemas.keyParams }), ctrl.getOne);
router.put('/:key', gateByKey, validate({ params: ctrl.schemas.keyParams, body: ctrl.schemas.putSchema }), ctrl.set);

module.exports = router;
