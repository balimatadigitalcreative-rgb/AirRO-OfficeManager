-- Supplier (Pemasok) system for Gudang. Additive: new tables + a nullable column on StockMovement.
ALTER TABLE "StockMovement" ADD COLUMN "supplierId" TEXT;
CREATE INDEX "StockMovement_supplierId_idx" ON "StockMovement"("supplierId");

CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByName" TEXT,
    "editedByName" TEXT,
    "editedAt" DATETIME,
    "deactivatedByName" TEXT,
    "deactivatedAt" DATETIME
);
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");
CREATE INDEX "Supplier_active_idx" ON "Supplier"("active");

CREATE TABLE "SupplierCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SupplierCode_code_key" ON "SupplierCode"("code");
CREATE UNIQUE INDEX "SupplierCode_seq_key" ON "SupplierCode"("seq");
