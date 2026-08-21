-- FIXED ASSETS & DEPRECIATION on the double-entry engine.
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "acquisitionDate" TEXT NOT NULL,
    "acquisitionCost" BIGINT NOT NULL,
    "salvageValue" BIGINT NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'garis_lurus',
    "chartAccountId" TEXT NOT NULL,
    "accumulatedAccountId" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "businessUnitId" TEXT,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "isProduction" BOOLEAN NOT NULL DEFAULT false,
    "pooled" BOOLEAN NOT NULL DEFAULT false,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'aktif',
    "disposalDate" TEXT,
    "disposalProceeds" BIGINT,
    "note" TEXT NOT NULL DEFAULT '',
    "attachmentId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "FixedAsset_code_key" ON "FixedAsset"("code");
CREATE INDEX "FixedAsset_status_idx" ON "FixedAsset"("status");
CREATE INDEX "FixedAsset_category_idx" ON "FixedAsset"("category");
CREATE INDEX "FixedAsset_businessUnitId_idx" ON "FixedAsset"("businessUnitId");
CREATE INDEX "FixedAsset_fleetId_idx" ON "FixedAsset"("fleetId");

CREATE TABLE "DepreciationEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "bookValueAfter" BIGINT NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "postedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepreciationEntry_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DepreciationEntry_assetId_period_key" ON "DepreciationEntry"("assetId", "period");
CREATE INDEX "DepreciationEntry_assetId_idx" ON "DepreciationEntry"("assetId");
CREATE INDEX "DepreciationEntry_period_idx" ON "DepreciationEntry"("period");
