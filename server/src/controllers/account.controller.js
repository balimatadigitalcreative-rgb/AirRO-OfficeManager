'use strict';
const { z } = require('zod');
const service = require('../services/account.service');
const { replaceCollection } = require('../services/sync.service');
const prisma = require('../lib/prisma');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['cash', 'bank']).optional().default('bank'),
  bank: z.string().max(60).optional().default(''),
  number: z.string().max(60).optional().default(''),
  opening: z.number().int().optional().default(0),
  color: z.string().max(20).optional(),
  sortOrder: z.number().int().optional(),
});
const updateSchema = createSchema.partial();
const idParams = z.object({ id: z.string().min(1) });

// Bulk replace-collection: each item carries its client id.
const syncSchema = z.object({
  items: z.array(createSchema.extend({ id: z.string().min(1) })).max(500),
});

const list = asyncHandler(async (req, res) => res.json({ data: await service.list() }));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.update(req.params.id, req.body) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); res.status(204).send(); });
const balance = asyncHandler(async (req, res) => res.json({ data: await service.balance(req.params.id) }));
const sync = asyncHandler(async (req, res) => {
  const data = await replaceCollection(prisma.account, req.body.items);
  bus.broadcast({ entity: 'config', action: 'accounts', id: null });
  res.json({ data });
});

module.exports = { list, getOne, create, update, remove, balance, sync, schemas: { createSchema, updateSchema, idParams, syncSchema } };
