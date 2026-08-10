-- User management: last-login timestamp + an admin audit trail for permission/role/scope changes.
-- ADDITIVE: one nullable column + one new table.
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;

CREATE TABLE "UserAuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "targetUserId" TEXT NOT NULL,
  "targetName" TEXT NOT NULL DEFAULT '',
  "actorId" TEXT,
  "actorName" TEXT,
  "action" TEXT NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "UserAuditLog_targetUserId_idx" ON "UserAuditLog"("targetUserId");
CREATE INDEX "UserAuditLog_createdAt_idx" ON "UserAuditLog"("createdAt");
