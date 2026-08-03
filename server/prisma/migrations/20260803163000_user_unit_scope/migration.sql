-- Per-user business-unit access control (Stage A). ADDITIVE: existing users default to "all",
-- so every screen/total is identical to before until a GM restricts someone.
ALTER TABLE "User" ADD COLUMN "unitScope" TEXT NOT NULL DEFAULT 'all';
