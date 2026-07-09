-- Per-customer billing reminder settings (JSON).
ALTER TABLE "Customer" ADD COLUMN "reminder" TEXT NOT NULL DEFAULT '';
