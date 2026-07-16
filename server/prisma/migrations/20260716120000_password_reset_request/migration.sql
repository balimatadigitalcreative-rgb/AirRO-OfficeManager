-- Forgot-password request-to-admin flow (no email/SMTP). Additive.
CREATE TABLE "PasswordResetRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledById" TEXT,
    "handledByName" TEXT,
    "handledAt" DATETIME
);
CREATE INDEX "PasswordResetRequest_status_idx" ON "PasswordResetRequest"("status");
CREATE INDEX "PasswordResetRequest_requestedAt_idx" ON "PasswordResetRequest"("requestedAt");
