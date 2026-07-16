-- Location quality: GPS accuracy + a location photo (Attachment ref, bytes stored out of the row). Additive.
ALTER TABLE "Customer" ADD COLUMN "locationAccuracy" REAL;
ALTER TABLE "Customer" ADD COLUMN "locationPhotoId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "locationPhotoAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "locationPhotoByName" TEXT;
