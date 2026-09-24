import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ListingSubmissionRepository,
  ListingSubmissionTransaction,
} from "./submission";

function createTransaction(
  prisma: Prisma.TransactionClient,
): ListingSubmissionTransaction {
  return {
    async findReferenceData(input) {
      const [locality, propertyType, amenities] = await Promise.all([
        prisma.locality.findUnique({
          where: { id: input.localityId },
          select: { cityId: true },
        }),
        prisma.propertyType.findUnique({
          where: { id: input.propertyTypeId },
          select: { id: true },
        }),
        prisma.amenity.findMany({
          where: { id: { in: input.amenityIds } },
          select: { id: true },
        }),
      ]);

      return {
        localityCityId: locality?.cityId ?? null,
        propertyTypeExists: propertyType !== null,
        foundAmenityIds: amenities.map((amenity) => amenity.id),
      };
    },
    async createListing(input) {
      const listing = await prisma.listing.create({
        data: {
          ownerId: input.ownerId,
          localityId: input.localityId,
          propertyTypeId: input.propertyTypeId,
          title: input.title,
          description: input.description,
          status: input.status,
          furnishingStatus: input.furnishingStatus,
          tenantPreference: input.tenantPreference,
          rentAmountPaise: input.rentAmountPaise,
          securityDepositAmountPaise: input.securityDepositAmountPaise,
          availableFrom: input.availableFrom,
          amenities: {
            create: input.amenityIds.map((amenityId) => ({ amenityId })),
          },
        },
        select: { id: true },
      });

      return listing;
    },
  };
}

export function createPrismaListingSubmissionRepository(
  prisma: PrismaClient,
): ListingSubmissionRepository {
  return {
    transaction(operation) {
      return prisma.$transaction((transaction) =>
        operation(createTransaction(transaction)),
      );
    },
  };
}
