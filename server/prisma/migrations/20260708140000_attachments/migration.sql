-- Separate attachment store so proof photos leave the record sync payload.
-- Records keep only a small ref in their `proof` column; the bytes live here and are
-- fetched lazily. Existing inline base64 proofs are migrated into this table by a JS
-- startup routine (migrateInlineProofs) — it handles both the JSON-object and the
-- legacy raw-data-URL proof formats and verifies nothing is lost, which is impractical
-- to do safely in pure SQL.
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "mime" TEXT NOT NULL DEFAULT '',
    "isImg" BOOLEAN NOT NULL DEFAULT true,
    "data" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Attachment_createdById_idx" ON "Attachment"("createdById");
