-- Backfill the gallon ledger for data that predates the GallonMovement table.
--
-- Before this feature, delivery transactions never wrote a gallon movement, so the
-- Gallon Stock screen showed 0/0/0 even though customers were holding gallons. This
-- one-time data migration reconstructs the ledger from history (loan/exchange model):
--
--   Part 1 — one delivery_out per existing sale = its `qty` gallons (empties returned
--            are unknown historically, so held = total delivered until returns are
--            logged going forward). Idempotent via a deterministic id ('bfdo-'||txn.id)
--            and a NOT EXISTS guard, so transactions that already have a delivery_out
--            (created after the feature shipped) are left untouched — no double counting.
--
--   Part 2 — opening depot stock so "At depot" starts at 0 per fleet on activation
--            (the chosen rule: Total owned = gallons currently held by customers). For
--            each fleet we append ONE depot correction = atCustomers − totalOwned
--            (only when positive), computed from the full active ledger AFTER Part 1.
--            Deterministic id ('bfopen-'||fleetId) keeps it idempotent. The physical
--            depot count can be adjusted anytime afterwards via a normal stock correction.

-- Part 1: delivery_out per un-ledgered transaction.
INSERT INTO "GallonMovement"
  ("id", "type", "qty", "customerId", "transactionId", "cashEntryId", "fleetId", "active", "note", "actorId", "actorRole", "actorName", "createdAt")
SELECT
  'bfdo-' || t."id", 'delivery_out', t."qty", t."customerId", t."id", NULL,
  COALESCE(t."fleetId", ''), 1, 'Backfill: galon keluar dari histori transaksi',
  t."actorId", t."actorRole", t."actorName", t."createdAt"
FROM "DistTransaction" t
WHERE t."qty" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "GallonMovement" m
    WHERE m."transactionId" = t."id" AND m."type" = 'delivery_out'
  );

-- Part 2: per-fleet opening depot stock so At depot = 0 (Total owned = At customers).
INSERT INTO "GallonMovement"
  ("id", "type", "qty", "customerId", "transactionId", "cashEntryId", "fleetId", "active", "note", "actorId", "actorRole", "actorName", "createdAt")
SELECT
  'bfopen-' || f."fleetId", 'correction', f."opening", NULL, NULL, NULL,
  f."fleetId", 1, 'Stok awal galon (aktivasi pelacakan stok)', NULL, NULL, 'Sistem', CURRENT_TIMESTAMP
FROM (
  SELECT
    COALESCE("fleetId", '') AS "fleetId",
    SUM(CASE WHEN "type" = 'delivery_out' THEN "qty"
             WHEN "type" = 'return_in' THEN -"qty"
             WHEN "type" = 'correction' AND "customerId" IS NOT NULL THEN "qty"
             ELSE 0 END)
    - SUM(CASE WHEN "type" = 'purchase' THEN "qty"
               WHEN "type" = 'correction' AND "customerId" IS NULL THEN "qty"
               ELSE 0 END) AS "opening"
  FROM "GallonMovement"
  WHERE "active" = 1
  GROUP BY COALESCE("fleetId", '')
) f
WHERE f."opening" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "GallonMovement" m WHERE m."id" = 'bfopen-' || f."fleetId"
  );
