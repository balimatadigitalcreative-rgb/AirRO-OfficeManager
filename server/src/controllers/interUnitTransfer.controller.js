'use strict';
const { z } = require('zod');
const service = require('../services/interUnitTransfer.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

const createSchema = z.object({
  fromUnitId: z.string().min(1).max(60),
  toUnitId: z.string().min(1).max(60),
  fromAccountId: z.string().min(1).max(60),
  toAccountId: z.string().min(1).max(60),
  amount: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  category: z.string().max(60).nullable().optional(),
  note: z.string().max(2000).optional(),
});
const groupParams = z.object({ groupId: z.string().min(1) });

const create = asyncHandler(async (req, res) => {
  const r = await service.createTransfer(req.body, req.user);
  bus.broadcast({ entity: 'entry', action: 'inter-unit', id: r.transferGroupId });
  res.status(201).json({ data: r });
});
const remove = asyncHandler(async (req, res) => {
  const r = await service.voidTransfer(req.params.groupId);
  bus.broadcast({ entity: 'entry', action: 'inter-unit-void', id: req.params.groupId });
  res.json({ data: r });
});

module.exports = { create, remove, schemas: { createSchema, groupParams } };
