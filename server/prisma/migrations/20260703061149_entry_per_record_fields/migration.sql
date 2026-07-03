-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT 'Cash',
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL DEFAULT '00:00',
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT,
    "acct" TEXT,
    "proof" TEXT,
    "meta" TEXT,
    "categoryKey" TEXT,
    "accountId" TEXT,
    "createdById" TEXT,
    CONSTRAINT "Entry_categoryKey_fkey" FOREIGN KEY ("categoryKey") REFERENCES "Category" ("key") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Entry" ("accountId", "amount", "categoryKey", "createdAt", "createdById", "date", "id", "method", "note", "status", "time", "type") SELECT "accountId", "amount", "categoryKey", "createdAt", "createdById", "date", "id", "method", "note", "status", "time", "type" FROM "Entry";
DROP TABLE "Entry";
ALTER TABLE "new_Entry" RENAME TO "Entry";
CREATE INDEX "Entry_date_idx" ON "Entry"("date");
CREATE INDEX "Entry_type_idx" ON "Entry"("type");
CREATE INDEX "Entry_updatedAt_idx" ON "Entry"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
