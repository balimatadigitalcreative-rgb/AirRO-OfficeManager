'use strict';
const { z } = require('zod');
const service = require('../services/settings.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

// A settings value may be any JSON (object/number/string/bool).
const putSchema = z.object({ value: z.any() });
const keyParams = z.object({ key: z.string().min(1).max(60) });

const getAll = asyncHandler(async (req, res) => res.json({ data: await service.getAll() }));
const getOne = asyncHandler(async (req, res) => res.json({ data: { key: req.params.key, value: await service.get(req.params.key) } }));
const set = asyncHandler(async (req, res) => { const data = await service.set(req.params.key, req.body.value); bus.broadcast({ entity: 'config', action: 'setting', id: req.params.key }); res.json({ data }); });

module.exports = { getAll, getOne, set, schemas: { putSchema, keyParams } };
