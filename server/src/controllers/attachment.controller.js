'use strict';
const { z } = require('zod');
const service = require('../services/attachment.service');
const asyncHandler = require('../utils/asyncHandler');

// A proof is a base64 data URL. Cap it well under the 12mb body limit — the client
// compresses to a few hundred KB, so anything larger is almost certainly a mistake.
const createSchema = z.object({
  data: z.string().min(1).max(11 * 1024 * 1024),
  name: z.string().max(200).optional(),
  mime: z.string().max(100).optional(),
  isImg: z.boolean().optional(),
});
const idParams = z.object({ id: z.string().min(1).max(60) });

const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body, req.user) }));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getOne(req.params.id) }));

module.exports = { create, getOne, schemas: { createSchema, idParams } };
