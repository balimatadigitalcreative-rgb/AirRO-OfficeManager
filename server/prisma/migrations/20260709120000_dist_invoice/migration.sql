-- Customer invoices / notas (documents; never mutate transactions).
CREATE TABLE "DistInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "issueDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL DEFAULT '',
    "items" TEXT NOT NULL DEFAULT '[]',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sisaBon" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "DistInvoice_number_key" ON "DistInvoice"("number");
CREATE INDEX "DistInvoice_customerId_idx" ON "DistInvoice"("customerId");
CREATE INDEX "DistInvoice_fleetId_idx" ON "DistInvoice"("fleetId");
