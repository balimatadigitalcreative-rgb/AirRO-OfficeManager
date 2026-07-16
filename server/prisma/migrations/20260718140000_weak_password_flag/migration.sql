-- Flag weak/temporary passwords (surfaced to the owner in the user list; never a force-reset). Additive.
ALTER TABLE "User" ADD COLUMN "weakPassword" BOOLEAN NOT NULL DEFAULT false;
