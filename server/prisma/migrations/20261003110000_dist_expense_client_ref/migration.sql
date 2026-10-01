-- Idempotent field expenses: a phone-generated ref per expense (nullable, unique).
ALTER TABLE "DistExpense" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "DistExpense_clientRef_key" ON "DistExpense"("clientRef");
