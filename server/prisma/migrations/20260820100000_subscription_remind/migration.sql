-- AlterTable: per-subscription reminder lead time (days before the next cycle).
ALTER TABLE "Subscription" ADD COLUMN "remindDays" INTEGER NOT NULL DEFAULT 3;
