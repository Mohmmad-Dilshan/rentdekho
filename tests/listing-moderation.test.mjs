import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthenticationRequiredError,
  AuthorizationError,
} from "../src/server/auth/authorization-rules.ts";
import {
  moderateListing,
  ModerationInputError,
} from "../src/server/listings/moderation.ts";

function createRepository(initialStatus = "PENDING_REVIEW") {
  const listing = {
    id: "listing-1",
    status: initialStatus,
    ownerId: "owner-1",
    title: "Original title",
    description: "Original description",
    rentAmountPaise: 1250050n,
    securityDepositAmountPaise: 2500000n,
    localityId: "locality-1",
    propertyTypeId: "property-type-1",
    furnishingStatus: "SEMI_FURNISHED",
    tenantPreference: "FAMILY",
    availableFrom: "2026-10-01",
    createdAt: "original-created-at",
    amenities: ["amenity-1"],
  };

  return {
    listing,
    calls: [],
    async transitionPendingListing({ listingId, targetStatus }) {
      this.calls.push({ listingId, targetStatus });
      if (listingId !== listing.id || listing.status !== "PENDING_REVIEW") {
        return { updated: false };
      }

      listing.status = targetStatus;
      return { updated: true };
    },
  };
}

const admin = { id: "admin-1", role: "ADMIN" };

test("anonymous moderation is rejected", async () => {
  const repository = createRepository();

  await assert.rejects(
    moderateListing(null, "listing-1", "APPROVE", repository),
    AuthenticationRequiredError,
  );
  assert.equal(repository.calls.length, 0);
});

for (const role of ["TENANT", "OWNER", "BROKER"]) {
  test(`${role} cannot moderate a listing`, async () => {
    const repository = createRepository();

    await assert.rejects(
      moderateListing(
        { id: `${role.toLowerCase()}-1`, role },
        "listing-1",
        "APPROVE",
        repository,
      ),
      AuthorizationError,
    );
    assert.equal(repository.calls.length, 0);
  });
}

test("ADMIN can approve a pending listing without overwriting listing data", async () => {
  const repository = createRepository();
  const original = {
    ...repository.listing,
    amenities: [...repository.listing.amenities],
  };

  const result = await moderateListing(
    admin,
    "listing-1",
    "APPROVE",
    repository,
  );

  assert.deepEqual(result, { outcome: "moderated", status: "PUBLISHED" });
  assert.deepEqual(repository.calls, [
    { listingId: "listing-1", targetStatus: "PUBLISHED" },
  ]);
  assert.equal(repository.listing.status, "PUBLISHED");
  assert.deepEqual(
    { ...repository.listing, status: original.status },
    original,
  );
});

test("ADMIN can reject a pending listing", async () => {
  const repository = createRepository();

  const result = await moderateListing(
    admin,
    "listing-1",
    "REJECT",
    repository,
  );

  assert.deepEqual(result, { outcome: "moderated", status: "REJECTED" });
  assert.equal(repository.listing.status, "REJECTED");
  assert.deepEqual(repository.calls, [
    { listingId: "listing-1", targetStatus: "REJECTED" },
  ]);
});

test("arbitrary target statuses and invalid decisions are rejected", async () => {
  for (const decision of ["PUBLISHED", "RENTED", "ARCHIVED", "SET_STATUS"]) {
    const repository = createRepository();
    await assert.rejects(
      moderateListing(admin, "listing-1", decision, repository),
      ModerationInputError,
    );
    assert.equal(repository.calls.length, 0);
  }
});

for (const status of ["PUBLISHED", "REJECTED", "RENTED", "ARCHIVED"]) {
  test(`${status} cannot be moderated through M7`, async () => {
    const repository = createRepository(status);

    const result = await moderateListing(
      admin,
      "listing-1",
      "APPROVE",
      repository,
    );

    assert.deepEqual(result, { outcome: "not-pending" });
    assert.equal(repository.listing.status, status);
  });
}

test("a stale concurrent moderation request cannot overwrite the first decision", async () => {
  const repository = createRepository();

  const [approval, rejection] = await Promise.all([
    moderateListing(admin, "listing-1", "APPROVE", repository),
    moderateListing(
      { id: "admin-2", role: "ADMIN" },
      "listing-1",
      "REJECT",
      repository,
    ),
  ]);

  assert.deepEqual(approval, { outcome: "moderated", status: "PUBLISHED" });
  assert.deepEqual(rejection, { outcome: "not-pending" });
  assert.equal(repository.listing.status, "PUBLISHED");
});
