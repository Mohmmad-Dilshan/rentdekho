"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  requireRole,
} from "../../../../../server/auth/authorization";
import { prisma } from "../../../../../server/db/prisma";
import {
  correctListing as correctListingService,
  CorrectionInputError,
} from "../../../../../server/listings/correction";
import { createPrismaCorrectionRepository } from "../../../../../server/listings/prisma-correction-repository";
import {
  fieldErrors,
  listingInputFromFormData,
  ListingSubmissionValidationError,
} from "../../../../../server/listings/submission";
import type { ListingFormState } from "../../../../listings/new/actions";

export async function correctListing(
  _previousState: ListingFormState,
  formData: FormData,
): Promise<ListingFormState> {
  const listingId = String(formData.get("listingId") ?? "");
  try {
    const user = await requireRole(["OWNER", "BROKER"]);
    const result = await correctListingService(
      { id: user.id, role: user.role as "OWNER" | "BROKER" },
      listingId,
      Number(formData.get("reviewVersion")),
      listingInputFromFormData(formData),
      createPrismaCorrectionRepository(prisma),
      formData.get("expectedStatus"),
    );
    if (result.outcome === "unavailable")
      return {
        errors: {},
        formError:
          "This listing has changed or is unavailable. Reload before editing.",
      };
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof AuthorizationError)
      return { errors: {}, formError: "You cannot edit this listing." };
    if (error instanceof ListingSubmissionValidationError)
      return { errors: fieldErrors(error.errors), formError: null };
    if (error instanceof CorrectionInputError)
      return {
        errors: {},
        formError: "Invalid or stale correction. Reload the listing.",
      };
    return {
      errors: {},
      formError: "We could not correct this listing. Try again.",
    };
  }
  revalidatePath("/my/listings");
  revalidatePath(`/my/listings/${listingId}`);
  revalidatePath("/admin/listings");
  revalidatePath(`/admin/listings/${listingId}`);
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${listingId}`);
  revalidatePath("/sitemap.xml");
  redirect(`/my/listings/${listingId}?updated=corrected`);
}
