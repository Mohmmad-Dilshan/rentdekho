"use server";

import { redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  requireRole,
} from "../../../../server/auth/authorization";
import { prisma } from "../../../../server/db/prisma";
import {
  ModerationInputError,
  moderateListing,
} from "../../../../server/listings/moderation";
import { createPrismaListingModerationRepository } from "../../../../server/listings/prisma-moderation-repository";

export type ModerationActionState = {
  error: string | null;
  message: string | null;
};

export const initialModerationActionState: ModerationActionState = {
  error: null,
  message: null,
};

async function applyModeration(
  formData: FormData,
  decision: "APPROVE" | "REJECT",
): Promise<ModerationActionState> {
  try {
    const user = await requireRole(["ADMIN"]);
    const result = await moderateListing(
      { id: user.id, role: user.role as "ADMIN" },
      String(formData.get("listingId") ?? ""),
      decision,
      createPrismaListingModerationRepository(prisma),
    );

    if (result.outcome === "not-pending") {
      return {
        error: "This listing is no longer awaiting review.",
        message: null,
      };
    }

    return {
      error: null,
      message:
        result.status === "PUBLISHED"
          ? "Listing published."
          : "Listing rejected.",
    };
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof AuthorizationError) {
      return {
        error: "You do not have permission to moderate listings.",
        message: null,
      };
    }
    if (error instanceof ModerationInputError) {
      return {
        error: "The moderation request could not be processed.",
        message: null,
      };
    }
    return {
      error: "We could not update this listing. Please try again.",
      message: null,
    };
  }
}

export async function approveListing(
  _previousState: ModerationActionState,
  formData: FormData,
) {
  return applyModeration(formData, "APPROVE");
}

export async function rejectListing(
  _previousState: ModerationActionState,
  formData: FormData,
) {
  return applyModeration(formData, "REJECT");
}
