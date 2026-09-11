'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/gps.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

/*
 * ONE GATE FOR THE WHOLE FEATURE. Without distribusiLacakArmada there is no vehicle tracking at all -
 * no list, no position, no refresh, no sync - and every path below answers 403. The panel does not
 * render for such a user either, but the server is what enforces it: the UI hiding a thing is a
 * courtesy, not a control.
 *
 * WITH the capability, WHICH vehicles is decided by fleetScope, resolved from the SESSION in
 * gps.service.trackingScope and never from a request parameter. A driver scoped to ["Biru"] cannot
 * reach the Merah vehicle by naming its id - that request is refused, not served.
 */
router.use(requireCap('distribusiLacakArmada'));

// Seeing your own armada's vehicle, and asking for a fresh position, are delivery work.
router.get('/devices', ctrl.listDevices);
router.post('/refresh', ctrl.refreshPositions);

// PULLING FROM THE PROVIDER and EDITING THE FLEET MAPPING are integration configuration: they change
// how every armada resolves, so they need `settings` ON TOP of the tracking capability. A driver can
// see their truck; they cannot reassign it to somebody else's fleet.
router.post('/sync', requireCap('settings'), ctrl.syncDevices);
router.patch('/devices/:id/fleet', requireCap('settings'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.fleetSchema }), ctrl.setDeviceFleet);

module.exports = router;
