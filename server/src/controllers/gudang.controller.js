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

const summary = asyncHandler(async (req, res) => res.json({ data: await service.gudangSummary(req.user) }));
const getItem = asyncHandler(async (req, res) => res.json({ data: await service.getItem(req.params.id, req.user) }));
const createItem = asyncHandler(async (req, res) => res.status(201).json({ data: await service.createItem(req.body) }));
const updateItem = asyncHandler(async (req, res) => res.json({ data: await service.updateItem(req.params.id, req.body) }));
const addStock = asyncHandler(async (req, res) => res.status(201).json({ data: await service.addMovement(req.params.id, req.body, req.user, service.ADD_TYPES.concat('correction')) }));
const addDamage = asyncHandler(async (req, res) => res.status(201).json({ data: await service.addMovement(req.params.id, req.body, req.user, ['damage', 'loss']) }));
const report = asyncHandler(async (req, res) => res.json({ data: await service.report(req.user) }));

module.exports = {
  summary, getItem, createItem, updateItem, addStock, addDamage, report,
  schemas: { idParams, createItemSchema, updateItemSchema, stockSchema, damageSchema },
};
