'use strict';
const { z } = require('zod');
const service = require('../services/fleet.service');
const asyncHandler = require('../utils/asyncHandler');

const createSchema = z.object({ plate: z.string().trim().min(1).max(20) });
const updateSchema = createSchema.partial();
const idParams = z.object({ id: z.string().min(1) });

const list = asyncHandler(async (req, res) => res.json({ data: await service.list() }));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.update(req.params.id, req.body) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id); res.status(204).send(); });

module.exports = { list, getOne, create, update, remove, schemas: { createSchema, updateSchema, idParams } };
