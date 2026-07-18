'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/role.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// Any signed-in user may READ roles (the app resolves its own role's capabilities
// for client-side gating). Editing roles is part of user administration → `manageUsers`.
router.get('/', ctrl.list);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', requireCap('manageUsers'), validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', requireCap('manageUsers'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', requireCap('manageUsers'), validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
