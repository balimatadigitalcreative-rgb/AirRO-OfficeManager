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
// Adding / importing customers needs the dedicated capability.
router.post('/customers', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.customerSchema }), ctrl.createCustomer);
router.post('/customers/import', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.importSchema }), ctrl.importCustomers);
// Master-price change is owner-level; writes price_history + audit, leaves old txns.
router.patch('/customers/:id/price', requireCap('distribusiHargaMaster'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.priceSchema }), ctrl.updatePrice);

// ── Transactions ── (price locked server-side; append-only)
router.get('/transactions', requireCap('distribusi'), validate({ query: ctrl.schemas.listTxnQuery }), ctrl.listTransactions);
router.post('/transactions', requireCap('distribusi'), validate({ body: ctrl.schemas.txnSchema }), ctrl.createTransaction);
router.post('/transactions/:id/corrections', requireCap('distribusi'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.correctionSchema }), ctrl.addCorrection);

// ── Audit (owner) + dashboard ──
router.get('/audit', requireCap('distribusiAudit'), validate({ query: ctrl.schemas.auditQuery }), ctrl.listAudit);
router.get('/dashboard/summary', requireCap('distribusi'), validate({ query: ctrl.schemas.summaryQuery }), ctrl.dashboardSummary);

// NOTE: no DELETE routes anywhere — distribusi records are immutable/append-only.
module.exports = router;
