'use strict';
const createApp = require('./app');
const config = require('./config/env');
const prisma = require('./lib/prisma');
const { seedBuiltinRoles } = require('./config/permissions');
const distribution = require('./services/distribution.service');
const gudang = require('./services/gudang.service');
const attachments = require('./services/attachment.service');
const businessUnits = require('./services/businessUnit.service');

const app = createApp();
// Ensure built-in roles exist + warm the permission cache (idempotent). resolvePerms
// falls back to the hard-coded seed while this loads, so auth is never blocked.
seedBuiltinRoles().catch(() => {});
// Ensure the seed customer types (reguler/kos/cafe/bulk) exist (idempotent).
distribution.seedCustomerTypes().catch(() => {});
// Ensure the seed warehouse items (Galon/Sticker/Tutup/Segel) exist (idempotent).
gudang.seedInventoryItems().catch(() => {});
// Business unit (Stage 1): ensure the seed units exist, then backfill any still-unlabelled
// core row to "Air". Both idempotent — the migration already did this; this covers rows a
// pre-migration build may have created between deploy and migrate. Never changes any number.
businessUnits.seedBusinessUnits()
  .then(() => businessUnits.backfillBusinessUnit())
  .then((filled) => { if (Object.keys(filled).length) console.log('[business-unit] backfilled → Air:', JSON.stringify(filled)); })
  // "Posisi kantor" is gone from the employee form — office is now DERIVED from the business unit.
  // Existing staff may disagree; we REPORT that (never rewrite), because the stored office is the
  // source of truth for the NIP they already hold.
  .then(() => businessUnits.auditOfficeUnitMismatch())
  .then((rows) => { if (rows && rows.length) console.warn(`[business-unit] ${rows.length} employee(s) whose office ≠ their unit's NIP prefix (left as-is, review):`, JSON.stringify(rows.slice(0, 20))); })
  .catch(() => {});
// One-time: move any inline base64 proofs out of Entry/Setoran into the Attachment
// table so old records stop dragging photos through the sync payload (idempotent).
attachments.migrateInlineProofs().catch(() => {});
// One-time: also strip inline base64 out of the /state Document blobs (attendance,
// cashbon, legacy setoran, …) so GET /state stops shipping megabytes of photos. Runs
// after inline-proofs; both are idempotent and safe to run on every boot.
attachments.migrateStateBlobProofs().catch(() => {});

const server = app.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`AirRO Finance API listening on http://${config.host}:${config.port} (${config.env})`);
});

// Graceful shutdown.
async function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received — shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

module.exports = server;
