-- Human-readable customer code (C-0001) + its append-only counter table. Additive.
-- Customer.code is nullable here for the migration window; the backfill script fills existing
-- rows (scripts/backfill-customer-codes.js) and every new customer gets one on create.
ALTER TABLE "Customer" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

CREATE TABLE "CustomerCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CustomerCode_code_key" ON "CustomerCode"("code");
CREATE UNIQUE INDEX "CustomerCode_seq_key" ON "CustomerCode"("seq");
