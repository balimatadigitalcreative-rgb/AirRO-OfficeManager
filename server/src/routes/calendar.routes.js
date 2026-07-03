'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/calendar.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireAnyCap } = require('../middleware/auth');

const router = Router();
// The HR calendar is read + written by several HR flows: manual events (HR),
// auto-leave events created when GM/Finance APPROVE a leave request, and the
// calendar screen (attendance/payroll). Gate on any of those caps so no legit
// flow 403s. (Writes are not a privilege escalation — these roles already create
// calendar events today via the shared blob.)
const CAN_CALENDAR = ['employees', 'payroll', 'attendance', 'approvals', 'company'];
router.use(requireAuth, requireAnyCap(CAN_CALENDAR));

router.get('/', validate({ query: ctrl.schemas.listQuery }), ctrl.list);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
