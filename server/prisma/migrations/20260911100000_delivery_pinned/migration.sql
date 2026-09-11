-- ROUTE ORDERING BY PROXIMITY — "urutan tetap" (pinned) stops.
-- A stop with a fixed time window (hotel/restaurant delivery hours) must keep its position when the
-- nearest-neighbour route reorders the rest. Additive, defaults false → every existing stop is unpinned
-- and the board behaves exactly as before.
ALTER TABLE "Delivery" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
