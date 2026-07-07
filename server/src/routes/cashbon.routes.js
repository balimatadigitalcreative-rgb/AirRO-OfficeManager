'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/cashbon.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap, requireAnyCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// Viewing the kasbon list/detail is allowed for ANY kasbon capability holder — an
// approver/rejecter/deleter must be able to see the cards they act on, even without
// the request cap.
const KASBON_VIEW = ['kasbon', 'kasbonRequest', 'kasbonApprove', 'kasbonReject', 'kasbonCancel', 'kasbonDelete'];

// ── Requesting → 'kasbonRequest' (legacy 'kasbon' derives into it). A request lands
// as 'pending' and does not deduct until approved. Viewing → any kasbon cap. ──
router.post('/preview', requireCap('kasbonRequest'), validate({ body: ctrl.schemas.previewSchema }), ctrl.preview);
router.post('/request', requireCap('kasbonRequest'), validate({ body: ctrl.schemas.requestSchema }), ctrl.request);
router.get('/', requireAnyCap(KASBON_VIEW), validate({ query: ctrl.schemas.listQuery }), ctrl.list);
router.get('/:id', requireAnyCap(KASBON_VIEW), validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', requireCap('kasbonRequest'), validate({ body: ctrl.schemas.createSchema }), ctrl.create);

// ── Cancel → a 'kasbonCancel' holder (any live status) OR the submitter of a still-
// pending kasbon. No requireCap here: the controller/service authorises by
// ownership+status vs the kasbonCancel capability. ──
router.post('/:id/cancel', validate({ params: ctrl.schemas.idParams }), ctrl.cancel);

// ── Each remaining action is gated on its OWN capability. ──
router.post('/:id/approve', requireCap('kasbonApprove'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.approveSchema }), ctrl.approve);
router.post('/:id/reject', requireCap('kasbonReject'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.rejectSchema }), ctrl.reject);
router.patch('/:id', requireCap('kasbonApprove'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', requireCap('kasbonDelete'), validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
