-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Cashbon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "installments" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "cycleAnchor" TEXT,
    "data" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Cashbon_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Cashbon" ("amount", "createdAt", "cycleAnchor", "date", "employeeId", "id", "installments", "note", "status") SELECT "amount", "createdAt", "cycleAnchor", "date", "employeeId", "id", "installments", "note", "status" FROM "Cashbon";
DROP TABLE "Cashbon";
ALTER TABLE "new_Cashbon" RENAME TO "Cashbon";
CREATE INDEX "Cashbon_employeeId_idx" ON "Cashbon"("employeeId");
CREATE INDEX "Cashbon_updatedAt_idx" ON "Cashbon"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
