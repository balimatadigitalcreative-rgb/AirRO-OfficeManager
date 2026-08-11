-- ACCOUNTING v2 — period close. Additive: one new table, touches nothing existing.
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'terbuka',
    "closedById" TEXT,
    "closedByName" TEXT,
    "closedAt" DATETIME,
    "reopenReason" TEXT,
    "reopenedById" TEXT,
    "reopenedByName" TEXT,
    "reopenedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AccountingPeriod_periodKey_key" ON "AccountingPeriod"("periodKey");
CREATE INDEX "AccountingPeriod_status_idx" ON "AccountingPeriod"("status");
