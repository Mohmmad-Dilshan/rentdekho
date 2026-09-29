"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  requireRole,
} from "../../../../server/auth/authorization";
import { prisma } from "../../../../server/db/prisma";
import {
  OwnerListingInputError,
  transitionOwnerListing,
  type OwnerAction,
  type OwnerSourceStatus,
} from "../../../../server/listings/owner-management";
import { createPrismaOwnerListingRepository } from "../../../../server/listings/prisma-owner-listings-repository";

export type OwnerActionState = { error: string | null };

async function applyOwnerAction(
  formData: FormData,
  action: OwnerAction,
  expectedStatus: OwnerSourceStatus,
): Promise<OwnerActionState> {
  const listingId = formData.get("listingId");
  try {
    const user = await requireRole(["OWNER", "BROKER"]);
    const result = await transitionOwnerListing(
      { id: user.id, role: user.role as "OWNER" | "BROKER" },
      listingId,
      action,
      expectedStatus,
      createPrismaOwnerListingRepository(prisma),
    );
    if (result.outcome === "unavailable") {
      return {
        error: "This listing is unavailable or has changed. Refresh the page.",
      };
    }
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof AuthorizationError) {
      return { error: "You cannot manage this listing." };
    }
    if (error instanceof OwnerListingInputError) {
      return {
        error: "This listing is unavailable or has changed. Refresh the page.",
      };
    }
    return { error: "We could not update this listing. Please try again." };
  }

  revalidatePath("/my/listings");
  revalidatePath(`/my/listings/${listingId}`);
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${listingId}`);
  revalidatePath("/sitemap.xml");
  redirect(
    `/my/listings/${listingId}?updated=${action === "MARK_RENTED" ? "rented" : "withdrawn"}`,
  );
}

export async function markListingRented(
  _previousState: OwnerActionState,
  formData: FormData,
) {
  return applyOwnerAction(formData, "MARK_RENTED", "PUBLISHED");
}

export async function withdrawPendingListing(
  _previousState: OwnerActionState,
  formData: FormData,
) {
  return applyOwnerAction(formData, "WITHDRAW", "PENDING_REVIEW");
}

export async function withdrawPublishedListing(
  _previousState: OwnerActionState,
  formData: FormData,
) {
  return applyOwnerAction(formData, "WITHDRAW", "PUBLISHED");
}
