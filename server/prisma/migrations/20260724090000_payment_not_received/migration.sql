-- "Pelunasan Tidak Diterima" (payment not received) — the customer genuinely paid their bon but the
-- money never reached the company (staff took it). The row is a REAL pelunasan for the CUSTOMER
-- (reduces sisa bon, prints as a received payment) but is EXCLUDED from every company money-in/cash
-- aggregate and reported as a LOSS against the responsible staff. lossReason/lossPhotoId are
-- internal-only (never printed for the customer — that is why the reason is not stored in `note`).
-- Additive: defaults keep every existing row behaving exactly as before.
ALTER TABLE "DistTransaction" ADD COLUMN "paymentNotReceived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DistTransaction" ADD COLUMN "responsibleUserId" TEXT;
ALTER TABLE "DistTransaction" ADD COLUMN "responsibleName" TEXT;
ALTER TABLE "DistTransaction" ADD COLUMN "lossReason" TEXT;
ALTER TABLE "DistTransaction" ADD COLUMN "lossPhotoId" TEXT;

CREATE INDEX "DistTransaction_paymentNotReceived_idx" ON "DistTransaction"("paymentNotReceived");
