'use strict';
const { z } = require('zod');
const service = require('../services/approval.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

// Approvals are stored as a per-record DOCUMENT (full object in `data`); validate
// loosely and keep every field via passthrough. Capabilities enforced in the route.
const createSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  type: z.string().max(40).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
}).passthrough();
const updateSchema = createSchema.partial();
const idParams = z.object({ id: z.string().min(1) });

const bcast = (action, id) => bus.broadcast({ entity: 'approval', action, id });
const list = asyncHandler(async (req, res) => res.json(await service.list()));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => { const a = await service.create(req.body); bcast('create', a.id); res.status(201).json({ data: a }); });
const update = asyncHandler(async (req, res) => { const a = await service.update(req.params.id, req.body); bcast('update', a.id); res.json({ data: a }); });
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); bcast('delete', req.params.id); res.status(204).send(); });

module.exports = { list, getOne, create, update, remove, schemas: { createSchema, updateSchema, idParams } };
