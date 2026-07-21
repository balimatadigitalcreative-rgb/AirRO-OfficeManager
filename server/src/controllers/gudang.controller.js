'use strict';
const { z } = require('zod');
const service = require('../services/gudang.service');
const asyncHandler = require('../utils/asyncHandler');

// ── validation schemas ──
const idParams = z.object({ id: z.string().min(1) });
const createItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['sticker', 'tutup', 'segel', 'lainnya']).optional(),
  unit: z.string().trim().max(20).optional(),
  // Only accepted from a caller who also holds gudangBuffer (the route checks); a
  // gudangItems-only user creating an item simply gets bufferMin 0 and cannot set it.
  bufferMin: z.number().int().min(0).optional(),
});
// NOTE: bufferMin is deliberately NOT here. Setting the restock threshold is its own
// action with its own capability (gudangBuffer) — holding gudangItems (edit an item's
// details) must not imply the right to move the buffer. See PATCH /items/:id/buffer.
const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  unit: z.string().trim().max(20).optional(),
  form: z.string().trim().max(60).optional(),
  description: z.string().trim().max(500).optional(),
  photoId: z.string().max(60).nullable().optional(),   // Attachment.id, or null to remove
});
const bufferSchema = z.object({ bufferMin: z.number().int().min(0) });
// "Tambah Stok" / "Koreksi" — additive + correction types. Which capability applies
// depends on the TYPE in the body: 'correction' needs gudangKoreksi, everything else
// needs gudangAddStock (see requireStockCap in gudang.routes.js). A purchase/restock
// may record the supplier (supplierId) + an invoice/PO ref (refId).
const stockSchema = z.object({ type: z.enum(['opening', 'purchase', 'in', 'correction']), qty: z.number().int(), reason: z.string().trim().min(1).max(300), refId: z.string().max(120).optional(), supplierId: z.string().max(60).optional() });
// Supplier (Pemasok) — gudangSupplier. Codes are server-allocated (S-0001).
const supplierCreateSchema = z.object({ name: z.string().trim().min(1).max(120), phone: z.string().trim().max(40).optional(), address: z.string().trim().max(300).optional(), note: z.string().trim().max(500).optional() });
const supplierUpdateSchema = supplierCreateSchema.partial();
const supplierListQuery = z.object({ q: z.string().max(80).optional(), status: z.enum(['active', 'inactive', 'all']).optional() });
const supplierActiveSchema = z.object({ active: z.boolean() });
// Damage / loss write-off (gudangDamage).
const damageSchema = z.object({ type: z.enum(['damage', 'loss']), qty: z.number().int().positive(), reason: z.string().trim().min(1).max(300), refId: z.string().max(120).optional() });
// Report a broken/lost GOOD gallon (gudangDamage). Reason mandatory; fleet/culprit/photo optional.
const gallonDamageSchema = z.object({
  kind: z.enum(['pecah', 'rusak', 'hilang']),
  qty: z.number().int().positive(),
  reason: z.string().trim().min(1).max(300),
  fleet: z.string().max(60).optional(),
  culprit: z.string().trim().max(80).optional(),
  proof: z.any().optional(),
});
// Sell damaged gallons (gudangSupplier — it books money, like supplier dealings): qty + price + method.
const sellRusakSchema = z.object({ qty: z.number().int().positive(), price: z.number().int().positive(), method: z.enum(['Cash', 'Transfer', 'QRIS']).optional(), reason: z.string().trim().max(300).optional() });
// Daily warehouse closeout (gudangReport): per-item physical count + optional opname reason.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const closeoutQuery = z.object({ date: z.string().regex(DATE_RE).optional() });
const closeoutPreviewQuery = z.object({ date: z.string().regex(DATE_RE) });
const closeoutSchema = z.object({
  date: z.string().regex(DATE_RE),
  items: z.array(z.object({ itemId: z.string().min(1), physical: z.number().int().nonnegative(), reason: z.string().trim().max(300).optional() })).max(200).optional(),
  note: z.string().trim().max(500).optional(),
});

const summary = asyncHandler(async (req, res) => res.json({ data: await service.gudangSummary(req.user) }));
const getItem = asyncHandler(async (req, res) => res.json({ data: await service.getItem(req.params.id, req.user) }));
const createItem = asyncHandler(async (req, res) => res.status(201).json({ data: await service.createItem(req.body) }));
const updateItem = asyncHandler(async (req, res) => res.json({ data: await service.updateItem(req.params.id, req.body, req.user) }));
// Buffer (restock threshold) — its own endpoint so it can carry its own capability.
const setBuffer = asyncHandler(async (req, res) => res.json({ data: await service.setBuffer(req.params.id, req.body.bufferMin, req.user) }));
const addStock = asyncHandler(async (req, res) => res.status(201).json({ data: await service.addMovement(req.params.id, req.body, req.user, service.ADD_TYPES.concat('correction')) }));
const addDamage = asyncHandler(async (req, res) => res.status(201).json({ data: await service.addMovement(req.params.id, req.body, req.user, ['damage', 'loss']) }));
const report = asyncHandler(async (req, res) => res.json({ data: await service.report(req.user) }));
const reportGallonDamage = asyncHandler(async (req, res) => res.status(201).json({ data: await service.reportGallonDamage(req.body, req.user) }));
const sellRusak = asyncHandler(async (req, res) => res.status(201).json({ data: await service.sellGalonRusak(req.body, req.user) }));
const closeoutPreview = asyncHandler(async (req, res) => res.json({ data: await service.closeoutPreview(req.query.date, req.user) }));
const closeWarehouse = asyncHandler(async (req, res) => res.status(201).json({ data: await service.closeWarehouse(req.body, req.user) }));
const listCloseouts = asyncHandler(async (req, res) => res.json(await service.listCloseouts(req.query)));
// Suppliers
const listSuppliers = asyncHandler(async (req, res) => res.json(await service.listSuppliers(req.query)));
const getSupplier = asyncHandler(async (req, res) => res.json({ data: await service.getSupplier(req.params.id) }));
const createSupplier = asyncHandler(async (req, res) => res.status(201).json({ data: await service.createSupplier(req.body, req.user) }));
const updateSupplier = asyncHandler(async (req, res) => res.json({ data: await service.updateSupplier(req.params.id, req.body, req.user) }));
const setSupplierActive = asyncHandler(async (req, res) => res.json({ data: await service.setSupplierActive(req.params.id, req.body.active, req.user) }));
const deleteSupplier = asyncHandler(async (req, res) => { await service.deleteSupplier(req.params.id, req.user); res.status(204).send(); });

module.exports = {
  summary, getItem, createItem, updateItem, setBuffer, addStock, addDamage, report, reportGallonDamage, sellRusak,
  listSuppliers, getSupplier, createSupplier, updateSupplier, setSupplierActive, deleteSupplier,
  closeoutPreview, closeWarehouse, listCloseouts,
  schemas: { idParams, createItemSchema, updateItemSchema, bufferSchema, stockSchema, damageSchema, gallonDamageSchema, sellRusakSchema, closeoutQuery, closeoutPreviewQuery, closeoutSchema, supplierCreateSchema, supplierUpdateSchema, supplierListQuery, supplierActiveSchema },
};
