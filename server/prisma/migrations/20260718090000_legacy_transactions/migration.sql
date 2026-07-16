-- Per-customer legacy transaction import (archive-only rows). Additive.
ALTER TABLE "DistTransaction" ADD COLUMN "legacy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DistTransaction" ADD COLUMN "importBatchId" TEXT;
CREATE INDEX "DistTransaction_importBatchId_idx" ON "DistTransaction"("importBatchId");
