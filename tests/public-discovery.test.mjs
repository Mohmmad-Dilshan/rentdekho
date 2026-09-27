import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import {
  decodePublicCursor,
  encodePublicCursor,
  parsePublicListingQuery,
  discoverPublicListings,
  getPublicListingById,
} from "../src/server/listings/public-discovery.ts";
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
const id = (n) => `c${String(n).padStart(24, "0")}`;
const rows = Array.from({ length: 15 }, (_, n) => ({
  id: id(30 - n),
  status: "PUBLISHED",
  createdAt: new Date("2026-09-01"),
  updatedAt: new Date("2026-09-02"),
  title: "Test fixture",
  localityId: id(90),
  propertyTypeId: id(91),
  amenities: [],
  ownerId: "private",
  owner: { email: "private" },
}));
for (const status of [
  "DRAFT",
  "PENDING_REVIEW",
  "REJECTED",
  "RENTED",
  "EXPIRED",
  "ARCHIVED",
])
  rows.push({ ...rows[0], id: id(100 + rows.length), status });
function matches(row, where) {
  return Object.entries(where).every(([key, value]) =>
    key === "OR"
      ? value.some((w) => matches(row, w))
      : value && typeof value === "object" && !(value instanceof Date)
        ? row[key] < value.lt
        : row[key] instanceof Date
          ? +row[key] === +value
          : row[key] === value,
  );
}
function setup() {
  const calls = [];
  const query = (args) => {
    calls.push(args);
    return rows
      .filter((row) => matches(row, args.where))
      .slice(0, args.take ?? rows.length)
      .map((row) =>
        Object.fromEntries(
          Object.keys(args.select).map((key) => [key, row[key]]),
        ),
      );
  };
  return {
    calls,
    repository: createPrismaPublicListingRepository({
      listing: {
        findMany: async (args) => query(args),
        findFirst: async (args) => query(args)[0] ?? null,
      },
    }),
  };
}
test("published discovery is anonymous, bounded, and strips private fields", async () => {
  const { repository, calls } = setup();
  const result = await discoverPublicListings({}, repository);
  assert.equal(result.listings.length, 12);
  assert.equal(calls[0].take, 13);
  assert.equal(calls[0].where.status, "PUBLISHED");
  for (const row of result.listings)
    for (const key of [
      "owner",
      "ownerId",
      "status",
      "sessions",
      "password",
      "token",
    ])
      assert.equal(key in row, false);
  assert.deepEqual(calls[0].orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
});
for (const status of [
  "DRAFT",
  "PENDING_REVIEW",
  "REJECTED",
  "RENTED",
  "EXPIRED",
  "ARCHIVED",
])
  test(`${status} is absent from discovery, detail and sitemap`, async () => {
    const { repository } = setup();
    const row = rows.find((row) => row.status === status);
    assert.equal(await getPublicListingById(row.id, repository), null);
    assert.equal(
      (await discoverPublicListings({}, repository)).listings.some(
        (r) => r.id === row.id,
      ),
      false,
    );
    assert.equal(
      (await repository.findPublishedSitemapEntries()).some(
        (r) => r.id === row.id,
      ),
      false,
    );
  });
test("published and nonexistent detail", async () => {
  const { repository } = setup();
  assert.equal((await getPublicListingById(id(30), repository)).id, id(30));
  assert.equal(await getPublicListingById(id(999), repository), null);
});
test("locality and property type constrain queries", async () => {
  for (const key of ["localityId", "propertyTypeId"]) {
    const { repository } = setup();
    assert.equal(
      (await discoverPublicListings({ [key]: id(999) }, repository)).listings
        .length,
      0,
    );
    assert.equal(
      (
        await discoverPublicListings(
          { [key]: key === "localityId" ? id(90) : id(91) },
          repository,
        )
      ).listings.length,
      12,
    );
  }
});
test("invalid, duplicate and unknown parameters normalize safely", () => {
  assert.deepEqual(
    parsePublicListingQuery({
      locality: "x".repeat(1000),
      propertyType: [id(91)],
      cursor: "bad",
      status: "DRAFT",
      orderBy: "owner",
    }),
    { localityId: undefined, propertyTypeId: undefined, cursor: undefined },
  );
  assert.equal(
    parsePublicListingQuery({ locality: ` ${id(90)} ` }).localityId,
    id(90),
  );
});
test("cursor validates date, ID, shape and length", () => {
  for (const value of [
    "%",
    "a".repeat(257),
    Buffer.from(JSON.stringify(["bad", id(1)])).toString("base64url"),
    Buffer.from(JSON.stringify(["2026-09-01T00:00:00.000Z", {}])).toString(
      "base64url",
    ),
  ])
    assert.equal(decodePublicCursor(value), undefined);
  assert.deepEqual(decodePublicCursor(encodePublicCursor(rows[0])), {
    id: rows[0].id,
    createdAt: rows[0].createdAt,
  });
});
test("next cursor handles tied timestamps without overlap and stops at last page", async () => {
  const { repository } = setup();
  const first = await discoverPublicListings({}, repository);
  const second = await discoverPublicListings(
    { cursor: first.nextCursor },
    repository,
  );
  assert.equal(second.listings.length, 3);
  assert.equal(second.nextCursor, undefined);
  assert.equal(
    new Set([...first.listings, ...second.listings].map((r) => r.id)).size,
    15,
  );
});
test("metadata route uses the same published-only detail boundary before emitting fields", async () => {
  const page = await readFile(
    new URL("../src/app/rentals/[listingId]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /getPublicListingById/);
  assert.match(
    page,
    /const listing = await findListing\(\(await params\).listingId\);\s+if \(!listing\) notFound\(\);/,
  );
});
test("sitemap route uses published-only repository and no guessed origin", async () => {
  const page = await readFile(
    new URL("../src/app/sitemap.ts", import.meta.url),
    "utf8",
  );
  assert.match(page, /findPublishedSitemapEntries/);
  assert.match(page, /process.env.BETTER_AUTH_URL/);
  const { repository, calls } = setup();
  const entries = await repository.findPublishedSitemapEntries();
  assert.ok(entries.length);
  assert.deepEqual(calls[0].select, { id: true, updatedAt: true });
});
