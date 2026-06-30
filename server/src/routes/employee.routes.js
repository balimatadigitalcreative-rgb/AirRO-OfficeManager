'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/employee.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth, requireCap('employees'));

router.get('/', validate({ query: ctrl.schemas.listQuery }), ctrl.list);
router.post('/nip', validate({ body: ctrl.schemas.nipSchema }), ctrl.generateNip);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.post('/:id/regenerate-nip', validate({ params: ctrl.schemas.idParams }), ctrl.regenerateNip);
router.delete('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
