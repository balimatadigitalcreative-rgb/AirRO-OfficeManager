'use strict';
const { z } = require('zod');
const service = require('../services/dataWipe.service');
const asyncHandler = require('../utils/asyncHandler');

const categoriesSchema = z.object({ categories: z.array(z.string().max(40)).max(50) });
// The wipe itself additionally demands the typed word + the caller's own password.
const wipeSchema = categoriesSchema.extend({
  confirm: z.string().max(20),
  password: z.string().min(1).max(200),
});

const categories = asyncHandler(async (req, res) => res.json({ data: service.categoryList() }));
const preview = asyncHandler(async (req, res) => res.json({ data: await service.preview(req.body.categories) }));
const wipe = asyncHandler(async (req, res) => res.json({ data: await service.wipe(req.body, req.user) }));
const history = asyncHandler(async (req, res) => res.json(await service.history()));

module.exports = { categories, preview, wipe, history, schemas: { categoriesSchema, wipeSchema } };
