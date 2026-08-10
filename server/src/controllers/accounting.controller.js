'use strict';
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/accounting.service');
const range = (req) => ({ dateFrom: req.query.dateFrom, dateTo: req.query.dateTo });

const trialBalance = asyncHandler(async (req, res) => res.json({ data: await service.trialBalance(range(req)) }));
const balanceSheet = asyncHandler(async (req, res) => res.json({ data: await service.balanceSheet(range(req)) }));
const incomeStatement = asyncHandler(async (req, res) => res.json({ data: await service.incomeStatement(range(req)) }));
const generalLedger = asyncHandler(async (req, res) => res.json({ data: await service.accountBalances(range(req)) }));
const receivables = asyncHandler(async (req, res) => res.json({ data: { balance: await service.receivablesBalance(range(req)) } }));
const unmapped = asyncHandler(async (req, res) => res.json({ data: await service.unmappedCategories() }));
const backfill = asyncHandler(async (req, res) => res.json({ data: await service.backfill({ fromDate: req.body && req.body.fromDate, actor: req.user }) }));

module.exports = { trialBalance, balanceSheet, incomeStatement, generalLedger, receivables, unmapped, backfill };
