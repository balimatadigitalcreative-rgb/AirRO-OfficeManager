-- Permanent audit trail for selective data wipes. Never wiped itself (in no category),
-- so the record of a deletion survives the deletion. Additive: one new table.
CREATE TABLE "DataWipeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categories" TEXT NOT NULL,
    "counts" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "backupFile" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DataWipeLog_createdAt_idx" ON "DataWipeLog"("createdAt");
