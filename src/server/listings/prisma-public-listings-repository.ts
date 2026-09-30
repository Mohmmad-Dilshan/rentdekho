import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  PublicDiscoveryFilters,
  PublicListingDetailView,
  PublicListingRepository,
  PublicListingView,
} from "./public-discovery";

const publicListingSelect = {
  id: true,
  title: true,
  description: true,
  rentAmountPaise: true,
  securityDepositAmountPaise: true,
  availableFrom: true,
  furnishingStatus: true,
  tenantPreference: true,
  createdAt: true,
  updatedAt: true,
  locality: { select: { name: true, city: { select: { name: true } } } },
  propertyType: { select: { label: true } },
  amenities: { select: { amenity: { select: { label: true } } } },
} satisfies Prisma.ListingSelect;

const publicListingDetailSelect = {
  ...publicListingSelect,
  contactPhone: true,
  contactConsentAt: true,
} satisfies Prisma.ListingSelect;

function toPublicListingDetailView(
  listing: Prisma.ListingGetPayload<{
    select: typeof publicListingDetailSelect;
  }>,
): PublicListingDetailView {
  const { contactPhone, contactConsentAt, ...base } = listing;
  return {
    ...toPublicListingView(base),
    contactPhone:
      contactConsentAt &&
      contactPhone &&
      /^\+91[6-9][0-9]{9}$/.test(contactPhone)
        ? contactPhone
        : null,
  };
}

function toPublicListingView(
  listing: Prisma.ListingGetPayload<{ select: typeof publicListingSelect }>,
): PublicListingView {
  return {
    ...listing,
    amenities: listing.amenities.map((item) => item.amenity),
  };
}

export function createPrismaPublicListingRepository(
  prisma: PrismaClient,
): PublicListingRepository {
  return {
    async findPublishedListings({ localityId, propertyTypeId, cursor, take }) {
      const listings = await prisma.listing.findMany({
        where: {
          status: "PUBLISHED",
          ...(localityId ? { localityId } : {}),
          ...(propertyTypeId ? { propertyTypeId } : {}),
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: Math.max(1, Math.min(take, 13)),
        select: publicListingSelect,
      });

      return listings.map(toPublicListingView);
    },
    async findPublishedListingById(id) {
      const listing = await prisma.listing.findFirst({
        where: { id, status: "PUBLISHED" },
        select: publicListingDetailSelect,
      });

      return listing ? toPublicListingDetailView(listing) : null;
    },
    async findPublicDiscoveryFilters(): Promise<PublicDiscoveryFilters> {
      const [localities, propertyTypes] = await Promise.all([
        prisma.locality.findMany({
          where: { listings: { some: { status: "PUBLISHED" } } },
          select: { id: true, name: true, city: { select: { name: true } } },
          orderBy: [{ city: { name: "asc" } }, { name: "asc" }],
        }),
        prisma.propertyType.findMany({
          where: { listings: { some: { status: "PUBLISHED" } } },
          select: { id: true, label: true },
          orderBy: { label: "asc" },
        }),
      ]);

      return {
        localities: localities.map((locality) => ({
          id: locality.id,
          name: locality.name,
          cityName: locality.city.name,
        })),
        propertyTypes,
      };
    },
    findPublishedSitemapEntries() {
      return prisma.listing.findMany({
        where: { status: "PUBLISHED" },
        select: { id: true, updatedAt: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 49998,
      });
    },
  };
}
