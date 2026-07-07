-- AlterTable: Customer gains delivery days + delivery fleet (back-compat defaults)
ALTER TABLE "Customer" ADD COLUMN "deliveryDays" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Customer" ADD COLUMN "armada" TEXT NOT NULL DEFAULT '';

-- CreateTable: editable customer-type dictionary (id + label)
CREATE TABLE "CustomerType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
