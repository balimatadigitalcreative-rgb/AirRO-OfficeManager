-- NIP office prefix moves from a per-employee choice ("Posisi kantor") to a per-BUSINESS-UNIT
-- setting. Additive: one new column, defaulted so every existing row stays valid.
ALTER TABLE "BusinessUnit" ADD COLUMN "officeCode" TEXT NOT NULL DEFAULT 'AIRRO';

-- Seed the mapping for the three shipped units. Anything else keeps the AIRRO default until the
-- owner edits it. Employee.office is deliberately NOT touched here: it is the source of truth for
-- each employee's EXISTING NIP, and rewriting it would change what their historical NIP means.
UPDATE "BusinessUnit" SET "officeCode" = 'AIRRO' WHERE "id" = 'air';
UPDATE "BusinessUnit" SET "officeCode" = 'MFG'   WHERE "id" = 'manufaktur';
UPDATE "BusinessUnit" SET "officeCode" = 'NSN'   WHERE "id" = 'unit3';
