'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/entry.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();

// All cash-book routes require authentication + cash-book read access.
router.use(requireAuth, requireCap('cashflow'));

router.get('/', validate({ query: ctrl.schemas.listQuerySchema }), ctrl.list);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);

// Writes gated on the matching capability (addEntry / edit / delete).
router.post('/', requireCap('addEntry'), validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', requireCap('edit'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', requireCap('delete'), validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
