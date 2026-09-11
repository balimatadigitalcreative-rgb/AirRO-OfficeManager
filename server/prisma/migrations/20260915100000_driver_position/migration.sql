-- DRIVER POSITION — the phone's last known position, ONE ROW PER USER.
--
-- Deliberately not a trail: each new fix REPLACES the user's row. There is no history table here and
-- no way to reconstruct where somebody has been, because this exists to order today's stops, not to
-- watch staff. Rows older than the retention window are deleted on read and on write.
--
-- fleetId is resolved from the SESSION's fleetScope when the row is written, never from the request
-- body, so a crafted payload cannot attribute a position to another fleet.
CREATE TABLE "DriverPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL DEFAULT '',
    "fleetId" TEXT NOT NULL DEFAULT '',
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "accuracy" REAL,
    "recordedAt" DATETIME NOT NULL,       -- when the PHONE took the fix
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "DriverPosition_userId_key" ON "DriverPosition"("userId");
CREATE INDEX "DriverPosition_fleetId_idx" ON "DriverPosition"("fleetId");
CREATE INDEX "DriverPosition_recordedAt_idx" ON "DriverPosition"("recordedAt");
