-- CUSTOMER ZONES — areas on the map that own the delivery schedule of the customers inside them.
--
-- Additive only. A zone's armada '' / deliveryDays '[]' mean "not set": the customer keeps its own
-- value, so creating a zone can never blank a schedule. Customer.zoneId is DERIVED from the customer's
-- point unless zoneManual is set (placed by hand). Deleting a zone releases its customers (SET NULL);
-- their last-applied schedule stays as it was.
CREATE TABLE "DistZone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0B6FA8',
    "polygon" TEXT NOT NULL,
    "armada" TEXT NOT NULL DEFAULT '',
    "deliveryDays" TEXT NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "DistZone_sortOrder_idx" ON "DistZone"("sortOrder");

ALTER TABLE "Customer" ADD COLUMN "zoneId" TEXT REFERENCES "DistZone" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD COLUMN "zoneManual" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Customer_zoneId_idx" ON "Customer"("zoneId");
