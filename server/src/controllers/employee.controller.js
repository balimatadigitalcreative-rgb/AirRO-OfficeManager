'use strict';
const { z } = require('zod');
const service = require('../services/employee.service');
const asyncHandler = require('../utils/asyncHandler');
const { RISK_LEVELS, RELIGIONS } = require('../services/payroll.engine');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  department: z.string().max(60).optional().default('Staff'),
  base: z.number().int().nonnegative().optional().default(0),
  allowance: z.number().int().nonnegative().optional().default(0),
  risk: z.enum(RISK_LEVELS).optional().default('Low'),
  jp: z.boolean().optional().default(true),
  religion: z.enum(RELIGIONS).optional().default('Islam'),
  joinedDate: DATE.optional(),
  active: z.boolean().optional().default(true),
});
const updateSchema = createSchema.partial();
const listQuery = z.object({ includeInactive: z.coerce.boolean().optional().default(false) });
const idParams = z.object({ id: z.string().min(1) });

const list = asyncHandler(async (req, res) => res.json({ data: await service.list(req.query.includeInactive) }));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.update(req.params.id, req.body) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); res.status(204).send(); });

module.exports = { list, getOne, create, update, remove, schemas: { createSchema, updateSchema, listQuery, idParams } };
