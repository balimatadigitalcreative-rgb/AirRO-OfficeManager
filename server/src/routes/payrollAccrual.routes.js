'use strict';
// ACCRUAL PAYROLL (double-entry). Payroll figures are sensitive → their own caps: sdmPayrollLihat
// (view), sdmPayrollKelola (build/edit/pay), sdmPayrollSetujui (approve). Enforced server-side; an
// employee never sees another line (getPayslip gates by requester).
const { Router } = require('express');
const service = require('../services/payrollAccrual.service');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireCap } = require('../middleware/auth');

const router = Router();
router.use(requireAuth);

const view = requireCap('sdmPayrollLihat');
const manage = requireCap('sdmPayrollKelola');
const approve = requireCap('sdmPayrollSetujui');

router.get('/components', view, asyncHandler(async (req, res) => res.json(await service.listComponents())));
router.post('/components', manage, asyncHandler(async (req, res) => res.status(201).json({ data: await service.createComponent(req.body, req.user) })));
router.patch('/components/:id', manage, asyncHandler(async (req, res) => res.json({ data: await service.updateComponent(req.params.id, req.body) })));

router.get('/periods', view, asyncHandler(async (req, res) => res.json(await service.listPeriods(req.query))));
router.post('/periods', manage, asyncHandler(async (req, res) => res.status(201).json({ data: await service.createPeriod(req.body, req.user) })));
router.get('/periods/:id', view, asyncHandler(async (req, res) => res.json({ data: await service.getPeriod(req.params.id) })));
router.patch('/lines/:id', manage, asyncHandler(async (req, res) => res.json({ data: await service.updateLine(req.params.id, req.body, req.user) })));
router.post('/periods/:id/approve', approve, asyncHandler(async (req, res) => res.json({ data: await service.approvePeriod(req.params.id, req.user) })));
router.post('/periods/:id/pay', manage, asyncHandler(async (req, res) => res.json({ data: await service.payPeriod(req.params.id, req.body, req.user) })));
router.post('/periods/:id/void', approve, asyncHandler(async (req, res) => res.json({ data: await service.voidPeriod(req.params.id, req.body, req.user) })));
router.get('/report', view, asyncHandler(async (req, res) => res.json({ data: await service.payrollReport({ year: +req.query.year, month: +req.query.month }) })));
// Payslip authorization is derived from the SESSION (caps), never a request param — see getPayslip.
router.get('/payslip/:lineId', view, asyncHandler(async (req, res) => res.json({ data: await service.getPayslip(req.params.lineId, req.user) })));

module.exports = router;
