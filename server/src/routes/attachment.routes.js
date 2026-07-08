'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/attachment.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = Router();
// Any signed-in user may upload a proof and fetch one (proofs are not sensitive beyond
// the app itself; the record that references it already carries its own capability gate).
router.use(requireAuth);

router.post('/', validate({ body: ctrl.schemas.createSchema }), ctrl.create);
router.get('/:id', validate({ params: ctrl.schemas.idParams }), ctrl.getOne);

module.exports = router;
