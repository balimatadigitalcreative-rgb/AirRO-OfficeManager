-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DistAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "actorRole" TEXT,
    "actorName" TEXT,
    "actorStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_DistAuditLog" ("actorId", "actorName", "actorRole", "createdAt", "detail", "id", "kind", "title") SELECT "actorId", "actorName", "actorRole", "createdAt", "detail", "id", "kind", "title" FROM "DistAuditLog";
DROP TABLE "DistAuditLog";
ALTER TABLE "new_DistAuditLog" RENAME TO "DistAuditLog";
CREATE INDEX "DistAuditLog_kind_idx" ON "DistAuditLog"("kind");
CREATE INDEX "DistAuditLog_createdAt_idx" ON "DistAuditLog"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
