'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/user.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();
// User administration (incl. password reset) is restricted to the Owner & GM roles.
router.use(requireAuth, requireRole('owner', 'gm'));

router.get('/', ctrl.list);
// Forgot-password request queue (owner/GM). Declared BEFORE '/:id' so it isn't shadowed.
router.get('/reset-requests', validate({ query: ctrl.schemas.resetReqQuery }), ctrl.listResetRequests);
router.patch('/reset-requests/:id', validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.resetReqUpdate }), ctrl.handleResetRequest);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
