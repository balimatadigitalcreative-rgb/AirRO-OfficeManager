-- MODE LAPANGAN — payment method column (transfer sales, Kas vs Bank), row kind (ganti rugi galon) and
-- the proof photo. Additive; existing rows: payMethod '' (legacy note tag still honoured), kind 'jual'.
ALTER TABLE "DistTransaction" ADD COLUMN "payMethod" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DistTransaction" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'jual';
ALTER TABLE "DistTransaction" ADD COLUMN "gallonQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DistTransaction" ADD COLUMN "proofPhotoId" TEXT;
ALTER TABLE "DistTransaction" ADD COLUMN "proofTakenAt" DATETIME;
ALTER TABLE "DistTransaction" ADD COLUMN "proofLat" REAL;
ALTER TABLE "DistTransaction" ADD COLUMN "proofLng" REAL;
