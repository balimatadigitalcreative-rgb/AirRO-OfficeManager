-- Stage 4 — inter-unit transfers. Additive: four nullable/defaulted columns on Entry so an
-- internal money movement between two business units can be stored as a linked PAIR of entries
-- (payer expense + receiver income) sharing transferGroupId with interUnit=true. Existing rows
-- default interUnit=false / nulls, so nothing changes and no combined total moves.
ALTER TABLE "Entry" ADD COLUMN "interUnit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Entry" ADD COLUMN "transferGroupId" TEXT;
ALTER TABLE "Entry" ADD COLUMN "counterpartUnitId" TEXT;
ALTER TABLE "Entry" ADD COLUMN "counterpartAccountId" TEXT;
CREATE INDEX "Entry_transferGroupId_idx" ON "Entry"("transferGroupId");
