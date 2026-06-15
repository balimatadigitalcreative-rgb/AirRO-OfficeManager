'use strict';
const { z } = require('zod');
const service = require('../services/report.service');
const asyncHandler = require('../utils/asyncHandler');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const rangeQuery = z.object({ dateFrom: DATE.optional(), dateTo: DATE.optional() });
const breakdownQuery = rangeQuery.extend({ type: z.enum(['income', 'expense']).optional().default('expense') });

const summary = asyncHandler(async (req, res) => res.json({ data: await service.summary(req.query) }));
const cashflow = asyncHandler(async (req, res) => res.json({ data: await service.cashflow(req.query) }));
const breakdown = asyncHandler(async (req, res) => res.json({ data: await service.breakdown(req.query) }));

module.exports = { summary, cashflow, breakdown, schemas: { rangeQuery, breakdownQuery } };
