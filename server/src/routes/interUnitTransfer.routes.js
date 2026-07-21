'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/interUnitTransfer.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// Creating or voiding an inter-unit transfer is owner-tier: it moves money between two units'
// books at once. Gated by 'interUnitTransfer' (owner/GM default), server-enforced.
router.post('/', requireCap('interUnitTransfer'), validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.delete('/:groupId', requireCap('interUnitTransfer'), validate({ params: ctrl.schemas.groupParams }), ctrl.remove);

module.exports = router;
