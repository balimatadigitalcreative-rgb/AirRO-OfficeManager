-- Kerugian BATALKAN (loss cancellation) metadata on DistTransactionDispute. ADDITIVE: nullable
-- columns only; no existing data touched. A cancelled loss reverts its dispute to 'disengketakan'
-- (bon restored) but stays visible in the Kerugian list, marked "Dibatalkan", excluded from totals.
ALTER TABLE "DistTransactionDispute" ADD COLUMN "lossVoidedAt" DATETIME;
ALTER TABLE "DistTransactionDispute" ADD COLUMN "lossVoidReason" TEXT;
ALTER TABLE "DistTransactionDispute" ADD COLUMN "lossVoidNote" TEXT;
ALTER TABLE "DistTransactionDispute" ADD COLUMN "lossVoidedById" TEXT;
ALTER TABLE "DistTransactionDispute" ADD COLUMN "lossVoidedByName" TEXT;
