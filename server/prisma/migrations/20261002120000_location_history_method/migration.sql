-- GESER TITIK — how a customer point was set and how far it was dragged from the phone's own fix.
-- Additive; existing history rows read as method 'gps'.
ALTER TABLE "CustomerLocationHistory" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'gps';
ALTER TABLE "CustomerLocationHistory" ADD COLUMN "deviceLat" REAL;
ALTER TABLE "CustomerLocationHistory" ADD COLUMN "deviceLng" REAL;
ALTER TABLE "CustomerLocationHistory" ADD COLUMN "deviceAccuracy" REAL;
ALTER TABLE "CustomerLocationHistory" ADD COLUMN "fromDeviceM" REAL;
