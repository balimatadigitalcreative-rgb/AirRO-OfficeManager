-- PAYROLL (accrual, double-entry) + cashbon repayment + employee production flag.
ALTER TABLE "Employee" ADD COLUMN "isProduction" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Cashbon" ADD COLUMN "repaidAmount" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "businessUnitId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" DATETIME,
    "requestId" TEXT,
    "selfApproved" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" DATETIME,
    "paidAccountId" TEXT,
    "journalEntryId" TEXT,
    "payJournalId" TEXT,
    "periodId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "PayrollPeriod_year_month_idx" ON "PayrollPeriod"("year", "month");
CREATE INDEX "PayrollPeriod_status_idx" ON "PayrollPeriod"("status");

CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payrollPeriodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL DEFAULT '',
    "basicSalary" BIGINT NOT NULL DEFAULT 0,
    "overtime" BIGINT NOT NULL DEFAULT 0,
    "bonus" BIGINT NOT NULL DEFAULT 0,
    "allowancesTotal" BIGINT NOT NULL DEFAULT 0,
    "deductionsTotal" BIGINT NOT NULL DEFAULT 0,
    "cashbonDeduction" BIGINT NOT NULL DEFAULT 0,
    "netPay" BIGINT NOT NULL DEFAULT 0,
    "isProduction" BOOLEAN NOT NULL DEFAULT false,
    "chartAccountId" TEXT,
    "businessUnitId" TEXT,
    "fleetId" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "PayrollLine_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PayrollLine_payrollPeriodId_idx" ON "PayrollLine"("payrollPeriodId");
CREATE INDEX "PayrollLine_employeeId_idx" ON "PayrollLine"("employeeId");

CREATE TABLE "PayrollLineComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payrollLineId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'tunjangan',
    "amount" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "PayrollLineComponent_payrollLineId_fkey" FOREIGN KEY ("payrollLineId") REFERENCES "PayrollLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PayrollLineComponent_payrollLineId_idx" ON "PayrollLineComponent"("payrollLineId");

CREATE TABLE "PayrollComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "defaultAmount" BIGINT NOT NULL DEFAULT 0,
    "appliesTo" TEXT NOT NULL DEFAULT 'semua',
    "chartAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PayrollComponent_type_idx" ON "PayrollComponent"("type");
