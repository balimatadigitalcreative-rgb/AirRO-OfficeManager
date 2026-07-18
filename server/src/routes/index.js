'use strict';
const fs = require('fs');
const path = require('path');
const { Router } = require('express');

const router = Router();

// Liveness/readiness probe — no auth, no DB dependency required to be "live".
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
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
router.use('/reports', require('./report.routes'));
router.use('/state', require('./state.routes'));   // shared app-state document store
router.use('/events', require('./events.routes')); // SSE realtime change stream

module.exports = router;
