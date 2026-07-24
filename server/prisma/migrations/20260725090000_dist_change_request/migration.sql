-- Approval-gated corrections/voids for distribusi transactions. Additive: one new table + indexes.
-- The original DistTransaction rows are untouched; a correction/void is now a PENDING request that
-- only mutates the transaction once approved.
CREATE TABLE "DistChangeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedByName" TEXT,
    "requestedByRole" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedByRole" TEXT,
    "decisionNote" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DistChangeRequest_status_idx" ON "DistChangeRequest"("status");
CREATE INDEX "DistChangeRequest_transactionId_idx" ON "DistChangeRequest"("transactionId");
CREATE INDEX "DistChangeRequest_fleetId_idx" ON "DistChangeRequest"("fleetId");
