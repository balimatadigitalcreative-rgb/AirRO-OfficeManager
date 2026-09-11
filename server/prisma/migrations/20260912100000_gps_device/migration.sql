-- FLEET GPS (Cartrack) — one tracked vehicle mapped to an AirRO armada.
-- Additive: a brand-new table, nothing existing is touched. The fleet mapping is seeded from the
-- provider's vehicle_name suffix but stays editable (fleetSource='manual' survives a re-sync), and
-- every timestamp is stored as a UTC instant with the raw string + assumed zone kept for audit.
CREATE TABLE "GpsDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'cartrack',
    "vehicleId" TEXT NOT NULL,
    "registration" TEXT NOT NULL DEFAULT '',
    "vehicleName" TEXT NOT NULL DEFAULT '',
    "fleetId" TEXT NOT NULL DEFAULT '',
    "fleetSource" TEXT NOT NULL DEFAULT 'derived',
    "providerTz" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLat" REAL,
    "lastLng" REAL,
    "lastSpeedKph" REAL,
    "lastFixAt" DATETIME,
    "lastFixRaw" TEXT NOT NULL DEFAULT '',
    "lastFixAssumedTz" TEXT NOT NULL DEFAULT '',
    "lastSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GpsDevice_provider_vehicleId_key" ON "GpsDevice"("provider", "vehicleId");
CREATE INDEX "GpsDevice_fleetId_idx" ON "GpsDevice"("fleetId");
