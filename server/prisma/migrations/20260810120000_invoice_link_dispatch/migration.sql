-- WhatsApp invoice sharing: a signed expiring public link per invoice + a dispatch log. ADDITIVE:
-- two new tables only; no existing data touched.
CREATE TABLE "InvoiceLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "token" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revoked" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "InvoiceLink_token_key" ON "InvoiceLink"("token");
CREATE INDEX "InvoiceLink_invoiceId_idx" ON "InvoiceLink"("invoiceId");

CREATE TABLE "InvoiceDispatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "invoiceId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'wa',
  "phone" TEXT NOT NULL DEFAULT '',
  "messageSnapshot" TEXT NOT NULL DEFAULT '',
  "linkUrl" TEXT NOT NULL DEFAULT '',
  "linkExpiresAt" DATETIME,
  "sentById" TEXT,
  "sentByName" TEXT,
  "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "InvoiceDispatch_invoiceId_idx" ON "InvoiceDispatch"("invoiceId");
CREATE INDEX "InvoiceDispatch_customerId_idx" ON "InvoiceDispatch"("customerId");
