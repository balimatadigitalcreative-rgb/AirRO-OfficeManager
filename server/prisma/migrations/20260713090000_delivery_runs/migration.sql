-- Delivery runs (rit): per-trip gallon out/in tally + reconciliation. Additive.
ALTER TABLE "DistTransaction" ADD COLUMN "deliveryRunId" TEXT;

CREATE TABLE "DeliveryRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "runNo" INTEGER NOT NULL,
    "gallonsOut" INTEGER NOT NULL DEFAULT 0,
    "gallonsFullReturned" INTEGER NOT NULL DEFAULT 0,
    "gallonsEmptyReturned" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "diffReason" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "openedById" TEXT,
    "openedByName" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedByName" TEXT,
    "closedAt" DATETIME
);

CREATE UNIQUE INDEX "DeliveryRun_date_fleetId_runNo_key" ON "DeliveryRun"("date", "fleetId", "runNo");
CREATE INDEX "DeliveryRun_fleetId_status_idx" ON "DeliveryRun"("fleetId", "status");
CREATE INDEX "DeliveryRun_date_fleetId_idx" ON "DeliveryRun"("date", "fleetId");
CREATE INDEX "DistTransaction_deliveryRunId_idx" ON "DistTransaction"("deliveryRunId");
