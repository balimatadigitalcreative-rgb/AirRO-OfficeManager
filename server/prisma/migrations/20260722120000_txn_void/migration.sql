-- Distribution transaction VOID (recorded cancellation) + support for owner-only hard delete.
-- Additive: existing rows default status='active', so no aggregate changes. A voided row STAYS
-- (status='void', excluded from every aggregate + its gallon movements reversed); hard delete
-- removes the row but always writes an audit entry first.
ALTER TABLE "DistTransaction" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "DistTransaction" ADD COLUMN "voidedById" TEXT;
ALTER TABLE "DistTransaction" ADD COLUMN "voidedByName" TEXT;
ALTER TABLE "DistTransaction" ADD COLUMN "voidedByRole" TEXT;
ALTER TABLE "DistTransaction" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "DistTransaction" ADD COLUMN "voidReason" TEXT;
CREATE INDEX "DistTransaction_status_idx" ON "DistTransaction"("status");
