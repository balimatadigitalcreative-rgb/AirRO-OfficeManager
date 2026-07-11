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
  bufferMin: z.number().int().min(0).optional(),
});
const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  unit: z.string().trim().max(20).optional(),
  bufferMin: z.number().int().min(0).optional(),
});
// "Tambah Stok" / "Koreksi" — additive + correction types (gudangKelola).
const stockSchema = z.object({ type: z.enum(['opening', 'purchase', 'in', 'correction']), qty: z.number().int(), reason: z.string().trim().min(1).max(300), refId: z.string().max(120).optional() });
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
// Sell damaged gallons (gudangKelola): qty + unit price + method.
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
const updateItem = asyncHandler(async (req, res) => res.json({ data: await service.updateItem(req.params.id, req.body) }));
const addStock = asyncHandler(async (req, res) => res.status(201).json({ data: await service.addMovement(req.params.id, req.body, req.user, service.ADD_TYPES.concat('correction')) }));
const addDamage = asyncHandler(async (req, res) => res.status(201).json({ data: await service.addMovement(req.params.id, req.body, req.user, ['damage', 'loss']) }));
const report = asyncHandler(async (req, res) => res.json({ data: await service.report(req.user) }));
const reportGallonDamage = asyncHandler(async (req, res) => res.status(201).json({ data: await service.reportGallonDamage(req.body, req.user) }));
const sellRusak = asyncHandler(async (req, res) => res.status(201).json({ data: await service.sellGalonRusak(req.body, req.user) }));
const closeoutPreview = asyncHandler(async (req, res) => res.json({ data: await service.closeoutPreview(req.query.date, req.user) }));
const closeWarehouse = asyncHandler(async (req, res) => res.status(201).json({ data: await service.closeWarehouse(req.body, req.user) }));
const listCloseouts = asyncHandler(async (req, res) => res.json(await service.listCloseouts(req.query)));

module.exports = {
  summary, getItem, createItem, updateItem, addStock, addDamage, report, reportGallonDamage, sellRusak,
  closeoutPreview, closeWarehouse, listCloseouts,
  schemas: { idParams, createItemSchema, updateItemSchema, stockSchema, damageSchema, gallonDamageSchema, sellRusakSchema, closeoutQuery, closeoutPreviewQuery, closeoutSchema },
};
