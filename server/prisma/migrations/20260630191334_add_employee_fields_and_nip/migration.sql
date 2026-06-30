-- CreateTable
CREATE TABLE "EmployeeNip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nip" TEXT NOT NULL,
    "office" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT 'Staff',
    "base" INTEGER NOT NULL DEFAULT 0,
    "allowance" INTEGER NOT NULL DEFAULT 0,
    "risk" TEXT NOT NULL DEFAULT 'Low',
    "jp" BOOLEAN NOT NULL DEFAULT true,
    "religion" TEXT NOT NULL DEFAULT 'Islam',
    "joinedDate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nip" TEXT,
    "noSurat" TEXT,
    "noKk" TEXT,
    "noBpjsKes" TEXT,
    "noBpjsTk" TEXT,
    "office" TEXT NOT NULL DEFAULT 'AIRRO',
    "contractStart" TEXT,
    "contractEnd" TEXT,
    "birthPlace" TEXT,
    "birthDate" TEXT,
    "addressKtp" TEXT,
    "addressDomisili" TEXT,
    "maritalStatus" TEXT NOT NULL DEFAULT 'TK'
);
INSERT INTO "new_Employee" ("active", "allowance", "base", "createdAt", "department", "id", "joinedDate", "jp", "name", "religion", "risk") SELECT "active", "allowance", "base", "createdAt", "department", "id", "joinedDate", "jp", "name", "religion", "risk" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_nip_key" ON "Employee"("nip");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeNip_nip_key" ON "EmployeeNip"("nip");

-- CreateIndex
CREATE INDEX "EmployeeNip_office_year_idx" ON "EmployeeNip"("office", "year");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeNip_office_year_seq_key" ON "EmployeeNip"("office", "year", "seq");
