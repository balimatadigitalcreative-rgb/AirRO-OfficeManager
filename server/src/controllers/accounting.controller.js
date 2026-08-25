'use strict';
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const service = require('../services/accounting.service');
const period = require('../services/period.service');
const recon = require('../services/reconciliation.service');
const bill = require('../services/bill.service');
const accrual = require('../services/accrual.service');
const subscription = require('../services/subscription.service');
const depreciation = require('../services/depreciation.service');
const costing = require('../services/costing.service');
const range = (req) => ({ dateFrom: req.query.dateFrom, dateTo: req.query.dateTo, businessUnitId: req.query.businessUnitId, fleetId: req.query.fleetId });

const trialBalance = asyncHandler(async (req, res) => res.json({ data: await service.trialBalance(range(req)) }));
const balanceSheet = asyncHandler(async (req, res) => res.json({ data: await service.balanceSheet(range(req)) }));
const incomeStatement = asyncHandler(async (req, res) => res.json({ data: await service.incomeStatement(range(req)) }));
const cashFlow = asyncHandler(async (req, res) => res.json({ data: await service.cashFlow({ dateFrom: req.query.dateFrom, dateTo: req.query.dateTo, businessUnitId: req.query.businessUnitId, fleetId: req.query.fleetId }) }));
const generalLedger = asyncHandler(async (req, res) => res.json({ data: await service.accountBalances(range(req)) }));
const chart = asyncHandler(async (req, res) => res.json({ data: await service.chart() }));
const receivables = asyncHandler(async (req, res) => res.json({ data: { balance: await service.receivablesBalance(range(req)) } }));
const unmapped = asyncHandler(async (req, res) => res.json({ data: await service.unmappedCategories() }));
const aging = asyncHandler(async (req, res) => res.json({ data: await service.agingReceivables({ asOf: req.query.asOf, fleetId: req.query.fleetId, businessUnitId: req.query.businessUnitId }) }));
const ledger = asyncHandler(async (req, res) => res.json({ data: await service.generalLedger({ code: req.query.code, dateFrom: req.query.dateFrom, dateTo: req.query.dateTo, businessUnitId: req.query.businessUnitId, fleetId: req.query.fleetId }) }));
const journal = asyncHandler(async (req, res) => res.json({ data: await service.journalFor({ sourceType: req.query.sourceType, sourceId: req.query.sourceId }) }));
const periods = asyncHandler(async (req, res) => res.json({ data: await period.listPeriods() }));
const periodChecklist = asyncHandler(async (req, res) => res.json({ data: await period.closeChecklist(+req.query.year, +req.query.month) }));
const periodClose = asyncHandler(async (req, res) => res.json({ data: await period.closePeriod({ year: +req.body.year, month: +req.body.month, lock: !!req.body.lock }, req.user) }));
const periodReopen = asyncHandler(async (req, res) => res.json({ data: await period.reopenPeriod({ year: +req.body.year, month: +req.body.month, reason: req.body.reason }, req.user) }));
const reconciliation = asyncHandler(async (req, res) => res.json({ data: await recon.reconcileView({ accountId: req.query.accountId, statementBalance: req.query.statementBalance }) }));
const reconcileMark = asyncHandler(async (req, res) => res.json({ data: await recon.markCleared({ accountId: req.body.accountId, itemType: req.body.itemType, itemId: req.body.itemId, cleared: req.body.cleared, statementRef: req.body.statementRef }, req.user) }));
// Backfill: a DRY-RUN (body.dryRun) returns the preview synchronously (cheap counts). A REAL run starts
// an ASYNC job and returns { jobId, total } immediately — the work streams in the background so nginx
// never waits on the long write (the old blocking path returned 502). Poll status below.
const backfill = asyncHandler(async (req, res) => {
  if (req.body && req.body.dryRun) return res.json({ data: await service.backfill({ fromDate: req.body.fromDate, dryRun: true, actor: req.user }) });
  return res.json({ data: await service.startBackfillJob({ fromDate: req.body && req.body.fromDate, actor: req.user }) });
});
const backfillStatus = asyncHandler(async (req, res) => { const s = await service.backfillJobStatus(req.params.jobId); if (!s) throw ApiError.notFound('Job backfill tidak ditemukan.'); res.json({ data: s }); });
// INTEGRITY / drift detector — sources with no journal + journals with no source.
const integrity = asyncHandler(async (req, res) => res.json({ data: await service.integrityCheck({ fromDate: req.query.fromDate }) }));
// PEMETAAN AKUN — category → account mapping (list / set / clear).
const mappings = asyncHandler(async (req, res) => res.json({ data: await service.listCategoryMappings() }));
const setMapping = asyncHandler(async (req, res) => res.json({ data: await service.setCategoryMapping({ categoryKey: req.body.categoryKey, type: req.body.type, chartCode: req.body.chartCode }, req.user) }));
const clearMapping = asyncHandler(async (req, res) => res.json({ data: await service.clearCategoryMapping({ categoryKey: req.body.categoryKey, type: req.body.type }) }));
// STATUS roll-up for the workflow panel + report headers (last-posted, balance, drift/unmapped counts).
const status = asyncHandler(async (req, res) => res.json({ data: await service.accountingStatus({ asOf: req.query.asOf }) }));

// ACCOUNTS PAYABLE (Utang Usaha) — bills + payments + AP aging + due-this-week. The bill.service
// validates; handlers just pass through.
const billsList = asyncHandler(async (req, res) => res.json(await bill.listBills(req.query, req.user)));
const billGet = asyncHandler(async (req, res) => res.json({ data: await bill.getBill(req.params.id) }));
const billCreate = asyncHandler(async (req, res) => res.status(201).json({ data: await bill.createBill(req.body, req.user) }));
const billUpdate = asyncHandler(async (req, res) => res.json({ data: await bill.updateBill(req.params.id, req.body, req.user) }));
const billIssue = asyncHandler(async (req, res) => res.json({ data: await bill.issueBill(req.params.id, req.user) }));
const billPay = asyncHandler(async (req, res) => res.json({ data: await bill.recordBillPayment(req.params.id, req.body, req.user) }));
const billVoid = asyncHandler(async (req, res) => res.json({ data: await bill.voidBill(req.params.id, req.body, req.user) }));
const apAging = asyncHandler(async (req, res) => res.json({ data: await bill.agingPayables({ asOf: req.query.asOf, businessUnitId: req.query.businessUnitId }) }));
const apDue = asyncHandler(async (req, res) => res.json({ data: await bill.payablesDue({ asOf: req.query.asOf, days: req.query.days ? +req.query.days : 7 }) }));
const suppliersList = asyncHandler(async (req, res) => res.json(await bill.listSuppliers(req.query)));
const supplierCreate = asyncHandler(async (req, res) => res.status(201).json({ data: await bill.createSupplier(req.body, req.user) }));

// ACCRUAL MECHANICS — accrued expenses (reversing entries) + prepaid amortisation.
const accrualsList = asyncHandler(async (req, res) => res.json(await accrual.listAccruals(req.query)));
const accrualCreate = asyncHandler(async (req, res) => res.status(201).json({ data: await accrual.createAccrual(req.body, req.user) }));
const accrualVoid = asyncHandler(async (req, res) => res.json({ data: await accrual.voidAccrual(req.params.id, req.body, req.user) }));
const schedulesList = asyncHandler(async (req, res) => res.json(await accrual.listSchedules(req.query)));
const scheduleCreate = asyncHandler(async (req, res) => res.status(201).json({ data: await accrual.createManualSchedule(req.body, req.user) }));
const amortize = asyncHandler(async (req, res) => res.json({ data: await accrual.postAmortization({ asOf: req.body && req.body.asOf }, req.user) }));

// RECURRING SUBSCRIPTIONS — a recurring bill template that auto-generates a Bill each cycle.
const subsList = asyncHandler(async (req, res) => res.json(await subscription.listSubscriptions(req.query)));
const subGet = asyncHandler(async (req, res) => res.json({ data: await subscription.getSubscription(req.params.id) }));
const subCreate = asyncHandler(async (req, res) => res.status(201).json({ data: await subscription.createSubscription(req.body, req.user) }));
const subUpdate = asyncHandler(async (req, res) => res.json({ data: await subscription.updateSubscription(req.params.id, req.body, req.user) }));
const subPause = asyncHandler(async (req, res) => res.json({ data: await subscription.pauseSubscription(req.params.id) }));
const subResume = asyncHandler(async (req, res) => res.json({ data: await subscription.resumeSubscription(req.params.id) }));
const subCancel = asyncHandler(async (req, res) => res.json({ data: await subscription.cancelSubscription(req.params.id) }));
const subSkip = asyncHandler(async (req, res) => res.json({ data: await subscription.skipCycle(req.params.id) }));
const subRun = asyncHandler(async (req, res) => res.json({ data: await subscription.runSubscriptions({ asOf: req.body && req.body.asOf }, req.user) }));
const subsDue = asyncHandler(async (req, res) => res.json({ data: await subscription.subscriptionsDue({ asOf: req.query.asOf, days: req.query.days ? +req.query.days : 7 }) }));

// FIXED ASSETS & DEPRECIATION — register/list/detail + the monthly run, disposal, bulk import, and the
// gallon-pool reconcile/loss. The service validates + posts; handlers pass through.
const assetsList = asyncHandler(async (req, res) => res.json({ data: await depreciation.listAssets(req.query) }));
const assetGet = asyncHandler(async (req, res) => res.json({ data: await depreciation.getAsset(req.params.id) }));
const assetCreate = asyncHandler(async (req, res) => res.status(201).json({ data: await depreciation.createAsset(req.body, req.user) }));
const assetDispose = asyncHandler(async (req, res) => res.json({ data: await depreciation.disposeAsset(req.params.id, req.body, req.user) }));
const depreciate = asyncHandler(async (req, res) => res.json({ data: await depreciation.postDepreciation({ asOf: req.body && req.body.asOf, assetId: req.body && req.body.assetId }, req.user) }));
const assetsImportPreview = asyncHandler(async (req, res) => res.json({ data: await depreciation.previewImport(req.body && req.body.rows) }));
const assetsImportCommit = asyncHandler(async (req, res) => res.json({ data: await depreciation.commitImport(req.body && req.body.rows, req.user) }));
const gallonPoolReconcile = asyncHandler(async (req, res) => res.json({ data: await depreciation.reconcileGallonPool(req.params.id, req.user) }));
const gallonPoolLoss = asyncHandler(async (req, res) => res.json({ data: await depreciation.gallonPoolLoss(req.params.id, req.body, req.user) }));

// HPP / PRODUCT COSTING — standards, production runs, variance analysis, reports.
const stdList = asyncHandler(async (req, res) => res.json(await costing.listStandards(req.query)));
const stdGet = asyncHandler(async (req, res) => res.json({ data: await costing.getStandard(req.params.id) }));
const stdCreate = asyncHandler(async (req, res) => res.status(201).json({ data: await costing.createStandard(req.body, req.user) }));
const stdRequestActivate = asyncHandler(async (req, res) => res.json({ data: await costing.requestStandardActivation(req.params.id, { ...req.user, reason: req.body && req.body.reason }) }));
const runList = asyncHandler(async (req, res) => res.json(await costing.listRuns(req.query)));
const runGet = asyncHandler(async (req, res) => res.json({ data: await costing.getRun(req.params.id) }));
const runCreate = asyncHandler(async (req, res) => res.status(201).json({ data: await costing.createRun(req.body, req.user) }));
const runComplete = asyncHandler(async (req, res) => res.json({ data: await costing.completeRun(req.params.id, req.user) }));
const varReport = asyncHandler(async (req, res) => res.json({ data: await costing.varianceReport({ year: +req.query.year, month: +req.query.month }) }));
const varClose = asyncHandler(async (req, res) => res.json({ data: await costing.closeVariances({ year: +req.body.year, month: +req.body.month }, req.user) }));
const costingGallonLoss = asyncHandler(async (req, res) => res.json({ data: await costing.gallonLossReconcile({ year: +req.query.year, month: +req.query.month }, req.user) }));
const costingInventory = asyncHandler(async (req, res) => res.json({ data: await costing.costingInventory(req.user) }));
const costingHpp = asyncHandler(async (req, res) => res.json({ data: await costing.monthlyHpp({ year: +req.query.year, month: +req.query.month }) }));
const costingMargin = asyncHandler(async (req, res) => res.json({ data: await costing.marginAnalysis(req.query) }));

module.exports = { trialBalance, balanceSheet, incomeStatement, cashFlow, generalLedger, chart, journal, receivables, unmapped, backfill, backfillStatus, integrity, mappings, setMapping, clearMapping, status, aging, ledger, periods, periodChecklist, periodClose, periodReopen, reconciliation, reconcileMark,
  billsList, billGet, billCreate, billUpdate, billIssue, billPay, billVoid, apAging, apDue, suppliersList, supplierCreate,
  accrualsList, accrualCreate, accrualVoid, schedulesList, scheduleCreate, amortize,
  subsList, subGet, subCreate, subUpdate, subPause, subResume, subCancel, subSkip, subRun, subsDue,
  assetsList, assetGet, assetCreate, assetDispose, depreciate, assetsImportPreview, assetsImportCommit, gallonPoolReconcile, gallonPoolLoss,
  stdList, stdGet, stdCreate, stdRequestActivate, runList, runGet, runCreate, runComplete, varReport, varClose, costingGallonLoss, costingInventory, costingHpp, costingMargin };
