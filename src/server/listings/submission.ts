import {
  assertRole,
  AuthenticationRequiredError,
  type UserRole,
} from "../auth/authorization-rules.ts";

export const furnishingStatuses = [
  "UNFURNISHED",
  "SEMI_FURNISHED",
  "FURNISHED",
] as const;

export const tenantPreferences = [
  "ANY",
  "FAMILY",
  "BACHELORS",
  "FEMALE_ONLY",
  "MALE_ONLY",
  "STUDENTS",
  "WORKING_PROFESSIONALS",
] as const;

type FurnishingStatus = (typeof furnishingStatuses)[number];
type TenantPreference = (typeof tenantPreferences)[number];

export type ListingSubmissionInput = {
  cityId: string;
  localityId: string;
  propertyTypeId: string;
  title: string;
  description?: string;
  rent: string;
  securityDeposit?: string;
  contactPhone?: string;
  contactConsent?: string;
  availableFrom?: string;
  furnishingStatus?: string;
  tenantPreference?: string;
  amenityIds?: string[];
};

export function listingInputFromFormData(
  formData: FormData,
): ListingSubmissionInput {
  return {
    cityId: String(formData.get("cityId") ?? ""),
    localityId: String(formData.get("localityId") ?? ""),
    propertyTypeId: String(formData.get("propertyTypeId") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    rent: String(formData.get("rent") ?? ""),
    securityDeposit: String(formData.get("securityDeposit") ?? ""),
    contactPhone: String(formData.get("contactPhone") ?? ""),
    contactConsent: String(formData.get("contactConsent") ?? ""),
    availableFrom: String(formData.get("availableFrom") ?? ""),
    furnishingStatus: String(formData.get("furnishingStatus") ?? ""),
    tenantPreference: String(formData.get("tenantPreference") ?? ""),
    amenityIds: formData.getAll("amenityIds").map(String),
  };
}

export type ListingCreator = {
  id: string;
  role: UserRole;
};

export type ListingSubmissionError = {
  field?: keyof ListingSubmissionInput;
  message: string;
};

export class ListingSubmissionValidationError extends Error {
  readonly errors: ListingSubmissionError[];

  constructor(errors: ListingSubmissionError[]) {
    super("Listing submission is invalid.");
    this.name = "ListingSubmissionValidationError";
    this.errors = errors;
  }
}

export type ValidatedListingSubmission = {
  cityId: string;
  localityId: string;
  propertyTypeId: string;
  title: string;
  description: string | null;
  rentAmountPaise: bigint;
  securityDepositAmountPaise: bigint | null;
  contactPhone: string | null;
  contactConsentAt: Date | null;
  availableFrom: Date | null;
  furnishingStatus: FurnishingStatus;
  tenantPreference: TenantPreference;
  amenityIds: string[];
  status: "PENDING_REVIEW";
};

export type ListingSubmissionTransaction = {
  findReferenceData(input: {
    cityId: string;
    localityId: string;
    propertyTypeId: string;
    amenityIds: string[];
  }): Promise<{
    localityCityId: string | null;
    propertyTypeExists: boolean;
    foundAmenityIds: string[];
  }>;
  createListing(
    input: ValidatedListingSubmission & { ownerId: string },
  ): Promise<{
    id: string;
  }>;
};

export type ListingSubmissionRepository = {
  transaction<T>(
    operation: (tx: ListingSubmissionTransaction) => Promise<T>,
  ): Promise<T>;
};

function parsePaise(value: string, field: "rent" | "securityDeposit") {
  const normalized = value.trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new ListingSubmissionValidationError([
      {
        field,
        message: "Enter an amount with no more than two decimal places.",
      },
    ]);
  }

  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

export function normalizeIndianContactPhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.startsWith("+91") ? trimmed.slice(3) : trimmed;
  return /^[6-9][0-9]{9}$/.test(digits) ? `+91${digits}` : null;
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  const isExactDate =
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;

  return isExactDate ? date : null;
}

function isValueIn<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

export function validateSubmission(
  input: ListingSubmissionInput,
): ValidatedListingSubmission {
  const errors: ListingSubmissionError[] = [];
  const cityId = input.cityId.trim();
  const localityId = input.localityId.trim();
  const propertyTypeId = input.propertyTypeId.trim();
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const furnishingStatus = input.furnishingStatus || "UNFURNISHED";
  const tenantPreference = input.tenantPreference || "ANY";
  const amenityIds = input.amenityIds ?? [];
  const rawContact = input.contactPhone ?? "";
  const rawConsent = input.contactConsent ?? "";
  const contactPhone = rawContact.trim()
    ? normalizeIndianContactPhone(rawContact)
    : null;
  if (rawContact.trim() && !contactPhone)
    errors.push({
      field: "contactPhone",
      message: "Enter a valid Indian mobile number.",
    });
  if (rawConsent !== "" && rawConsent !== "on")
    errors.push({
      field: "contactConsent",
      message: "Choose a valid contact consent option.",
    });
  if (rawConsent === "on" && !contactPhone)
    errors.push({
      field: "contactConsent",
      message: "A valid contact number is required for public display.",
    });

  if (!cityId) errors.push({ field: "cityId", message: "Choose a city." });
  if (!localityId)
    errors.push({ field: "localityId", message: "Choose a locality." });
  if (!propertyTypeId) {
    errors.push({
      field: "propertyTypeId",
      message: "Choose a property type.",
    });
  }
  if (!title)
    errors.push({ field: "title", message: "Enter a listing title." });
  if (title.length > 160) {
    errors.push({ field: "title", message: "Use 160 characters or fewer." });
  }
  if (description && description.length > 4_000) {
    errors.push({
      field: "description",
      message: "Use 4,000 characters or fewer.",
    });
  }

  let rentAmountPaise: bigint | null = null;
  try {
    rentAmountPaise = parsePaise(input.rent, "rent");
    if (rentAmountPaise <= BigInt(0)) {
      errors.push({
        field: "rent",
        message: "Rent must be greater than zero.",
      });
    }
  } catch (error) {
    if (error instanceof ListingSubmissionValidationError)
      errors.push(...error.errors);
  }

  let securityDepositAmountPaise: bigint | null = null;
  if (input.securityDeposit?.trim()) {
    try {
      securityDepositAmountPaise = parsePaise(
        input.securityDeposit,
        "securityDeposit",
      );
    } catch (error) {
      if (error instanceof ListingSubmissionValidationError)
        errors.push(...error.errors);
    }
  }

  let availableFrom: Date | null = null;
  if (input.availableFrom?.trim()) {
    availableFrom = parseDateOnly(input.availableFrom);
    if (!availableFrom) {
      errors.push({ field: "availableFrom", message: "Enter a valid date." });
    }
  }

  if (!isValueIn(furnishingStatuses, furnishingStatus)) {
    errors.push({
      field: "furnishingStatus",
      message: "Choose a valid furnishing status.",
    });
  }
  if (!isValueIn(tenantPreferences, tenantPreference)) {
    errors.push({
      field: "tenantPreference",
      message: "Choose a valid tenant preference.",
    });
  }
  if (
    new Set(amenityIds).size !== amenityIds.length ||
    amenityIds.some((id) => !id)
  ) {
    errors.push({
      field: "amenityIds",
      message: "Choose each amenity only once.",
    });
  }

  if (
    errors.length > 0 ||
    !rentAmountPaise ||
    !isValueIn(furnishingStatuses, furnishingStatus) ||
    !isValueIn(tenantPreferences, tenantPreference)
  ) {
    throw new ListingSubmissionValidationError(errors);
  }

  return {
    cityId,
    localityId,
    propertyTypeId,
    title,
    description,
    rentAmountPaise,
    securityDepositAmountPaise,
    contactPhone,
    contactConsentAt: rawConsent === "on" && contactPhone ? new Date() : null,
    availableFrom,
    furnishingStatus,
    tenantPreference,
    amenityIds,
    status: "PENDING_REVIEW",
  };
}

export async function createListingSubmission(
  actor: ListingCreator | null,
  input: ListingSubmissionInput,
  repository: ListingSubmissionRepository,
) {
  if (!actor) {
    throw new AuthenticationRequiredError();
  }

  assertRole(actor.role, ["OWNER", "BROKER"]);
  const listing = validateSubmission(input);

  return repository.transaction(async (tx) => {
    await validateSubmissionReferences(listing, tx);

    return tx.createListing({
      ...listing,
      ownerId: actor.id,
    });
  });
}

export async function validateSubmissionReferences(
  listing: ValidatedListingSubmission,
  tx: Pick<ListingSubmissionTransaction, "findReferenceData">,
) {
  const references = await tx.findReferenceData({
    cityId: listing.cityId,
    localityId: listing.localityId,
    propertyTypeId: listing.propertyTypeId,
    amenityIds: listing.amenityIds,
  });
  const errors: ListingSubmissionError[] = [];

  if (references.localityCityId !== listing.cityId) {
    errors.push({
      field: "localityId",
      message: "Choose a valid locality for the city.",
    });
  }
  if (!references.propertyTypeExists) {
    errors.push({
      field: "propertyTypeId",
      message: "Choose a valid property type.",
    });
  }
  if (references.foundAmenityIds.length !== listing.amenityIds.length) {
    errors.push({
      field: "amenityIds",
      message: "Choose only valid amenities.",
    });
  }
  if (errors.length > 0) {
    throw new ListingSubmissionValidationError(errors);
  }

  return references;
}

export function fieldErrors(errors: ListingSubmissionError[]) {
  return errors.reduce<Record<string, string>>((result, error) => {
    if (error.field && !result[error.field])
      result[error.field] = error.message;
    return result;
  }, {});
}
