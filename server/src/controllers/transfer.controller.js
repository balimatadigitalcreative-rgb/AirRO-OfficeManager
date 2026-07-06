'use strict';
const { z } = require('zod');
const service = require('../services/transfer.service');
const { replaceCollection } = require('../services/sync.service');
const prisma = require('../lib/prisma');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const createSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  amount: z.number().int().positive(),
  date: DATE,
  note: z.string().max(300).optional().default(''),
});
const listQuery = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(5000).optional().default(2000),
  account: z.string().optional(),
  dateFrom: DATE.optional(),
  dateTo: DATE.optional(),
});
const idParams = z.object({ id: z.string().min(1) });
const syncSchema = z.object({
  items: z.array(createSchema.extend({ id: z.string().min(1) })).max(2000),
});

const list = asyncHandler(async (req, res) => res.json(await service.list(req.query)));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body, req.user?.id) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); res.status(204).send(); });
const sync = asyncHandler(async (req, res) => {
  const data = await replaceCollection(prisma.transfer, req.body.items);
  bus.broadcast({ entity: 'config', action: 'transfers', id: null });
  res.json({ data });
});

module.exports = { list, getOne, create, remove, sync, schemas: { createSchema, listQuery, idParams, syncSchema } };
