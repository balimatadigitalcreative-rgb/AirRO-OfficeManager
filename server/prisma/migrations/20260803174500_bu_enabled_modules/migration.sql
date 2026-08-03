-- Per-business-unit module toggle. ADDITIVE + non-breaking: default "all" = every module enabled,
-- so every existing unit behaves exactly as before until a GM turns a module off for a unit.
ALTER TABLE "BusinessUnit" ADD COLUMN "enabledModules" TEXT NOT NULL DEFAULT 'all';
