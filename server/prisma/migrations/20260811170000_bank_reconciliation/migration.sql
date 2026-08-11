-- ACCOUNTING v2 — bank reconciliation. Additive: one new table, touches nothing existing.
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "statementRef" TEXT NOT NULL DEFAULT '',
    "clearedById" TEXT,
    "clearedByName" TEXT,
    "clearedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Reconciliation_accountId_itemType_itemId_key" ON "Reconciliation"("accountId", "itemType", "itemId");
CREATE INDEX "Reconciliation_accountId_idx" ON "Reconciliation"("accountId");
