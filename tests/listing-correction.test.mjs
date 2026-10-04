import assert from "node:assert/strict";
import test from "node:test";
import {
  correctListing,
  CorrectionInputError,
} from "../src/server/listings/correction.ts";
import { ListingSubmissionValidationError } from "../src/server/listings/submission.ts";

const id = "cm13listing000000000000001";
const input = {
  cityId: "city",
  localityId: "locality",
  propertyTypeId: "type",
  title: "Corrected home",
  rent: "12500.50",
  contactPhone: "9876543210",
  contactConsent: "on",
  amenityIds: [],
};
function repository() {
  const calls = [];
  return {
    calls,
    transaction: async (operation) =>
      operation({
        findReferenceData: async () => ({
          localityCityId: "city",
          propertyTypeExists: true,
          foundAmenityIds: [],
        }),
        correct: async (args) => {
          calls.push(args);
          return args.ownerId === "owner" && args.expectedVersion === 1;
        },
      }),
  };
}

test("authorized OWNER and BROKER reuse validation and preserve server ownership", async () => {
  for (const role of ["OWNER", "BROKER"]) {
    const repo = repository();
    const result = await correctListing(
      { id: "owner", role },
      id,
      1,
      { ...input, ownerId: "attacker", status: "PUBLISHED", reviewVersion: 99 },
      repo,
      "PUBLISHED",
    );
    assert.deepEqual(result, { outcome: "corrected" });
    assert.equal(repo.calls[0].ownerId, "owner");
    assert.equal(repo.calls[0].content.status, "PENDING_REVIEW");
    assert.equal(repo.calls[0].expectedStatus, "PUBLISHED");
    assert.equal(repo.calls[0].content.contactPhone, "+919876543210");
  }
});

test("anonymous, TENANT and ADMIN cannot correct", async () => {
  for (const actor of [
    null,
    { id: "tenant", role: "TENANT" },
    { id: "admin", role: "ADMIN" },
  ]) {
    const repo = repository();
    await assert.rejects(
      correctListing(actor, id, 1, input, repo, "PUBLISHED"),
    );
    assert.equal(repo.calls.length, 0);
  }
});

test("invalid values and version never write", async () => {
  for (const [version, change, error] of [
    [1, { rent: "0" }, ListingSubmissionValidationError],
    [
      1,
      { contactPhone: "bad", contactConsent: "on" },
      ListingSubmissionValidationError,
    ],
    [0, {}, CorrectionInputError],
    [1.5, {}, CorrectionInputError],
  ]) {
    const repo = repository();
    await assert.rejects(
      correctListing(
        { id: "owner", role: "OWNER" },
        id,
        version,
        { ...input, ...change },
        repo,
        "PUBLISHED",
      ),
      error,
    );
    assert.equal(repo.calls.length, 0);
  }
});

test("stale or another-owner correction returns unavailable", async () => {
  for (const [ownerId, version] of [
    ["owner", 2],
    ["another", 1],
  ]) {
    const repo = repository();
    assert.deepEqual(
      await correctListing(
        { id: ownerId, role: "OWNER" },
        id,
        version,
        input,
        repo,
        "PUBLISHED",
      ),
      { outcome: "unavailable" },
    );
  }
});
