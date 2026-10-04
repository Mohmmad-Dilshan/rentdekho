import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { CorrectionRepository } from "./correction";

export function createPrismaCorrectionRepository(
  prisma: PrismaClient,
): CorrectionRepository {
  return {
    transaction(operation) {
      return prisma.$transaction(async (tx) =>
        operation({
          async findReferenceData(input) {
            const [locality, propertyType, amenities] = await Promise.all([
              tx.locality.findUnique({
                where: { id: input.localityId },
                select: { cityId: true },
              }),
              tx.propertyType.findUnique({
                where: { id: input.propertyTypeId },
                select: { id: true },
              }),
              tx.amenity.findMany({
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
          async correct({
            listingId,
            ownerId,
            expectedVersion,
            expectedStatus,
            content,
          }) {
            const result = await tx.listing.updateMany({
              where: {
                id: listingId,
                ownerId,
                status: expectedStatus,
                reviewVersion: expectedVersion,
              },
              data: {
                localityId: content.localityId,
                propertyTypeId: content.propertyTypeId,
                title: content.title,
                description: content.description,
                rentAmountPaise: content.rentAmountPaise,
                securityDepositAmountPaise: content.securityDepositAmountPaise,
                contactPhone: content.contactPhone,
                contactConsentAt: content.contactConsentAt,
                availableFrom: content.availableFrom,
                furnishingStatus: content.furnishingStatus,
                tenantPreference: content.tenantPreference,
                status: "PENDING_REVIEW",
                reviewVersion: { increment: 1 },
              },
            });
            if (result.count !== 1) return false;
            await tx.listingAmenity.deleteMany({ where: { listingId } });
            if (content.amenityIds.length)
              await tx.listingAmenity.createMany({
                data: content.amenityIds.map((amenityId) => ({
                  listingId,
                  amenityId,
                })),
              });
            return true;
          },
        }),
      );
    },
  };
}
