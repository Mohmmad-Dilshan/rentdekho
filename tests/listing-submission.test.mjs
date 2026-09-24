import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthenticationRequiredError,
  AuthorizationError,
} from "../src/server/auth/authorization-rules.ts";
import {
  createListingSubmission,
  ListingSubmissionValidationError,
} from "../src/server/listings/submission.ts";

const validInput = {
  cityId: "city-1",
  localityId: "locality-1",
  propertyTypeId: "property-type-1",
  title: "Sunny two-bedroom home",
  description: "Near local amenities.",
  rent: "12500.50",
  securityDeposit: "25000",
  availableFrom: "2026-10-01",
  furnishingStatus: "SEMI_FURNISHED",
  tenantPreference: "FAMILY",
  amenityIds: ["amenity-1", "amenity-2"],
};

function createRepository({ failCreate = false, references } = {}) {
  const committed = [];

  return {
    committed,
    async transaction(operation) {
      const staged = [];
      const result = await operation({
        async findReferenceData(input) {
          return (
            references ?? {
              localityCityId: input.cityId,
              propertyTypeExists: true,
              foundAmenityIds: input.amenityIds,
            }
          );
        },
        async createListing(input) {
          if (failCreate) throw new Error("simulated database failure");
          staged.push(input);
          return { id: "listing-1" };
        },
      });
      committed.push(...staged);
      return result;
    },
  };
}

test("unauthenticated and tenant actors cannot submit listings", async () => {
  const repository = createRepository();

  await assert.rejects(
    createListingSubmission(null, validInput, repository),
    AuthenticationRequiredError,
  );
  await assert.rejects(
    createListingSubmission(
      { id: "tenant-1", role: "TENANT" },
      validInput,
      repository,
    ),
    AuthorizationError,
  );
  assert.equal(repository.committed.length, 0);
});

for (const role of ["OWNER", "BROKER"]) {
  test(`${role} submission uses the authenticated owner and pending-review status`, async () => {
    const repository = createRepository();
    const result = await createListingSubmission(
      { id: `${role.toLowerCase()}-1`, role },
      {
        ...validInput,
        ownerId: "attacker-1",
        status: "PUBLISHED",
        createdAt: "tampered",
      },
      repository,
    );

    assert.equal(result.id, "listing-1");
    assert.equal(repository.committed.length, 1);
    assert.equal(repository.committed[0].ownerId, `${role.toLowerCase()}-1`);
    assert.equal(repository.committed[0].status, "PENDING_REVIEW");
    assert.equal(repository.committed[0].rentAmountPaise, 1250050n);
    assert.deepEqual(repository.committed[0].amenityIds, [
      "amenity-1",
      "amenity-2",
    ]);
  });
}

test("invalid money, enums, duplicate amenities, and invalid dates are rejected", async () => {
  const repository = createRepository();

  await assert.rejects(
    createListingSubmission(
      { id: "owner-1", role: "OWNER" },
      {
        ...validInput,
        rent: "12.999",
        securityDeposit: "-1",
        availableFrom: "2026-02-30",
        furnishingStatus: "PUBLISHED",
        amenityIds: ["amenity-1", "amenity-1"],
      },
      repository,
    ),
    ListingSubmissionValidationError,
  );
  assert.equal(repository.committed.length, 0);
});

test("nonexistent or mismatched reference IDs are rejected before creation", async () => {
  const repository = createRepository({
    references: {
      localityCityId: "different-city",
      propertyTypeExists: false,
      foundAmenityIds: ["amenity-1"],
    },
  });

  await assert.rejects(
    createListingSubmission(
      { id: "owner-1", role: "OWNER" },
      validInput,
      repository,
    ),
    ListingSubmissionValidationError,
  );
  assert.equal(repository.committed.length, 0);
});

test("a failed creation leaves the mock transaction without a committed listing", async () => {
  const repository = createRepository({ failCreate: true });

  await assert.rejects(
    createListingSubmission(
      { id: "owner-1", role: "OWNER" },
      validInput,
      repository,
    ),
    /simulated database failure/,
  );
  assert.equal(repository.committed.length, 0);
});
