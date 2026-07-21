'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/gudang.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');
const { resolvePerms } = require('../config/permissions');

const router = Router();
router.use(requireAuth);

// A stock 'correction' rewrites the counted quantity, so it needs the correction cap; every
// other type is an ordinary stock-in. Runs AFTER validate(), so req.body.type is known-good.
function requireStockCap(req, res, next) {
  return requireCap(req.body && req.body.type === 'correction' ? 'gudangKoreksi' : 'gudangAddStock')(req, res, next);
}
// Creating an item may carry an initial bufferMin — but only for someone who also holds the
// buffer cap. For anyone else the field is dropped (the item is created with buffer 0)
// rather than rejected, so item creation still works without the extra privilege.
function stripBufferUnlessAllowed(req, res, next) {
  const perms = req.user ? resolvePerms(req.user.role, req.user.permissions) : {};
  if (req.body && req.body.bufferMin !== undefined && !perms.gudangBuffer) delete req.body.bufferMin;
  next();
}

// View the warehouse dashboard / an item's ledger — read cap.
router.get('/summary', requireCap('gudangView'), ctrl.summary);
router.get('/report', requireCap('gudangReport'), ctrl.report);
// Daily closeout (opname + day report) — the report/closeout capability. Preview shows system
// numbers; POST confirms/opnames each item (a physical≠system gap needs a reason → correction).
router.get('/closeout', requireCap('gudangReport'), validate({ query: ctrl.schemas.closeoutPreviewQuery }), ctrl.closeoutPreview);
router.post('/closeout', requireCap('gudangReport'), validate({ body: ctrl.schemas.closeoutSchema }), ctrl.closeWarehouse);
router.get('/closeouts', requireCap('gudangReport'), validate({ query: ctrl.schemas.closeoutQuery }), ctrl.listCloseouts);
router.get('/items/:id', requireCap('gudangView'), validate({ params: ctrl.schemas.idParams }), ctrl.getItem);

// Manage items — create/edit an item's details (name, unit, shape, description, photo).
// NOT the buffer: that is its own action below, so "may edit items" does not imply
// "may move the restock threshold".
router.post('/items', requireCap('gudangItems'), validate({ body: ctrl.schemas.createItemSchema }), stripBufferUnlessAllowed, ctrl.createItem);
router.patch('/items/:id', requireCap('gudangItems'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.updateItemSchema }), ctrl.updateItem);
// Restock threshold — its own endpoint + capability.
router.patch('/items/:id/buffer', requireCap('gudangBuffer'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.bufferSchema }), ctrl.setBuffer);
// Stock in vs stock CORRECTION share one endpoint but are different privileges: adding a
// delivery is routine, correcting the count is how a discrepancy gets papered over. The cap
// is therefore chosen from the movement type in the body.
router.post('/items/:id/stock', validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.stockSchema }), requireStockCap, ctrl.addStock);

// Record damage / loss write-offs — dedicated cap (separate from ordinary stock-in).
router.post('/items/:id/damage', requireCap('gudangDamage'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.damageSchema }), ctrl.addDamage);

// Report a broken/lost GOOD gallon (reduces good gallon stock; books recoverable ones into
// "Galon Rusak"). Anti-fraud: reason mandatory, fully audited. Gated by the damage cap.
router.post('/gallon/damage', requireCap('gudangDamage'), validate({ body: ctrl.schemas.gallonDamageSchema }), ctrl.reportGallonDamage);
// Sell damaged gallons — reduces "Galon Rusak" stock + records the money separately.
router.post('/gallon-rusak/sell', requireCap('gudangSupplier'), validate({ body: ctrl.schemas.sellRusakSchema }), ctrl.sellRusak);

// Suppliers (Pemasok) — their own cap. Read is gated on it too, so only supplier managers see
// the list; stock-in selects from the same list.
router.get('/suppliers', requireCap('gudangSupplier'), validate({ query: ctrl.schemas.supplierListQuery }), ctrl.listSuppliers);
router.get('/suppliers/:id', requireCap('gudangSupplier'), validate({ params: ctrl.schemas.idParams }), ctrl.getSupplier);
router.post('/suppliers', requireCap('gudangSupplier'), validate({ body: ctrl.schemas.supplierCreateSchema }), ctrl.createSupplier);
router.patch('/suppliers/:id', requireCap('gudangSupplier'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.supplierUpdateSchema }), ctrl.updateSupplier);
router.patch('/suppliers/:id/active', requireCap('gudangSupplier'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.supplierActiveSchema }), ctrl.setSupplierActive);
router.delete('/suppliers/:id', requireCap('gudangSupplier'), validate({ params: ctrl.schemas.idParams }), ctrl.deleteSupplier);

module.exports = router;
