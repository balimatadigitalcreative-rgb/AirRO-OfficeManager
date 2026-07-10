-- Customer GPS location (collected in the field), address, and who/when set it.
ALTER TABLE "Customer" ADD COLUMN "lat" REAL;
ALTER TABLE "Customer" ADD COLUMN "lng" REAL;
ALTER TABLE "Customer" ADD COLUMN "address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "locationSetAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "locationSetByName" TEXT;
