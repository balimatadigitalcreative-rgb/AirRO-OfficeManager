-- Daily warehouse closeout (opname / stock-take + day report). Additive.
CREATE TABLE "WarehouseCloseout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "closedById" TEXT,
    "closedByName" TEXT,
    "closedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "items" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL DEFAULT '{}',
    "note" TEXT NOT NULL DEFAULT '',
    "diffCount" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "WarehouseCloseout_date_key" ON "WarehouseCloseout"("date");
