import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  getOwnerListing,
  transitionOwnerListing,
} from "../src/server/listings/owner-management.ts";
import { getPublicListingById } from "../src/server/listings/public-discovery.ts";

const loadRepository = async (path, exportName) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const loadedRepository = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replace('import "server-only";', ""))).toString("base64")}`
  );
  return loadedRepository[exportName];
};

if (!process.env.DATABASE_URL && existsSync(".env"))
  process.loadEnvFile(".env");

test("PostgreSQL owner transitions, races, ownership and public visibility", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not configured");
    return;
  }
  const createOwnerRepository = await loadRepository(
    "../src/server/listings/prisma-owner-listings-repository.ts",
    "createPrismaOwnerListingRepository",
  );
  const createPublicRepository = await loadRepository(
    "../src/server/listings/prisma-public-listings-repository.ts",
    "createPrismaPublicListingRepository",
  );
  const prisma = new PrismaClient();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  let cityId, localityId, propertyTypeId, ownerId, otherOwnerId;
  try {
    const city = await prisma.city.create({
      data: {
        name: `M9 Test City ${suffix}`,
        canonicalName: `m9 test city ${suffix}`,
        state: "Rajasthan",
        canonicalState: "rajasthan",
      },
    });
    cityId = city.id;
    const locality = await prisma.locality.create({
      data: {
        cityId,
        name: `M9 Test Locality ${suffix}`,
        canonicalName: `m9 test locality ${suffix}`,
      },
    });
    localityId = locality.id;
    const propertyType = await prisma.propertyType.create({
      data: {
        code: `M9TEST${suffix}`.toUpperCase(),
        label: "M9 test home",
      },
    });
    propertyTypeId = propertyType.id;
    const owner = await prisma.user.create({
      data: {
        email: `m9-owner-${suffix}@example.invalid`,
        displayName: "M9 Test Owner",
        role: "OWNER",
      },
    });
    ownerId = owner.id;
    const otherOwner = await prisma.user.create({
      data: {
        email: `m9-other-${suffix}@example.invalid`,
        displayName: "M9 Other Owner",
        role: "OWNER",
      },
    });
    otherOwnerId = otherOwner.id;

    const createListing = (status) =>
      prisma.listing.create({
        data: {
          ownerId,
          localityId,
          propertyTypeId,
          title: `M9 Test ${status} ${suffix}`,
          status,
          rentAmountPaise: 1000000n,
        },
      });
    const actor = { id: ownerId, role: "OWNER" };
    const outsider = { id: otherOwnerId, role: "OWNER" };
    const own = createOwnerRepository(prisma);
    const publicRepository = createPublicRepository(prisma);
    const published = await createListing("PUBLISHED");
    assert.equal(
      (await getOwnerListing(actor, published.id, own)).id,
      published.id,
    );
    assert.equal(await getOwnerListing(outsider, published.id, own), null);
    assert.deepEqual(
      await transitionOwnerListing(
        outsider,
        published.id,
        "WITHDRAW",
        "PUBLISHED",
        own,
      ),
      { outcome: "unavailable" },
    );
    assert.ok(await getPublicListingById(published.id, publicRepository));
    const [first, second] = await Promise.all([
      transitionOwnerListing(
        actor,
        published.id,
        "MARK_RENTED",
        "PUBLISHED",
        own,
      ),
      transitionOwnerListing(
        actor,
        published.id,
        "MARK_RENTED",
        "PUBLISHED",
        own,
      ),
    ]);
    assert.deepEqual([first.outcome, second.outcome].sort(), [
      "unavailable",
      "updated",
    ]);
    assert.equal(
      await getPublicListingById(published.id, publicRepository),
      null,
    );
    assert.equal(
      (await publicRepository.findPublishedSitemapEntries()).some(
        (item) => item.id === published.id,
      ),
      false,
    );

    const withdrawn = await createListing("PUBLISHED");
    assert.deepEqual(
      await transitionOwnerListing(
        actor,
        withdrawn.id,
        "WITHDRAW",
        "PUBLISHED",
        own,
      ),
      { outcome: "updated" },
    );
    assert.equal(
      await getPublicListingById(withdrawn.id, publicRepository),
      null,
    );
    assert.deepEqual(
      await publicRepository.findPublishedListings({ localityId, take: 13 }),
      [],
    );
    assert.equal(
      (await publicRepository.findPublishedSitemapEntries()).some(
        (item) => item.id === withdrawn.id,
      ),
      false,
    );

    const pending = await createListing("PENDING_REVIEW");
    const [ownerOutcome, adminOutcome] = await Promise.all([
      transitionOwnerListing(
        actor,
        pending.id,
        "WITHDRAW",
        "PENDING_REVIEW",
        own,
      ),
      prisma.listing.updateMany({
        where: { id: pending.id, status: "PENDING_REVIEW" },
        data: { status: "PUBLISHED" },
      }),
    ]);
    assert.equal(
      Number(ownerOutcome.outcome === "updated") + adminOutcome.count,
      1,
    );
    const final = await prisma.listing.findUnique({
      where: { id: pending.id },
      select: { status: true },
    });
    assert.ok(["ARCHIVED", "PUBLISHED"].includes(final.status));
    assert.deepEqual(
      await transitionOwnerListing(
        actor,
        pending.id,
        "WITHDRAW",
        "PENDING_REVIEW",
        own,
      ),
      { outcome: "unavailable" },
    );

    for (const status of [
      "DRAFT",
      "REJECTED",
      "RENTED",
      "EXPIRED",
      "ARCHIVED",
    ]) {
      const listing = await createListing(status);
      for (const action of ["MARK_RENTED", "WITHDRAW"]) {
        assert.deepEqual(
          await transitionOwnerListing(
            actor,
            listing.id,
            action,
            "PUBLISHED",
            own,
          ),
          { outcome: "unavailable" },
        );
      }
    }
  } finally {
    if (ownerId) await prisma.listing.deleteMany({ where: { ownerId } });
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
    if (otherOwnerId) await prisma.user.delete({ where: { id: otherOwnerId } });
    if (localityId) await prisma.locality.delete({ where: { id: localityId } });
    if (cityId) await prisma.city.delete({ where: { id: cityId } });
    if (propertyTypeId)
      await prisma.propertyType.delete({ where: { id: propertyTypeId } });
    await prisma.$disconnect();
  }
});
