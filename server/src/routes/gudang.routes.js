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
// Daily closeout (opname + day report) — the report/closeout capability. Preview shows system
// numbers; POST confirms/opnames each item (a physical≠system gap needs a reason → correction).
router.get('/closeout', requireCap('gudangReport'), validate({ query: ctrl.schemas.closeoutPreviewQuery }), ctrl.closeoutPreview);
router.post('/closeout', requireCap('gudangReport'), validate({ body: ctrl.schemas.closeoutSchema }), ctrl.closeWarehouse);
router.get('/closeouts', requireCap('gudangReport'), validate({ query: ctrl.schemas.closeoutQuery }), ctrl.listCloseouts);
router.get('/items/:id', requireCap('gudangView'), validate({ params: ctrl.schemas.idParams }), ctrl.getItem);

// Manage items + add/correct stock — manage cap.
router.post('/items', requireCap('gudangKelola'), validate({ body: ctrl.schemas.createItemSchema }), ctrl.createItem);
router.patch('/items/:id', requireCap('gudangKelola'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateItemSchema }), ctrl.updateItem);
router.post('/items/:id/stock', requireCap('gudangKelola'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.stockSchema }), ctrl.addStock);

// Record damage / loss write-offs — dedicated cap (separate from ordinary stock-in).
router.post('/items/:id/damage', requireCap('gudangDamage'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.damageSchema }), ctrl.addDamage);

// Report a broken/lost GOOD gallon (reduces good gallon stock; books recoverable ones into
// "Galon Rusak"). Anti-fraud: reason mandatory, fully audited. Gated by the damage cap.
router.post('/gallon/damage', requireCap('gudangDamage'), validate({ body: ctrl.schemas.gallonDamageSchema }), ctrl.reportGallonDamage);
// Sell damaged gallons — reduces "Galon Rusak" stock + records the money separately. Manage cap.
router.post('/gallon-rusak/sell', requireCap('gudangKelola'), validate({ body: ctrl.schemas.sellRusakSchema }), ctrl.sellRusak);

module.exports = router;
