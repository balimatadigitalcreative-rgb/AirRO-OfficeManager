-- Gallon pool write-off (owner 2026-10-02): remembered written-off accumulated + one write-off row per ganti rugi.
ALTER TABLE "FixedAsset" ADD COLUMN "writtenOffAccum" BIGINT NOT NULL DEFAULT 0;
CREATE TABLE "GallonPoolWriteOff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "cost" BIGINT NOT NULL,
    "accum" BIGINT NOT NULL,
    "salvage" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reversedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "GallonPoolWriteOff_transactionId_key" ON "GallonPoolWriteOff"("transactionId");
CREATE INDEX "GallonPoolWriteOff_assetId_idx" ON "GallonPoolWriteOff"("assetId");
