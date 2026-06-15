'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/account.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth, requireCap('seeMoney'));

router.get('/', ctrl.list);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.get('/:id/balance', validate({ params: ctrl.schemas.idParams }), ctrl.balance);

// Bulk replace-collection sync (used by the frontend cloud adapter).
router.put('/sync', requireCap('settings'), validate({ body: ctrl.schemas.syncSchema }), ctrl.sync);

// Accounts are managed under Settings in the UI → gate writes on 'settings'.
router.post('/', requireCap('settings'), validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', requireCap('settings'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', requireCap('settings'), validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
