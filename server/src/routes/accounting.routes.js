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
router.get('/chart', ctrl.chart);                    // full chart of accounts (hierarchy) for the Buku Besar picker
router.get('/ledger', ctrl.ledger);                  // ONE account — Buku Besar with running balance (?code=)
router.get('/journal', ctrl.journal);                // one source's full balanced journal (?sourceType=&sourceId=) — drill
router.get('/aging', ctrl.aging);                    // Umur Piutang (AR aging buckets)
router.get('/receivables', ctrl.receivables);

// ACCOUNTS PAYABLE (Utang Usaha) — bills accrue an expense when incurred; payments (partial ok) settle
// them. AP aging mirrors AR; "payables-due" is the jatuh-tempo-minggu-ini card. All under the flag gate.
router.get('/bills', ctrl.billsList);
router.get('/aging-payable', ctrl.apAging);          // Umur Utang (AP aging) — BEFORE :id
router.get('/payables-due', ctrl.apDue);             // jatuh tempo minggu ini
router.get('/bills/:id', ctrl.billGet);
router.post('/bills', ctrl.billCreate);
router.patch('/bills/:id', ctrl.billUpdate);         // draft only
router.post('/bills/:id/issue', ctrl.billIssue);     // draft → terbuka (posts the accrual journal)
router.post('/bills/:id/payments', ctrl.billPay);    // partial payment (posts Dr Utang / Cr Kas/Bank)
router.post('/bills/:id/void', ctrl.billVoid);

// ACCRUAL MECHANICS — accrued expenses (reversing entries) + prepaid amortisation schedules.
router.get('/accruals', ctrl.accrualsList);
router.post('/accruals', ctrl.accrualCreate);        // Dr Beban · Cr 2-4000 now; auto-reversed next period
router.post('/accruals/:id/void', ctrl.accrualVoid);
router.get('/amortization-schedules', ctrl.schedulesList);
router.post('/amortization-schedules', ctrl.scheduleCreate);   // manual standalone prepaid
router.post('/amortize', ctrl.amortize);             // post every due month up to { asOf } (idempotent)

// RECURRING SUBSCRIPTIONS — a recurring bill template; running it generates the due Bills (idempotent).
router.get('/subscriptions', ctrl.subsList);
router.post('/subscriptions/run', ctrl.subRun);      // generate due bills up to { asOf } — BEFORE :id
router.get('/subscriptions/:id', ctrl.subGet);
router.post('/subscriptions', ctrl.subCreate);
router.patch('/subscriptions/:id', ctrl.subUpdate);
router.post('/subscriptions/:id/pause', ctrl.subPause);
router.post('/subscriptions/:id/resume', ctrl.subResume);
router.post('/subscriptions/:id/cancel', ctrl.subCancel);
router.post('/subscriptions/:id/skip', ctrl.subSkip);   // skip the next cycle (no bill)
router.get('/unmapped', ctrl.unmapped);
router.get('/integrity', ctrl.integrity);  // drift detector — sources missing a journal / orphan journals
router.get('/status', ctrl.status);        // workflow-panel + report-header roll-up (?asOf=YYYY-MM-DD)
// PEMETAAN AKUN — read for any reports user; map/unmap is owner/GM-tier (a config change).
router.get('/mappings', ctrl.mappings);
router.post('/mappings', requireRole('owner', 'gm'), ctrl.setMapping);
router.delete('/mappings', requireRole('owner', 'gm'), ctrl.clearMapping);
router.post('/backfill', requireRole('owner', 'gm'), ctrl.backfill);   // owner/GM projection from the cash book (dryRun = preview; else starts an async job → { jobId })
router.get('/backfill/status/:jobId', ctrl.backfillStatus);           // poll async backfill progress { processed, total, status, result }

// PERIOD CLOSE — list/checklist readable by any reports user; close is owner/GM-tier, reopen owner-only.
router.get('/periods', ctrl.periods);
router.get('/periods/checklist', ctrl.periodChecklist);
router.post('/periods/close', requireRole('owner', 'gm'), ctrl.periodClose);
router.post('/periods/reopen', requireRole('owner'), ctrl.periodReopen);

// BANK RECONCILIATION — view an account's cleared/uncleared movements + running diff; mark items cleared.
router.get('/reconciliation', ctrl.reconciliation);
router.post('/reconciliation/mark', ctrl.reconcileMark);

module.exports = router;
