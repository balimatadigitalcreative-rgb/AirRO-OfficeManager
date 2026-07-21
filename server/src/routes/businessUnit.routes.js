'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/businessUnit.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// Reading the unit list is available to any authenticated user (the header selector + future
// per-unit views need it). Managing units is owner-tier: cap 'manageBusinessUnits'.
router.get('/', ctrl.list);
router.post('/', requireCap('manageBusinessUnits'), validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', requireCap('manageBusinessUnits'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);

module.exports = router;
