'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/approval.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
// Submitting + viewing + deciding approvals all require the `approvals` capability.
// (Who may ACT on which request by routeTo/role is enforced in the UI; the server
// gate ensures only approval-capable accounts touch the resource at all.)
router.use(requireAuth, requireCap('approvals'));

router.get('/', ctrl.list);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
