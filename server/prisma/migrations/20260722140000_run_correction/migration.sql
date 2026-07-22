-- Delivery-run CORRECTION (append-only). A rit closed with a mistake (forgot empties, wrong
-- full-returned/muat) is fixed by appending a SIGNED delta per field — never by overwriting the
-- stored figure. The run's EFFECTIVE value = base + Σ active deltas; reconciliation recomputes
-- from those. Additive: existing runs have no corrections, so effective == base and no aggregate
-- changes. No GallonMovement is written (a run is a truck-level tally; stock stays driven by the
-- per-customer delivery_out/return_in movements).
CREATE TABLE "RunCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "actorId" TEXT,
    "actorRole" TEXT,
    "actorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunCorrection_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DeliveryRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "RunCorrection_runId_idx" ON "RunCorrection"("runId");
