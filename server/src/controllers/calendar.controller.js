'use strict';
const { z } = require('zod');
const service = require('../services/calendar.service');
const asyncHandler = require('../utils/asyncHandler');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const DATE_OPT = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Date must be YYYY-MM-DD').optional();
const TYPE = z.enum(['holiday', 'leave', 'permit']);

const createSchema = z.object({
  type: TYPE,
  title: z.string().trim().min(1).max(160),
  employeeId: z.string().optional().nullable(),
  startDate: DATE,
  endDate: DATE_OPT,
  note: z.string().max(500).optional().default(''),
  sourceId: z.string().max(60).optional().nullable(),
});
const updateSchema = createSchema.partial();
const listQuery = z.object({ type: TYPE.optional(), employeeId: z.string().optional(), dateFrom: DATE.optional(), dateTo: DATE.optional() });
const idParams = z.object({ id: z.string().min(1) });

const list = asyncHandler(async (req, res) => res.json(await service.list(req.query)));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.update(req.params.id, req.body) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); res.status(204).send(); });

module.exports = { list, getOne, create, update, remove, schemas: { createSchema, updateSchema, listQuery, idParams } };
