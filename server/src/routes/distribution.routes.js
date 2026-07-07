'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/distribution.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// ── Customers ──
// Viewing the customer list/detail is part of base module access ('distribusi').
router.get('/customers', requireCap('distribusi'), ctrl.listCustomers);
router.get('/customers/:id', requireCap('distribusi'), validate({ params: ctrl.schemas.idParams }), ctrl.getCustomer);
// NOTE: the delivery-fleet list is NOT served here — armada has a single app-wide
// source (the `airro_fleet` /settings key managed in Setoran → Kelola Armada), read
// by the client directly. No duplicate fleet source lives in this module.
// Adding / editing / importing customers needs the dedicated capability.
router.post('/customers', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.customerSchema }), ctrl.createCustomer);
router.patch('/customers/:id', requireCap('distribusiCustomers'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.customerUpdateSchema }), ctrl.updateCustomer);
router.post('/customers/import', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.importSchema }), ctrl.importCustomers);
// Master-price change is owner-level; writes price_history + audit, leaves old txns.
router.patch('/customers/:id/price', requireCap('distribusiHargaMaster'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.priceSchema }), ctrl.updatePrice);

// ── Customer types (editable dictionary) ── read = base module; write = distribusiCustomers.
router.get('/customer-types', requireCap('distribusi'), ctrl.listTypes);
router.post('/customer-types', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.typeCreateSchema }), ctrl.createType);
router.patch('/customer-types/:id', requireCap('distribusiCustomers'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.typeRenameSchema }), ctrl.updateType);
router.delete('/customer-types/:id', requireCap('distribusiCustomers'), validate({ params: ctrl.schemas.idParams, query: ctrl.schemas.typeDeleteQuery }), ctrl.deleteType);

// ── Transactions ── (price locked server-side; append-only)
router.get('/transactions', requireCap('distribusi'), validate({ query: ctrl.schemas.listTxnQuery }), ctrl.listTransactions);
router.post('/transactions', requireCap('distribusi'), validate({ body: ctrl.schemas.txnSchema }), ctrl.createTransaction);
router.post('/transactions/:id/corrections', requireCap('distribusi'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.correctionSchema }), ctrl.addCorrection);

// ── Audit (owner) + dashboard ──
router.get('/audit', requireCap('distribusiAudit'), validate({ query: ctrl.schemas.auditQuery }), ctrl.listAudit);
router.get('/dashboard/summary', requireCap('distribusi'), validate({ query: ctrl.schemas.summaryQuery }), ctrl.dashboardSummary);

// NOTE: no DELETE routes anywhere — distribusi records are immutable/append-only.
module.exports = router;
