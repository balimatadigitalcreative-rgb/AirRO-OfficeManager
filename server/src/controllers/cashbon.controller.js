'use strict';
const { z } = require('zod');
const service = require('../services/cashbon.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
// pending → approved/rejected is the approval flow; active/paid/cancelled kept for
// legacy rows (active is treated as approved when deducting).
const STATUS = z.enum(['pending', 'approved', 'rejected', 'active', 'paid', 'cancelled']);

const createSchema = z.object({
  id: z.string().min(1).max(80).optional(),   // client id (optimistic insert / import)
  employeeId: z.string().min(1),
  amount: z.number().int().positive(),
  date: DATE,
  note: z.string().max(300).optional().default(''),
  installments: z.number().int().positive().max(60).optional().default(1),
  status: STATUS.optional().default('pending'),
  cycleAnchor: z.string().max(20).nullable().optional(),
}).passthrough();   // keep the approval-trail fields (requestedBy/approvedBy/…) → folded into `data`
const updateSchema = createSchema.partial();
const listQuery = z.object({ employeeId: z.string().optional(), status: STATUS.optional() });
const idParams = z.object({ id: z.string().min(1) });
const previewSchema = z.object({ employeeId: z.string().min(1), date: DATE, amount: z.number().int().nonnegative().optional().default(0) });
const requestSchema = z.object({ employeeId: z.string().min(1), amount: z.number().int().positive(), date: DATE, note: z.string().max(300).optional().default('') });
const rejectSchema = z.object({ reason: z.string().max(300).optional().default('') });

const bcast = (action, id) => bus.broadcast({ entity: 'cashbon', action, id });
const preview = asyncHandler(async (req, res) => res.json({ data: await service.preview(req.body) }));
const request = asyncHandler(async (req, res) => { const r = await service.request(req.body, req.user); bcast('create', r.cashbon.id); res.status(201).json({ data: r }); });
const list = asyncHandler(async (req, res) => res.json(await service.list(req.query)));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => { const c = await service.create(req.body, req.user?.id); bcast('create', c.id); res.status(201).json({ data: c }); });
const update = asyncHandler(async (req, res) => { const c = await service.update(req.params.id, req.body); bcast('update', c.id); res.json({ data: c }); });
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); bcast('delete', req.params.id); res.status(204).send(); });
const approve = asyncHandler(async (req, res) => { const c = await service.decide(req.params.id, 'approved', req.user); bcast('update', c.id); res.json({ data: c }); });
const reject = asyncHandler(async (req, res) => { const c = await service.decide(req.params.id, 'rejected', req.user, req.body.reason); bcast('update', c.id); res.json({ data: c }); });

module.exports = { list, getOne, create, update, remove, preview, request, approve, reject, schemas: { createSchema, updateSchema, listQuery, idParams, previewSchema, requestSchema, rejectSchema } };
