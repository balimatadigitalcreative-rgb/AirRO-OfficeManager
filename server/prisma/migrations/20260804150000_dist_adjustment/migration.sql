-- Customer balance ADJUSTMENT (penyesuaian). ADDITIVE: a new table only; no existing data touched.
CREATE TABLE "DistAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "before" BIGINT NOT NULL DEFAULT 0,
    "delta" BIGINT NOT NULL DEFAULT 0,
    "after" BIGINT NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "evidenceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reversalOf" TEXT,
    "reversedById" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DistAdjustment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DistAdjustment_customerId_idx" ON "DistAdjustment"("customerId");
CREATE INDEX "DistAdjustment_status_idx" ON "DistAdjustment"("status");
CREATE INDEX "DistAdjustment_fleetId_idx" ON "DistAdjustment"("fleetId");
CREATE INDEX "DistAdjustment_kind_idx" ON "DistAdjustment"("kind");
