'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/payroll.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth, requireCap('payroll'));

// View the payroll run (hrd, finance, gm).
router.get('/', ctrl.run);

// Posting writes a cash-book expense — requires cash-book add rights too,
// so hrd (no cashflow) is correctly blocked while finance/gm can post.
router.post('/post', requireCap('addEntry'), validate({ body: ctrl.schemas.postSchema }), ctrl.post);

module.exports = router;
