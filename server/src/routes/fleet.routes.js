'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/fleet.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth, requireCap('setoran'));

router.get('/', ctrl.list);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', requireCap('settings'), validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', requireCap('settings'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', requireCap('settings'), validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
