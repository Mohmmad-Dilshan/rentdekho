import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { ListingModerationRepository } from "./moderation";

export function createPrismaListingModerationRepository(
  prisma: PrismaClient,
): ListingModerationRepository {
  return {
    async transitionPendingListing({ listingId, targetStatus }) {
      const result = await prisma.listing.updateMany({
        where: { id: listingId, status: "PENDING_REVIEW" },
        data: { status: targetStatus },
      });

      return { updated: result.count === 1 };
    },
  };
}
