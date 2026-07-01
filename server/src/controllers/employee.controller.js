'use strict';
const { z } = require('zod');
const service = require('../services/employee.service');
const asyncHandler = require('../utils/asyncHandler');
const { RISK_LEVELS, RELIGIONS } = require('../services/payroll.engine');
const { OFFICES, MARITAL } = service;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
// Date that may also be blank (cleared field from the UI).
const DATE_OPT = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Date must be YYYY-MM-DD').optional();
const STR = (max) => z.string().trim().max(max).optional();

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  department: z.string().max(60).optional().default('Staff'),
  base: z.number().int().nonnegative().optional().default(0),
  allowance: z.number().int().nonnegative().optional().default(0), // "Tunjangan lain"
  tjKinerja: z.number().int().nonnegative().optional().default(0),
  tjProfesi: z.number().int().nonnegative().optional().default(0),
  tjRumahDinas: z.number().int().nonnegative().optional().default(0),
  tjBpjsKes: z.number().int().nonnegative().optional().default(0),
  tjBpjsTk: z.number().int().nonnegative().optional().default(0),
  risk: z.enum(RISK_LEVELS).optional().default('Low'),
  jp: z.boolean().optional().default(true),
  religion: z.enum(RELIGIONS).optional().default('Islam'),
  joinedDate: DATE.optional(),
  active: z.boolean().optional().default(true),
  // ── extended HR profile ──
  nip: STR(40), // normally server-generated; accepted for imports
  noSurat: STR(60),
  noKk: STR(40),
  noBpjsKes: STR(40),
  noBpjsTk: STR(40),
  office: z.enum(OFFICES).optional().default('AIRRO'),
  contractStart: DATE_OPT,
  contractEnd: DATE_OPT,
  birthPlace: STR(80),
  birthDate: DATE_OPT,
  addressKtp: STR(240),
  addressDomisili: STR(240),
  maritalStatus: z.enum(MARITAL).optional().default('TK'),
});
const updateSchema = createSchema.partial();
const listQuery = z.object({ includeInactive: z.coerce.boolean().optional().default(false) });
const idParams = z.object({ id: z.string().min(1) });
// Standalone NIP allocation (used by the shared-store UI path).
const nipSchema = z.object({
  office: z.enum(OFFICES).optional().default('AIRRO'),
  contractStart: DATE_OPT,
});

const list = asyncHandler(async (req, res) => res.json({ data: await service.list(req.query.includeInactive) }));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.update(req.params.id, req.body) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); res.status(204).send(); });
// POST /employees/nip → allocate a unique NIP without creating an Employee row.
const generateNip = asyncHandler(async (req, res) => res.json({ data: { nip: await service.allocateNip(req.body) } }));
// POST /employees/:id/regenerate-nip → fresh NIP for an existing DB employee.
const regenerateNip = asyncHandler(async (req, res) => res.json({ data: await service.regenerateNip(req.params.id) }));

module.exports = {
  list, getOne, create, update, remove, generateNip, regenerateNip,
  schemas: { createSchema, updateSchema, listQuery, idParams, nipSchema },
};
