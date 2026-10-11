import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import {
  decodePublicCursor,
  encodePublicCursor,
  parsePublicListingQuery,
  parsePublicRentBound,
  parsePublicFurnishingStatus,
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
  rentAmountPaise: BigInt(1_250_000 + n * 50),
  furnishingStatus: ["UNFURNISHED", "SEMI_FURNISHED", "FURNISHED"][n % 3],
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
        ? Object.entries(value).every(([operator, bound]) => {
            if (operator === "lt") return row[key] < bound;
            if (operator === "gte") return row[key] >= bound;
            if (operator === "lte") return row[key] <= bound;
            throw new Error(`Unexpected test predicate ${operator}`);
          })
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
test("furnishing accepts only the existing exact enum values", () => {
  assert.equal(parsePublicFurnishingStatus(undefined), undefined);
  assert.equal(parsePublicFurnishingStatus(""), undefined);
  for (const value of ["UNFURNISHED", "SEMI_FURNISHED", "FURNISHED"]) {
    assert.equal(parsePublicFurnishingStatus(value), value);
    assert.equal(
      parsePublicListingQuery({ furnishingStatus: value }).furnishingStatus,
      value,
    );
  }
});
test("invalid or duplicate furnishing never broadens discovery", async () => {
  for (const value of [
    "FURNISHED ",
    "furnished",
    "UNKNOWN",
    "PUBLISHED",
    " ",
    ["FURNISHED", "UNFURNISHED"],
    ["FURNISHED", "FURNISHED"],
  ]) {
    assert.equal(parsePublicFurnishingStatus(value), null);
    const query = parsePublicListingQuery({ furnishingStatus: value });
    assert.equal(query.invalidFurnishing, true);
    const { repository, calls } = setup();
    assert.deepEqual(await discoverPublicListings(query, repository), {
      listings: [],
      nextCursor: undefined,
    });
    assert.equal(calls.length, 0);
  }
  const { repository, calls } = setup();
  await discoverPublicListings({ furnishingStatus: "UNKNOWN" }, repository);
  assert.equal(calls.length, 0);
});
test("furnishing combines with locality, property type and rent bounds", async () => {
  for (const furnishingStatus of [
    "UNFURNISHED",
    "SEMI_FURNISHED",
    "FURNISHED",
  ]) {
    const { repository, calls } = setup();
    const query = parsePublicListingQuery({
      locality: id(90),
      propertyType: id(91),
      minRent: "12500",
      maxRent: "12507",
      furnishingStatus,
    });
    const result = await discoverPublicListings(query, repository);
    assert.equal(result.listings.length, 5);
    assert.ok(
      result.listings.every((row) => row.furnishingStatus === furnishingStatus),
    );
    assert.equal(calls[0].where.furnishingStatus, furnishingStatus);
    assert.equal(calls[0].where.status, "PUBLISHED");
    assert.equal(calls[0].where.localityId, id(90));
    assert.equal(calls[0].where.propertyTypeId, id(91));
    assert.deepEqual(calls[0].where.rentAmountPaise, {
      gte: 1_250_000n,
      lte: 1_250_700n,
    });
  }
});
test("rent bounds convert exact rupee strings to paise", () => {
  assert.equal(parsePublicRentBound(undefined), undefined);
  assert.equal(parsePublicRentBound(""), undefined);
  assert.equal(parsePublicRentBound("0.01"), 1n);
  assert.equal(parsePublicRentBound("12500"), 1_250_000n);
  assert.equal(parsePublicRentBound("12500.5"), 1_250_050n);
  assert.equal(parsePublicRentBound("12500.50"), 1_250_050n);
  assert.equal(parsePublicRentBound("10000000.00"), 1_000_000_000n);
});
test("invalid and duplicate rent bounds never silently broaden discovery", async () => {
  for (const value of [
    "0",
    "0.00",
    "000.00",
    "-1",
    "+1",
    "1e3",
    " 1",
    "1 ",
    "1\t",
    ".5",
    "1.",
    "1.001",
    "1,000",
    "10000000.01",
    "9".repeat(65),
    ["1", "2"],
  ]) {
    assert.equal(parsePublicRentBound(value), null);
    for (const parameter of ["minRent", "maxRent"]) {
      const query = parsePublicListingQuery({ [parameter]: value });
      assert.equal(query.invalidRent, true);
      const { repository, calls } = setup();
      assert.deepEqual(await discoverPublicListings(query, repository), {
        listings: [],
        nextCursor: undefined,
      });
      assert.equal(calls.length, 0);
    }
  }
  const inverted = parsePublicListingQuery({
    minRent: "12500.51",
    maxRent: "12500.50",
  });
  assert.equal(inverted.invalidRent, true);
  const { repository, calls } = setup();
  await discoverPublicListings(inverted, repository);
  assert.equal(calls.length, 0);
  assert.equal(
    parsePublicListingQuery({ maxRent: ["1", "1"] }).invalidRent,
    true,
  );
});
test("inclusive rent bounds combine with locality and property type", async () => {
  const { repository, calls } = setup();
  const query = parsePublicListingQuery({
    locality: id(90),
    propertyType: id(91),
    minRent: "12500.50",
    maxRent: "12501",
  });
  assert.equal(query.invalidRent, undefined);
  const result = await discoverPublicListings(query, repository);
  assert.deepEqual(
    result.listings.map((row) => row.id),
    [id(29), id(28)],
  );
  assert.deepEqual(calls[0].where.rentAmountPaise, {
    gte: 1_250_050n,
    lte: 1_250_100n,
  });
  assert.equal(calls[0].where.status, "PUBLISHED");
  assert.equal(calls[0].where.localityId, id(90));
  assert.equal(calls[0].where.propertyTypeId, id(91));

  const equal = await discoverPublicListings(
    parsePublicListingQuery({ minRent: "12500.50", maxRent: "12500.50" }),
    repository,
  );
  assert.deepEqual(
    equal.listings.map((row) => row.id),
    [id(29)],
  );
  const minimumOnly = await discoverPublicListings(
    parsePublicListingQuery({ minRent: "12507" }),
    repository,
  );
  assert.deepEqual(
    minimumOnly.listings.map((row) => row.id),
    [id(16)],
  );
  const maximumOnly = await discoverPublicListings(
    parsePublicListingQuery({ maxRent: "12500" }),
    repository,
  );
  assert.deepEqual(
    maximumOnly.listings.map((row) => row.id),
    [id(30)],
  );
});
test("budget and reference filters continue across cursor pages without gaps", async () => {
  const { repository, calls } = setup();
  const filters = {
    locality: id(90),
    propertyType: id(91),
    minRent: "12500",
    maxRent: "12507.00",
  };
  const first = await discoverPublicListings(
    parsePublicListingQuery(filters),
    repository,
  );
  assert.ok(first.nextCursor);
  const second = await discoverPublicListings(
    parsePublicListingQuery({ ...filters, cursor: first.nextCursor }),
    repository,
  );
  assert.equal(first.listings.length, 12);
  assert.equal(second.listings.length, 3);
  assert.equal(second.nextCursor, undefined);
  assert.equal(
    new Set([...first.listings, ...second.listings].map((row) => row.id)).size,
    15,
  );
  for (const call of calls) {
    assert.equal(call.where.status, "PUBLISHED");
    assert.equal(call.where.localityId, id(90));
    assert.equal(call.where.propertyTypeId, id(91));
    assert.deepEqual(call.where.rentAmountPaise, {
      gte: 1_250_000n,
      lte: 1_250_700n,
    });
  }
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
