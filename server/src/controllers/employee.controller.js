'use strict';
const { z } = require('zod');
const service = require('../services/employee.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');
const { OFFICES } = service;

const DATE_OPT = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Date must be YYYY-MM-DD').optional();

// Employees are stored as a per-record DOCUMENT: the full frontend staff object is
// kept verbatim in the `data` column and projected onto structured columns by the
// service (see employee.service.toColumns). So the request body is validated
// LOOSELY — only `name` is required and a client `id` is accepted — with
// `.passthrough()` keeping every rich frontend field (pos, pph, deductions[],
// employment-type `status`, inline `orientation`, …). Capabilities are still
// enforced by requireCap in the routes.
const createSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120),
}).passthrough();
const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
}).passthrough();
const listQuery = z.object({ includeInactive: z.coerce.boolean().optional().default(false) });
const idParams = z.object({ id: z.string().min(1) });
// Standalone NIP allocation (used by the shared-store UI path).
const nipSchema = z.object({
  office: z.enum(OFFICES).optional().default('AIRRO'),
  contractStart: DATE_OPT,
});

const list = asyncHandler(async (req, res) => res.json({ data: await service.list(req.query.includeInactive) }));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => { const e = await service.create(req.body); bus.broadcast({ entity: 'employee', action: 'create', id: e.id }); res.status(201).json({ data: e }); });
const update = asyncHandler(async (req, res) => { const e = await service.update(req.params.id, req.body); bus.broadcast({ entity: 'employee', action: 'update', id: e.id }); res.json({ data: e }); });
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); bus.broadcast({ entity: 'employee', action: 'delete', id: req.params.id }); res.status(204).send(); });
// POST /employees/nip → allocate a unique NIP without creating an Employee row.
const generateNip = asyncHandler(async (req, res) => res.json({ data: { nip: await service.allocateNip(req.body) } }));
// POST /employees/:id/regenerate-nip → fresh NIP for an existing DB employee.
const regenerateNip = asyncHandler(async (req, res) => { const e = await service.regenerateNip(req.params.id); bus.broadcast({ entity: 'employee', action: 'update', id: e.id }); res.json({ data: e }); });

module.exports = {
  list, getOne, create, update, remove, generateNip, regenerateNip,
  schemas: { createSchema, updateSchema, listQuery, idParams, nipSchema },
};
