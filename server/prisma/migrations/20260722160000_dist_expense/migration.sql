-- FIELD EXPENSE (cash paid out in the field by delivery staff — fuel/bensin, meals, parking…).
-- Itemised detail behind the old single Setoran.expense number. Additive: a brand-new table, so
-- no existing row/aggregate changes. It never posts to Entry/Setoran (the distribusi module is
-- separate) → it cannot double-count; it only reduces "net cash to deposit" on the dashboard and
-- surfaces as an informational line in the Integrasi Kas bridge. Append-only: a mistake is fixed
-- by VOID (recorded, reason) + re-log. Receipt photos live in Attachment (a ref here, never base64).
CREATE TABLE "DistExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL,
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

CREATE INDEX "DistExpense_date_fleetId_idx" ON "DistExpense"("date", "fleetId");
CREATE INDEX "DistExpense_fleetId_status_idx" ON "DistExpense"("fleetId", "status");
