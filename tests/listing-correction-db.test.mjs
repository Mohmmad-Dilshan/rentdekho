import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { correctListing } from "../src/server/listings/correction.ts";
import { moderateListing } from "../src/server/listings/moderation.ts";
import { transitionOwnerListing } from "../src/server/listings/owner-management.ts";
import { getPublicListingById } from "../src/server/listings/public-discovery.ts";

async function loadRepository(path, name) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  return (
    await import(
      `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replace('import "server-only";', ""))).toString("base64")}`
    )
  )[name];
}

test("M13 disposable PostgreSQL corrections and exact-version moderation", async (t) => {
  const url = process.env.M13_TEST_DATABASE_URL;
  if (!url) {
    t.skip("Set M13_TEST_DATABASE_URL to a disposable database.");
    return;
  }
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /^\/rentdekho_m13_test_[a-z0-9_]+$/);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const unique = randomUUID().replaceAll("-", "");
  let cityId, localityId, propertyTypeId, ownerId, outsiderId;
  try {
    const city = await prisma.city.create({
      data: {
        name: `M13 ${unique}`,
        canonicalName: `m13 ${unique}`,
        state: "Test",
        canonicalState: "test",
      },
    });
    cityId = city.id;
    localityId = (
      await prisma.locality.create({
        data: { cityId, name: `M13 ${unique}`, canonicalName: `m13 ${unique}` },
      })
    ).id;
    propertyTypeId = (
      await prisma.propertyType.create({
        data: { code: `M13${unique}`.toUpperCase(), label: "M13 type" },
      })
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `m13-owner-${unique}@example.invalid`,
          displayName: "M13 Owner",
          role: "OWNER",
        },
      })
    ).id;
    outsiderId = (
      await prisma.user.create({
        data: {
          email: `m13-other-${unique}@example.invalid`,
          displayName: "M13 Other",
          role: "OWNER",
        },
      })
    ).id;
    const correctionRepo = (
      await loadRepository(
        "../src/server/listings/prisma-correction-repository.ts",
        "createPrismaCorrectionRepository",
      )
    )(prisma);
    const moderationRepo = (
      await loadRepository(
        "../src/server/listings/prisma-moderation-repository.ts",
        "createPrismaListingModerationRepository",
      )
    )(prisma);
    const ownerRepo = (
      await loadRepository(
        "../src/server/listings/prisma-owner-listings-repository.ts",
        "createPrismaOwnerListingRepository",
      )
    )(prisma);
    const publicRepo = (
      await loadRepository(
        "../src/server/listings/prisma-public-listings-repository.ts",
        "createPrismaPublicListingRepository",
      )
    )(prisma);
    const owner = { id: ownerId, role: "OWNER" };
    const admin = { id: "admin", role: "ADMIN" };
    const input = (contactPhone = "9876543210", contactConsent = "on") => ({
      cityId,
      localityId,
      propertyTypeId,
      title: `Corrected ${unique}`,
      rent: "13000.50",
      securityDeposit: "0",
      contactPhone,
      contactConsent,
      amenityIds: [],
    });
    const create = (status = "PUBLISHED") =>
      prisma.listing.create({
        data: {
          ownerId,
          localityId,
          propertyTypeId,
          title: `Original ${unique}`,
          rentAmountPaise: 1250000n,
          status,
          contactPhone: "+919876543210",
          contactConsentAt: new Date(),
        },
      });

    await t.test(
      "published correction retains identity and immediately hides every public surface",
      async () => {
        const row = await create();
        assert.equal(
          (await getPublicListingById(row.id, publicRepo)).contactPhone,
          "+919876543210",
        );
        assert.deepEqual(
          await correctListing(
            owner,
            row.id,
            1,
            input("9123456780", "on"),
            correctionRepo,
            "PUBLISHED",
          ),
          { outcome: "corrected" },
        );
        const corrected = await prisma.listing.findUnique({
          where: { id: row.id },
        });
        assert.equal(corrected.id, row.id);
        assert.equal(corrected.ownerId, ownerId);
        assert.equal(corrected.status, "PENDING_REVIEW");
        assert.equal(corrected.reviewVersion, 2);
        assert.equal(corrected.contactPhone, "+919123456780");
        assert.equal(await getPublicListingById(row.id, publicRepo), null);
        assert.equal(
          (await publicRepo.findPublishedListings({ take: 13 })).some(
            (item) => item.id === row.id,
          ),
          false,
        );
        assert.equal(
          (await publicRepo.findPublishedSitemapEntries()).some(
            (item) => item.id === row.id,
          ),
          false,
        );
        assert.deepEqual(
          await moderateListing(admin, row.id, "APPROVE", moderationRepo, 1),
          { outcome: "not-pending" },
        );
        assert.deepEqual(
          await moderateListing(admin, row.id, "REJECT", moderationRepo, 1),
          { outcome: "not-pending" },
        );
        assert.equal(
          (await prisma.listing.findUnique({ where: { id: row.id } })).status,
          "PENDING_REVIEW",
        );
        assert.deepEqual(
          await moderateListing(admin, row.id, "APPROVE", moderationRepo, 2),
          { outcome: "moderated", status: "PUBLISHED" },
        );
        assert.equal(
          (await getPublicListingById(row.id, publicRepo)).contactPhone,
          "+919123456780",
        );
      },
    );

    await t.test(
      "pending correction replaces review content once; stale correction and moderation fail",
      async () => {
        const row = await create("PENDING_REVIEW");
        assert.deepEqual(
          await correctListing(
            owner,
            row.id,
            1,
            input(),
            correctionRepo,
            "PENDING_REVIEW",
          ),
          { outcome: "corrected" },
        );
        assert.equal(
          (await prisma.listing.findUnique({ where: { id: row.id } }))
            .reviewVersion,
          2,
        );
        assert.deepEqual(
          await correctListing(
            owner,
            row.id,
            1,
            input(),
            correctionRepo,
            "PENDING_REVIEW",
          ),
          { outcome: "unavailable" },
        );
        assert.deepEqual(
          await moderateListing(admin, row.id, "REJECT", moderationRepo, 1),
          { outcome: "not-pending" },
        );
        assert.deepEqual(
          await moderateListing(admin, row.id, "REJECT", moderationRepo, 2),
          { outcome: "moderated", status: "REJECTED" },
        );
        assert.deepEqual(
          await correctListing(
            owner,
            row.id,
            2,
            input(),
            correctionRepo,
            "PENDING_REVIEW",
          ),
          { outcome: "unavailable" },
        );
      },
    );

    await t.test(
      "old pending edit cannot depublish an ADMIN-approved version",
      async () => {
        const row = await create("PENDING_REVIEW");
        assert.deepEqual(
          await moderateListing(admin, row.id, "APPROVE", moderationRepo, 1),
          { outcome: "moderated", status: "PUBLISHED" },
        );
        assert.deepEqual(
          await correctListing(
            owner,
            row.id,
            1,
            input(),
            correctionRepo,
            "PENDING_REVIEW",
          ),
          { outcome: "unavailable" },
        );
        const current = await prisma.listing.findUnique({
          where: { id: row.id },
        });
        assert.equal(current.status, "PUBLISHED");
        assert.equal(current.title, row.title);
      },
    );

    await t.test(
      "simultaneous correction competes safely with ADMIN and terminal actions",
      async () => {
        for (const competitor of [
          "APPROVE",
          "REJECT",
          "MARK_RENTED",
          "WITHDRAW",
        ]) {
          const source =
            competitor === "MARK_RENTED" ? "PUBLISHED" : "PENDING_REVIEW";
          const row = await create(source);
          const correction = correctListing(
            owner,
            row.id,
            1,
            input(),
            correctionRepo,
            source,
          );
          const other =
            competitor === "APPROVE" || competitor === "REJECT"
              ? moderateListing(admin, row.id, competitor, moderationRepo, 1)
              : transitionOwnerListing(
                  owner,
                  row.id,
                  competitor,
                  source,
                  ownerRepo,
                  1,
                );
          const [correctionResult, otherResult] = await Promise.all([
            correction,
            other,
          ]);
          const corrected = correctionResult.outcome === "corrected";
          const decided =
            otherResult.outcome === "moderated" ||
            otherResult.outcome === "updated";
          assert.equal(Number(corrected) + Number(decided), 1, competitor);
          const current = await prisma.listing.findUnique({
            where: { id: row.id },
          });
          assert.equal(current.reviewVersion, corrected ? 2 : 1);
          if (corrected) assert.equal(current.status, "PENDING_REVIEW");
        }
      },
    );

    await t.test(
      "other owner, wrong role and terminal states cannot correct",
      async () => {
        const row = await create();
        assert.deepEqual(
          await correctListing(
            { id: outsiderId, role: "OWNER" },
            row.id,
            1,
            input(),
            correctionRepo,
            "PUBLISHED",
          ),
          { outcome: "unavailable" },
        );
        for (const role of ["TENANT", "ADMIN"])
          await assert.rejects(
            correctListing(
              { id: ownerId, role },
              row.id,
              1,
              input(),
              correctionRepo,
              "PUBLISHED",
            ),
          );
        assert.deepEqual(
          await correctListing(
            owner,
            "cm13nonexistent000000000001",
            1,
            input(),
            correctionRepo,
            "PUBLISHED",
          ),
          { outcome: "unavailable" },
        );
        for (const status of [
          "RENTED",
          "ARCHIVED",
          "REJECTED",
          "DRAFT",
          "EXPIRED",
        ]) {
          await prisma.listing.update({
            where: { id: row.id },
            data: { status },
          });
          assert.deepEqual(
            await correctListing(
              owner,
              row.id,
              1,
              input(),
              correctionRepo,
              "PUBLISHED",
            ),
            { outcome: "unavailable" },
          );
        }
      },
    );

    await t.test(
      "changed contact without consent stays private after approval",
      async () => {
        const row = await create();
        await correctListing(
          owner,
          row.id,
          1,
          input("9123456780", ""),
          correctionRepo,
          "PUBLISHED",
        );
        assert.equal(await getPublicListingById(row.id, publicRepo), null);
        await moderateListing(admin, row.id, "APPROVE", moderationRepo, 2);
        assert.equal(
          (await getPublicListingById(row.id, publicRepo)).contactPhone,
          null,
        );
      },
    );

    await t.test(
      "terminal owner actions cannot overwrite a newer correction",
      async () => {
        const row = await create();
        await correctListing(
          owner,
          row.id,
          1,
          input(),
          correctionRepo,
          "PUBLISHED",
        );
        assert.deepEqual(
          await transitionOwnerListing(
            owner,
            row.id,
            "WITHDRAW",
            "PUBLISHED",
            ownerRepo,
            1,
          ),
          { outcome: "unavailable" },
        );
        assert.deepEqual(
          await transitionOwnerListing(
            owner,
            row.id,
            "MARK_RENTED",
            "PUBLISHED",
            ownerRepo,
            1,
          ),
          { outcome: "unavailable" },
        );
        assert.deepEqual(
          await transitionOwnerListing(
            owner,
            row.id,
            "WITHDRAW",
            "PENDING_REVIEW",
            ownerRepo,
            1,
          ),
          { outcome: "unavailable" },
        );
        assert.equal(
          (await prisma.listing.findUnique({ where: { id: row.id } })).status,
          "PENDING_REVIEW",
        );
        assert.deepEqual(
          await transitionOwnerListing(
            owner,
            row.id,
            "WITHDRAW",
            "PENDING_REVIEW",
            ownerRepo,
            2,
          ),
          { outcome: "updated" },
        );
      },
    );
  } finally {
    try {
      await prisma.listing.deleteMany({
        where: { ownerId: { in: [ownerId, outsiderId].filter(Boolean) } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [ownerId, outsiderId].filter(Boolean) } },
      });
      if (localityId)
        await prisma.locality.delete({ where: { id: localityId } });
      if (cityId) await prisma.city.delete({ where: { id: cityId } });
      if (propertyTypeId)
        await prisma.propertyType.delete({ where: { id: propertyTypeId } });
      assert.equal(await prisma.listing.count({ where: { ownerId } }), 0);
      t.diagnostic("M13 correction fixtures cleaned.");
    } finally {
      await prisma.$disconnect();
    }
  }
});
