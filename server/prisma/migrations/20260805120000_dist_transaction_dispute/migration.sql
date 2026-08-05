-- Transaction DISPUTE / LOSS status. ADDITIVE: a new side table only; DistTransaction is never
-- mutated. A dispute changes a transaction's STATUS (disengketakan / tidak_diakui / kerugian /
-- diakui_kembali) without deleting or hiding the row. Approved tidak_diakui/kerugian rows are the
-- SAME records surfaced by the Kerugian / Uang Tidak Diterima report (no duplicates).
CREATE TABLE "DistTransactionDispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'investigasi',
    "reason" TEXT NOT NULL,
    "disputedAmount" BIGINT NOT NULL DEFAULT 0,
    "customerClaimAmount" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "staffUserId" TEXT,
    "staffName" TEXT,
    "lossId" TEXT,
    "staffLiabilityId" TEXT,
    "reversalOf" TEXT,
    "reversedById" TEXT,
    "raisedById" TEXT,
    "raisedByName" TEXT,
    "raisedByRole" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DistTransactionDispute_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DistTransactionDispute_transactionId_idx" ON "DistTransactionDispute"("transactionId");
CREATE INDEX "DistTransactionDispute_customerId_idx" ON "DistTransactionDispute"("customerId");
CREATE INDEX "DistTransactionDispute_status_idx" ON "DistTransactionDispute"("status");
CREATE INDEX "DistTransactionDispute_fleetId_idx" ON "DistTransactionDispute"("fleetId");
