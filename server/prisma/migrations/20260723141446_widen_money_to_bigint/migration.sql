-- WIDEN MONEY COLUMNS Int -> BigInt (fixes: a mis-entered amount that overflows the 32-bit Int
-- mapping made Prisma throw "does not fit in an INT column" and blanked the transaction list).
-- SQLite stores both Int and BigInt as 64-bit INTEGER, so this is DATA-PRESERVING: each table is
-- rebuilt with the column re-declared BIGINT and every row copied via INSERT ... SELECT (the
-- "data could be lost" lines below are Prisma's generic type-change warning and do NOT apply to
-- Int->BigInt on SQLite). BACK UP THE DB FIRST (see DEPLOY.md). Additive to behaviour: values are
-- unchanged; the app now reads them as Number via the Prisma money result-extension.

/*
  Warnings:

  - You are about to alter the column `opening` on the `Account` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `amount` on the `Cashbon` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `deltaAmount` on the `Correction` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `masterPrice` on the `Customer` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `amount` on the `DistExpense` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `sisaBon` on the `DistInvoice` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `total` on the `DistInvoice` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `amount` on the `DistTransaction` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `unitPriceLocked` on the `DistTransaction` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `base` on the `Employee` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `tjBpjsKes` on the `Employee` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `tjBpjsTk` on the `Employee` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `tjKinerja` on the `Employee` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `tjProfesi` on the `Employee` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `tjRumahDinas` on the `Employee` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `amount` on the `Entry` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `dailyWage` on the `Orientation` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `newPrice` on the `PriceHistory` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `oldPrice` on the `PriceHistory` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `bon` on the `Setoran` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `bonPay` on the `Setoran` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `cash` on the `Setoran` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `expense` on the `Setoran` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `amount` on the `StockMovement` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `cost` on the `Training` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.
  - You are about to alter the column `amount` on the `Transfer` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'bank',
    "bank" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "opening" BIGINT NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#065489',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessUnitId" TEXT
);
INSERT INTO "new_Account" ("bank", "businessUnitId", "color", "createdAt", "id", "name", "number", "opening", "sortOrder", "type") SELECT "bank", "businessUnitId", "color", "createdAt", "id", "name", "number", "opening", "sortOrder", "type" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE INDEX "Account_businessUnitId_idx" ON "Account"("businessUnitId");
CREATE TABLE "new_Cashbon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "disbursedDate" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "installments" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "cycleAnchor" TEXT,
    "data" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    CONSTRAINT "Cashbon_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Cashbon" ("amount", "createdAt", "createdById", "createdByName", "createdByRole", "cycleAnchor", "data", "date", "disbursedDate", "employeeId", "id", "installments", "note", "status", "updatedAt") SELECT "amount", "createdAt", "createdById", "createdByName", "createdByRole", "cycleAnchor", "data", "date", "disbursedDate", "employeeId", "id", "installments", "note", "status", "updatedAt" FROM "Cashbon";
DROP TABLE "Cashbon";
ALTER TABLE "new_Cashbon" RENAME TO "Cashbon";
CREATE INDEX "Cashbon_employeeId_idx" ON "Cashbon"("employeeId");
CREATE INDEX "Cashbon_updatedAt_idx" ON "Cashbon"("updatedAt");
CREATE TABLE "new_Correction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "deltaAmount" BIGINT NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "oldValue" TEXT,
    "newValue" TEXT,
    "actorId" TEXT,
    "actorRole" TEXT,
    "actorName" TEXT,
    "byStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Correction_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "DistTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Correction" ("active", "actorId", "actorName", "actorRole", "batchId", "byStaff", "createdAt", "deltaAmount", "id", "kind", "newValue", "oldValue", "reason", "transactionId") SELECT "active", "actorId", "actorName", "actorRole", "batchId", "byStaff", "createdAt", "deltaAmount", "id", "kind", "newValue", "oldValue", "reason", "transactionId" FROM "Correction";
DROP TABLE "Correction";
ALTER TABLE "new_Correction" RENAME TO "Correction";
CREATE INDEX "Correction_transactionId_idx" ON "Correction"("transactionId");
CREATE INDEX "Correction_batchId_idx" ON "Correction"("batchId");
CREATE TABLE "new_Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'reguler',
    "masterPrice" BIGINT NOT NULL DEFAULT 0,
    "deliveryDays" TEXT NOT NULL DEFAULT '[]',
    "armada" TEXT NOT NULL DEFAULT '',
    "reminder" TEXT NOT NULL DEFAULT '',
    "lat" REAL,
    "lng" REAL,
    "mapsUrl" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "locationSetAt" DATETIME,
    "locationSetByName" TEXT,
    "locationAccuracy" REAL,
    "locationPhotoId" TEXT,
    "locationPhotoAt" DATETIME,
    "locationPhotoByName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" DATETIME,
    "deactivatedByName" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Customer" ("active", "address", "armada", "code", "createdAt", "createdById", "createdByName", "createdByRole", "deactivatedAt", "deactivatedByName", "deliveryDays", "id", "lat", "lng", "locationAccuracy", "locationPhotoAt", "locationPhotoByName", "locationPhotoId", "locationSetAt", "locationSetByName", "mapsUrl", "masterPrice", "name", "phone", "reminder", "type") SELECT "active", "address", "armada", "code", "createdAt", "createdById", "createdByName", "createdByRole", "deactivatedAt", "deactivatedByName", "deliveryDays", "id", "lat", "lng", "locationAccuracy", "locationPhotoAt", "locationPhotoByName", "locationPhotoId", "locationSetAt", "locationSetByName", "mapsUrl", "masterPrice", "name", "phone", "reminder", "type" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");
CREATE INDEX "Customer_type_idx" ON "Customer"("type");
CREATE TABLE "new_DistExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "amount" BIGINT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'lainnya',
    "note" TEXT NOT NULL DEFAULT '',
    "photoId" TEXT,
    "businessUnitId" TEXT NOT NULL DEFAULT 'air',
    "status" TEXT NOT NULL DEFAULT 'active',
    "voidedById" TEXT,
    "voidedByName" TEXT,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_DistExpense" ("amount", "businessUnitId", "category", "createdAt", "createdById", "createdByName", "date", "fleetId", "id", "note", "photoId", "status", "voidReason", "voidedAt", "voidedById", "voidedByName") SELECT "amount", "businessUnitId", "category", "createdAt", "createdById", "createdByName", "date", "fleetId", "id", "note", "photoId", "status", "voidReason", "voidedAt", "voidedById", "voidedByName" FROM "DistExpense";
DROP TABLE "DistExpense";
ALTER TABLE "new_DistExpense" RENAME TO "DistExpense";
CREATE INDEX "DistExpense_date_fleetId_idx" ON "DistExpense"("date", "fleetId");
CREATE INDEX "DistExpense_fleetId_status_idx" ON "DistExpense"("fleetId", "status");
CREATE TABLE "new_DistInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "issueDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL DEFAULT '',
    "items" TEXT NOT NULL DEFAULT '[]',
    "total" BIGINT NOT NULL DEFAULT 0,
    "sisaBon" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_DistInvoice" ("createdAt", "createdById", "createdByName", "createdByRole", "customerId", "dueDate", "fleetId", "id", "issueDate", "items", "note", "number", "sisaBon", "total") SELECT "createdAt", "createdById", "createdByName", "createdByRole", "customerId", "dueDate", "fleetId", "id", "issueDate", "items", "note", "number", "sisaBon", "total" FROM "DistInvoice";
DROP TABLE "DistInvoice";
ALTER TABLE "new_DistInvoice" RENAME TO "DistInvoice";
CREATE UNIQUE INDEX "DistInvoice_number_key" ON "DistInvoice"("number");
CREATE INDEX "DistInvoice_customerId_idx" ON "DistInvoice"("customerId");
CREATE INDEX "DistInvoice_fleetId_idx" ON "DistInvoice"("fleetId");
CREATE TABLE "new_DistTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "qty" INTEGER NOT NULL,
    "unitPriceLocked" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'lunas',
    "note" TEXT NOT NULL DEFAULT '',
    "txnDate" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "actorName" TEXT,
    "deliveryRunId" TEXT,
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "openingBon" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "voidedById" TEXT,
    "voidedByName" TEXT,
    "voidedByRole" TEXT,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DistTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DistTransaction" ("actorId", "actorName", "actorRole", "amount", "createdAt", "customerId", "deliveryRunId", "fleetId", "id", "importBatchId", "legacy", "method", "note", "openingBon", "qty", "status", "txnDate", "unitPriceLocked", "voidReason", "voidedAt", "voidedById", "voidedByName", "voidedByRole") SELECT "actorId", "actorName", "actorRole", "amount", "createdAt", "customerId", "deliveryRunId", "fleetId", "id", "importBatchId", "legacy", "method", "note", "openingBon", "qty", "status", "txnDate", "unitPriceLocked", "voidReason", "voidedAt", "voidedById", "voidedByName", "voidedByRole" FROM "DistTransaction";
DROP TABLE "DistTransaction";
ALTER TABLE "new_DistTransaction" RENAME TO "DistTransaction";
CREATE INDEX "DistTransaction_txnDate_idx" ON "DistTransaction"("txnDate");
CREATE INDEX "DistTransaction_customerId_idx" ON "DistTransaction"("customerId");
CREATE INDEX "DistTransaction_fleetId_idx" ON "DistTransaction"("fleetId");
CREATE INDEX "DistTransaction_deliveryRunId_idx" ON "DistTransaction"("deliveryRunId");
CREATE INDEX "DistTransaction_importBatchId_idx" ON "DistTransaction"("importBatchId");
CREATE INDEX "DistTransaction_status_idx" ON "DistTransaction"("status");
CREATE TABLE "new_Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT 'Staff',
    "base" BIGINT NOT NULL DEFAULT 0,
    "allowance" INTEGER NOT NULL DEFAULT 0,
    "tjKinerja" BIGINT NOT NULL DEFAULT 0,
    "tjProfesi" BIGINT NOT NULL DEFAULT 0,
    "tjRumahDinas" BIGINT NOT NULL DEFAULT 0,
    "tjBpjsKes" BIGINT NOT NULL DEFAULT 0,
    "tjBpjsTk" BIGINT NOT NULL DEFAULT 0,
    "risk" TEXT NOT NULL DEFAULT 'Low',
    "jp" BOOLEAN NOT NULL DEFAULT true,
    "religion" TEXT NOT NULL DEFAULT 'Islam',
    "joinedDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "separationDate" TEXT,
    "separationReason" TEXT,
    "separationNote" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'orientation',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nip" TEXT,
    "noSurat" TEXT,
    "noKk" TEXT,
    "noBpjsKes" TEXT,
    "noBpjsTk" TEXT,
    "bpjsKesEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "bpjsKesStart" TEXT,
    "bpjsTkEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "bpjsTkStart" TEXT,
    "office" TEXT NOT NULL DEFAULT 'AIRRO',
    "contractStart" TEXT,
    "contractEnd" TEXT,
    "birthPlace" TEXT,
    "birthDate" TEXT,
    "addressKtp" TEXT,
    "addressDomisili" TEXT,
    "maritalStatus" TEXT NOT NULL DEFAULT 'TK',
    "data" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    "businessUnitId" TEXT
);
INSERT INTO "new_Employee" ("active", "addressDomisili", "addressKtp", "allowance", "base", "birthDate", "birthPlace", "bpjsKesEnrolled", "bpjsKesStart", "bpjsTkEnrolled", "bpjsTkStart", "businessUnitId", "contractEnd", "contractStart", "createdAt", "createdById", "createdByName", "createdByRole", "data", "department", "id", "joinedDate", "jp", "maritalStatus", "name", "nip", "noBpjsKes", "noBpjsTk", "noKk", "noSurat", "office", "religion", "risk", "separationDate", "separationNote", "separationReason", "stage", "status", "tjBpjsKes", "tjBpjsTk", "tjKinerja", "tjProfesi", "tjRumahDinas", "updatedAt") SELECT "active", "addressDomisili", "addressKtp", "allowance", "base", "birthDate", "birthPlace", "bpjsKesEnrolled", "bpjsKesStart", "bpjsTkEnrolled", "bpjsTkStart", "businessUnitId", "contractEnd", "contractStart", "createdAt", "createdById", "createdByName", "createdByRole", "data", "department", "id", "joinedDate", "jp", "maritalStatus", "name", "nip", "noBpjsKes", "noBpjsTk", "noKk", "noSurat", "office", "religion", "risk", "separationDate", "separationNote", "separationReason", "stage", "status", "tjBpjsKes", "tjBpjsTk", "tjKinerja", "tjProfesi", "tjRumahDinas", "updatedAt" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_nip_key" ON "Employee"("nip");
CREATE INDEX "Employee_businessUnitId_idx" ON "Employee"("businessUnitId");
CREATE TABLE "new_Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT 'Cash',
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL DEFAULT '00:00',
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "gallonQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT,
    "acct" TEXT,
    "proof" TEXT,
    "meta" TEXT,
    "categoryKey" TEXT,
    "accountId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    "businessUnitId" TEXT,
    "interUnit" BOOLEAN NOT NULL DEFAULT false,
    "transferGroupId" TEXT,
    "counterpartUnitId" TEXT,
    "counterpartAccountId" TEXT,
    CONSTRAINT "Entry_categoryKey_fkey" FOREIGN KEY ("categoryKey") REFERENCES "Category" ("key") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Entry" ("accountId", "acct", "amount", "businessUnitId", "category", "categoryKey", "counterpartAccountId", "counterpartUnitId", "createdAt", "createdById", "createdByName", "createdByRole", "date", "gallonQty", "id", "interUnit", "meta", "method", "note", "proof", "status", "time", "transferGroupId", "type", "updatedAt") SELECT "accountId", "acct", "amount", "businessUnitId", "category", "categoryKey", "counterpartAccountId", "counterpartUnitId", "createdAt", "createdById", "createdByName", "createdByRole", "date", "gallonQty", "id", "interUnit", "meta", "method", "note", "proof", "status", "time", "transferGroupId", "type", "updatedAt" FROM "Entry";
DROP TABLE "Entry";
ALTER TABLE "new_Entry" RENAME TO "Entry";
CREATE INDEX "Entry_date_idx" ON "Entry"("date");
CREATE INDEX "Entry_type_idx" ON "Entry"("type");
CREATE INDEX "Entry_updatedAt_idx" ON "Entry"("updatedAt");
CREATE INDEX "Entry_businessUnitId_idx" ON "Entry"("businessUnitId");
CREATE INDEX "Entry_transferGroupId_idx" ON "Entry"("transferGroupId");
CREATE TABLE "new_Orientation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 7,
    "dailyWage" BIGINT NOT NULL DEFAULT 0,
    "endDate" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Orientation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Orientation" ("createdAt", "dailyWage", "durationDays", "employeeId", "endDate", "id", "note", "outcome", "paid", "paidAt", "startDate") SELECT "createdAt", "dailyWage", "durationDays", "employeeId", "endDate", "id", "note", "outcome", "paid", "paidAt", "startDate" FROM "Orientation";
DROP TABLE "Orientation";
ALTER TABLE "new_Orientation" RENAME TO "Orientation";
CREATE UNIQUE INDEX "Orientation_employeeId_key" ON "Orientation"("employeeId");
CREATE TABLE "new_PriceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "oldPrice" BIGINT NOT NULL,
    "newPrice" BIGINT NOT NULL,
    "changedById" TEXT,
    "changedByName" TEXT,
    "changedByRole" TEXT,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PriceHistory" ("changedAt", "changedById", "changedByName", "changedByRole", "customerId", "id", "newPrice", "oldPrice") SELECT "changedAt", "changedById", "changedByName", "changedByRole", "customerId", "id", "newPrice", "oldPrice" FROM "PriceHistory";
DROP TABLE "PriceHistory";
ALTER TABLE "new_PriceHistory" RENAME TO "PriceHistory";
CREATE INDEX "PriceHistory_customerId_idx" ON "PriceHistory"("customerId");
CREATE TABLE "new_Setoran" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "armada" TEXT NOT NULL DEFAULT '',
    "galon" INTEGER NOT NULL DEFAULT 0,
    "cash" BIGINT NOT NULL DEFAULT 0,
    "bon" BIGINT NOT NULL DEFAULT 0,
    "bonPay" BIGINT NOT NULL DEFAULT 0,
    "expense" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "proof" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "fleetId" TEXT,
    "createdById" TEXT,
    "businessUnitId" TEXT,
    CONSTRAINT "Setoran_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Setoran_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Setoran" ("armada", "bon", "bonPay", "businessUnitId", "cash", "createdAt", "createdById", "date", "expense", "fleetId", "galon", "id", "note", "proof", "updatedAt") SELECT "armada", "bon", "bonPay", "businessUnitId", "cash", "createdAt", "createdById", "date", "expense", "fleetId", "galon", "id", "note", "proof", "updatedAt" FROM "Setoran";
DROP TABLE "Setoran";
ALTER TABLE "new_Setoran" RENAME TO "Setoran";
CREATE INDEX "Setoran_date_idx" ON "Setoran"("date");
CREATE INDEX "Setoran_updatedAt_idx" ON "Setoran"("updatedAt");
CREATE INDEX "Setoran_businessUnitId_idx" ON "Setoran"("businessUnitId");
CREATE TABLE "new_StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "amount" BIGINT,
    "method" TEXT,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "refId" TEXT,
    "supplierId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StockMovement" ("actorId", "actorName", "actorRole", "amount", "createdAt", "fleetId", "id", "itemId", "method", "qty", "reason", "refId", "supplierId", "type") SELECT "actorId", "actorName", "actorRole", "amount", "createdAt", "fleetId", "id", "itemId", "method", "qty", "reason", "refId", "supplierId", "type" FROM "StockMovement";
DROP TABLE "StockMovement";
ALTER TABLE "new_StockMovement" RENAME TO "StockMovement";
CREATE INDEX "StockMovement_itemId_idx" ON "StockMovement"("itemId");
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");
CREATE INDEX "StockMovement_supplierId_idx" ON "StockMovement"("supplierId");
CREATE TABLE "new_Training" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "cost" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Training_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Training" ("cost", "createdAt", "employeeId", "endDate", "id", "note", "provider", "startDate", "status", "title") SELECT "cost", "createdAt", "employeeId", "endDate", "id", "note", "provider", "startDate", "status", "title" FROM "Training";
DROP TABLE "Training";
ALTER TABLE "new_Training" RENAME TO "Training";
CREATE INDEX "Training_employeeId_idx" ON "Training"("employeeId");
CREATE TABLE "new_Transfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amount" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "Transfer_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transfer_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transfer" ("amount", "createdAt", "createdById", "date", "fromId", "id", "note", "toId") SELECT "amount", "createdAt", "createdById", "date", "fromId", "id", "note", "toId" FROM "Transfer";
DROP TABLE "Transfer";
ALTER TABLE "new_Transfer" RENAME TO "Transfer";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
