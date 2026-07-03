'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/employee.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap, requireAnyCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// READ the roster: allowed for any role that legitimately consumes it (the roster
// feeds payroll/reports/kasbon/approvals/company/attendance, not just the
// employees-manage screen). This is stricter than before, when the roster came
// from an ungated shared blob.
const CAN_VIEW_ROSTER = ['employees', 'payroll', 'reports', 'company', 'kasbon', 'approvals', 'attendance'];
router.get('/', requireAnyCap(CAN_VIEW_ROSTER), validate({ query: ctrl.schemas.listQuery }), ctrl.list);
router.get('/:id', requireAnyCap(CAN_VIEW_ROSTER), validate({ params: ctrl.schemas.idParams }), ctrl.getOne);

// WRITE / NIP allocation: still gated on the employees-manage capability.
router.post('/nip', requireCap('employees'), validate({ body: ctrl.schemas.nipSchema }), ctrl.generateNip);
router.post('/', requireCap('employees'), validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', requireCap('employees'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.post('/:id/regenerate-nip', requireCap('employees'), validate({ params: ctrl.schemas.idParams }), ctrl.regenerateNip);
router.delete('/:id', requireCap('employees'), validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
