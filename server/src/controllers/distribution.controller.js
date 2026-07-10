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
const reminderSchema = z.object({
  enabled: z.boolean().optional(),
  dueDay: z.number().int().min(0).max(31).optional(),
  weekday: z.string().max(4).optional(),
  overdueDays: z.number().int().min(0).max(3650).optional(),
  gallonThreshold: z.number().int().min(0).optional(),
  bonThreshold: z.number().int().min(0).optional(),
}).nullable();
const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().max(40).optional().default(''),
  type: z.string().trim().min(1).max(60).optional().default('reguler'),   // CustomerType id (validated in the service)
  masterPrice: z.number().int().nonnegative().optional().default(0),
  deliveryDays: DAYS.optional(),
  armada: z.string().max(40).optional(),
  reminder: reminderSchema.optional(),
});
// Edit: every field optional; masterPrice is NOT accepted here (owner-gated price route).
const customerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().max(40).optional(),
  type: z.string().trim().min(1).max(60).optional(),
  deliveryDays: DAYS.optional(),
  armada: z.string().max(40).optional(),
  reminder: reminderSchema.optional(),
});
const importSchema = z.object({ customers: z.array(customerSchema.partial({ masterPrice: true, phone: true, type: true })).max(5000) });
// scope null/omitted = option (a) new-only; 'all'|'cycle'|'bon' = option (b) retroactive.
const priceSchema = z.object({ newPrice: z.number().int().nonnegative(), scope: z.enum(['all', 'cycle', 'bon']).nullable().optional() });
const pricePreviewSchema = z.object({ newPrice: z.number().int().nonnegative() });
// Customer types (editable dictionary)
const typeCreateSchema = z.object({ label: z.string().trim().min(1).max(60) });
const typeRenameSchema = z.object({ label: z.string().trim().min(1).max(60) });
const typeDeleteQuery = z.object({ reassignTo: z.string().min(1).optional() });
// NOTE: no unitPrice/amount here — the server locks the price from master_price.
const txnSchema = z.object({
  customerId: z.string().min(1),
  qty: z.number().int().nonnegative().optional().default(0),   // 0 allowed for a standalone bon payment
  method: z.enum(['lunas', 'bon', 'pelunasan']).optional().default('lunas'),
  note: z.string().max(300).optional().default(''),
  txnDate: DATE,
  gallonOut: z.number().int().nonnegative().optional(),   // full gallons delivered (default = qty)
  gallonIn: z.number().int().nonnegative().optional(),    // empty gallons returned
  payAmount: z.number().int().nonnegative().optional(),   // method='pelunasan': bon payment amount
  payMethod: z.enum(['cash', 'transfer']).optional(),     // method='pelunasan': how it was paid
});
// Gallon stock: a correction is a SIGNED delta (may be negative); reason required.
const gallonCorrectionSchema = z.object({ qty: z.number().int(), customerId: z.string().min(1).optional(), reason: z.string().trim().min(1).max(300) });
const gallonQuery = z.object({ fleet: z.string().max(60).optional() });
const correctionSchema = z.object({
  reason: z.string().trim().min(1, 'reason is required').max(1000),
  oldValue: z.any().optional(),
  newValue: z.any().optional(),
});
const listTxnQuery = z.object({
  date: DATE.optional(), dateFrom: DATE.optional(), dateTo: DATE.optional(),
  customerId: z.string().optional(), method: z.enum(['lunas', 'bon', 'pelunasan']).optional(),
  fleet: z.string().max(60).optional(),
});
const auditQuery = z.object({ kind: z.enum(['koreksi', 'harga', 'input', 'impor', 'pelanggan']).optional(), limit: z.coerce.number().int().positive().max(2000).optional(), fleet: z.string().max(60).optional() });
const summaryQuery = z.object({ date: DATE.optional(), fleet: z.string().max(60).optional() });
const cashIntegQuery = z.object({ dateFrom: DATE.optional(), dateTo: DATE.optional(), fleet: z.string().max(60).optional() });
const boardQuery = z.object({ date: DATE, fleet: z.string().max(60).optional() });
const orderSchema = z.object({ customerId: z.string().min(1), date: DATE, qty: z.number().int().nonnegative().optional(), note: z.string().max(300).optional() });
const markSchema = z.object({ status: z.enum(['pending', 'terkirim', 'batal']), transactionId: z.string().min(1).optional() });
const reorderSchema = z.object({ date: DATE.optional(), fleet: z.string().max(60).optional(), order: z.array(z.string().min(1)).max(2000) });
const closeSchema = z.object({ date: DATE, fleet: z.string().max(60).optional(), generalNote: z.string().max(500).optional(), reasons: z.record(z.string().max(300)).optional() });
const closeoutQuery = z.object({ date: DATE.optional(), fleet: z.string().max(60).optional() });
const custListQuery = z.object({ fleet: z.string().max(60).optional() });
const idParams = z.object({ id: z.string().min(1) });
const batchParams = z.object({ batchId: z.string().min(1) });
const invoiceCreateSchema = z.object({
  scope: z.enum(['unpaidBon', 'period', 'selected']).optional(),
  transactionIds: z.array(z.string().min(1)).max(2000).optional(),
  dateFrom: DATE.optional(), dateTo: DATE.optional(),
  dueDate: z.union([DATE, z.literal('')]).optional(),
  note: z.string().max(500).optional(),
});

// ── customers ──
const listCustomers = asyncHandler(async (req, res) => res.json(await service.listCustomers(req.user, req.query.fleet)));
const getCustomer = asyncHandler(async (req, res) => res.json({ data: await service.getCustomer(req.params.id, req.user) }));
const createCustomer = asyncHandler(async (req, res) => { const c = await service.createCustomer(req.body, req.user); bcast('create', c.id); res.status(201).json({ data: c }); });
const updateCustomer = asyncHandler(async (req, res) => { const c = await service.updateCustomer(req.params.id, req.body, req.user); bcast('update', c.id); res.json({ data: c }); });
const importCustomers = asyncHandler(async (req, res) => { const r = await service.importCustomers(req.body.customers, req.user); bcast('import', 'customers'); res.status(201).json(r); });
const updatePrice = asyncHandler(async (req, res) => { const c = await service.updatePrice(req.params.id, req.body.newPrice, req.user, req.body.scope); bcast('price', c.id); res.json({ data: c }); });
const pricePreview = asyncHandler(async (req, res) => res.json({ data: await service.pricePreview(req.params.id, req.body.newPrice, req.user) }));
const cancelPriceAdjustment = asyncHandler(async (req, res) => { const r = await service.cancelPriceAdjustment(req.params.batchId, req.user); bcast('price', req.params.batchId); res.json({ data: r }); });

// ── customer types (editable dictionary) ──
const listTypes = asyncHandler(async (req, res) => res.json(await service.listTypes()));
const createType = asyncHandler(async (req, res) => { const t = await service.createType(req.body, req.user); bcast('type', t.id); res.status(201).json({ data: t }); });
const updateType = asyncHandler(async (req, res) => { const t = await service.renameType(req.params.id, req.body, req.user); bcast('type', t.id); res.json({ data: t }); });
const deleteType = asyncHandler(async (req, res) => { const r = await service.deleteType(req.params.id, req.query.reassignTo, req.user); bcast('type', req.params.id); res.json({ data: r }); });

// ── transactions ── (immutable; price locked server-side)
const listTransactions = asyncHandler(async (req, res) => res.json(await service.listTransactions(req.query, req.user)));
const createTransaction = asyncHandler(async (req, res) => { const t = await service.createTransaction(req.body, req.user); bcast('create', t.id); res.status(201).json({ data: t }); });
const addCorrection = asyncHandler(async (req, res) => {
  // A "staff" actor has 'distribusi' but none of the owner distribusi caps → flag it.
  const perms = resolvePerms(req.user.role, req.user.permissions);
  const isStaff = !perms.distribusiAudit && !perms.distribusiHargaMaster && !perms.distribusiCustomers;
  const c = await service.addCorrection(req.params.id, req.body, req.user, isStaff);
  bcast('correction', req.params.id);
  res.status(201).json({ data: c });
});

// ── invoices / notas ──
const createInvoice = asyncHandler(async (req, res) => { const inv = await service.createInvoice(req.params.id, req.body, req.user); bcast('invoice', inv.id); res.status(201).json({ data: inv }); });
const listInvoices = asyncHandler(async (req, res) => res.json(await service.listInvoices(req.params.id, req.user)));
const getInvoice = asyncHandler(async (req, res) => res.json({ data: await service.getInvoice(req.params.id, req.user) }));

// ── audit + dashboard ──
const listAudit = asyncHandler(async (req, res) => res.json(await service.listAudit(req.query, req.user)));
const dashboardSummary = asyncHandler(async (req, res) => res.json({ data: await service.dashboardSummary(req.query.date, req.user, req.query.fleet) }));
const billingReminders = asyncHandler(async (req, res) => res.json(await service.billingReminders(req.user, req.query.fleet, req.query.date)));
const cashIntegration = asyncHandler(async (req, res) => res.json({ data: await service.cashIntegration(req.user, req.query) }));

// ── Delivery board ──
const deliveryBoard = asyncHandler(async (req, res) => res.json(await service.deliveryBoard(req.user, req.query.date, req.query.fleet)));
const addOrder = asyncHandler(async (req, res) => {
  const { delivery, fleetId } = await service.addOrder(req.body, req.user);
  // Notify the fleet's crew (AlertBell) + refresh open boards — carry fleetId so a scoped
  // helper's client can tell whether the new order is for them.
  bus.broadcast({ entity: 'distribusi', action: 'order', id: delivery.id, fleetId });
  res.status(201).json({ data: delivery });
});
const markDelivery = asyncHandler(async (req, res) => { const r = await service.markDelivery(req.params.id, req.body, req.user); bcast('delivery', req.params.id); res.json(r); });
const reorderDeliveries = asyncHandler(async (req, res) => { const r = await service.reorderDeliveries(req.user, req.body); bcast('delivery', 'reorder'); res.json({ data: r }); });
const closeDay = asyncHandler(async (req, res) => {
  const r = await service.closeDay(req.user, req.body);
  // Notify the fleet's admins/atasan (AlertBell) when the day is closed with undelivered
  // stops — carry the pending count + fleet so a scoped viewer can filter.
  bus.broadcast({ entity: 'distribusi', action: 'closeout', id: r.closeout.id, fleetId: r.fleetId, pending: r.pending });
  res.status(201).json({ data: r.closeout });
});
const listCloseouts = asyncHandler(async (req, res) => res.json(await service.listCloseouts(req.user, req.query)));

// ── gallon stock ──
const gallonSummary = asyncHandler(async (req, res) => res.json({ data: await service.gallonSummary(req.user, req.query.fleet) }));
const gallonCorrection = asyncHandler(async (req, res) => { const m = await service.gallonCorrection(req.body, req.user); bcast('gallon', m.id); res.status(201).json({ data: m }); });

module.exports = {
  listCustomers, getCustomer, createCustomer, updateCustomer, importCustomers, updatePrice, pricePreview, cancelPriceAdjustment,
  listTypes, createType, updateType, deleteType,
  listTransactions, createTransaction, addCorrection, listAudit, dashboardSummary,
  gallonSummary, gallonCorrection, createInvoice, listInvoices, getInvoice, billingReminders, cashIntegration,
  deliveryBoard, addOrder, markDelivery, reorderDeliveries, closeDay, listCloseouts,
  schemas: { customerSchema, customerUpdateSchema, importSchema, priceSchema, pricePreviewSchema, txnSchema, correctionSchema, listTxnQuery, auditQuery, summaryQuery, cashIntegQuery, boardQuery, orderSchema, markSchema, reorderSchema, closeSchema, closeoutQuery, custListQuery, gallonQuery, gallonCorrectionSchema, idParams, typeCreateSchema, typeRenameSchema, typeDeleteQuery, batchParams, invoiceCreateSchema },
};
