-- Opening / carry-over bon: a REAL receivable typed in by an admin for customers whose old
-- records couldn't be imported. Stored as a normal bon transaction (method='bon', legacy=0)
-- so all existing receivable math counts it; this flag only labels + audits it.
-- Additive: one nullable-with-default column, existing rows default to false.
ALTER TABLE "DistTransaction" ADD COLUMN "openingBon" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "DistTransaction_openingBon_idx" ON "DistTransaction"("openingBon");
