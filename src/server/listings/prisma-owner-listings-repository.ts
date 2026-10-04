import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ManagedListing,
  OwnerListingRepository,
} from "./owner-management";

const ownerListingSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  reviewVersion: true,
  rentAmountPaise: true,
  securityDepositAmountPaise: true,
  contactPhone: true,
  contactConsentAt: true,
  availableFrom: true,
  furnishingStatus: true,
  tenantPreference: true,
  createdAt: true,
  updatedAt: true,
  locality: { select: { name: true, city: { select: { name: true } } } },
  propertyType: { select: { label: true } },
  amenities: { select: { amenity: { select: { label: true } } } },
} satisfies Prisma.ListingSelect;

function toManagedListing(
  listing: Prisma.ListingGetPayload<{ select: typeof ownerListingSelect }>,
): ManagedListing {
  return {
    ...listing,
    amenities: listing.amenities.map((item) => item.amenity),
  };
}

export function createPrismaOwnerListingRepository(
  prisma: PrismaClient,
): OwnerListingRepository {
  return {
    async listOwn(ownerId) {
      const listings = await prisma.listing.findMany({
        where: { ownerId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 25,
        select: ownerListingSelect,
      });
      return listings.map(toManagedListing);
    },
    async findOwn(ownerId, listingId) {
      const listing = await prisma.listing.findFirst({
        where: { id: listingId, ownerId },
        select: ownerListingSelect,
      });
      return listing ? toManagedListing(listing) : null;
    },
    async transition({
      ownerId,
      listingId,
      action,
      expectedStatus,
      expectedVersion,
    }) {
      const result = await prisma.listing.updateMany({
        where: {
          id: listingId,
          ownerId,
          status: expectedStatus,
          reviewVersion: expectedVersion,
        },
        data: { status: action === "MARK_RENTED" ? "RENTED" : "ARCHIVED" },
      });
      return result.count === 1;
    },
  };
}
