'use strict';
const { z } = require('zod');
const entryService = require('../services/entry.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const TIME = z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:mm');

const createSchema = z.object({
  // client-generated id so an optimistic insert keeps the same key server-side
  // (mirrors the setoran per-record path). Server generates one when omitted.
  id: z.string().min(1).max(80).optional(),
  type: z.enum(['income', 'expense']),
  amount: z.number().int().nonnegative(),
  note: z.string().max(2000).optional().default(''),
  method: z.string().max(60).optional().default('Cash'),
  date: DATE,
  time: TIME.optional().default('00:00'),
  status: z.enum(['Completed', 'Pending', 'Failed']).optional().default('Completed'),
  // Free-form frontend key/id (NOT foreign keys) — see schema.prisma Entry.
  category: z.string().max(60).nullable().optional(),
  acct: z.string().max(60).nullable().optional(),
  proof: z.string().nullable().optional(),           // may be a base64 data URL → large
  meta: z.string().max(4000).nullable().optional(),  // JSON string of extra tags
  gallonQty: z.number().int().nonnegative().max(1000000).optional(),   // "Pembelian Galon" quantity
  // Legacy relational fields — still accepted (the server-side account-balance
  // endpoint and existing API tests reference categoryKey/accountId). The frontend
  // cash book uses the plain category/acct above instead.
  categoryKey: z.string().max(60).nullable().optional(),
  accountId: z.string().max(60).nullable().optional(),
});

// All fields optional for PATCH-style updates.
const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(5000).optional().default(2000),
  type: z.enum(['income', 'expense']).optional(),
  category: z.string().optional(),
  account: z.string().optional(),
  method: z.string().optional(),
  status: z.enum(['Completed', 'Pending', 'Failed']).optional(),
  dateFrom: DATE.optional(),
  dateTo: DATE.optional(),
  since: z.string().optional(),
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
  const entry = await entryService.create(req.body, req.user);
  bus.broadcast({ entity: 'entry', action: 'create', id: entry.id });
  res.status(201).json({ data: entry });
});

const update = asyncHandler(async (req, res) => {
  const entry = await entryService.update(req.params.id, req.body, req.user);
  bus.broadcast({ entity: 'entry', action: 'update', id: entry.id });
  res.json({ data: entry });
});

const remove = asyncHandler(async (req, res) => {
  await entryService.remove(req.params.id);
  bus.broadcast({ entity: 'entry', action: 'delete', id: req.params.id });
  res.status(204).send();
});

module.exports = {
  list, getOne, create, update, remove,
  schemas: { createSchema, updateSchema, listQuerySchema, idParams },
};
