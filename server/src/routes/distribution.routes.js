'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/distribution.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireCap, requireAnyCap, requireUnit, requireModule } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);
// STAGE B — distribution is the WATER business, mapped wholesale to unit "air" (its models are keyed
// by fleetId, not businessUnitId, so there is no per-transaction unit). A user scoped to only
// mfg/nsn therefore has no distribution access at all (every endpoint 403s); "air"/all users are
// unaffected. This is the single, consistent rule applied uniformly across the whole module.
router.use(requireUnit('air'));
// MODULE TOGGLE — distribution stays available while the distribusi module is enabled for ANY unit
// the caller can access (the same union the client nav uses), so the nav and the API never disagree
// and a default-'all' unit is always available. It only 403s when distribusi is off for every unit
// the caller can see.
router.use(requireModule('distribusi'));

// ── Customers ──
// Viewing the customer list/detail is part of base module access ('distribusi').
// Opening / carry-over bon — a REAL receivable created from nothing, so it sits at the
// CORRECTION tier (distribusiKoreksi), not plain input: a field helper who only records
// sales must not be able to invent receivables. Owner/GM hold this cap by default.
router.post('/customers/:id/opening-bon', requireCap('distribusiKoreksi'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.openingBonSchema }), ctrl.createOpeningBon);
// Balance ADJUSTMENTS (penyesuaian) — create/list need the dedicated cap; approve/reverse are GM/owner
// (enforced in the service by role, on top of the cap here). A pending adjustment never affects balances.
router.post('/customers/:id/adjustments', requireCap('distribusiPenyesuaian'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.adjustCreateSchema }), ctrl.createAdjustment);
router.get('/customers/:id/adjustments', requireCap('distribusiPenyesuaian'), validate({ params: ctrl.schemas.idParams }), ctrl.listAdjustments);
router.post('/adjustments/:id/approve', requireCap('distribusiPenyesuaian'), validate({ params: ctrl.schemas.idParams }), ctrl.approveAdjustment);
router.post('/adjustments/:id/reverse', requireCap('distribusiPenyesuaian'), validate({ params: ctrl.schemas.idParams }), ctrl.reverseAdjustment);
router.get('/reports/adjustments', requireCap('distribusiPenyesuaian'), validate({ query: ctrl.schemas.adjustReportQuery }), ctrl.adjustmentReport);
router.get('/customers', requireCap('distribusi'), validate({ query: ctrl.schemas.custListQuery }), ctrl.listCustomers);
router.get('/customers/:id', requireCap('distribusi'), validate({ params: ctrl.schemas.idParams }), ctrl.getCustomer);
// NOTE: the delivery-fleet list is NOT served here — armada has a single app-wide
// source (the `airro_fleet` /settings key managed in Setoran → Kelola Armada), read
// by the client directly. No duplicate fleet source lives in this module.
// Adding / editing a customer needs the customer capability. BULK import does NOT ride
// along with it — see /customers/import below.
router.post('/customers', requireCap('distribusiCustomers'), validate({ body: ctrl.schemas.customerSchema }), ctrl.createCustomer);
router.patch('/customers/:id', requireCap('distribusiCustomers'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.customerUpdateSchema }), ctrl.updateCustomer);
// GPS location tagging by the delivery crew (needs only the delivery caps, not full
// customer-management). Sets lat/lng + stamps who/when; fleet scope enforced.
router.patch('/customers/:id/location', requireAnyCap(['distribusiInput', 'distribusiPengiriman']), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.locationSchema }), ctrl.setLocation);
// Location photo (bytes already in the Attachment store; this stores only the id + who/when).
// Delivery helpers may photograph while delivering; customer managers may replace/remove.
router.patch('/customers/:id/location-photo', requireAnyCap(['distribusiInput', 'distribusiPengiriman', 'distribusiCustomers']), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.locationPhotoSchema }), ctrl.setLocationPhoto);
// BULK spreadsheet import — its own capability. Creating one customer is routine; creating
// hundreds in one call is a different risk (duplicates, bad phone/price data at scale), so it
// is granted separately. Back-filled from distribusiCustomers so nobody loses it on upgrade.
router.post('/customers/import', requireCap('distribusiCustomerImport'), validate({ body: ctrl.schemas.importSchema }), ctrl.importCustomers);
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
// CORRECTION / VOID are now APPROVAL-GATED. distribusiKoreksi / distribusiVoid are REQUEST rights:
// posting here creates a PENDING DistChangeRequest and does NOT change the transaction. It is applied
// only when an approver (distribusiApprove) approves it — and a requester can never approve their own.
router.post('/transactions/:id/corrections', requireCap('distribusiKoreksi'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.correctionSchema }), ctrl.requestCorrection);
router.post('/transactions/:id/void', requireCap('distribusiVoid'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.voidSchema }), ctrl.requestVoid);
// Change-request inbox + decisions — approver-only (distribusiApprove), fleet-scoped, server-enforced.
router.get('/change-requests', requireCap('distribusiApprove'), validate({ query: ctrl.schemas.changeReqQuery }), ctrl.listChangeRequests);
router.post('/change-requests/:id/approve', requireCap('distribusiApprove'), validate({ params: ctrl.schemas.idParams }), ctrl.approveChangeRequest);
router.post('/change-requests/:id/reject', requireCap('distribusiApprove'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.rejectSchema }), ctrl.rejectChangeRequest);
// ARCHIVE TOGGLE — flip a row between active and archive (legacy). Cap: distribusiLegacyImport (the
// archive-management capability). Reason required; audited; gallon movements reconciled. Fleet-scoped.
router.post('/transactions/:id/archive', requireCap('distribusiLegacyImport'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.archiveSchema }), ctrl.setTransactionArchive);
// PELUNASAN TIDAK DITERIMA — the customer paid their bon but the money never reached the company.
// Writes off a receivable AND names a responsible staff member, so it is its own owner/GM-tier cap
// (distribusiBonAdjust), granted deliberately — never derived from the generic `distribusi` flag.
// The same cap gates the internal loss report below; nothing here is ever customer-facing.
router.post('/transactions/payment-not-received', requireCap('distribusiBonAdjust'), validate({ body: ctrl.schemas.pnrSchema }), ctrl.createPaymentNotReceived);
router.get('/reports/loss', requireCap('distribusiBonAdjust'), validate({ query: ctrl.schemas.lossQuery }), ctrl.lossReport);
// TRANSACTION DISPUTE / LOSS — mark a transaction disputed → tidak diakui / kerugian. The transaction
// is never mutated; only a side-table STATUS changes. Same owner/GM-tier cap as the loss report;
// approve/reverse are additionally GM/owner-only (enforced in the service). The staff linked to the
// transaction can never raise or approve a dispute on their own transaction (server-enforced).
router.post('/transactions/:id/dispute', requireCap('distribusiBonAdjust'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.disputeSchema }), ctrl.raiseDispute);
router.post('/disputes/:id/approve', requireCap('distribusiBonAdjust'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.disputeApproveSchema }), ctrl.approveDispute);
router.post('/disputes/:id/reverse', requireCap('distribusiBonAdjust'), validate({ params: ctrl.schemas.idParams }), ctrl.reverseDispute);
// KERUGIAN void / delete. Same owner/GM-tier cap (distribusiBonAdjust). Void (Batalkan) is GM/owner;
// hard delete is OWNER-only — both enforced in the service. All eligibility rules are server-side.
// bulk-delete is registered BEFORE :id so "bulk-delete" is never captured as an :id.
router.post('/kerugian/bulk-delete', requireCap('distribusiBonAdjust'), validate({ body: ctrl.schemas.kerugianBulkSchema }), ctrl.bulkDeleteKerugian);
router.get('/kerugian/:id/impact', requireCap('distribusiBonAdjust'), validate({ params: ctrl.schemas.idParams, query: ctrl.schemas.kerugianQuery }), ctrl.kerugianImpact);
router.post('/kerugian/:id/void', requireCap('distribusiBonAdjust'), validate({ params: ctrl.schemas.idParams, query: ctrl.schemas.kerugianQuery, body: ctrl.schemas.kerugianVoidSchema }), ctrl.voidKerugian);
router.post('/kerugian/:id/note', requireCap('distribusiBonAdjust'), validate({ params: ctrl.schemas.idParams, query: ctrl.schemas.kerugianQuery, body: ctrl.schemas.kerugianNoteSchema }), ctrl.editKerugianNote);
router.delete('/kerugian/:id', requireCap('distribusiBonAdjust'), validate({ params: ctrl.schemas.idParams, query: ctrl.schemas.kerugianQuery, body: ctrl.schemas.kerugianDeleteSchema }), ctrl.hardDeleteKerugian);
// HARD DELETE (permanent) — OWNER-ONLY last resort. Cap: distribusiHardDelete (granted to no one
// but owner by default). Typed ref/HAPUS + password + reason enforced in the service; an audit
// entry is written BEFORE the row is removed, so a trace always survives. Fleet-scoped.
router.delete('/transactions/:id', requireCap('distribusiHardDelete'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.hardDeleteSchema }), ctrl.hardDeleteTransaction);
// BULK removal (batal · arsip · hapus). Preview is read-only (any distribusi user); execute requires
// at least one bulk-capable cap (the SPECIFIC per-action cap is re-checked in the service); restore is
// owner/GM for hapus (checked in the service). All eligibility is re-enforced per row server-side.
router.post('/transactions/bulk/preview', requireCap('distribusi'), validate({ body: ctrl.schemas.bulkTxnPreviewSchema }), ctrl.bulkTxnPreview);
router.post('/transactions/bulk/restore', requireCap('distribusi'), validate({ body: ctrl.schemas.bulkRestoreSchema }), ctrl.bulkTxnRestore);
router.post('/transactions/bulk', requireAnyCap(['distribusiVoid', 'distribusiLegacyImport', 'distribusi.transaksi.hapus']), validate({ body: ctrl.schemas.bulkTxnSchema }), ctrl.bulkTxn);

// ── Invoices / notas ── (documents; never mutate transactions). Any distribusi user can
// view; creating one needs input or customer-management (so staff can bill on the spot).
router.get('/invoices/dispatches', requireCap('distribusi'), validate({ query: ctrl.schemas.dispatchQuery }), ctrl.invoiceDispatches);   // BEFORE :id so 'dispatches' isn't an id
router.get('/invoices/:id', requireCap('distribusi'), validate({ params: ctrl.schemas.idParams }), ctrl.getInvoice);
router.get('/customers/:id/invoices', requireCap('distribusi'), validate({ params: ctrl.schemas.idParams }), ctrl.listInvoices);
router.post('/customers/:id/invoices', requireAnyCap(['distribusiInput', 'distribusiCustomers']), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.invoiceCreateSchema }), ctrl.createInvoice);
// Signed shareable link (WhatsApp) + dispatch log. The PUBLIC page is unauthed (mounted in routes/index).
router.post('/invoices/:id/link', requireAnyCap(['distribusiInput', 'distribusiCustomers']), validate({ params: ctrl.schemas.idParams }), ctrl.invoiceLink);
router.post('/invoices/:id/revoke', requireAnyCap(['distribusiInput', 'distribusiCustomers']), validate({ params: ctrl.schemas.idParams }), ctrl.invoiceRevoke);
router.post('/invoices/dispatch', requireAnyCap(['distribusiInput', 'distribusiCustomers']), validate({ body: ctrl.schemas.dispatchSchema }), ctrl.invoiceDispatch);
router.get('/invoices/dispatches', requireCap('distribusi'), validate({ query: ctrl.schemas.dispatchQuery }), ctrl.invoiceDispatches);

// ── Audit (owner) + dashboard ── each view now has its OWN capability (the UI hides the
// menu without it; the server rejects the request regardless of what the UI shows).
router.get('/audit', requireCap('distribusiAudit'), validate({ query: ctrl.schemas.auditQuery }), ctrl.listAudit);
router.get('/dashboard/summary', requireCap('distribusiDashboard'), validate({ query: ctrl.schemas.summaryQuery }), ctrl.dashboardSummary);
router.get('/billing-reminders', requireCap('distribusiDashboard'), validate({ query: ctrl.schemas.summaryQuery }), ctrl.billingReminders);
// Laporan Pengiriman (delivery report) — read-only per-day/range report per fleet (rits + stops +
// closeout + cash reconciliation). Its own cap; fleet scope + business-unit filtering apply.
router.get('/reports/delivery', requireCap('distribusiPengirimanReport'), validate({ query: ctrl.schemas.deliveryReportQuery }), ctrl.deliveryReport);

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
// Koreksi Rit — append-only correction of a run's figures. Gated on distribusiKoreksi (the same
// correction tier as transaction corrections): a helper with only input/pengiriman can VIEW runs
// but never correct one.
router.post('/runs/:id/corrections', requireCap('distribusiKoreksi'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.runCorrectionSchema }), ctrl.correctRun);

// ── Field expenses (pengeluaran lapangan) — cap distribusiExpense. Fleet scope enforced: a scoped
// delivery staff logs/sees only their fleet; owner/admin (no scope) see & manage all. Append-only:
// a mistake is VOIDED (recorded, reason) not deleted. ──
router.get('/expenses/categories', requireCap('distribusiExpense'), ctrl.expenseCats);
router.get('/expenses', requireCap('distribusiExpense'), validate({ query: ctrl.schemas.expenseQuery }), ctrl.listExpenses);
router.post('/expenses', requireCap('distribusiExpense'), validate({ body: ctrl.schemas.expenseSchema }), ctrl.createExpense);
router.post('/expenses/:id/void', requireCap('distribusiExpense'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.expenseVoidSchema }), ctrl.voidExpense);

// ── GALLON STOCK (Stok Galon page) — the URLs stay under /distribusi/gallon (client + nginx depend on
// them) but every cap is now in the GUDANG namespace, because the user SEES this page under Gudang.
// ACCESS-CONTROL FIX: correction & opname no longer accept distribusiCustomers (a customer cap must not
// grant a warehouse write). See permissions.deriveGudangGalonCaps for the safe old→new derivation. ──
router.get('/gallon', requireCap('gudangGalonView'), validate({ query: ctrl.schemas.gallonQuery }), ctrl.gallonSummary);
router.post('/gallon/correction', requireCap('gudangGalonKoreksi'), validate({ body: ctrl.schemas.gallonCorrectionSchema }), ctrl.gallonCorrection);
// Opening (go-live) depot stock — a stock adjustment, so it shares the gallon-correction cap.
router.post('/gallon/opening', requireCap('gudangGalonKoreksi'), validate({ body: ctrl.schemas.openingStockSchema }), ctrl.setOpeningStock);
// Reset gallon count — GM-tier destructive stock action, its OWN cap. Server rejects anyone without it.
router.post('/gallon/reset', requireCap('gudangGalonReset'), validate({ body: ctrl.schemas.gallonResetSchema }), ctrl.resetGallon);

// ── Depot gallon-stock ENTRY void / restore / hard-delete + reset-stok-awal ──
// All confined to customerId=null rows server-side, so customer gallon counts are structurally
// untouchable. void / restore / reset → gudangGalonReset (GM/owner) · hard delete → gudangGalonHardDelete (owner).
router.get('/gallon/movements/:id/impact', requireCap('gudangGalonReset'), validate({ params: ctrl.schemas.idParams }), ctrl.gallonMovementImpact);
router.post('/gallon/movements/:id/void', requireCap('gudangGalonReset'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.gallonVoidSchema }), ctrl.gallonMovementVoid);
router.post('/gallon/movements/:id/restore', requireCap('gudangGalonReset'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.gallonRestoreSchema }), ctrl.gallonMovementRestore);
router.get('/gallon/opening/reset/impact', requireCap('gudangGalonReset'), validate({ query: ctrl.schemas.openingResetImpactSchema }), ctrl.openingResetImpact);
router.post('/gallon/opening/reset', requireCap('gudangGalonReset'), validate({ body: ctrl.schemas.openingResetSchema }), ctrl.openingReset);
// Owner-only narrow hard-delete of an already-voided, unlinked, customerId=null depot row <30 days old.
router.delete('/gallon/movements/:id', requireCap('gudangGalonHardDelete'), validate({ params: ctrl.schemas.idParams, body: ctrl.schemas.gallonMovDeleteSchema }), ctrl.gallonMovementDelete);

// ── Stok Opname (physical count → correction) + integrity guard ──
// Opname = a STOCK write (its own cap). Integrity check is read-only for any gallon viewer; repair is owner.
router.post('/gallon/opname', requireCap('gudangGalonOpname'), validate({ body: ctrl.schemas.opnameSchema }), ctrl.stockOpname);
router.get('/gallon/opname/history', requireCap('gudangGalonView'), validate({ query: ctrl.schemas.gallonQuery }), ctrl.opnameHistory);
router.get('/gallon/integrity', requireCap('gudangGalonView'), ctrl.gallonIntegrity);
router.post('/gallon/integrity/repair', requireCap('gudangGalonHardDelete'), ctrl.gallonIntegrityRepair);

// ── RESET TOTAL STOK GALON (OWNER ONLY) — clean slate for the whole gallon ledger ──
router.post('/gallon/reset-total/preview', requireCap('gudang.galon.reset_total'), validate({ body: ctrl.schemas.resetTotalSchema }), ctrl.resetTotalPreview);
router.post('/gallon/reset-total', requireCap('gudang.galon.reset_total'), validate({ body: ctrl.schemas.resetTotalSchema }), ctrl.resetTotalCommit);
router.post('/gallon/reset-total/restore', requireCap('gudang.galon.reset_total'), validate({ body: ctrl.schemas.resetTotalRestoreSchema }), ctrl.resetTotalRestore);

// ── RINCIAN STOK AWAL — per-row opening/depot management (customerId=null rows only) ──
router.get('/gallon/opening-rows', requireCap('gudangGalonView'), validate({ query: ctrl.schemas.gallonQuery }), ctrl.openingRowsList);
router.post('/gallon/opening-rows/bulk/preview', requireCap('gudangGalonReset'), validate({ body: ctrl.schemas.openingRowsBulkSchema }), ctrl.openingRowsBulkPreview);
router.post('/gallon/opening-rows/bulk', requireCap('gudangGalonReset'), validate({ body: ctrl.schemas.openingRowsBulkSchema }), ctrl.openingRowsBulk);
router.post('/gallon/opening-rows/restore', requireCap('gudangGalonReset'), validate({ body: ctrl.schemas.resetTotalRestoreSchema }), ctrl.openingRowsRestore);

module.exports = router;
