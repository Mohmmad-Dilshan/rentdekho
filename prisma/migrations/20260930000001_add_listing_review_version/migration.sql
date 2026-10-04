ALTER TABLE "Listing" ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_reviewVersion_check" CHECK ("reviewVersion" > 0);
