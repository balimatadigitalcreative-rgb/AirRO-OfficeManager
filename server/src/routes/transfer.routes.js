'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/transfer.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth, requireCap('cashflow'));

router.get('/', validate({ query: ctrl.schemas.listQuery }), ctrl.list);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.put('/sync', requireCap('addEntry'), validate({ body: ctrl.schemas.syncSchema }), ctrl.sync);
router.post('/', requireCap('addEntry'), validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.delete('/:id', requireCap('delete'), validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
