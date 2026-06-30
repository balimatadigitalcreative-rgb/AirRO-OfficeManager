'use strict';
const { z } = require('zod');
const service = require('../services/state.service');
const asyncHandler = require('../utils/asyncHandler');

// Only allow the app's own data keys (airro_*) to be stored.
const keyParams = z.object({ key: z.string().regex(/^airro_[a-zA-Z0-9_]+$/, 'invalid state key') });
// Value is the localStorage string (JSON). Allow up to ~12MB (localStorage cap).
const putSchema = z.object({ value: z.string().max(12 * 1024 * 1024) });

const getAll = asyncHandler(async (req, res) => {
  res.json({ data: await service.getAll() });
});

const set = asyncHandler(async (req, res) => {
  res.json({ data: await service.set(req.params.key, req.body.value) });
});

module.exports = { getAll, set, schemas: { keyParams, putSchema } };
