-- Business unit (unit bisnis) — STAGE 1: labels on ONE company, NOT separate ledgers.
-- Purely additive + a one-time idempotent backfill. It must NOT change any number, balance,
-- payroll or report: it only creates the dictionary, adds a nullable label column to the core
-- records, and defaults every existing row to "Air". null is treated as "Air" everywhere, so
-- nothing is orphaned and nothing is filtered yet.

-- 1. Dictionary table.
CREATE TABLE "BusinessUnit" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "code"      TEXT NOT NULL DEFAULT '',
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Seed the three starter units with FIXED ids (so the backfill below can reference "air"
--    and so app-level seeding stays idempotent — INSERT OR IGNORE never double-inserts). The
--    third is a placeholder the owner renames later.
INSERT OR IGNORE INTO "BusinessUnit" ("id","name","code","active","sortOrder") VALUES
  ('air',        'Air',           'AIR', true, 0),
  ('manufaktur', 'Manufaktur',    'MFG', true, 1),
  ('unit3',      'Unit Bisnis 3', 'U3',  true, 2);

-- 3. Nullable label column on each core record that will LATER be filtered by unit.
ALTER TABLE "Entry"    ADD COLUMN "businessUnitId" TEXT;
ALTER TABLE "Account"  ADD COLUMN "businessUnitId" TEXT;
ALTER TABLE "Employee" ADD COLUMN "businessUnitId" TEXT;
ALTER TABLE "Setoran"  ADD COLUMN "businessUnitId" TEXT;

-- 4. One-time BACKFILL — default every existing row to "Air". Idempotent: the WHERE guard
--    means re-running (or the app-level backfill on boot) touches only still-null rows.
UPDATE "Entry"    SET "businessUnitId" = 'air' WHERE "businessUnitId" IS NULL;
UPDATE "Account"  SET "businessUnitId" = 'air' WHERE "businessUnitId" IS NULL;
UPDATE "Employee" SET "businessUnitId" = 'air' WHERE "businessUnitId" IS NULL;
UPDATE "Setoran"  SET "businessUnitId" = 'air' WHERE "businessUnitId" IS NULL;

-- 5. Indexes for the future per-unit filters (cheap now, needed later).
CREATE INDEX "Entry_businessUnitId_idx"    ON "Entry"("businessUnitId");
CREATE INDEX "Account_businessUnitId_idx"  ON "Account"("businessUnitId");
CREATE INDEX "Employee_businessUnitId_idx" ON "Employee"("businessUnitId");
CREATE INDEX "Setoran_businessUnitId_idx"  ON "Setoran"("businessUnitId");
