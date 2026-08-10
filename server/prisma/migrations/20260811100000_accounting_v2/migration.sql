-- ACCOUNTING v2 — double-entry layer ON TOP of the cash book. ADDITIVE ONLY: no existing table is
-- touched, so every current report stays byte-identical. Populated by accounting.service behind the
-- ACCOUNTING_V2 feature flag.
CREATE TABLE "ChartAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "subtype" TEXT NOT NULL DEFAULT '',
  "parentId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "businessUnitId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ChartAccount_code_key" ON "ChartAccount"("code");
CREATE INDEX "ChartAccount_type_idx" ON "ChartAccount"("type");
CREATE INDEX "ChartAccount_parentId_idx" ON "ChartAccount"("parentId");

CREATE TABLE "JournalEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "date" TEXT NOT NULL,
  "ref" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "postedById" TEXT,
  "postedByName" TEXT,
  "postedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversalOf" TEXT,
  "periodId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "JournalEntry_sourceType_sourceId_key" ON "JournalEntry"("sourceType", "sourceId");
CREATE INDEX "JournalEntry_date_idx" ON "JournalEntry"("date");
CREATE INDEX "JournalEntry_sourceType_idx" ON "JournalEntry"("sourceType");

CREATE TABLE "JournalLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "journalEntryId" TEXT NOT NULL,
  "chartAccountId" TEXT NOT NULL,
  "debit" BIGINT NOT NULL DEFAULT 0,
  "credit" BIGINT NOT NULL DEFAULT 0,
  "businessUnitId" TEXT,
  "fleetId" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JournalLine_chartAccountId_fkey" FOREIGN KEY ("chartAccountId") REFERENCES "ChartAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");
CREATE INDEX "JournalLine_chartAccountId_idx" ON "JournalLine"("chartAccountId");
