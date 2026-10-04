"use server";

import { redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  requireRole,
} from "../../../server/auth/authorization";
import { prisma } from "../../../server/db/prisma";
import { createPrismaListingSubmissionRepository } from "../../../server/listings/prisma-submission-repository";
import {
  createListingSubmission,
  fieldErrors,
  listingInputFromFormData,
  ListingSubmissionValidationError,
} from "../../../server/listings/submission";

export type ListingFormState = {
  errors: Record<string, string>;
  formError: string | null;
};

export async function submitListing(
  _previousState: ListingFormState,
  formData: FormData,
): Promise<ListingFormState> {
  try {
    const user = await requireRole(["OWNER", "BROKER"]);
    await createListingSubmission(
      { id: user.id, role: user.role as "OWNER" | "BROKER" },
      listingInputFromFormData(formData),
      createPrismaListingSubmissionRepository(prisma),
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect("/sign-in");
    }
    if (error instanceof AuthorizationError) {
      return {
        errors: {},
        formError: "Only owner and broker accounts can submit rental listings.",
      };
    }
    if (error instanceof ListingSubmissionValidationError) {
      return { errors: fieldErrors(error.errors), formError: null };
    }

    return {
      errors: {},
      formError: "We could not submit this listing. Please try again.",
    };
  }

  redirect("/listings/submitted");
}
