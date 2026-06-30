'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/state.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = Router();
// Shared data — any signed-in user can read/write (the UI enforces per-feature
// access; this is the shared store behind it).
router.use(requireAuth);

router.get('/', ctrl.getAll);
router.put('/:key', validate({ params: ctrl.schemas.keyParams, body: ctrl.schemas.putSchema }), ctrl.set);

module.exports = router;
