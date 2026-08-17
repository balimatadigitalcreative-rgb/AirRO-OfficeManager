-- CreateTable: runtime override of the hardcoded cash-book category → account map.
CREATE TABLE "CategoryMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "chartCode" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "CategoryMapping_categoryKey_type_key" ON "CategoryMapping"("categoryKey", "type");
CREATE INDEX "CategoryMapping_type_idx" ON "CategoryMapping"("type");
