'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/settings.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// Any authenticated user may read settings; only 'settings' roles may change them.
router.get('/', ctrl.getAll);
router.get('/:key', validate({ params: ctrl.schemas.keyParams }), ctrl.getOne);
router.put('/:key', requireCap('settings'), validate({ params: ctrl.schemas.keyParams, body: ctrl.schemas.putSchema }), ctrl.set);

module.exports = router;
