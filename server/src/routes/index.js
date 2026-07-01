'use strict';
const { Router } = require('express');

const router = Router();

// Liveness/readiness probe — no auth, no DB dependency required to be "live".
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/accounts', require('./account.routes'));
router.use('/categories', require('./category.routes'));
router.use('/entries', require('./entry.routes'));
router.use('/transfers', require('./transfer.routes'));
router.use('/setoran', require('./setoran.routes'));
router.use('/fleet', require('./fleet.routes'));
router.use('/employees', require('./employee.routes'));
router.use('/cashbon', require('./cashbon.routes'));
router.use('/payroll', require('./payroll.routes'));
router.use('/settings', require('./settings.routes'));
router.use('/reports', require('./report.routes'));
router.use('/state', require('./state.routes'));   // shared app-state document store

module.exports = router;
