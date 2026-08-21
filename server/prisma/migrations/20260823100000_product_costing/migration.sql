-- HPP / PRODUCT COSTING — standard costing + variance analysis.
CREATE TABLE "CostStandard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL DEFAULT 'galon-19l',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "normalVolume" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "requestId" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" DATETIME,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "CostStandard_productId_idx" ON "CostStandard"("productId");
CREATE INDEX "CostStandard_status_idx" ON "CostStandard"("status");

CREATE TABLE "CostStandardLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "standardId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "qtyPerUnit" REAL NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '',
    "unitCost" BIGINT NOT NULL DEFAULT 0,
    "chartAccountId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CostStandardLine_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "CostStandard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CostStandardLine_standardId_idx" ON "CostStandardLine"("standardId");

CREATE TABLE "ProductionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "unitsProduced" INTEGER NOT NULL,
    "unitsRejected" INTEGER NOT NULL DEFAULT 0,
    "standardId" TEXT NOT NULL,
    "businessUnitId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "journalPosted" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "periodId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductionRun_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "CostStandard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProductionRun_date_idx" ON "ProductionRun"("date");
CREATE INDEX "ProductionRun_status_idx" ON "ProductionRun"("status");
CREATE INDEX "ProductionRun_standardId_idx" ON "ProductionRun"("standardId");

CREATE TABLE "ProductionInput" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "actualQty" REAL NOT NULL DEFAULT 0,
    "actualCost" BIGINT NOT NULL DEFAULT 0,
    "chartAccountId" TEXT NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProductionInput_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProductionInput_runId_idx" ON "ProductionInput"("runId");
