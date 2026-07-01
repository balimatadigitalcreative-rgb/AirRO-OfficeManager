'use strict';
const { z } = require('zod');
const service = require('../services/cashbon.service');
const asyncHandler = require('../utils/asyncHandler');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const STATUS = z.enum(['active', 'paid', 'cancelled']);

const createSchema = z.object({
  employeeId: z.string().min(1),
  amount: z.number().int().positive(),
  date: DATE,
  note: z.string().max(300).optional().default(''),
  installments: z.number().int().positive().max(60).optional().default(1),
  status: STATUS.optional().default('active'),
});
const updateSchema = createSchema.partial();
const listQuery = z.object({ employeeId: z.string().optional(), status: STATUS.optional() });
const idParams = z.object({ id: z.string().min(1) });

const list = asyncHandler(async (req, res) => res.json(await service.list(req.query)));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.update(req.params.id, req.body) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); res.status(204).send(); });

module.exports = { list, getOne, create, update, remove, schemas: { createSchema, updateSchema, listQuery, idParams } };
