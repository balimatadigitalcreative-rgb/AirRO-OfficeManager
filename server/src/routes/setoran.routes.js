'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/setoran.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
// Setoran is the adminfin team's screen — gate on the 'setoran' capability.
router.use(requireAuth, requireCap('setoran'));

router.get('/', validate({ query: ctrl.schemas.listQuery }), ctrl.list);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
