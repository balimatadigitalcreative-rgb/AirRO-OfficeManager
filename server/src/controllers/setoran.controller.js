'use strict';
const { z } = require('zod');
const service = require('../services/setoran.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const createSchema = z.object({
  date: DATE,
  armada: z.string().max(60).optional().default(''),
  fleetId: z.string().optional(),
  galon: z.number().int().nonnegative().optional().default(0),
  cash: z.number().int().nonnegative().optional().default(0),
  bon: z.number().int().nonnegative().optional().default(0),
  bonPay: z.number().int().nonnegative().optional().default(0),
  expense: z.number().int().nonnegative().optional().default(0),
  note: z.string().max(300).optional().default(''),
  proof: z.string().nullable().optional(),
  // client-generated id so an optimistic insert keeps the same key server-side
  id: z.string().min(1).max(60).optional(),
});
const updateSchema = createSchema.partial();
const listQuery = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(5000).optional().default(2000),
  date: DATE.optional(),
  dateFrom: DATE.optional(),
  dateTo: DATE.optional(),
  fleetId: z.string().optional(),
  since: z.string().optional(),   // incremental poll: records changed at/after this ISO
});
const idParams = z.object({ id: z.string().min(1) });

const list = asyncHandler(async (req, res) => res.json(await service.list(req.query)));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => { const data = await service.create(req.body, req.user?.id); bus.broadcast({ entity: 'setoran', action: 'create', id: data.id }); res.status(201).json({ data }); });
const update = asyncHandler(async (req, res) => { const data = await service.update(req.params.id, req.body); bus.broadcast({ entity: 'setoran', action: 'update', id: data.id }); res.json({ data }); });
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); bus.broadcast({ entity: 'setoran', action: 'delete', id: req.params.id }); res.status(204).send(); });

module.exports = { list, getOne, create, update, remove, schemas: { createSchema, updateSchema, listQuery, idParams } };
