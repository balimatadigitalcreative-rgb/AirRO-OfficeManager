'use strict';
const { Router } = require('express');
const ctrl = require('../controllers/accounting.controller');
const { requireAuth, requireCap, requireRole } = require('../middleware/auth');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

const router = Router();
// ACCOUNTING v2 is behind a feature flag. While OFF, the whole router 404s — the double-entry engine
// exists (and is backfilled/tested) but is never SERVED, so the cash book stays the only reporting path.
router.use((req, res, next) => (config.accountingV2 ? next() : next(ApiError.notFound('Accounting v2 disabled'))));
router.use(requireAuth, requireCap('reports'));

router.get('/trial-balance', ctrl.trialBalance);
router.get('/balance-sheet', ctrl.balanceSheet);
router.get('/income-statement', ctrl.incomeStatement);
router.get('/cash-flow', ctrl.cashFlow);   // Arus Kas (operasi/investasi/pendanaan) — reconciles to real cash
router.get('/general-ledger', ctrl.generalLedger);   // all accounts (trial-balance style summary)
router.get('/ledger', ctrl.ledger);                  // ONE account — Buku Besar with running balance (?code=)
router.get('/aging', ctrl.aging);                    // Umur Piutang (AR aging buckets)
router.get('/receivables', ctrl.receivables);
router.get('/unmapped', ctrl.unmapped);
router.post('/backfill', ctrl.backfill);   // owner-driven projection from the cash book

// PERIOD CLOSE — list/checklist readable by any reports user; close is owner/GM-tier, reopen owner-only.
router.get('/periods', ctrl.periods);
router.get('/periods/checklist', ctrl.periodChecklist);
router.post('/periods/close', requireRole('owner', 'gm'), ctrl.periodClose);
router.post('/periods/reopen', requireRole('owner'), ctrl.periodReopen);

// BANK RECONCILIATION — view an account's cleared/uncleared movements + running diff; mark items cleared.
router.get('/reconciliation', ctrl.reconciliation);
router.post('/reconciliation/mark', ctrl.reconcileMark);

module.exports = router;
