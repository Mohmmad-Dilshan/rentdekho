import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  discoverPublicListings,
  getPublicListingById,
  parsePublicListingQuery,
} from "../src/server/listings/public-discovery.ts";

async function createPublicRepository(prisma) {
  const source = await readFile(
    new URL(
      "../src/server/listings/prisma-public-listings-repository.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const { createPrismaPublicListingRepository } = await import(
    "data:text/javascript;base64," +
      Buffer.from(
        stripTypeScriptTypes(source.replace('import "server-only";', "")),
      ).toString("base64")
  );
  return createPrismaPublicListingRepository(prisma);
}

test("M15 disposable PostgreSQL rent filtering and public discovery", async (t) => {
  const url =
    process.env.M15_TEST_DATABASE_URL || process.env.M13_TEST_DATABASE_URL;
  if (!url) {
    t.skip(
      "Set M15_TEST_DATABASE_URL or M13_TEST_DATABASE_URL to a local disposable database.",
    );
    return;
  }

  const parsed = new URL(url);
  assert.ok(
    ["postgres:", "postgresql:"].includes(parsed.protocol),
    "Use a PostgreSQL test database.",
  );
  assert.ok(
    ["localhost", "127.0.0.1"].includes(parsed.hostname),
    "Use a local disposable test database.",
  );
  assert.match(
    parsed.pathname,
    /^\/rentdekho_(?:(?:m13|m15)_test_[a-z0-9_]+|m8_dev)$/,
    "Use a named disposable M8, M13 or M15 test database.",
  );

  const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
  const unique = randomUUID().replaceAll("-", "");
  const localityIds = [];
  const propertyTypeIds = [];
  let cityId;
  let ownerId;

  try {
    const city = await prisma.city.create({
      data: {
        name: "M15 Test City " + unique,
        canonicalName: "m15 test city " + unique,
        state: "Test State",
        canonicalState: "test state",
      },
    });
    cityId = city.id;

    async function createLocality(kind) {
      const locality = await prisma.locality.create({
        data: {
          cityId,
          name: "M15 " + kind + " " + unique,
          canonicalName: "m15 " + kind.toLowerCase() + " " + unique,
        },
      });
      localityIds.push(locality.id);
      return locality;
    }

    async function createPropertyType(kind) {
      const propertyType = await prisma.propertyType.create({
        data: {
          code: ("M15" + kind + unique).toUpperCase(),
          label: "M15 " + kind + " type",
        },
      });
      propertyTypeIds.push(propertyType.id);
      return propertyType;
    }

    const mainLocality = await createLocality("Main");
    const otherLocality = await createLocality("Other");
    const hiddenLocality = await createLocality("Hidden");
    const mainType = await createPropertyType("Main");
    const otherType = await createPropertyType("Other");
    const hiddenType = await createPropertyType("Hidden");
    ownerId = (
      await prisma.user.create({
        data: {
          email: "m15-owner-" + unique + "@example.invalid",
          displayName: "M15 Test Owner",
          role: "OWNER",
        },
      })
    ).id;

    const repository = await createPublicRepository(prisma);
    const createdAt = new Date("2026-10-01T01:02:03.000Z");
    async function createListing(
      label,
      rentAmountPaise,
      status = "PUBLISHED",
      localityId = mainLocality.id,
      propertyTypeId = mainType.id,
    ) {
      return prisma.listing.create({
        data: {
          ownerId,
          localityId,
          propertyTypeId,
          title: "M15 " + label + " " + unique,
          status,
          rentAmountPaise,
          createdAt,
        },
      });
    }

    const lower = await createListing("inclusive lower", 1250050n);
    const matching = [lower];
    for (let index = 0; index < 13; index++)
      matching.push(await createListing("middle " + index, 1500000n));
    const upper = await createListing("inclusive upper", 2000000n);
    matching.push(upper);

    const below = await createListing("below range", 1250049n);
    const above = await createListing("above range", 2000001n);
    const wrongLocality = await createListing(
      "other locality",
      1500000n,
      "PUBLISHED",
      otherLocality.id,
    );
    const wrongType = await createListing(
      "other property type",
      1500000n,
      "PUBLISHED",
      mainLocality.id,
      otherType.id,
    );
    const nonpublished = [];
    for (const status of [
      "DRAFT",
      "PENDING_REVIEW",
      "REJECTED",
      "RENTED",
      "EXPIRED",
      "ARCHIVED",
    ])
      nonpublished.push(await createListing(status, 1500000n, status));
    const hiddenOnly = await createListing(
      "hidden references",
      1500000n,
      "DRAFT",
      hiddenLocality.id,
      hiddenType.id,
    );

    const query = parsePublicListingQuery({
      locality: mainLocality.id,
      propertyType: mainType.id,
      minRent: "12500.50",
      maxRent: "20000",
    });
    const first = await discoverPublicListings(query, repository);
    assert.equal(first.listings.length, 12);
    assert.ok(first.nextCursor);
    const second = await discoverPublicListings(
      { ...query, cursor: first.nextCursor },
      repository,
    );
    assert.equal(second.listings.length, 3);
    assert.equal(second.nextCursor, undefined);

    const listed = [...first.listings, ...second.listings];
    const listedIds = listed.map((listing) => listing.id);
    const expectedOrder = await prisma.listing.findMany({
      where: { id: { in: matching.map((listing) => listing.id) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    assert.deepEqual(
      listedIds,
      expectedOrder.map((listing) => listing.id),
      "Tied timestamps paginate in descending ID order without overlap.",
    );
    assert.equal(new Set(listedIds).size, 15);
    assert.ok(listedIds.includes(lower.id), "Minimum bound is inclusive.");
    assert.ok(listedIds.includes(upper.id), "Maximum bound is inclusive.");
    for (const listing of listed) {
      assert.ok(listing.rentAmountPaise >= 1250050n);
      assert.ok(listing.rentAmountPaise <= 2000000n);
      assert.equal(listing.locality.name, mainLocality.name);
      assert.equal(listing.propertyType.label, mainType.label);
      for (const privateField of [
        "owner",
        "ownerId",
        "status",
        "contactPhone",
        "contactConsentAt",
        "sessions",
        "password",
        "token",
      ])
        assert.equal(privateField in listing, false, privateField);
    }
    for (const excluded of [
      below,
      above,
      wrongLocality,
      wrongType,
      ...nonpublished,
      hiddenOnly,
    ])
      assert.equal(listedIds.includes(excluded.id), false);

    const minOnly = await discoverPublicListings(
      parsePublicListingQuery({
        locality: mainLocality.id,
        propertyType: mainType.id,
        minRent: "20000",
      }),
      repository,
    );
    assert.deepEqual(
      new Set(minOnly.listings.map((listing) => listing.id)),
      new Set([upper.id, above.id]),
    );
    const maxOnly = await discoverPublicListings(
      parsePublicListingQuery({
        locality: mainLocality.id,
        propertyType: mainType.id,
        maxRent: "12500.50",
      }),
      repository,
    );
    assert.deepEqual(
      new Set(maxOnly.listings.map((listing) => listing.id)),
      new Set([lower.id, below.id]),
    );

    const publishedDetail = await getPublicListingById(lower.id, repository);
    assert.equal(publishedDetail.id, lower.id);
    assert.equal("ownerId" in publishedDetail, false);
    assert.equal("status" in publishedDetail, false);
    assert.equal("contactConsentAt" in publishedDetail, false);
    for (const listing of [...nonpublished, hiddenOnly])
      assert.equal(await getPublicListingById(listing.id, repository), null);

    const options = await repository.findPublicDiscoveryFilters();
    for (const locality of [mainLocality, otherLocality])
      assert.ok(options.localities.some((item) => item.id === locality.id));
    for (const propertyType of [mainType, otherType])
      assert.ok(
        options.propertyTypes.some((item) => item.id === propertyType.id),
      );
    assert.equal(
      options.localities.some((item) => item.id === hiddenLocality.id),
      false,
    );
    assert.equal(
      options.propertyTypes.some((item) => item.id === hiddenType.id),
      false,
    );
  } finally {
    try {
      if (ownerId) await prisma.listing.deleteMany({ where: { ownerId } });
      if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
      if (localityIds.length)
        await prisma.locality.deleteMany({
          where: { id: { in: localityIds } },
        });
      if (cityId) await prisma.city.deleteMany({ where: { id: cityId } });
      if (propertyTypeIds.length)
        await prisma.propertyType.deleteMany({
          where: { id: { in: propertyTypeIds } },
        });
      if (ownerId)
        assert.equal(await prisma.listing.count({ where: { ownerId } }), 0);
      t.diagnostic("M15 public discovery fixtures cleaned.");
    } finally {
      await prisma.$disconnect();
    }
  }
});
