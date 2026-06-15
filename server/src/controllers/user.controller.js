'use strict';
const { z } = require('zod');
const service = require('../services/user.service');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/permissions');

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(4).max(200), // PIN-style (4+); login enforces no minimum
  role: z.enum(ROLES),
  sub: z.string().max(120).optional(),
  color: z.string().max(20).optional(),
  active: z.boolean().optional(),
});
const updateSchema = createSchema.partial();
const idParams = z.object({ id: z.string().min(1) });

const list = asyncHandler(async (req, res) => res.json({ data: await service.list() }));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.update(req.params.id, req.body) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id, req.user.id); res.status(204).send(); });

module.exports = { list, getOne, create, update, remove, schemas: { createSchema, updateSchema, idParams } };
