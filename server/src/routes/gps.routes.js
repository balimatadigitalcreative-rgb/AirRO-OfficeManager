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

// REFRESHING THE POSITION is a read, not configuration: it updates lat/lng/fix and nothing else - no
// device is created, no mapping is touched - so a driver can ask "where is the truck now?" without
// holding the keys to the integration. One provider call serves every vehicle, and the service caches
// it briefly, so the whole team pressing [Coba lagi] is still one request.
router.post('/refresh', requireCap('distribusiPengiriman'), ctrl.refreshPositions);

// SYNC (pull from the provider) and EDITING the fleet mapping are integration configuration, not daily
// delivery work: they change how every armada resolves, so they sit behind `settings` (owner/GM).
router.post('/sync', requireCap('settings'), ctrl.syncDevices);
router.patch('/devices/:id/fleet', requireCap('settings'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.fleetSchema }), ctrl.setDeviceFleet);

module.exports = router;
