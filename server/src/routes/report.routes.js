'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/report.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth, requireCap('reports'));

router.get('/summary', validate({ query: ctrl.schemas.rangeQuery }), ctrl.summary);
router.get('/cashflow', validate({ query: ctrl.schemas.rangeQuery }), ctrl.cashflow);
router.get('/breakdown', validate({ query: ctrl.schemas.breakdownQuery }), ctrl.breakdown);

module.exports = router;
