'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/cashbon.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// ── Requesting / viewing kasbon → 'kasbon' capability ──
// Live path (validation reads /state): preview limits, then request (authoritative,
// enforces the 16→15 cycle rules). A request lands as 'pending'.
router.post('/preview', requireCap('kasbon'), validate({ body: ctrl.schemas.previewSchema }), ctrl.preview);
router.post('/request', requireCap('kasbon'), validate({ body: ctrl.schemas.requestSchema }), ctrl.request);
router.get('/', requireCap('kasbon'), validate({ query: ctrl.schemas.listQuery }), ctrl.list);
router.get('/:id', requireCap('kasbon'), validate({ params: ctrl.schemas.idParams }), ctrl.getOne);
router.post('/', requireCap('kasbon'), validate({ body: ctrl.schemas.createSchema }), ctrl.create);

// ── Approving / rejecting / editing → 'kasbonApprove' capability ──
router.post('/:id/approve', requireCap('kasbonApprove'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.approveSchema }), ctrl.approve);
router.post('/:id/reject', requireCap('kasbonApprove'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.rejectSchema }), ctrl.reject);
router.patch('/:id', requireCap('kasbonApprove'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateSchema }), ctrl.update);
router.delete('/:id', requireCap('kasbonApprove'), validate({ params: ctrl.schemas.idParams }), ctrl.remove);

module.exports = router;
