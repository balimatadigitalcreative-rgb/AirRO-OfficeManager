'use strict';
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/accounting.service');
const period = require('../services/period.service');
const recon = require('../services/reconciliation.service');
const range = (req) => ({ dateFrom: req.query.dateFrom, dateTo: req.query.dateTo });

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
// Backfill supports a DRY-RUN (?dryRun / body.dryRun) — the preview screen shows what WOULD post,
// per source type, writing nothing.
const backfill = asyncHandler(async (req, res) => res.json({ data: await service.backfill({ fromDate: req.body && req.body.fromDate, dryRun: !!(req.body && req.body.dryRun), actor: req.user }) }));
// INTEGRITY / drift detector — sources with no journal + journals with no source.
const integrity = asyncHandler(async (req, res) => res.json({ data: await service.integrityCheck({ fromDate: req.query.fromDate }) }));
// PEMETAAN AKUN — category → account mapping (list / set / clear).
const mappings = asyncHandler(async (req, res) => res.json({ data: await service.listCategoryMappings() }));
const setMapping = asyncHandler(async (req, res) => res.json({ data: await service.setCategoryMapping({ categoryKey: req.body.categoryKey, type: req.body.type, chartCode: req.body.chartCode }, req.user) }));
const clearMapping = asyncHandler(async (req, res) => res.json({ data: await service.clearCategoryMapping({ categoryKey: req.body.categoryKey, type: req.body.type }) }));

module.exports = { trialBalance, balanceSheet, incomeStatement, cashFlow, generalLedger, chart, journal, receivables, unmapped, backfill, integrity, mappings, setMapping, clearMapping, aging, ledger, periods, periodChecklist, periodClose, periodReopen, reconciliation, reconcileMark };
