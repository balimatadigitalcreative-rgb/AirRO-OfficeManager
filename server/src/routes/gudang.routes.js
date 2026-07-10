'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/gudang.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// View the warehouse dashboard / an item's ledger — read cap.
router.get('/summary', requireCap('gudangView'), ctrl.summary);
router.get('/report', requireCap('gudangReport'), ctrl.report);
router.get('/items/:id', requireCap('gudangView'), validate({ params: ctrl.schemas.idParams }), ctrl.getItem);

// Manage items + add/correct stock — manage cap.
router.post('/items', requireCap('gudangKelola'), validate({ body: ctrl.schemas.createItemSchema }), ctrl.createItem);
router.patch('/items/:id', requireCap('gudangKelola'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateItemSchema }), ctrl.updateItem);
router.post('/items/:id/stock', requireCap('gudangKelola'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.stockSchema }), ctrl.addStock);

// Record damage / loss write-offs — dedicated cap (separate from ordinary stock-in).
router.post('/items/:id/damage', requireCap('gudangDamage'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.damageSchema }), ctrl.addDamage);

module.exports = router;
