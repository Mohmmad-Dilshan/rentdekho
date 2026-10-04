import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { ensureServerEntryExports } from "next/dist/build/webpack/loaders/next-flight-loader/action-validate.js";

async function loadActions(path, boundary) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const rules = new URL(
    "../src/server/auth/authorization-rules.ts",
    import.meta.url,
  ).href;
  const submission = new URL(
    "../src/server/listings/submission.ts",
    import.meta.url,
  ).href;
  const moderation = new URL(
    "../src/server/listings/moderation.ts",
    import.meta.url,
  ).href;
  const harness = `
    import { AuthenticationRequiredError, AuthorizationError, assertRole } from ${JSON.stringify(rules)};
    import { createListingSubmission, fieldErrors, listingInputFromFormData, ListingSubmissionValidationError } from ${JSON.stringify(submission)};
    import { moderateListing, ModerationInputError } from ${JSON.stringify(moderation)};
    const requireRole = async (roles) => {
      const actor = globalThis[${JSON.stringify(boundary)}].actor;
      if (!actor) throw new AuthenticationRequiredError();
      assertRole(actor.role, roles);
      return actor;
    };
    const prisma = {};
    const redirect = (url) => { throw new Error("redirect:" + url); };
    const createPrismaListingSubmissionRepository = () => globalThis[${JSON.stringify(boundary)}].repository;
    const createPrismaListingModerationRepository = () => globalThis[${JSON.stringify(boundary)}].repository;
  `;
  return import(
    `data:text/javascript;base64,${Buffer.from(harness + stripTypeScriptTypes(source.replace(/import[\s\S]*?from\s+"[^"]+";/g, ""))).toString("base64")}`
  );
}

test("submission and moderation action modules load with valid server exports", async () => {
  for (const path of [
    "../src/app/listings/new/actions.ts",
    "../src/app/admin/listings/[listingId]/actions.ts",
  ]) {
    const actions = await loadActions(path, "m10-export-test");
    assert.doesNotThrow(() => ensureServerEntryExports(Object.values(actions)));
    assert.ok(Object.keys(actions).length > 0);
    for (const action of Object.values(actions)) {
      assert.equal(action.constructor.name, "AsyncFunction");
    }
  }
  assert.throws(
    () => ensureServerEntryExports([{}]),
    /only export async functions/,
  );
});

test("submission action rejects invalid input and unauthorized users without writes", async () => {
  const boundary = "m10-submission-test";
  let writes = 0;
  globalThis[boundary] = {
    actor: { id: "session-owner", role: "OWNER" },
    repository: {
      transaction: async (operation) =>
        operation({
          findReferenceData: async () => ({
            localityCityId: "city",
            propertyTypeExists: true,
            foundAmenityIds: [],
          }),
          createListing: async () => {
            writes++;
            return { id: "created" };
          },
        }),
    },
  };
  try {
    const { submitListing } = await loadActions(
      "../src/app/listings/new/actions.ts",
      boundary,
    );
    const form = (overrides = {}) => {
      const data = new FormData();
      for (const [key, value] of Object.entries({
        cityId: "city",
        localityId: "locality",
        propertyTypeId: "type",
        title: "Home",
        rent: "12500.50",
        securityDeposit: "25000",
        ...overrides,
      }))
        data.set(key, value);
      return data;
    };
    for (const rent of ["0", "0.00", "000.00"]) {
      const result = await submitListing({}, form({ rent }));
      assert.equal(result.errors.rent, "Rent must be greater than zero.");
    }
    for (const overrides of [
      { rent: "" },
      { rent: "-1" },
      { rent: "12.345" },
      { securityDeposit: "-1" },
      { securityDeposit: "12..5" },
      { cityId: "different" },
    ]) {
      const result = await submitListing({}, form(overrides));
      assert.ok(Object.keys(result.errors).length > 0);
    }
    globalThis[boundary].repository.transaction = async (operation) =>
      operation({
        findReferenceData: async () => ({
          localityCityId: null,
          propertyTypeExists: false,
          foundAmenityIds: [],
        }),
        createListing: async () => {
          writes++;
        },
      });
    assert.ok((await submitListing({}, form())).errors.localityId);
    assert.ok((await submitListing({}, form())).errors.propertyTypeId);
    globalThis[boundary].actor = { id: "tenant", role: "TENANT" };
    assert.match(
      (await submitListing({}, form())).formError,
      /Only owner and broker/,
    );
    globalThis[boundary].actor = null;
    await assert.rejects(submitListing({}, form()), /redirect:\/sign-in/);
    assert.equal(writes, 0);
  } finally {
    delete globalThis[boundary];
  }
});

test("moderation actions reauthorize and ignore client target/owner/status fields", async () => {
  const boundary = "m10-moderation-test";
  const writes = [];
  globalThis[boundary] = {
    actor: { id: "admin", role: "ADMIN" },
    repository: {
      transitionPendingListing: async (input) => {
        writes.push(input);
        return { updated: true };
      },
    },
  };
  try {
    const actions = await loadActions(
      "../src/app/admin/listings/[listingId]/actions.ts",
      boundary,
    );
    const data = new FormData();
    data.set("listingId", "listing");
    data.set("reviewVersion", "1");
    data.set("ownerId", "another-owner");
    data.set("status", "PUBLISHED");
    data.set("targetStatus", "RENTED");
    data.set("currentStatus", "DRAFT");
    for (const role of ["TENANT", "OWNER", "BROKER"]) {
      globalThis[boundary].actor = { id: "non-admin", role };
      for (const action of [actions.approveListing, actions.rejectListing]) {
        assert.match((await action({}, data)).error, /permission/);
      }
    }
    assert.equal(writes.length, 0);
    globalThis[boundary].actor = { id: "admin", role: "ADMIN" };
    await actions.approveListing({}, data);
    await actions.rejectListing({}, data);
    assert.deepEqual(writes, [
      { listingId: "listing", targetStatus: "PUBLISHED", expectedVersion: 1 },
      { listingId: "listing", targetStatus: "REJECTED", expectedVersion: 1 },
    ]);
  } finally {
    delete globalThis[boundary];
  }
});
