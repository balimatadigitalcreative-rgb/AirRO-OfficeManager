'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/events.controller');

const router = Router();
// Auth is handled inside the controller (token via ?token= for EventSource).
router.get('/', ctrl.stream);

module.exports = router;
