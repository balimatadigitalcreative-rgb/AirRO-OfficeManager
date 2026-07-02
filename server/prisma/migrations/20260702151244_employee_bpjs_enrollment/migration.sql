-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT 'Staff',
    "base" INTEGER NOT NULL DEFAULT 0,
    "allowance" INTEGER NOT NULL DEFAULT 0,
    "tjKinerja" INTEGER NOT NULL DEFAULT 0,
    "tjProfesi" INTEGER NOT NULL DEFAULT 0,
    "tjRumahDinas" INTEGER NOT NULL DEFAULT 0,
    "tjBpjsKes" INTEGER NOT NULL DEFAULT 0,
    "tjBpjsTk" INTEGER NOT NULL DEFAULT 0,
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
    "maritalStatus" TEXT NOT NULL DEFAULT 'TK'
);
INSERT INTO "new_Employee" ("active", "addressDomisili", "addressKtp", "allowance", "base", "birthDate", "birthPlace", "contractEnd", "contractStart", "createdAt", "department", "id", "joinedDate", "jp", "maritalStatus", "name", "nip", "noBpjsKes", "noBpjsTk", "noKk", "noSurat", "office", "religion", "risk", "separationDate", "separationNote", "separationReason", "stage", "status", "tjBpjsKes", "tjBpjsTk", "tjKinerja", "tjProfesi", "tjRumahDinas") SELECT "active", "addressDomisili", "addressKtp", "allowance", "base", "birthDate", "birthPlace", "contractEnd", "contractStart", "createdAt", "department", "id", "joinedDate", "jp", "maritalStatus", "name", "nip", "noBpjsKes", "noBpjsTk", "noKk", "noSurat", "office", "religion", "risk", "separationDate", "separationNote", "separationReason", "stage", "status", "tjBpjsKes", "tjBpjsTk", "tjKinerja", "tjProfesi", "tjRumahDinas" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_nip_key" ON "Employee"("nip");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
