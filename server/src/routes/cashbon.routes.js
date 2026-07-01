'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/cashbon.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
// Kasbon is a payroll/HR concern — gate on the same capability as employees.
router.use(requireAuth, requireCap('employees'));

router.get('/', validate({ query: ctrl.schemas.listQuery }), ctrl.list);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
