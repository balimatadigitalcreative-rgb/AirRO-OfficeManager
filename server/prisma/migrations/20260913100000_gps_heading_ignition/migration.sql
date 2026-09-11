-- FLEET GPS — heading and ignition from the /vehicles/status feed.
-- Additive and nullable: NULL means "the provider did not tell us", which is a different thing from
-- "stationary" (speed 0) or "engine off" (ignition false) and must stay distinguishable.
ALTER TABLE "GpsDevice" ADD COLUMN "lastHeadingDeg" REAL;
ALTER TABLE "GpsDevice" ADD COLUMN "lastIgnitionOn" BOOLEAN;
