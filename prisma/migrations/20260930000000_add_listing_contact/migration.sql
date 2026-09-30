-- Existing listings retain NULL contact fields. Contact is not public without consent.
ALTER TABLE "Listing" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Listing" ADD COLUMN "contactConsentAt" TIMESTAMP(3);

ALTER TABLE "Listing" ADD CONSTRAINT "Listing_contactPhone_check"
  CHECK ("contactPhone" IS NULL OR "contactPhone" ~ '^\+91[6-9][0-9]{9}$');
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_contactConsentAt_check"
  CHECK ("contactConsentAt" IS NULL OR "contactPhone" IS NOT NULL);
