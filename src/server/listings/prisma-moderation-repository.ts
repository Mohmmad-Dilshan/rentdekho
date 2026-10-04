import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { ListingModerationRepository } from "./moderation";

export function createPrismaListingModerationRepository(
  prisma: PrismaClient,
): ListingModerationRepository {
  return {
    async transitionPendingListing({
      listingId,
      targetStatus,
      expectedVersion,
    }) {
      const result = await prisma.listing.updateMany({
        where: {
          id: listingId,
          status: "PENDING_REVIEW",
          reviewVersion: expectedVersion,
        },
        data: { status: targetStatus },
      });

      return { updated: result.count === 1 };
    },
  };
}
