-- Google Maps link per customer (pasted share link, or built ?q=lat,lng from GPS).
ALTER TABLE "Customer" ADD COLUMN "mapsUrl" TEXT NOT NULL DEFAULT '';
