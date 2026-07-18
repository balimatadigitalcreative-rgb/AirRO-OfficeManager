-- Inventory item editable details: shape/form, description, photo (→ Attachment.id), edit audit.
-- Additive only; existing rows keep their data (new columns default to '' / NULL).
ALTER TABLE "InventoryItem" ADD COLUMN "form" TEXT NOT NULL DEFAULT '';
ALTER TABLE "InventoryItem" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "InventoryItem" ADD COLUMN "photoId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "editedById" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "editedByName" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "editedAt" DATETIME;
