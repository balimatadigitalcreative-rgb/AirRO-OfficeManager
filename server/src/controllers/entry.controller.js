'use strict';
const { z } = require('zod');
const entryService = require('../services/entry.service');
const asyncHandler = require('../utils/asyncHandler');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const TIME = z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:mm');

const createSchema = z.object({
  type: z.enum(['income', 'expense']),
  amount: z.number().int().positive(),
  note: z.string().max(500).optional().default(''),
  method: z.string().max(60).optional().default('Cash'),
  date: DATE,
  time: TIME.optional().default('00:00'),
  status: z.enum(['Completed', 'Pending', 'Failed']).optional().default('Completed'),
  categoryKey: z.string().max(60).optional(),
  accountId: z.string().max(60).optional(),
});

// All fields optional for PATCH-style updates.
const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  type: z.enum(['income', 'expense']).optional(),
  category: z.string().optional(),
  account: z.string().optional(),
  method: z.string().optional(),
  status: z.enum(['Completed', 'Pending', 'Failed']).optional(),
  dateFrom: DATE.optional(),
  dateTo: DATE.optional(),
  search: z.string().max(120).optional(),
});

const idParams = z.object({ id: z.string().min(1) });

const list = asyncHandler(async (req, res) => {
  res.json(await entryService.list(req.query));
});

const getOne = asyncHandler(async (req, res) => {
  res.json({ data: await entryService.getById(req.params.id) });
});

const create = asyncHandler(async (req, res) => {
  const entry = await entryService.create(req.body, req.user?.id);
  res.status(201).json({ data: entry });
});

const update = asyncHandler(async (req, res) => {
  res.json({ data: await entryService.update(req.params.id, req.body) });
});

const remove = asyncHandler(async (req, res) => {
  await entryService.remove(req.params.id);
  res.status(204).send();
});

module.exports = {
  list, getOne, create, update, remove,
  schemas: { createSchema, updateSchema, listQuerySchema, idParams },
};
