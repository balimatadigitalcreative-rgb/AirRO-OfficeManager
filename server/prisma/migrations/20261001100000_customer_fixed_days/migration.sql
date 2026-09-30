-- FIXED DELIVERY DAYS — a customer whose days are its own (a hotel on Sen/Rab/Jum). Zones never
-- rewrite those days; they still set the armada. Additive; every existing customer starts as false.
ALTER TABLE "Customer" ADD COLUMN "fixedDays" BOOLEAN NOT NULL DEFAULT false;
