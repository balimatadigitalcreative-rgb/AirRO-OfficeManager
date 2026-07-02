/*
  Warnings:

  - Added the required column `updatedAt` to the `Setoran` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Setoran" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "armada" TEXT NOT NULL DEFAULT '',
    "galon" INTEGER NOT NULL DEFAULT 0,
    "cash" INTEGER NOT NULL DEFAULT 0,
    "bon" INTEGER NOT NULL DEFAULT 0,
    "bonPay" INTEGER NOT NULL DEFAULT 0,
    "expense" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "proof" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "fleetId" TEXT,
    "createdById" TEXT,
    CONSTRAINT "Setoran_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Setoran_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Setoran" ("bonPay", "cash", "createdAt", "createdById", "date", "expense", "fleetId", "id", "note") SELECT "bonPay", "cash", "createdAt", "createdById", "date", "expense", "fleetId", "id", "note" FROM "Setoran";
DROP TABLE "Setoran";
ALTER TABLE "new_Setoran" RENAME TO "Setoran";
CREATE INDEX "Setoran_date_idx" ON "Setoran"("date");
CREATE INDEX "Setoran_updatedAt_idx" ON "Setoran"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
