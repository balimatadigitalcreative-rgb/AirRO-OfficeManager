'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/distribution.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap, requireAnyCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

// ── Customers ──
// Viewing the customer list/detail is part of base module access ('distribusi').
router.get('/customers', requireCap('distribusi'), validate({ query: ctrl.schemas.custListQuery }), ctrl.listCustomers);
router.get('/customers/:id', requireCap('distribusi'), validate({ params: ctrl.schemas.idParams }), ctrl.getCustomer);
// NOTE: the delivery-fleet list is NOT served here — armada has a single app-wide
// source (the `airro_fleet` /settings key managed in Setoran → Kelola Armada), read
// by the client directly. No duplicate fleet source lives in this module.
// Adding / editing / importing customers needs the dedicated capability.
router.post('/customers', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.customerSchema }), ctrl.createCustomer);
router.patch('/customers/:id', requireCap('distribusiCustomers'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.customerUpdateSchema }), ctrl.updateCustomer);
router.post('/customers/import', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.importSchema }), ctrl.importCustomers);
// Master-price change is owner-level. Option (a) new-only just writes price_history +
// audit; option (b) also appends retroactive price adjustments (originals untouched).
router.post('/customers/:id/price/preview', requireCap('distribusiHargaMaster'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.pricePreviewSchema }), ctrl.pricePreview);
router.patch('/customers/:id/price', requireCap('distribusiHargaMaster'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.priceSchema }), ctrl.updatePrice);
// Cancel a whole price-adjustment batch (reverses the effective amounts; originals kept).
router.delete('/price-adjustments/:batchId', requireCap('distribusiHargaMaster'), validate({ params: ctrl.schemas.batchParams }), ctrl.cancelPriceAdjustment);

// ── Customer types (editable dictionary) ── read = base module; write = distribusiCustomers.
router.get('/customer-types', requireCap('distribusi'), ctrl.listTypes);
router.post('/customer-types', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.typeCreateSchema }), ctrl.createType);
router.patch('/customer-types/:id', requireCap('distribusiCustomers'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.typeRenameSchema }), ctrl.updateType);
router.delete('/customer-types/:id', requireCap('distribusiCustomers'), validate({ params: ctrl.schemas.idParams, query: ctrl.schemas.typeDeleteQuery }), ctrl.deleteType);

// ── Transactions ── (price locked server-side; append-only)
// Viewing is base module access ('distribusi' = holds ANY distribusi cap). Creating a
// transaction needs 'distribusiInput' (helper staff); appending a correction needs the
// separate 'distribusiKoreksi' — a helper with only input can never correct.
router.get('/transactions', requireCap('distribusi'), validate({ query: ctrl.schemas.listTxnQuery }), ctrl.listTransactions);
router.post('/transactions', requireCap('distribusiInput'), validate({ body: ctrl.schemas.txnSchema }), ctrl.createTransaction);
router.post('/transactions/:id/corrections', requireCap('distribusiKoreksi'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.correctionSchema }), ctrl.addCorrection);

// ── Invoices / notas ── (documents; never mutate transactions). Any distribusi user can
// view; creating one needs input or customer-management (so staff can bill on the spot).
router.get('/invoices/:id', requireCap('distribusi'), validate({ params: ctrl.schemas.idParams }), ctrl.getInvoice);
router.get('/customers/:id/invoices', requireCap('distribusi'), validate({ params: ctrl.schemas.idParams }), ctrl.listInvoices);
router.post('/customers/:id/invoices', requireAnyCap(['distribusiInput', 'distribusiCustomers']), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.invoiceCreateSchema }), ctrl.createInvoice);

// ── Audit (owner) + dashboard ── each view now has its OWN capability (the UI hides the
// menu without it; the server rejects the request regardless of what the UI shows).
router.get('/audit', requireCap('distribusiAudit'), validate({ query: ctrl.schemas.auditQuery }), ctrl.listAudit);
router.get('/dashboard/summary', requireCap('distribusiDashboard'), validate({ query: ctrl.schemas.summaryQuery }), ctrl.dashboardSummary);
router.get('/billing-reminders', requireCap('distribusiDashboard'), validate({ query: ctrl.schemas.summaryQuery }), ctrl.billingReminders);

// ── Cash Integration — its own capability. Composes the datasets the view needs
// (transactions in range + customers + adjustment audit) behind a single gate. ──
router.get('/cash-integration', requireCap('distribusiCashIntegrasi'), validate({ query: ctrl.schemas.cashIntegQuery }), ctrl.cashIntegration);

// ── Delivery board — view = distribusiPengiriman; add extra order = distribusiOrder;
// marking a stop (terkirim/batal, link a txn) = distribusiPengiriman. ──
router.get('/deliveries', requireCap('distribusiPengiriman'), validate({ query: ctrl.schemas.boardQuery }), ctrl.deliveryBoard);
router.post('/deliveries/order', requireCap('distribusiOrder'), validate({ body: ctrl.schemas.orderSchema }), ctrl.addOrder);
router.put('/deliveries/reorder', requireCap('distribusiPengiriman'), validate({ body: ctrl.schemas.reorderSchema }), ctrl.reorderDeliveries);
router.patch('/deliveries/:id', requireCap('distribusiPengiriman'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.markSchema }), ctrl.markDelivery);

// ── Gallon stock (loan/exchange) — read = distribusiGallon; correction = distribusiCustomers. ──
router.get('/gallon', requireCap('distribusiGallon'), validate({ query: ctrl.schemas.gallonQuery }), ctrl.gallonSummary);
router.post('/gallon/correction', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.gallonCorrectionSchema }), ctrl.gallonCorrection);

// NOTE: no DELETE routes anywhere — distribusi records are immutable/append-only.
module.exports = router;
