-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DistTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceLocked" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'lunas',
    "note" TEXT NOT NULL DEFAULT '',
    "txnDate" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "actorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DistTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DistTransaction" ("actorId", "actorName", "actorRole", "amount", "createdAt", "customerId", "id", "method", "qty", "txnDate", "unitPriceLocked") SELECT "actorId", "actorName", "actorRole", "amount", "createdAt", "customerId", "id", "method", "qty", "txnDate", "unitPriceLocked" FROM "DistTransaction";
DROP TABLE "DistTransaction";
ALTER TABLE "new_DistTransaction" RENAME TO "DistTransaction";
CREATE INDEX "DistTransaction_txnDate_idx" ON "DistTransaction"("txnDate");
CREATE INDEX "DistTransaction_customerId_idx" ON "DistTransaction"("customerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
