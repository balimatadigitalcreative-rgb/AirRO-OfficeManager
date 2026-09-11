'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/gps.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// READING the tracked vehicles is delivery work — the Pengiriman board shows each armada's last known
// position and the "tracked but unmapped" warning, so it rides distribusiPengiriman.
router.get('/devices', requireCap('distribusiPengiriman'), ctrl.listDevices);

// SYNC (pull from the provider) and EDITING the fleet mapping are integration configuration, not daily
// delivery work: they change how every armada resolves, so they sit behind `settings` (owner/GM).
router.post('/sync', requireCap('settings'), ctrl.syncDevices);
router.patch('/devices/:id/fleet', requireCap('settings'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.fleetSchema }), ctrl.setDeviceFleet);

module.exports = router;
