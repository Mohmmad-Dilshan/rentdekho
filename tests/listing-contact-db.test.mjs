import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createListingSubmission } from "../src/server/listings/submission.ts";
import { getPublicListingById } from "../src/server/listings/public-discovery.ts";
import { transitionOwnerListing } from "../src/server/listings/owner-management.ts";

async function loadRepository(path, name) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const loadedRepository = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replace('import "server-only";', ""))).toString("base64")}`
  );
  return loadedRepository[name];
}

test("M12 disposable PostgreSQL submission, privacy, lifecycle and migration compatibility", async (t) => {
  const url = process.env.M12_TEST_DATABASE_URL;
  if (!url) {
    t.skip("Set M12_TEST_DATABASE_URL to a disposable database.");
    return;
  }
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /^\/rentdekho_m12_test_[a-z0-9_]+$/);
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
  const unique = randomUUID().replaceAll("-", "");
  const email = (part) => `m12-${part}-${unique}@example.invalid`;
  let cityId, localityId, propertyTypeId, ownerId, brokerId, outsiderId;
  try {
    const city = await prisma.city.create({
      data: {
        name: `M12 Test City ${unique}`,
        canonicalName: `m12 test city ${unique}`,
        state: "Test State",
        canonicalState: "test state",
      },
    });
    cityId = city.id;
    const locality = await prisma.locality.create({
      data: {
        cityId,
        name: `M12 Test Locality ${unique}`,
        canonicalName: `m12 test locality ${unique}`,
      },
    });
    localityId = locality.id;
    const type = await prisma.propertyType.create({
      data: { code: `M12${unique}`.toUpperCase(), label: "M12 test type" },
    });
    propertyTypeId = type.id;
    const owner = await prisma.user.create({
      data: { email: email("owner"), displayName: "M12 owner", role: "OWNER" },
    });
    ownerId = owner.id;
    const broker = await prisma.user.create({
      data: {
        email: email("broker"),
        displayName: "M12 broker",
        role: "BROKER",
      },
    });
    brokerId = broker.id;
    const outsider = await prisma.user.create({
      data: {
        email: email("outsider"),
        displayName: "M12 outsider",
        role: "OWNER",
      },
    });
    outsiderId = outsider.id;
    const makeSubmission = await loadRepository(
      "../src/server/listings/prisma-submission-repository.ts",
      "createPrismaListingSubmissionRepository",
    );
    const makePublic = await loadRepository(
      "../src/server/listings/prisma-public-listings-repository.ts",
      "createPrismaPublicListingRepository",
    );
    const makeOwner = await loadRepository(
      "../src/server/listings/prisma-owner-listings-repository.ts",
      "createPrismaOwnerListingRepository",
    );
    const publicRepo = makePublic(prisma);
    const ownRepo = makeOwner(prisma);
    const submit = (actor, contactPhone, contactConsent) =>
      createListingSubmission(
        actor,
        {
          cityId,
          localityId,
          propertyTypeId,
          title: `M12 listing ${unique}`,
          rent: "12500",
          contactPhone,
          contactConsent,
        },
        makeSubmission(prisma),
      );
    const ownerActor = { id: ownerId, role: "OWNER" };
    const brokerActor = { id: brokerId, role: "BROKER" };
    await t.test(
      "legacy-shaped published record has no fabricated contact",
      async () => {
        const row = await prisma.listing.create({
          data: {
            ownerId,
            localityId,
            propertyTypeId,
            title: `M12 legacy-shaped ${unique}`,
            rentAmountPaise: 1000000n,
            status: "PUBLISHED",
          },
        });
        assert.equal(row.contactPhone, null);
        assert.equal(row.contactConsentAt, null);
        assert.equal(
          (await getPublicListingById(row.id, publicRepo)).contactPhone,
          null,
        );
      },
    );
    await t.test(
      "OWNER and BROKER submissions persist contact, consent and authenticated owner",
      async () => {
        for (const actor of [ownerActor, brokerActor]) {
          const submitted = await submit(actor, "9876543210", "on");
          const row = await prisma.listing.findUnique({
            where: { id: submitted.id },
          });
          assert.equal(row.ownerId, actor.id);
          assert.equal(row.status, "PENDING_REVIEW");
          assert.equal(row.contactPhone, "+919876543210");
          assert.ok(row.contactConsentAt);
          assert.equal(await getPublicListingById(row.id, publicRepo), null);
        }
      },
    );
    await t.test(
      "approved contact appears only while PUBLISHED, owner IDOR is refused",
      async () => {
        const submission = await submit(ownerActor, "+919876543210", "on");
        const id = submission.id;
        const denied = await transitionOwnerListing(
          { id: outsiderId, role: "OWNER" },
          id,
          "WITHDRAW",
          "PENDING_REVIEW",
          ownRepo,
        );
        assert.deepEqual(denied, { outcome: "unavailable" });
        assert.equal(
          (await prisma.listing.findUnique({ where: { id } })).status,
          "PENDING_REVIEW",
        );
        await prisma.listing.updateMany({
          where: { id, status: "PENDING_REVIEW" },
          data: { status: "PUBLISHED" },
        });
        const visible = await getPublicListingById(id, publicRepo);
        assert.equal(visible.contactPhone, "+919876543210");
        for (const key of [
          "ownerId",
          "owner",
          "contactConsentAt",
          "email",
          "password",
        ])
          assert.equal(key in visible, false);
        assert.deepEqual(
          await transitionOwnerListing(
            ownerActor,
            id,
            "MARK_RENTED",
            "PUBLISHED",
            ownRepo,
          ),
          { outcome: "updated" },
        );
        assert.equal(await getPublicListingById(id, publicRepo), null);
        assert.equal(
          (await prisma.listing.findUnique({ where: { id } })).contactPhone,
          "+919876543210",
        );
      },
    );
    await t.test(
      "withdrawn and rejected records never reveal contact",
      async () => {
        const pending = await submit(brokerActor, "9876543210", "on");
        assert.deepEqual(
          await transitionOwnerListing(
            brokerActor,
            pending.id,
            "WITHDRAW",
            "PENDING_REVIEW",
            ownRepo,
          ),
          { outcome: "updated" },
        );
        assert.equal(await getPublicListingById(pending.id, publicRepo), null);
        const rejected = await submit(ownerActor, "9876543210", "on");
        await prisma.listing.updateMany({
          where: { id: rejected.id, status: "PENDING_REVIEW" },
          data: { status: "REJECTED" },
        });
        assert.equal(await getPublicListingById(rejected.id, publicRepo), null);
        const published = await submit(brokerActor, "9876543210", "on");
        await prisma.listing.updateMany({
          where: { id: published.id, status: "PENDING_REVIEW" },
          data: { status: "PUBLISHED" },
        });
        assert.equal(
          (await getPublicListingById(published.id, publicRepo)).contactPhone,
          "+919876543210",
        );
        assert.deepEqual(
          await transitionOwnerListing(
            brokerActor,
            published.id,
            "WITHDRAW",
            "PUBLISHED",
            ownRepo,
          ),
          { outcome: "updated" },
        );
        assert.equal(
          await getPublicListingById(published.id, publicRepo),
          null,
        );
      },
    );
    await t.test(
      "unconsented stored contact and malformed direct writes do not become public",
      async () => {
        const unconsented = await submit(ownerActor, "9876543210", "");
        await prisma.listing.updateMany({
          where: { id: unconsented.id, status: "PENDING_REVIEW" },
          data: { status: "PUBLISHED" },
        });
        assert.equal(
          (await getPublicListingById(unconsented.id, publicRepo)).contactPhone,
          null,
        );
        await assert.rejects(
          prisma.listing.create({
            data: {
              ownerId,
              localityId,
              propertyTypeId,
              title: "Invalid M12",
              rentAmountPaise: 1000000n,
              contactPhone: "123",
              contactConsentAt: new Date(),
            },
          }),
        );
        await assert.rejects(
          prisma.listing.create({
            data: {
              ownerId,
              localityId,
              propertyTypeId,
              title: "Invalid M12",
              rentAmountPaise: 1000000n,
              contactConsentAt: new Date(),
            },
          }),
        );
      },
    );
  } finally {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.listing.deleteMany({
          where: {
            ownerId: { in: [ownerId, brokerId, outsiderId].filter(Boolean) },
          },
        });
        await tx.user.deleteMany({
          where: {
            id: { in: [ownerId, brokerId, outsiderId].filter(Boolean) },
          },
        });
        if (localityId) await tx.locality.delete({ where: { id: localityId } });
        if (cityId) await tx.city.delete({ where: { id: cityId } });
        if (propertyTypeId)
          await tx.propertyType.delete({ where: { id: propertyTypeId } });
      });
      assert.equal(
        await prisma.user.count({
          where: {
            email: { in: [email("owner"), email("broker"), email("outsider")] },
          },
        }),
        0,
      );
      assert.equal(await prisma.listing.count({ where: { localityId } }), 0);
      t.diagnostic("Zero leftover M12 users, listings or reference fixtures.");
    } finally {
      await prisma.$disconnect();
    }
  }
});
