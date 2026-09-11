'use strict';
const { z } = require('zod');
const service = require('../services/gps.service');
const asyncHandler = require('../utils/asyncHandler');

// Only the mapping is writable. vehicleId/registration/name are the provider's, never ours to edit.
// '' clears the mapping and returns the row to 'derived' so a later sync may seed it again.
const fleetSchema = z.object({ fleetId: z.string().max(60) });
const idParams = z.object({ id: z.string().min(1) });

// EVERY handler passes req.user and nothing from the query or body decides scope. There is deliberately
// no `fleetId` parameter to honour: scope comes from the session, so a crafted request cannot widen it.
const listDevices = asyncHandler(async (req, res) => res.json(await service.viewDevices(req.user)));
const syncDevices = asyncHandler(async (req, res) => res.json({ data: await service.syncDevices(req.user) }));
const refreshPositions = asyncHandler(async (req, res) => res.json({ data: await service.refreshPositions(req.user, {}) }));
const setDeviceFleet = asyncHandler(async (req, res) => res.json({ data: await service.setDeviceFleet(req.user, req.params.id, req.body) }));

module.exports = { listDevices, syncDevices, refreshPositions, setDeviceFleet, schemas: { fleetSchema, idParams } };
