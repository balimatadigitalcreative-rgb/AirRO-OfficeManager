'use strict';
const { z } = require('zod');
const service = require('../services/distribution.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');
const { resolvePerms } = require('../config/permissions');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const bcast = (action, id) => bus.broadcast({ entity: 'distribusi', action, id });

// ── validation schemas ──
const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().max(40).optional().default(''),
  type: z.enum(['reguler', 'kos', 'cafe', 'bulk']).optional().default('reguler'),
  masterPrice: z.number().int().nonnegative().optional().default(0),
});
const importSchema = z.object({ customers: z.array(customerSchema.partial({ masterPrice: true, phone: true, type: true })).max(5000) });
const priceSchema = z.object({ newPrice: z.number().int().nonnegative() });
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
const importCustomers = asyncHandler(async (req, res) => { const r = await service.importCustomers(req.body.customers, req.user); bcast('import', 'customers'); res.status(201).json(r); });
const updatePrice = asyncHandler(async (req, res) => { const c = await service.updatePrice(req.params.id, req.body.newPrice, req.user); bcast('price', c.id); res.json({ data: c }); });

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
  listCustomers, getCustomer, createCustomer, importCustomers, updatePrice,
  listTransactions, createTransaction, addCorrection, listAudit, dashboardSummary,
  schemas: { customerSchema, importSchema, priceSchema, txnSchema, correctionSchema, listTxnQuery, auditQuery, summaryQuery, idParams },
};
