import {
  assertRole,
  AuthenticationRequiredError,
  type UserRole,
} from "../auth/authorization-rules.ts";

export const moderationDecisions = ["APPROVE", "REJECT"] as const;

type ModerationTargetStatus = "PUBLISHED" | "REJECTED";

export type ListingModerator = {
  id: string;
  role: UserRole;
};

export class ModerationInputError extends Error {
  constructor() {
    super("The moderation request is invalid.");
  }
}

export type ListingModerationRepository = {
  transitionPendingListing(input: {
    listingId: string;
    targetStatus: ModerationTargetStatus;
    expectedVersion: number;
  }): Promise<{ updated: boolean }>;
};

function targetStatusFor(decision: string): ModerationTargetStatus {
  if (decision === "APPROVE") return "PUBLISHED";
  if (decision === "REJECT") return "REJECTED";
  throw new ModerationInputError();
}

export async function moderateListing(
  actor: ListingModerator | null,
  listingId: string,
  decision: string,
  repository: ListingModerationRepository,
  expectedVersion = 1,
) {
  if (!actor) {
    throw new AuthenticationRequiredError();
  }

  assertRole(actor.role, ["ADMIN"]);

  const normalizedListingId = listingId.trim();
  if (
    !normalizedListingId ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    throw new ModerationInputError();
  }

  const targetStatus = targetStatusFor(decision);
  const result = await repository.transitionPendingListing({
    listingId: normalizedListingId,
    targetStatus,
    expectedVersion,
  });

  return result.updated
    ? { outcome: "moderated" as const, status: targetStatus }
    : { outcome: "not-pending" as const };
}
