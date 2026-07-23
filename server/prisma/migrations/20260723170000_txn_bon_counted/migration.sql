-- Add DistTransaction.bonCounted — whether a row counts toward the customer's outstanding bon
-- (sisa bon), INDEPENDENT of `legacy`. `legacy` excludes a row from KPIs/gallons/cash; `bonCounted`
-- decides the receivable. This lets an archive either keep affecting sisa bon (a historical-debt
-- import) or not (a mistaken row). Additive: default TRUE so every existing row — active sales and
-- prior legacy imports alike — keeps counting exactly as it did before this change.
ALTER TABLE "DistTransaction" ADD COLUMN "bonCounted" BOOLEAN NOT NULL DEFAULT true;
