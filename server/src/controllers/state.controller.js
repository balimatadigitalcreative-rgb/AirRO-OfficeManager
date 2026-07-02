'use strict';
const { z } = require('zod');
const service = require('../services/state.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

// Only allow the app's own data keys (airro_*) to be stored.
const keyParams = z.object({ key: z.string().regex(/^airro_[a-zA-Z0-9_]+$/, 'invalid state key') });
// Value is the localStorage string (JSON). Allow up to ~12MB (localStorage cap).
const putSchema = z.object({ value: z.string().max(12 * 1024 * 1024) });

const getAll = asyncHandler(async (req, res) => {
  // Capture `now` BEFORE the query so a doc written mid-query is redelivered next
  // poll (at-least-once) rather than missed. Client sends `now` back as `since`.
  const now = new Date().toISOString();
  const raw = typeof req.query.since === 'string' ? req.query.since : null;
  const since = raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
  const { data, meta } = await service.getAll(since);
  res.json({ data, meta, now });
});

const set = asyncHandler(async (req, res) => {
  const data = await service.set(req.params.key, req.body.value);
  // Push a realtime notice so other clients pull this key immediately (no 3s wait).
  bus.broadcast({ entity: 'state', action: 'set', id: req.params.key });
  res.json({ data });
});

module.exports = { getAll, set, schemas: { keyParams, putSchema } };
