-- Gallon damage/loss reporting + damaged-gallon sale. Additive columns only.
ALTER TABLE "GallonMovement" ADD COLUMN "proof" TEXT;          -- evidence photo ref for a damage/loss report
ALTER TABLE "StockMovement" ADD COLUMN "amount" INTEGER;       -- money for a 'sale' (total Rp)
ALTER TABLE "StockMovement" ADD COLUMN "method" TEXT;          -- payment method for a 'sale'
