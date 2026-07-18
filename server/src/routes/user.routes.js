'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/user.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
// User administration (incl. password reset) is gated on the `manageUsers` CAPABILITY —
// NOT on role===owner/gm. Owner is configurable like anyone else; a lockout guard in the
// service keeps at least one active manageUsers holder at all times.
router.use(requireAuth, requireCap('manageUsers'));

router.get('/', ctrl.list);
// Forgot-password request queue (owner/GM). Declared BEFORE '/:id' so it isn't shadowed.
router.get('/reset-requests', validate({ query: ctrl.schemas.resetReqQuery }), ctrl.listResetRequests);
router.patch('/reset-requests/:id', validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.resetReqUpdate }), ctrl.handleResetRequest);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.patch('/:id', validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
