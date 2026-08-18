-- AlterTable: prepaid amortisation flags on a bill line.
ALTER TABLE "BillLine" ADD COLUMN "amortizeMonths" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BillLine" ADD COLUMN "amortizeStart" TEXT;

-- CreateTable: prepaid amortisation schedule (Beban Dibayar Di Muka → expense, monthly).
CREATE TABLE "AmortizationSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chartAccountId" TEXT NOT NULL,
    "prepaidCode" TEXT NOT NULL DEFAULT '1-1600',
    "startDate" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "monthlyAmount" BIGINT NOT NULL,
    "total" BIGINT NOT NULL DEFAULT 0,
    "postedThrough" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "businessUnitId" TEXT,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AmortizationSchedule_sourceType_sourceId_idx" ON "AmortizationSchedule"("sourceType", "sourceId");

-- CreateTable: accrued expense (reversing entries).
CREATE TABLE "Accrual" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chartAccountId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "reverseDate" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "businessUnitId" TEXT,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'aktif',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Accrual_date_idx" ON "Accrual"("date");
