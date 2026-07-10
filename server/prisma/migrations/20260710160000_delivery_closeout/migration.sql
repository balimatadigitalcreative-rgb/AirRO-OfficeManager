-- Daily delivery closeout + per-stop reason for undelivered stops.
ALTER TABLE "Delivery" ADD COLUMN "pendingReason" TEXT NOT NULL DEFAULT '';

CREATE TABLE "DeliveryCloseout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "closedById" TEXT,
    "closedByName" TEXT,
    "closedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generalNote" TEXT NOT NULL DEFAULT '',
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "cancelled" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "DeliveryCloseout_date_fleetId_key" ON "DeliveryCloseout"("date", "fleetId");
CREATE INDEX "DeliveryCloseout_date_idx" ON "DeliveryCloseout"("date");
