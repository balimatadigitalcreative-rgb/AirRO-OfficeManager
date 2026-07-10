-- Soft-deactivation for customers (history kept). Hard delete has no schema change.
ALTER TABLE "Customer" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Customer" ADD COLUMN "deactivatedAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "deactivatedByName" TEXT;
