'use strict';
const { z } = require('zod');
const service = require('../services/distribution.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');
const { resolvePerms } = require('../config/permissions');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const bcast = (action, id) => bus.broadcast({ entity: 'distribusi', action, id });

// ── validation schemas ──
const DAYS = z.array(z.string().max(4)).max(7);   // day codes; the service canonicalises them
const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().max(40).optional().default(''),
  type: z.string().trim().min(1).max(60).optional().default('reguler'),   // CustomerType id (validated in the service)
  masterPrice: z.number().int().nonnegative().optional().default(0),
  deliveryDays: DAYS.optional(),
  armada: z.string().max(40).optional(),
});
// Edit: every field optional; masterPrice is NOT accepted here (owner-gated price route).
const customerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().max(40).optional(),
  type: z.string().trim().min(1).max(60).optional(),
  deliveryDays: DAYS.optional(),
  armada: z.string().max(40).optional(),
});
const importSchema = z.object({ customers: z.array(customerSchema.partial({ masterPrice: true, phone: true, type: true })).max(5000) });
const priceSchema = z.object({ newPrice: z.number().int().nonnegative() });
// Customer types (editable dictionary)
const typeCreateSchema = z.object({ label: z.string().trim().min(1).max(60) });
const typeRenameSchema = z.object({ label: z.string().trim().min(1).max(60) });
const typeDeleteQuery = z.object({ reassignTo: z.string().min(1).optional() });
// NOTE: no unitPrice/amount here — the server locks the price from master_price.
const txnSchema = z.object({
  customerId: z.string().min(1),
  qty: z.number().int().positive(),
  method: z.enum(['lunas', 'bon', 'pelunasan']).optional().default('lunas'),
  note: z.string().max(300).optional().default(''),
  txnDate: DATE,
});
const correctionSchema = z.object({
  reason: z.string().trim().min(1, 'reason is required').max(1000),
  oldValue: z.any().optional(),
  newValue: z.any().optional(),
});
const listTxnQuery = z.object({
  date: DATE.optional(), dateFrom: DATE.optional(), dateTo: DATE.optional(),
  customerId: z.string().optional(), method: z.enum(['lunas', 'bon', 'pelunasan']).optional(),
});
const auditQuery = z.object({ kind: z.enum(['koreksi', 'harga', 'input', 'impor', 'pelanggan']).optional(), limit: z.coerce.number().int().positive().max(2000).optional() });
const summaryQuery = z.object({ date: DATE.optional() });
const idParams = z.object({ id: z.string().min(1) });

// ── customers ──
const listCustomers = asyncHandler(async (req, res) => res.json(await service.listCustomers()));
const getCustomer = asyncHandler(async (req, res) => res.json({ data: await service.getCustomer(req.params.id) }));
const createCustomer = asyncHandler(async (req, res) => { const c = await service.createCustomer(req.body, req.user); bcast('create', c.id); res.status(201).json({ data: c }); });
const updateCustomer = asyncHandler(async (req, res) => { const c = await service.updateCustomer(req.params.id, req.body, req.user); bcast('update', c.id); res.json({ data: c }); });
const importCustomers = asyncHandler(async (req, res) => { const r = await service.importCustomers(req.body.customers, req.user); bcast('import', 'customers'); res.status(201).json(r); });
const updatePrice = asyncHandler(async (req, res) => { const c = await service.updatePrice(req.params.id, req.body.newPrice, req.user); bcast('price', c.id); res.json({ data: c }); });

// ── customer types (editable dictionary) ──
const listTypes = asyncHandler(async (req, res) => res.json(await service.listTypes()));
const createType = asyncHandler(async (req, res) => { const t = await service.createType(req.body, req.user); bcast('type', t.id); res.status(201).json({ data: t }); });
const updateType = asyncHandler(async (req, res) => { const t = await service.renameType(req.params.id, req.body, req.user); bcast('type', t.id); res.json({ data: t }); });
const deleteType = asyncHandler(async (req, res) => { const r = await service.deleteType(req.params.id, req.query.reassignTo, req.user); bcast('type', req.params.id); res.json({ data: r }); });

// ── transactions ── (immutable; price locked server-side)
const listTransactions = asyncHandler(async (req, res) => res.json(await service.listTransactions(req.query)));
const createTransaction = asyncHandler(async (req, res) => { const t = await service.createTransaction(req.body, req.user); bcast('create', t.id); res.status(201).json({ data: t }); });
const addCorrection = asyncHandler(async (req, res) => {
  // A "staff" actor has 'distribusi' but none of the owner distribusi caps → flag it.
  const perms = resolvePerms(req.user.role, req.user.permissions);
  const isStaff = !perms.distribusiAudit && !perms.distribusiHargaMaster && !perms.distribusiCustomers;
  const c = await service.addCorrection(req.params.id, req.body, req.user, isStaff);
  bcast('correction', req.params.id);
  res.status(201).json({ data: c });
});

// ── audit + dashboard ──
const listAudit = asyncHandler(async (req, res) => res.json(await service.listAudit(req.query)));
const dashboardSummary = asyncHandler(async (req, res) => res.json({ data: await service.dashboardSummary(req.query.date) }));

module.exports = {
  listCustomers, getCustomer, createCustomer, updateCustomer, importCustomers, updatePrice,
  listTypes, createType, updateType, deleteType,
  listTransactions, createTransaction, addCorrection, listAudit, dashboardSummary,
  schemas: { customerSchema, customerUpdateSchema, importSchema, priceSchema, txnSchema, correctionSchema, listTxnQuery, auditQuery, summaryQuery, idParams, typeCreateSchema, typeRenameSchema, typeDeleteQuery },
};
