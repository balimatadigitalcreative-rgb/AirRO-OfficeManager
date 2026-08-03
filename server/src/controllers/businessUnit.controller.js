'use strict';
const { z } = require('zod');
const service = require('../services/businessUnit.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

const idParams = z.object({ id: z.string().min(1) });
// `officeCode` = the NIP <OFFICE> prefix for staff placed in this unit (owner-editable, so a new
// unit can get its own). Validated against the allowed set in the service.
const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().max(12).optional(),
  officeCode: z.string().trim().max(12).optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  code: z.string().trim().max(12).optional(),
  officeCode: z.string().trim().max(12).optional(),
  active: z.boolean().optional(),
  // Per-unit module toggle: 'all' or a list of module keys (finance | hr | distribusi | gudang).
  enabledModules: z.union([z.literal('all'), z.array(z.string().max(20)).max(12)]).optional(),
});

const list = asyncHandler(async (req, res) => res.json({ data: await service.listUnits() }));
const create = asyncHandler(async (req, res) => { const data = await service.createUnit(req.body); bus.broadcast({ entity: 'config', action: 'bunits', id: data.id }); res.status(201).json({ data }); });
// Broadcast a config event so every client re-pulls the unit dictionary (module toggles change the
// nav for everyone whose active unit is affected) without needing a reload.
const update = asyncHandler(async (req, res) => { const data = await service.updateUnit(req.params.id, req.body); bus.broadcast({ entity: 'config', action: 'bunits', id: data.id }); res.json({ data }); });

module.exports = { list, create, update, schemas: { idParams, createSchema, updateSchema } };
