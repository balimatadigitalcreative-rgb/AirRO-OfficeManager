-- Correction gains numeric price-adjustment fields (retro master-price changes).
ALTER TABLE "Correction" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Correction" ADD COLUMN "deltaAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Correction" ADD COLUMN "batchId" TEXT;
ALTER TABLE "Correction" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Correction" ADD COLUMN "actorName" TEXT;

-- Index for grouping / cancelling a whole price-change batch.
CREATE INDEX "Correction_batchId_idx" ON "Correction"("batchId");
