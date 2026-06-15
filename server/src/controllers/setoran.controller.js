'use strict';
const { z } = require('zod');
const service = require('../services/setoran.service');
const asyncHandler = require('../utils/asyncHandler');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const createSchema = z.object({
  date: DATE,
  fleetId: z.string().optional(),
  cash: z.number().int().nonnegative().optional().default(0),
  bonPay: z.number().int().nonnegative().optional().default(0),
  expense: z.number().int().nonnegative().optional().default(0),
  note: z.string().max(300).optional().default(''),
});
const updateSchema = createSchema.partial();
const listQuery = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  date: DATE.optional(),
  dateFrom: DATE.optional(),
  dateTo: DATE.optional(),
  fleetId: z.string().optional(),
});
const idParams = z.object({ id: z.string().min(1) });

const list = asyncHandler(async (req, res) => res.json(await service.list(req.query)));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body, req.user?.id) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.update(req.params.id, req.body) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); res.status(204).send(); });

module.exports = { list, getOne, create, update, remove, schemas: { createSchema, updateSchema, listQuery, idParams } };
