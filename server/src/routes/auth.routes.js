'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.post('/register', validate({ body: ctrl.schemas.registerSchema }), ctrl.register);
router.post('/login', validate({ body: ctrl.schemas.loginSchema }), ctrl.login);
router.get('/me', requireAuth, ctrl.me);

module.exports = router;
