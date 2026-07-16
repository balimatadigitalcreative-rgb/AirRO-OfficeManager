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
// GPS location tagging by the delivery crew (needs only the delivery caps, not full
// customer-management). Sets lat/lng + stamps who/when; fleet scope enforced.
router.patch('/customers/:id/location', requireAnyCap(['distribusiInput', 'distribusiPengiriman']), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.locationSchema }), ctrl.setLocation);
// Location photo (bytes already in the Attachment store; this stores only the id + who/when).
// Delivery helpers may photograph while delivering; customer managers may replace/remove.
router.patch('/customers/:id/location-photo', requireAnyCap(['distribusiInput', 'distribusiPengiriman', 'distribusiCustomers']), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.locationPhotoSchema }), ctrl.setLocationPhoto);
router.post('/customers/import', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.importSchema }), ctrl.importCustomers);
// Per-customer LEGACY (archive) transaction import — its own capability. customerId is from the
// route; rows are stored legacy=true (excluded from every aggregate; no gallon movement). Undo a
// whole batch is GM/Owner-only (enforced in the service). Fleet scope enforced.
router.post('/customers/:id/transactions/import', requireCap('distribusiLegacyImport'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.legacyImportSchema }), ctrl.importLegacyTxns);
router.delete('/customers/:id/transactions/legacy-batch/:batchId', requireCap('distribusiLegacyImport'), validate({ params: ctrl.schemas.legacyBatchParams }), ctrl.undoLegacyBatch);
// Deactivate (soft, reversible) / reactivate / hard-delete a customer — dedicated
// capability, separate from ordinary customer management. Server enforces the cap + scope.
router.patch('/customers/:id/deactivate', requireCap('distribusiCustomerDelete'), validate({ params: ctrl.schemas.idParams }), ctrl.deactivateCustomer);
router.patch('/customers/:id/reactivate', requireCap('distribusiCustomerDelete'), validate({ params: ctrl.schemas.idParams }), ctrl.reactivateCustomer);
router.delete('/customers/:id', requireCap('distribusiCustomerDelete'), validate({ params: ctrl.schemas.idParams }), ctrl.deleteCustomer);
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
router.put('/deliveries/reorder', requireCap('distribusiRute'), validate({ body: ctrl.schemas.reorderSchema }), ctrl.reorderDeliveries);
// Close the day (helper who ran the deliveries). Undelivered stops need a reason.
router.post('/deliveries/close', requireCap('distribusiPengiriman'), validate({ body: ctrl.schemas.closeSchema }), ctrl.closeDay);
// Admin report of closeouts across the (scoped) fleets.
router.get('/closeouts', requireCap('distribusiDashboard'), validate({ query: ctrl.schemas.closeoutQuery }), ctrl.listCloseouts);
router.patch('/deliveries/:id', requireCap('distribusiPengiriman'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.markSchema }), ctrl.markDelivery);

// ── Delivery runs (rit) — per-trip gallon out/in + reconciliation. Same delivery cap;
// fleet scope enforced. Report is scoped (owner sees all, helper sees their fleet). ──
router.get('/runs', requireCap('distribusiPengiriman'), validate({ query: ctrl.schemas.runQuery }), ctrl.listRuns);
router.post('/runs/open', requireCap('distribusiPengiriman'), validate({ body: ctrl.schemas.runOpenSchema }), ctrl.openRun);
router.post('/runs/:id/close', requireCap('distribusiPengiriman'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.runCloseSchema }), ctrl.closeRun);

// ── Gallon stock (loan/exchange) — read = distribusiGallon; correction = distribusiCustomers. ──
router.get('/gallon', requireCap('distribusiGallon'), validate({ query: ctrl.schemas.gallonQuery }), ctrl.gallonSummary);
router.post('/gallon/correction', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.gallonCorrectionSchema }), ctrl.gallonCorrection);
// Opening (go-live) depot stock — same stock-management cap as a correction. Append-only:
// records the delta as an 'opening' movement, never overwrites the ledger.
router.post('/gallon/opening', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.openingStockSchema }), ctrl.setOpeningStock);
// Reset gallon count — GM-tier destructive action, its OWN capability. Server rejects anyone
// without it (403), not just a hidden button. Balanced mode appends corrections; purge deletes.
router.post('/gallon/reset', requireCap('distribusiGallonReset'), validate({ body: ctrl.schemas.gallonResetSchema }), ctrl.resetGallon);

// NOTE: no DELETE routes anywhere — distribusi records are immutable/append-only.
module.exports = router;
