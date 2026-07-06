'use strict';
const { z } = require('zod');
const service = require('../services/role.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');
const { refreshRoleCache } = require('../config/permissions');

const createSchema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1).max(60),
  color: z.string().max(20).optional(),
  permissions: z.record(z.boolean()).optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().max(20).optional(),
  permissions: z.record(z.boolean()).optional(),
});
const idParams = z.object({ id: z.string().min(1) });

// After any role change: refresh the server's live permission cache (so requireCap
// resolves the new perms immediately) and notify clients to reload the role list.
async function afterWrite(action, id) { await refreshRoleCache(); bus.broadcast({ entity: 'role', action, id }); }

const list = asyncHandler(async (req, res) => res.json({ data: await service.list() }));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => { const r = await service.create(req.body); await afterWrite('create', r.id); res.status(201).json({ data: r }); });
const update = asyncHandler(async (req, res) => { const r = await service.update(req.params.id, req.body); await afterWrite('update', r.id); res.json({ data: r }); });
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); await afterWrite('delete', req.params.id); res.status(204).send(); });

module.exports = { list, getOne, create, update, remove, schemas: { createSchema, updateSchema, idParams } };
