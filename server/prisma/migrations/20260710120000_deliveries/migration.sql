-- Delivery board: one stop per fleet per date (jadwal generated from deliveryDays + tambahan orders).
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "customerId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'jadwal',
    "seq" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "qty" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "transactionId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Delivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Delivery_date_customerId_source_key" ON "Delivery"("date", "customerId", "source");
CREATE INDEX "Delivery_date_fleetId_idx" ON "Delivery"("date", "fleetId");
