-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'RENTED', 'EXPIRED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FurnishingStatus" AS ENUM ('UNFURNISHED', 'SEMI_FURNISHED', 'FURNISHED');

-- CreateEnum
CREATE TYPE "TenantPreference" AS ENUM ('ANY', 'FAMILY', 'BACHELORS', 'FEMALE_ONLY', 'MALE_ONLY', 'STUDENTS', 'WORKING_PROFESSIONALS');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "canonicalState" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL DEFAULT 'IN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Locality" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Locality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amenity" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "localityId" TEXT NOT NULL,
    "propertyTypeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "furnishingStatus" "FurnishingStatus" NOT NULL DEFAULT 'UNFURNISHED',
    "tenantPreference" "TenantPreference" NOT NULL DEFAULT 'ANY',
    "rentAmountPaise" BIGINT NOT NULL,
    "securityDepositAmountPaise" BIGINT,
    "availableFrom" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingAmenity" (
    "listingId" TEXT NOT NULL,
    "amenityId" TEXT NOT NULL,

    CONSTRAINT "ListingAmenity_pkey" PRIMARY KEY ("listingId","amenityId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "City_canonicalName_canonicalState_countryCode_key" ON "City"("canonicalName", "canonicalState", "countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "Locality_cityId_canonicalName_key" ON "Locality"("cityId", "canonicalName");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyType_code_key" ON "PropertyType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Amenity_code_key" ON "Amenity"("code");

-- CreateIndex
CREATE INDEX "Listing_ownerId_idx" ON "Listing"("ownerId");

-- CreateIndex
CREATE INDEX "Listing_localityId_idx" ON "Listing"("localityId");

-- CreateIndex
CREATE INDEX "Listing_propertyTypeId_idx" ON "Listing"("propertyTypeId");

-- CreateIndex
CREATE INDEX "Listing_status_localityId_idx" ON "Listing"("status", "localityId");

-- CreateIndex
CREATE INDEX "ListingAmenity_amenityId_idx" ON "ListingAmenity"("amenityId");

-- AddCheckConstraint
ALTER TABLE "City" ADD CONSTRAINT "City_canonicalName_check" CHECK ("canonicalName" = lower(regexp_replace("name", '^[[:space:]]+|[[:space:]]+$', '', 'g')) AND char_length("canonicalName") > 0);

-- AddCheckConstraint
ALTER TABLE "City" ADD CONSTRAINT "City_canonicalState_check" CHECK ("canonicalState" = lower(regexp_replace("state", '^[[:space:]]+|[[:space:]]+$', '', 'g')) AND char_length("canonicalState") > 0);

-- AddCheckConstraint
ALTER TABLE "City" ADD CONSTRAINT "City_countryCode_check" CHECK ("countryCode" = upper(btrim("countryCode")) AND char_length(btrim("countryCode")) = 2);

-- AddCheckConstraint
ALTER TABLE "Locality" ADD CONSTRAINT "Locality_canonicalName_check" CHECK ("canonicalName" = lower(regexp_replace("name", '^[[:space:]]+|[[:space:]]+$', '', 'g')) AND char_length("canonicalName") > 0);

-- AddCheckConstraint
ALTER TABLE "PropertyType" ADD CONSTRAINT "PropertyType_code_check" CHECK ("code" = upper(regexp_replace("code", '^[[:space:]]+|[[:space:]]+$', '', 'g')) AND char_length("code") > 0);

-- AddCheckConstraint
ALTER TABLE "Amenity" ADD CONSTRAINT "Amenity_code_check" CHECK ("code" = upper(regexp_replace("code", '^[[:space:]]+|[[:space:]]+$', '', 'g')) AND char_length("code") > 0);

-- AddCheckConstraint
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_rentAmountPaise_check" CHECK ("rentAmountPaise" > 0);

-- AddCheckConstraint
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_securityDepositAmountPaise_check" CHECK ("securityDepositAmountPaise" IS NULL OR "securityDepositAmountPaise" >= 0);

-- AddForeignKey
ALTER TABLE "Locality" ADD CONSTRAINT "Locality_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "Locality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_propertyTypeId_fkey" FOREIGN KEY ("propertyTypeId") REFERENCES "PropertyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingAmenity" ADD CONSTRAINT "ListingAmenity_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingAmenity" ADD CONSTRAINT "ListingAmenity_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
