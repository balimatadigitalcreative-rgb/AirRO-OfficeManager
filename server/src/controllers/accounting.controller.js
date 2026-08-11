'use strict';
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/accounting.service');
const period = require('../services/period.service');
const recon = require('../services/reconciliation.service');
const range = (req) => ({ dateFrom: req.query.dateFrom, dateTo: req.query.dateTo });

const trialBalance = asyncHandler(async (req, res) => res.json({ data: await service.trialBalance(range(req)) }));
const balanceSheet = asyncHandler(async (req, res) => res.json({ data: await service.balanceSheet(range(req)) }));
const incomeStatement = asyncHandler(async (req, res) => res.json({ data: await service.incomeStatement(range(req)) }));
const generalLedger = asyncHandler(async (req, res) => res.json({ data: await service.accountBalances(range(req)) }));
const receivables = asyncHandler(async (req, res) => res.json({ data: { balance: await service.receivablesBalance(range(req)) } }));
const unmapped = asyncHandler(async (req, res) => res.json({ data: await service.unmappedCategories() }));
const aging = asyncHandler(async (req, res) => res.json({ data: await service.agingReceivables({ asOf: req.query.asOf, fleetId: req.query.fleetId, businessUnitId: req.query.businessUnitId }) }));
const ledger = asyncHandler(async (req, res) => res.json({ data: await service.generalLedger({ code: req.query.code, dateFrom: req.query.dateFrom, dateTo: req.query.dateTo }) }));
const periods = asyncHandler(async (req, res) => res.json({ data: await period.listPeriods() }));
const periodChecklist = asyncHandler(async (req, res) => res.json({ data: await period.closeChecklist(+req.query.year, +req.query.month) }));
const periodClose = asyncHandler(async (req, res) => res.json({ data: await period.closePeriod({ year: +req.body.year, month: +req.body.month, lock: !!req.body.lock }, req.user) }));
const periodReopen = asyncHandler(async (req, res) => res.json({ data: await period.reopenPeriod({ year: +req.body.year, month: +req.body.month, reason: req.body.reason }, req.user) }));
const reconciliation = asyncHandler(async (req, res) => res.json({ data: await recon.reconcileView({ accountId: req.query.accountId, statementBalance: req.query.statementBalance }) }));
const reconcileMark = asyncHandler(async (req, res) => res.json({ data: await recon.markCleared({ accountId: req.body.accountId, itemType: req.body.itemType, itemId: req.body.itemId, cleared: req.body.cleared, statementRef: req.body.statementRef }, req.user) }));
const backfill = asyncHandler(async (req, res) => res.json({ data: await service.backfill({ fromDate: req.body && req.body.fromDate, actor: req.user }) }));

module.exports = { trialBalance, balanceSheet, incomeStatement, generalLedger, receivables, unmapped, backfill, aging, ledger, periods, periodChecklist, periodClose, periodReopen, reconciliation, reconcileMark };
