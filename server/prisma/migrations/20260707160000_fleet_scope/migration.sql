-- Per-fleet data separation for the Distribusi module.

-- Transactions carry the fleet they belong to (copied from the customer's armada).
ALTER TABLE "DistTransaction" ADD COLUMN "fleetId" TEXT NOT NULL DEFAULT '';
-- Backfill from each transaction's customer armada (delivery fleet).
UPDATE "DistTransaction"
   SET "fleetId" = COALESCE((SELECT "armada" FROM "Customer" WHERE "Customer"."id" = "DistTransaction"."customerId"), '');
CREATE INDEX "DistTransaction_fleetId_idx" ON "DistTransaction"("fleetId");

-- Audit rows carry the fleet of the event ("" = global/cross-fleet).
ALTER TABLE "DistAuditLog" ADD COLUMN "fleetId" TEXT NOT NULL DEFAULT '';

-- Per-user fleet access scope ("all" or a JSON array of fleet names).
ALTER TABLE "User" ADD COLUMN "fleetScope" TEXT NOT NULL DEFAULT 'all';
