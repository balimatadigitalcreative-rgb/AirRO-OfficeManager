-- "Reset Total Stok Galon": tag rows retired by a reset batch (for restore + hiding retired history).
-- ADDITIVE: one nullable column + index. Touches only GallonMovement; no data is moved.
ALTER TABLE "GallonMovement" ADD COLUMN "resetBatchId" TEXT;
CREATE INDEX "GallonMovement_resetBatchId_idx" ON "GallonMovement"("resetBatchId");
