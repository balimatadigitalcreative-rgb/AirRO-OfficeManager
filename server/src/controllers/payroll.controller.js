'use strict';
const { z } = require('zod');
const service = require('../services/payroll.service');
const asyncHandler = require('../utils/asyncHandler');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const postSchema = z.object({ date: DATE, accountId: z.string().optional() });

const run = asyncHandler(async (req, res) => res.json({ data: await service.run() }));
const post = asyncHandler(async (req, res) => {
  const entry = await service.post(req.body, req.user?.id);
  res.status(201).json({ data: entry });
});

module.exports = { run, post, schemas: { postSchema } };
