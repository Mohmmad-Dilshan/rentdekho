import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import {
  createListingSubmission,
  ListingSubmissionValidationError,
  normalizeIndianContactPhone,
} from "../src/server/listings/submission.ts";
import { getPublicListingById } from "../src/server/listings/public-discovery.ts";

const source = await readFile(
  new URL(
    "../src/server/listings/prisma-public-listings-repository.ts",
    import.meta.url,
  ),
  "utf8",
);
const { createPrismaPublicListingRepository } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replace('import "server-only";', ""))).toString("base64")}`
);

const input = {
  cityId: "city",
  localityId: "locality",
  propertyTypeId: "type",
  title: "Home",
  rent: "12500",
};
function repository() {
  const writes = [];
  return {
    writes,
    transaction: async (operation) =>
      operation({
        findReferenceData: async () => ({
          localityCityId: "city",
          propertyTypeExists: true,
          foundAmenityIds: [],
        }),
        createListing: async (listing) => {
          writes.push(listing);
          return { id: "listing" };
        },
      }),
  };
}
const actor = (role = "OWNER") => ({
  id: `session-${role.toLowerCase()}`,
  role,
});

test("Indian mobile formats normalize to one stored form", () => {
  for (const value of ["9876543210", "+919876543210", " 9876543210 "])
    assert.equal(normalizeIndianContactPhone(value), "+919876543210");
  for (const value of [
    "",
    "1234567890",
    "5876543210",
    "919876543210",
    "+91987654321",
    "98765-43210",
    "+1 9876543210",
    "98765432100",
  ])
    assert.equal(normalizeIndianContactPhone(value), null, value);
});

test("OWNER and BROKER submission stores only authenticated ownership, pending status and explicit consent", async () => {
  for (const role of ["OWNER", "BROKER"]) {
    const repo = repository();
    await createListingSubmission(
      actor(role),
      {
        ...input,
        contactPhone: "9876543210",
        contactConsent: "on",
        ownerId: "attacker",
        status: "PUBLISHED",
        contactConsentAt: new Date("2000-01-01"),
      },
      repo,
    );
    assert.equal(repo.writes.length, 1);
    assert.equal(repo.writes[0].ownerId, actor(role).id);
    assert.equal(repo.writes[0].status, "PENDING_REVIEW");
    assert.equal(repo.writes[0].contactPhone, "+919876543210");
    assert.ok(repo.writes[0].contactConsentAt instanceof Date);
    assert.ok(repo.writes[0].contactConsentAt.getFullYear() > 2000);
  }
});

test("invalid contact and consent combinations never write", async () => {
  for (const [contactPhone, contactConsent] of [
    ["not-a-number", "on"],
    ["", "on"],
    ["+91987654321", "on"],
    ["9876543210", "yes"],
    ["bad", ""],
  ]) {
    const repo = repository();
    await assert.rejects(
      createListingSubmission(
        actor(),
        { ...input, contactPhone, contactConsent },
        repo,
      ),
      ListingSubmissionValidationError,
    );
    assert.equal(repo.writes.length, 0);
  }
});

test("valid contact without consent is private; absent contact remains null", async () => {
  for (const value of ["9876543210", ""]) {
    const repo = repository();
    await createListingSubmission(
      actor(),
      { ...input, contactPhone: value, contactConsent: "" },
      repo,
    );
    assert.equal(repo.writes[0].contactPhone, value ? "+919876543210" : null);
    assert.equal(repo.writes[0].contactConsentAt, null);
  }
});

test("anonymous and TENANT cannot submit a number or consent", async () => {
  for (const subject of [null, actor("TENANT")]) {
    const repo = repository();
    await assert.rejects(
      createListingSubmission(
        subject,
        { ...input, contactPhone: "9876543210", contactConsent: "on" },
        repo,
      ),
    );
    assert.equal(repo.writes.length, 0);
  }
});

test("published detail alone projects consented valid contact, never owner or consent internals", async () => {
  const row = {
    id: "c123456789012345678901234",
    status: "PUBLISHED",
    contactPhone: "+919876543210",
    contactConsentAt: new Date(),
    ownerId: "secret-owner",
    owner: { email: "private@example.invalid" },
    amenities: [],
    locality: { name: "Test", city: { name: "Test" } },
    propertyType: { label: "Home" },
  };
  const calls = [];
  const prisma = {
    listing: {
      findFirst: async (args) => {
        calls.push(args);
        if (row.status !== args.where.status || row.id !== args.where.id)
          return null;
        return Object.fromEntries(
          Object.keys(args.select).map((key) => [key, row[key]]),
        );
      },
      findMany: async (args) => {
        calls.push(args);
        return [];
      },
    },
  };
  const repo = createPrismaPublicListingRepository(prisma);
  for (const status of [
    "DRAFT",
    "PENDING_REVIEW",
    "REJECTED",
    "RENTED",
    "EXPIRED",
    "ARCHIVED",
  ]) {
    row.status = status;
    assert.equal(await getPublicListingById(row.id, repo), null);
  }
  row.status = "PUBLISHED";
  assert.equal(
    (await getPublicListingById(row.id, repo)).contactPhone,
    "+919876543210",
  );
  row.contactConsentAt = null;
  assert.equal((await getPublicListingById(row.id, repo)).contactPhone, null);
  row.contactConsentAt = new Date();
  row.contactPhone = null;
  assert.equal((await getPublicListingById(row.id, repo)).contactPhone, null);
  row.contactPhone = "untrusted";
  assert.equal((await getPublicListingById(row.id, repo)).contactPhone, null);
  row.contactPhone = "+919876543210";
  const detail = await getPublicListingById(row.id, repo);
  for (const key of [
    "ownerId",
    "owner",
    "email",
    "contactConsentAt",
    "status",
    "sessions",
    "password",
  ])
    assert.equal(key in detail, false, key);
  assert.equal(calls.at(-1).where.status, "PUBLISHED");
  await repo.findPublishedListings({ take: 13 });
  for (const key of ["contactPhone", "contactConsentAt", "owner", "ownerId"])
    assert.equal(key in calls.at(-1).select, false, key);
  await repo.findPublishedSitemapEntries();
  assert.deepEqual(calls.at(-1).select, { id: true, updatedAt: true });
});
