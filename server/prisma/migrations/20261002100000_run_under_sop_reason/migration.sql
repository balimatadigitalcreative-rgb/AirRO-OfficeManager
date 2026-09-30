-- SOP MUATAN — the reason a rit was opened below the owner's minimum load. Additive; '' for every
-- existing rit.
ALTER TABLE "DeliveryRun" ADD COLUMN "underSopReason" TEXT NOT NULL DEFAULT '';
