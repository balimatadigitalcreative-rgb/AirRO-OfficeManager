-- Gallon stock (loan/exchange) management.

-- A cash-flow expense may record a gallon purchase quantity.
ALTER TABLE "Entry" ADD COLUMN "gallonQty" INTEGER NOT NULL DEFAULT 0;

-- Append-only gallon-stock ledger (source of truth for all stock numbers).
CREATE TABLE "GallonMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "customerId" TEXT,
    "transactionId" TEXT,
    "cashEntryId" TEXT,
    "fleetId" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "actorRole" TEXT,
    "actorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GallonMovement_customerId_idx" ON "GallonMovement"("customerId");
CREATE INDEX "GallonMovement_cashEntryId_idx" ON "GallonMovement"("cashEntryId");
CREATE INDEX "GallonMovement_type_idx" ON "GallonMovement"("type");
CREATE INDEX "GallonMovement_fleetId_idx" ON "GallonMovement"("fleetId");
