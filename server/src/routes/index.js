'use strict';
const fs = require('fs');
const path = require('path');
const { Router } = require('express');

const router = Router();

// LIVENESS — the process is up. No auth, no DB. Deliberately cannot fail on a DB problem, so a
// monitor can still distinguish "process dead" from "process up but DB broken" (that's /health/ready).
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// READINESS — can the API actually SERVE data? This is the probe the plain /health lacked, and whose
// absence let an app-wide outage stay invisible: /health returned 200 while every DB-backed endpoint
// 500'd. Two checks, each mapping to a real outage class:
//   • db:     a trivial query — catches an unreachable / locked / corrupt database file.
//   • schema: a SELECT touching the NEWEST migrated columns via the RUNNING Prisma client — catches
//             "code deployed but `migrate deploy` didn't run", where the client references columns the
//             DB lacks (Prisma P2021/P2022) and every feature query throws at once.
// 200 {db:'ok',schema:'ok'} when serveable; 503 with a specific reason otherwise. Used by the deploy
// verification gate so a schema-behind / DB-down state ROLLS BACK instead of going green.
const prisma = require('../lib/prisma');
router.get('/health/ready', async (req, res) => {
  const out = { status: 'ok', db: 'ok', schema: 'ok', timestamp: new Date().toISOString() };
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    return res.status(503).json({ ...out, status: 'error', db: 'error', reason: 'db_unreachable', message: String(e && e.message || e).slice(0, 200) });
  }
  try {
    // Touch the tables/columns added by the recent migration burst through the client that is
    // actually running. If the deployed DB is behind, one of these throws (missing table/column).
    await prisma.businessUnit.findFirst({ select: { officeCode: true } });          // 20260726 office_code
    await prisma.distChangeRequest.findFirst({ select: { id: true } });             // 20260725 change_request
    await prisma.distTransaction.findFirst({ select: { paymentNotReceived: true } }); // 20260724 payment_not_received
  } catch (e) {
    return res.status(503).json({ ...out, status: 'error', schema: 'behind', reason: 'schema_behind', message: String(e && e.message || e).slice(0, 200) });
  }
  res.json(out);
});

// Build stamp (frontend code freshness). Unauthenticated + rate-limit-exempt (see
// rateLimiters) — the web app polls it every ~10 min to detect that a deploy has
// shipped newer JS than the tab is running, and prompt a reload. version.json is
// written by build.mjs at the repo root with the SAME value the bundle embeds.
// Re-read only when the file changes (mtime) so a rebuild is picked up without a
// restart, while normal polling costs nothing.
const VERSION_FILE = path.join(__dirname, '../../../version.json');
let versionCache = { mtimeMs: -1, data: { version: null } };
function readVersion() {
  try {
    const st = fs.statSync(VERSION_FILE);
    if (st.mtimeMs !== versionCache.mtimeMs) {
      versionCache = { mtimeMs: st.mtimeMs, data: JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')) };
    }
  } catch (e) { /* keep last known (or the null default) */ }
  return versionCache.data;
}
router.get('/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(readVersion());
});

// PUBLIC signed invoice page (WhatsApp share). Unauthed, like /health — the token IS the credential.
// Renders ONE invoice as noindex HTML (customer can Save-as-PDF). Expired/revoked/unknown → friendly page.
const invoiceShare = require('../services/invoiceShare.service');
router.get('/inv/:token', async (req, res) => {
  let view;
  try { view = await invoiceShare.publicView(req.params.token); }
  catch (e) { view = { status: 'notfound' }; }
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.status(view.status === 'ok' ? 200 : 404).send(invoiceShare.renderPublicHtml(view));
});

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/roles', require('./role.routes'));
router.use('/accounts', require('./account.routes'));
router.use('/categories', require('./category.routes'));
router.use('/entries', require('./entry.routes'));
router.use('/transfers', require('./transfer.routes'));
router.use('/setoran', require('./setoran.routes'));
router.use('/distribusi', require('./distribution.routes'));   // Distribusi module (separate from cash flow)
router.use('/gudang', require('./gudang.routes'));             // Gudang (warehouse) — ledger-based inventory
router.use('/fleet', require('./fleet.routes'));
router.use('/employees', require('./employee.routes'));
router.use('/cashbon', require('./cashbon.routes'));
router.use('/approvals', require('./approval.routes'));
router.use('/training', require('./training.routes'));
router.use('/calendar', require('./calendar.routes'));
router.use('/payroll', require('./payroll.routes'));
router.use('/attachments', require('./attachment.routes'));   // proof photos, out of the record payload
router.use('/settings', require('./settings.routes'));
router.use('/business-units', require('./businessUnit.routes'));   // unit bisnis dictionary (labels only, Stage 1)
router.use('/inter-unit-transfers', require('./interUnitTransfer.routes'));   // Stage 4: internal money movement between units
router.use('/reports', require('./report.routes'));
router.use('/data-wipe', require('./dataWipe.routes'));   // selective, guarded data wipe (cap: dataWipe)
router.use('/state', require('./state.routes'));   // shared app-state document store
router.use('/events', require('./events.routes')); // SSE realtime change stream

module.exports = router;
