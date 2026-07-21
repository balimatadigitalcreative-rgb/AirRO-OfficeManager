'use strict';
const { z } = require('zod');
const service = require('../services/businessUnit.service');
const asyncHandler = require('../utils/asyncHandler');

const idParams = z.object({ id: z.string().min(1) });
const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().max(12).optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  code: z.string().trim().max(12).optional(),
  active: z.boolean().optional(),
});

const list = asyncHandler(async (req, res) => res.json({ data: await service.listUnits() }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.createUnit(req.body) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.updateUnit(req.params.id, req.body) }));

module.exports = { list, create, update, schemas: { idParams, createSchema, updateSchema } };
