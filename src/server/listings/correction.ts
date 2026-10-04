import {
  assertRole,
  AuthenticationRequiredError,
  type UserRole,
} from "../auth/authorization-rules.ts";
import {
  validateSubmission,
  validateSubmissionReferences,
  type ListingSubmissionInput,
  type ListingSubmissionTransaction,
  type ValidatedListingSubmission,
} from "./submission.ts";

export type CorrectionActor = { id: string; role: UserRole };
export type CorrectionRepository = {
  transaction<T>(
    operation: (
      tx: Pick<ListingSubmissionTransaction, "findReferenceData"> & {
        correct(input: {
          listingId: string;
          ownerId: string;
          expectedVersion: number;
          expectedStatus: "PENDING_REVIEW" | "PUBLISHED";
          content: ValidatedListingSubmission;
        }): Promise<boolean>;
      },
    ) => Promise<T>,
  ): Promise<T>;
};

export class CorrectionInputError extends Error {
  constructor() {
    super("The correction request is invalid.");
  }
}

export async function correctListing(
  actor: CorrectionActor | null,
  listingId: unknown,
  expectedVersion: unknown,
  input: ListingSubmissionInput,
  repository: CorrectionRepository,
  expectedStatus: unknown,
) {
  if (!actor) throw new AuthenticationRequiredError();
  assertRole(actor.role, ["OWNER", "BROKER"]);
  if (
    typeof listingId !== "string" ||
    !/^[a-z0-9]{10,36}$/.test(listingId) ||
    !Number.isSafeInteger(expectedVersion) ||
    (expectedVersion as number) < 1 ||
    (expectedStatus !== "PENDING_REVIEW" && expectedStatus !== "PUBLISHED")
  )
    throw new CorrectionInputError();

  const content = validateSubmission(input);
  return repository.transaction(async (tx) => {
    await validateSubmissionReferences(content, tx);
    const updated = await tx.correct({
      listingId,
      ownerId: actor.id,
      expectedVersion: expectedVersion as number,
      expectedStatus,
      content,
    });
    return updated
      ? { outcome: "corrected" as const }
      : { outcome: "unavailable" as const };
  });
}
