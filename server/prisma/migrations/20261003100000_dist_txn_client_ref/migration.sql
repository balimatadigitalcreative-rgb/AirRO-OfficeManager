-- Idempotent field writes: a phone-generated ref per sale / payment / damage charge (nullable, unique).
ALTER TABLE "DistTransaction" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "DistTransaction_clientRef_key" ON "DistTransaction"("clientRef");
