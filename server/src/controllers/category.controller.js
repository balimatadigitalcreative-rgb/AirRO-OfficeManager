'use strict';
const { z } = require('zod');
const service = require('../services/category.service');
const asyncHandler = require('../utils/asyncHandler');

const createSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(80),
  icon: z.string().max(40).optional().default('IconDots'),
  type: z.enum(['income', 'expense']),
});
const updateSchema = createSchema.partial();
const listQuery = z.object({ type: z.enum(['income', 'expense']).optional() });
const idParams = z.object({ id: z.string().min(1) });

const list = asyncHandler(async (req, res) => res.json({ data: await service.list(req.query.type) }));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.update(req.params.id, req.body) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); res.status(204).send(); });

module.exports = { list, getOne, create, update, remove, schemas: { createSchema, updateSchema, listQuery, idParams } };
