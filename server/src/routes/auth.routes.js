'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const router = Router();

router.post('/register', validate({ body: ctrl.schemas.registerSchema }), ctrl.register);
router.post('/login', validate({ body: ctrl.schemas.loginSchema }), ctrl.login);
// Forgot password — PUBLIC (no login) + rate-limited (max 5/hour per IP) to prevent spam.
router.post('/forgot', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }), validate({ body: ctrl.schemas.forgotSchema }), ctrl.forgot);
router.get('/me', requireAuth, ctrl.me);
// A signed-in user changes their own password (verifies the current one first).
router.post('/change-password', requireAuth, validate({ body: ctrl.schemas.changePasswordSchema }), ctrl.changePassword);
// A signed-in user edits their own profile (display name / avatar colour only).
router.patch('/me', requireAuth, validate({ body: ctrl.schemas.updateProfileSchema }), ctrl.updateProfile);

module.exports = router;
