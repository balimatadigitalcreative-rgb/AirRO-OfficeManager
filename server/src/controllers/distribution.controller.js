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
  address: z.string().max(300).optional(),
  mapsUrl: z.string().max(500).optional(),
  lat: z.union([z.number(), z.string(), z.null()]).optional(),
  lng: z.union([z.number(), z.string(), z.null()]).optional(),
  accuracy: z.union([z.number(), z.string(), z.null()]).optional(),
});
// Edit: every field optional; masterPrice is NOT accepted here (owner-gated price route).
const LATLNG = z.union([z.number(), z.string(), z.null()]).optional();
const customerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().max(40).optional(),
  type: z.string().trim().min(1).max(60).optional(),
  deliveryDays: DAYS.optional(),
  armada: z.string().max(40).optional(),
  reminder: reminderSchema.optional(),
  address: z.string().max(300).optional(),
  mapsUrl: z.string().max(500).optional(),
  lat: LATLNG,
  lng: LATLNG,
});
// Field GPS tag / paste — coordinates required; accuracy (metres) + address optional.
const locationSchema = z.object({ lat: z.union([z.number(), z.string()]), lng: z.union([z.number(), z.string()]), accuracy: z.union([z.number(), z.string(), z.null()]).optional(), address: z.string().max(300).optional() });
const locationPhotoSchema = z.object({ photoId: z.string().max(60).nullable().optional() });
const importSchema = z.object({ customers: z.array(customerSchema.partial({ masterPrice: true, phone: true, type: true })).max(5000), skipped: z.number().int().nonnegative().optional() });
// Per-customer legacy (archive) transaction import — customerId comes from the route, NOT the body.
const legacyRow = z.object({ txnDate: z.string().max(20), qty: z.number().int(), price: z.number().int().nonnegative(), method: z.enum(['lunas', 'bon']).optional(), note: z.string().max(300).optional() });
const legacyImportSchema = z.object({ rows: z.array(legacyRow).max(5000), skipped: z.number().int().nonnegative().optional() });
const legacyBatchParams = z.object({ id: z.string().min(1), batchId: z.string().min(1) });
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
const openingStockSchema = z.object({ qty: z.number().int().min(0), fleet: z.string().max(60).optional(), reason: z.string().trim().min(1).max(300) });
// Reset gallon count (GM). mode 'balanced' (append corrections to target) | 'purge' (delete ledger).
const gallonResetSchema = z.object({
  mode: z.enum(['balanced', 'purge']),
  fleet: z.string().max(60).optional(),
  target: z.number().int().min(0).optional(),        // balanced only (default 0)
  confirm: z.string().max(20).optional(),            // purge requires exactly "RESET"
  reason: z.string().trim().min(1).max(300),
});
const gallonQuery = z.object({ fleet: z.string().max(60).optional() });
const correctionSchema = z.object({
  reason: z.string().trim().min(1, 'reason is required').max(1000),
  oldValue: z.any().optional(),
  newValue: z.any().optional(),
});
// VOID — a mandatory reason. HARD DELETE — reason + typed confirmation (ref or "HAPUS") + password.
const voidSchema = z.object({ reason: z.string().trim().min(1, 'reason is required').max(1000) });
const hardDeleteSchema = z.object({
  reason: z.string().trim().min(1, 'reason is required').max(1000),
  confirm: z.string().min(1).max(40),
  password: z.string().min(1).max(200),
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
// Delivery runs (rit)
const runOpenSchema = z.object({ date: DATE, fleet: z.string().max(60).optional(), gallonsOut: z.number().int().positive(), note: z.string().max(300).optional() });
const runCloseSchema = z.object({ gallonsFullReturned: z.number().int().nonnegative(), gallonsEmptyReturned: z.number().int().nonnegative(), diffReason: z.string().max(300).optional() });
// Koreksi Rit (append-only): CORRECTED absolute value(s) for muat/isi-kembali/kosong + a required
// reason. At least one field must be present (enforced in the service via a zero-change check).
const runCorrectionSchema = z.object({ out: z.number().int().nonnegative().optional(), full: z.number().int().nonnegative().optional(), empty: z.number().int().nonnegative().optional(), reason: z.string().min(1).max(300) });
const runQuery = z.object({ date: DATE.optional(), fleet: z.string().max(60).optional(), status: z.enum(['open', 'closed']).optional() });
// Customer list + detailed multi-criteria filter. Every criterion is optional and they
// combine with AND. Kept as query params so the list stays a plain cacheable GET.
// Opening / carry-over bon (cap: distribusiKoreksi). Nominal + the date the admin picks +
// a mandatory keterangan. It is stored as a real bon, so it counts toward sisa bon.
const openingBonSchema = z.object({
  amount: z.number().int().positive(),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(1).max(300),
});
const custListQuery = z.object({
  fleet: z.string().max(60).optional(),
  status: z.enum(['active', 'inactive', 'all']).optional(),
  q: z.string().max(80).optional(),                       // name / phone / code
  types: z.string().max(400).optional(),                  // CSV of CustomerType ids
  bon: z.enum(['ada', 'lunas']).optional(),
  bonMin: z.coerce.number().int().min(0).optional(),      // sisa bon ≥ N
  days: z.string().max(60).optional(),                    // CSV of day codes (Sen…Min)
  daysMode: z.enum(['any', 'all']).optional(),
  complete: z.enum(['lengkap', 'belum']).optional(),
  hasLocation: z.enum(['ya', 'tidak']).optional(),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
});
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
const createOpeningBon = asyncHandler(async (req, res) => res.status(201).json({ data: await service.createOpeningBon(req.params.id, req.body, req.user) }));
const listCustomers = asyncHandler(async (req, res) => res.json(await service.listCustomers(req.user, req.query.fleet, req.query.status, req.query)));
const getCustomer = asyncHandler(async (req, res) => res.json({ data: await service.getCustomer(req.params.id, req.user) }));
const createCustomer = asyncHandler(async (req, res) => { const c = await service.createCustomer(req.body, req.user); bcast('create', c.id); res.status(201).json({ data: c }); });
const updateCustomer = asyncHandler(async (req, res) => { const c = await service.updateCustomer(req.params.id, req.body, req.user); bcast('update', c.id); res.json({ data: c }); });
const setLocation = asyncHandler(async (req, res) => { const c = await service.setCustomerLocation(req.params.id, req.body, req.user); bcast('update', c.id); res.json({ data: c }); });
const setLocationPhoto = asyncHandler(async (req, res) => { const c = await service.setLocationPhoto(req.params.id, req.body, req.user); bcast('update', c.id); res.json({ data: c }); });
const importCustomers = asyncHandler(async (req, res) => { const r = await service.importCustomers(req.body.customers, req.user, req.body.skipped); bcast('import', 'customers'); res.status(201).json(r); });
const importLegacyTxns = asyncHandler(async (req, res) => { const r = await service.importLegacyTransactions(req.params.id, req.body.rows, req.user, req.body.skipped); bcast('update', req.params.id); res.status(201).json(r); });
const undoLegacyBatch = asyncHandler(async (req, res) => { const r = await service.undoLegacyBatch(req.params.id, req.params.batchId, req.user); bcast('update', req.params.id); res.json({ data: r }); });
const updatePrice = asyncHandler(async (req, res) => { const c = await service.updatePrice(req.params.id, req.body.newPrice, req.user, req.body.scope); bcast('price', c.id); res.json({ data: c }); });
const pricePreview = asyncHandler(async (req, res) => res.json({ data: await service.pricePreview(req.params.id, req.body.newPrice, req.user) }));
const cancelPriceAdjustment = asyncHandler(async (req, res) => { const r = await service.cancelPriceAdjustment(req.params.batchId, req.user); bcast('price', req.params.batchId); res.json({ data: r }); });
// Customer deactivate (soft, reversible) / reactivate / hard delete — all gated distribusiCustomerDelete.
const deactivateCustomer = asyncHandler(async (req, res) => { const c = await service.deactivateCustomer(req.params.id, req.user); bcast('deactivate', c.id); res.json({ data: c }); });
const reactivateCustomer = asyncHandler(async (req, res) => { const c = await service.reactivateCustomer(req.params.id, req.user); bcast('reactivate', c.id); res.json({ data: c }); });
const deleteCustomer = asyncHandler(async (req, res) => { const r = await service.deleteCustomer(req.params.id, req.user); bcast('delete', req.params.id); res.json(r); });

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
const voidTransaction = asyncHandler(async (req, res) => { const t = await service.voidTransaction(req.params.id, req.body, req.user); bcast('void', req.params.id); res.json({ data: t }); });
const hardDeleteTransaction = asyncHandler(async (req, res) => { const r = await service.hardDeleteTransaction(req.params.id, req.body, req.user); bcast('delete', req.params.id); res.json({ data: r }); });

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

// ── Delivery runs (rit) ──
const openRun = asyncHandler(async (req, res) => { const r = await service.openRun(req.body, req.user); bus.broadcast({ entity: 'distribusi', action: 'run', id: r.id, fleetId: r.fleetId }); res.status(201).json({ data: r }); });
const closeRun = asyncHandler(async (req, res) => { const r = await service.closeRun(req.params.id, req.body, req.user); bus.broadcast({ entity: 'distribusi', action: 'run', id: r.id, fleetId: r.fleetId }); res.json({ data: r }); });
const correctRun = asyncHandler(async (req, res) => { const r = await service.correctRun(req.params.id, req.body, req.user); bus.broadcast({ entity: 'distribusi', action: 'run', id: r.id, fleetId: r.fleetId }); res.json({ data: r }); });
const listRuns = asyncHandler(async (req, res) => res.json(await service.listRuns(req.user, req.query)));

// ── gallon stock ──
const gallonSummary = asyncHandler(async (req, res) => res.json({ data: await service.gallonSummary(req.user, req.query.fleet) }));
const gallonCorrection = asyncHandler(async (req, res) => { const m = await service.gallonCorrection(req.body, req.user); bcast('gallon', m.id); res.status(201).json({ data: m }); });
const setOpeningStock = asyncHandler(async (req, res) => { const r = await service.setOpeningStock(req.body, req.user); bcast('gallon', 'opening'); res.status(201).json({ data: r }); });
const resetGallon = asyncHandler(async (req, res) => { const r = await service.resetGallon(req.body, req.user); bcast('gallon', 'reset'); res.status(201).json({ data: r }); });

module.exports = {
  listCustomers, getCustomer, createCustomer, createOpeningBon, updateCustomer, setLocation, setLocationPhoto, importCustomers, importLegacyTxns, undoLegacyBatch, updatePrice, pricePreview, cancelPriceAdjustment,
  deactivateCustomer, reactivateCustomer, deleteCustomer,
  listTypes, createType, updateType, deleteType,
  listTransactions, createTransaction, addCorrection, voidTransaction, hardDeleteTransaction, listAudit, dashboardSummary,
  gallonSummary, gallonCorrection, setOpeningStock, resetGallon, createInvoice, listInvoices, getInvoice, billingReminders, cashIntegration,
  deliveryBoard, addOrder, markDelivery, reorderDeliveries, closeDay, listCloseouts,
  openRun, closeRun, correctRun, listRuns,
  schemas: { openingBonSchema, customerSchema, customerUpdateSchema, locationSchema, locationPhotoSchema, importSchema, legacyImportSchema, legacyBatchParams, priceSchema, pricePreviewSchema, txnSchema, correctionSchema, voidSchema, hardDeleteSchema, listTxnQuery, auditQuery, summaryQuery, cashIntegQuery, boardQuery, orderSchema, markSchema, reorderSchema, closeSchema, closeoutQuery, runOpenSchema, runCloseSchema, runCorrectionSchema, runQuery, custListQuery, gallonQuery, gallonCorrectionSchema, openingStockSchema, gallonResetSchema, idParams, typeCreateSchema, typeRenameSchema, typeDeleteQuery, batchParams, invoiceCreateSchema },
};
