-- CreateTable: Accounts Payable (Bill / BillLine / BillPayment).
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL DEFAULT '',
    "billDate" TEXT NOT NULL,
    "dueDate" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "tax" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "businessUnitId" TEXT,
    "periodId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "voidReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Bill_supplierId_idx" ON "Bill"("supplierId");
CREATE INDEX "Bill_status_idx" ON "Bill"("status");
CREATE INDEX "Bill_billDate_idx" ON "Bill"("billDate");
CREATE INDEX "Bill_dueDate_idx" ON "Bill"("dueDate");

CREATE TABLE "BillLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "chartAccountId" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" BIGINT NOT NULL DEFAULT 0,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "fleetId" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "BillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BillLine_billId_idx" ON "BillLine"("billId");

CREATE TABLE "BillPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "accountId" TEXT,
    "method" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BillPayment_billId_idx" ON "BillPayment"("billId");
