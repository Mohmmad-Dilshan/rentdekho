import {
  assertRole,
  AuthenticationRequiredError,
  type UserRole,
} from "../auth/authorization-rules.ts";

export type OwnerActor = { id: string; role: UserRole };
export type OwnerAction = "MARK_RENTED" | "WITHDRAW";
export type OwnerSourceStatus = "PENDING_REVIEW" | "PUBLISHED";

export type ManagedListing = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  rentAmountPaise: bigint;
  securityDepositAmountPaise: bigint | null;
  contactPhone: string | null;
  contactConsentAt: Date | null;
  availableFrom: Date | null;
  furnishingStatus: string;
  tenantPreference: string;
  createdAt: Date;
  updatedAt: Date;
  locality: { name: string; city: { name: string } };
  propertyType: { label: string };
  amenities: { label: string }[];
};

export type OwnerListingRepository = {
  listOwn(ownerId: string): Promise<ManagedListing[]>;
  findOwn(ownerId: string, listingId: string): Promise<ManagedListing | null>;
  transition(input: {
    ownerId: string;
    listingId: string;
    action: OwnerAction;
    expectedStatus: OwnerSourceStatus;
  }): Promise<boolean>;
};

export class OwnerListingInputError extends Error {
  constructor() {
    super("The listing action is invalid.");
  }
}

function requireOwner(actor: OwnerActor | null) {
  if (!actor) throw new AuthenticationRequiredError();
  assertRole(actor.role, ["OWNER", "BROKER"]);
  return actor.id;
}

function parseListingId(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9]{10,36}$/.test(value)) {
    throw new OwnerListingInputError();
  }
  return value;
}

export async function listOwnerListings(
  actor: OwnerActor | null,
  repository: OwnerListingRepository,
) {
  return repository.listOwn(requireOwner(actor));
}

export async function getOwnerListing(
  actor: OwnerActor | null,
  listingId: unknown,
  repository: OwnerListingRepository,
) {
  const ownerId = requireOwner(actor);
  try {
    return await repository.findOwn(ownerId, parseListingId(listingId));
  } catch (error) {
    if (error instanceof OwnerListingInputError) return null;
    throw error;
  }
}

export async function transitionOwnerListing(
  actor: OwnerActor | null,
  listingId: unknown,
  action: unknown,
  expectedStatus: unknown,
  repository: OwnerListingRepository,
) {
  const ownerId = requireOwner(actor);
  const id = parseListingId(listingId);
  if (action !== "MARK_RENTED" && action !== "WITHDRAW") {
    throw new OwnerListingInputError();
  }
  if (
    (action === "MARK_RENTED" && expectedStatus !== "PUBLISHED") ||
    (action === "WITHDRAW" &&
      expectedStatus !== "PENDING_REVIEW" &&
      expectedStatus !== "PUBLISHED")
  ) {
    throw new OwnerListingInputError();
  }
  const sourceStatus = expectedStatus as OwnerSourceStatus;
  const listing = await repository.findOwn(ownerId, id);
  if (!listing || listing.status !== sourceStatus) {
    return { outcome: "unavailable" as const };
  }
  const updated = await repository.transition({
    ownerId,
    listingId: id,
    action,
    expectedStatus: sourceStatus,
  });
  return updated
    ? { outcome: "updated" as const }
    : { outcome: "unavailable" as const };
}
