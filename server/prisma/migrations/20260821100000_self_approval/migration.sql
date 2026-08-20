-- SELF-APPROVAL (segregation-of-duties waiver via the owner-granted distribusiApproveSelf cap).
-- Records approved by their own requester are flagged so the badge, the "Persetujuan mandiri" audit
-- filter, and the owner-dashboard monthly count can surface them. Every existing row defaults to false.
ALTER TABLE "DistChangeRequest" ADD COLUMN "selfApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DistTransactionDispute" ADD COLUMN "selfApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DistAuditLog" ADD COLUMN "selfApproved" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "DistChangeRequest_selfApproved_idx" ON "DistChangeRequest"("selfApproved");
CREATE INDEX "DistTransactionDispute_selfApproved_idx" ON "DistTransactionDispute"("selfApproved");
CREATE INDEX "DistAuditLog_selfApproved_idx" ON "DistAuditLog"("selfApproved");
