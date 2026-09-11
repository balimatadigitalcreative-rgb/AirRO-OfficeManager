-- CUSTOMER LOCATION HISTORY — every change to a customer's coordinates, so a bad capture can be
-- reverted without sending anyone back to the door.
--
-- Additive: a new table only. One row per CHANGE, holding BOTH sides of it (prev* and lat/lng), so a
-- revert is a straight read of the previous point and never a replay of the whole chain.
-- action: 'set' (captured/replaced) | 'clear' (removed) | 'revert' (restored a previous point).
CREATE TABLE "CustomerLocationHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'set',
    "lat" REAL,
    "lng" REAL,
    "accuracy" REAL,
    "prevLat" REAL,
    "prevLng" REAL,
    "prevAccuracy" REAL,
    -- Metres between the old point and the new one. Stored rather than recomputed so the number in
    -- the audit trail is the number the person was shown when they confirmed.
    "movedM" REAL,
    "note" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerLocationHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomerLocationHistory_customerId_idx" ON "CustomerLocationHistory"("customerId");
CREATE INDEX "CustomerLocationHistory_createdAt_idx" ON "CustomerLocationHistory"("createdAt");
