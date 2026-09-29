import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  provisionSupplier,
  provisionCatalog,
} from "../src/server/provisioning/operator-provisioning.mjs";
import { createListingSubmission } from "../src/server/listings/submission.ts";

test("M11 disposable PostgreSQL provisioning and existing submission integration", async (t) => {
  const url = process.env.M11_TEST_DATABASE_URL;
  if (!url) {
    t.skip("Set M11_TEST_DATABASE_URL to an explicitly disposable database.");
    return;
  }
  const target = new URL(url);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname));
  assert.match(target.pathname, /^\/rentdekho_m11_test_[a-z0-9_]+$/);
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
  const suffix = randomUUID().replaceAll("-", "");
  const city = {
    name: `M11 Test City ${suffix}`,
    state: "Test State",
    countryCode: "IN",
  };
  const catalog = {
    cities: [city],
    localities: [{ name: `M11 Locality ${suffix}`, city }],
    propertyTypes: [
      { code: `M11TYPE${suffix}`.toUpperCase(), label: "Synthetic test home" },
    ],
    amenities: [
      {
        code: `M11AMENITY${suffix}`.toUpperCase(),
        label: "Synthetic test amenity",
      },
    ],
  };
  const users = [];
  const trackedCodes = [
    catalog.propertyTypes[0].code,
    catalog.amenities[0].code,
  ];
  const counts = async () =>
    Promise.all([
      prisma.city.count(),
      prisma.locality.count(),
      prisma.propertyType.count(),
      prisma.amenity.count(),
    ]);
  const dry = (input = catalog) =>
    provisionCatalog(prisma, input, { mode: "dry-run" });
  const apply = (input, confirmation) =>
    provisionCatalog(prisma, input, { mode: "apply", confirm: confirmation });
  const createUser = async (role = "TENANT") => {
    const user = await prisma.user.create({
      data: {
        email: `m11-${randomUUID()}@example.invalid`,
        displayName: "M11 synthetic supplier",
        role,
      },
    });
    users.push(user.id);
    return user;
  };
  const assign = async (userId, role) => {
    const report = await provisionSupplier(prisma, {
      userId,
      role,
      mode: "dry-run",
    });
    return provisionSupplier(prisma, {
      userId,
      role,
      mode: "apply",
      confirm: report.confirmation,
    });
  };
  let owner, broker;
  try {
    await t.test(
      "TENANT to OWNER and BROKER, same-role no-op and dry-run zero writes",
      async () => {
        owner = await createUser();
        broker = await createUser();
        const before = await prisma.user.findUnique({
          where: { id: owner.id },
        });
        await provisionSupplier(prisma, {
          userId: owner.id,
          role: "OWNER",
          mode: "dry-run",
        });
        assert.deepEqual(
          await prisma.user.findUnique({ where: { id: owner.id } }),
          before,
        );
        assert.equal((await assign(owner.id, "OWNER")).updated, 1);
        assert.equal((await assign(broker.id, "BROKER")).updated, 1);
        const assigned = await prisma.user.findUnique({
          where: { id: owner.id },
        });
        assert.equal((await assign(owner.id, "OWNER")).updated, 0);
        assert.equal((await assign(broker.id, "BROKER")).reused, 1);
        assert.deepEqual(
          await prisma.user.findUnique({ where: { id: owner.id } }),
          assigned,
        );
      },
    );
    await t.test(
      "cross-role, ADMIN, nonexistent accounts and ADMIN target refused",
      async () => {
        const admin = await createUser("ADMIN");
        for (const [userId, role] of [
          [owner.id, "BROKER"],
          [broker.id, "OWNER"],
          [admin.id, "OWNER"],
          [admin.id, "BROKER"],
        ]) {
          await assert.rejects(assign(userId, role), /ROLE_TRANSITION_REFUSED/);
        }
        await assert.rejects(
          assign(`m11missing${suffix.slice(0, 16)}`, "OWNER"),
          /ACCOUNT_NOT_FOUND/,
        );
        await assert.rejects(
          assign(owner.id, "ADMIN"),
          /UNSUPPORTED_TARGET_ROLE/,
        );
        assert.equal(
          (await prisma.user.findUnique({ where: { id: admin.id } })).role,
          "ADMIN",
        );
      },
    );
    await t.test(
      "stale supplier confirmation cannot overwrite a role change",
      async () => {
        const user = await createUser();
        const preview = await provisionSupplier(prisma, {
          userId: user.id,
          role: "OWNER",
          mode: "dry-run",
        });
        await assign(user.id, "BROKER");
        await assert.rejects(
          provisionSupplier(prisma, {
            userId: user.id,
            role: "OWNER",
            mode: "apply",
            confirm: preview.confirmation,
          }),
          /ROLE_TRANSITION_REFUSED/,
        );
        assert.equal(
          (await prisma.user.findUnique({ where: { id: user.id } })).role,
          "BROKER",
        );
      },
    );
    await t.test(
      "competing supplier assignments cannot overwrite each other",
      async () => {
        const user = await createUser();
        const ownerPreview = await provisionSupplier(prisma, {
          userId: user.id,
          role: "OWNER",
          mode: "dry-run",
        });
        const brokerPreview = await provisionSupplier(prisma, {
          userId: user.id,
          role: "BROKER",
          mode: "dry-run",
        });
        const results = await Promise.allSettled([
          provisionSupplier(prisma, {
            userId: user.id,
            role: "OWNER",
            mode: "apply",
            confirm: ownerPreview.confirmation,
          }),
          provisionSupplier(prisma, {
            userId: user.id,
            role: "BROKER",
            mode: "apply",
            confirm: brokerPreview.confirmation,
          }),
        ]);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        const winner = results.find(
          (result) => result.status === "fulfilled",
        ).value;
        assert.equal(
          (await prisma.user.findUnique({ where: { id: user.id } })).role,
          winner.toRole,
        );
      },
    );
    await t.test(
      "valid four-model catalog preview accepts all rows with zero writes",
      async () => {
        const before = await counts();
        const report = await dry();
        assert.equal(report.accepted, 4);
        assert.equal(report.rejected, 0);
        assert.equal(report.wouldCreate, 4);
        assert.equal(report.created, 0);
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      "unknown city and mismatched city definition rejected",
      async () => {
        const unknown = structuredClone(catalog);
        unknown.cities = [];
        assert.equal((await dry(unknown)).errors[0].code, "UNKNOWN_CITY");
        const conflict = structuredClone(catalog);
        conflict.localities[0].city = {
          ...conflict.localities[0].city,
          name: city.name.toLowerCase(),
        };
        assert.equal((await dry(conflict)).conflicts, 1);
      },
    );
    await t.test(
      "duplicate canonical city, locality and reference codes rejected",
      async () => {
        for (const group of [
          "cities",
          "localities",
          "propertyTypes",
          "amenities",
        ]) {
          const input = structuredClone(catalog);
          const duplicate = structuredClone(input[group][0]);
          if (duplicate.name)
            duplicate.name = `\t${duplicate.name.toLowerCase()}\n`;
          else duplicate.code = ` ${duplicate.code.toLowerCase()} `;
          input[group].push(duplicate);
          const report = await dry(input);
          assert.equal(report.duplicates, 1, group);
          assert.equal(report.rejected, 1, group);
        }
      },
    );
    await t.test(
      "malformed shape, unknown fields, empty values and country rejected",
      async () => {
        for (const input of [
          null,
          [],
          {},
          { ...catalog, unexpected: [] },
          { ...catalog, cities: Array(1001).fill(city) },
        ])
          await assert.rejects(dry(input), /INVALID_CATALOG_SHAPE_OR_SIZE/);
        for (const [group, field, value] of [
          ["cities", "name", "\t\n"],
          ["cities", "countryCode", "india"],
          ["cities", "countryCode", ["IN"]],
          ["localities", "name", 4],
          ["propertyTypes", "label", " "],
          ["amenities", "code", ""],
        ]) {
          const input = structuredClone(catalog);
          input[group][0][field] = value;
          assert.ok((await dry(input)).rejected > 0);
        }
      },
    );
    await t.test(
      "invalid apply and missing confirmation leave zero partial writes",
      async () => {
        const before = await counts();
        const input = structuredClone(catalog);
        input.amenities[0].label = "";
        await assert.rejects(
          apply(input, "not-a-confirmation"),
          /CATALOG_REJECTED_NO_WRITES/,
        );
        await assert.rejects(
          apply(catalog),
          /DRY_RUN_CONFIRMATION_REQUIRED_OR_STALE/,
        );
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      "database failure after first insert rolls entire catalog back",
      async () => {
        const before = await counts();
        const preview = await dry();
        const failing = {
          $transaction: (fn, options) =>
            prisma.$transaction(async (tx) => {
              const wrapped = new Proxy(tx, {
                get(target, key) {
                  if (key === "locality")
                    return {
                      findUnique: target.locality.findUnique.bind(
                        target.locality,
                      ),
                      create: async () => {
                        throw new Error("Synthetic failure after city insert");
                      },
                    };
                  return Reflect.get(target, key);
                },
              });
              return fn(wrapped);
            }, options),
        };
        await assert.rejects(
          provisionCatalog(failing, catalog, {
            mode: "apply",
            confirm: preview.confirmation,
          }),
          /Synthetic failure/,
        );
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      "transactional apply creates four rows and repeated apply reuses all",
      async () => {
        const initial = await dry();
        const report = await apply(catalog, initial.confirmation);
        assert.equal(report.created, 4);
        const before = await counts();
        await assert.rejects(
          apply(catalog, initial.confirmation),
          /DRY_RUN_CONFIRMATION_REQUIRED_OR_STALE/,
        );
        const second = await apply(catalog, (await dry()).confirmation);
        assert.equal(second.created, 0);
        assert.equal(second.reused, 4);
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      "conflicting existing labels and display names never overwritten",
      async () => {
        for (const [group, field] of [
          ["cities", "name"],
          ["localities", "name"],
          ["propertyTypes", "label"],
          ["amenities", "label"],
        ]) {
          const input = structuredClone(catalog);
          input[group][0][field] =
            field === "name"
              ? input[group][0][field].toLowerCase()
              : "Conflicting label";
          assert.ok((await dry(input)).conflicts > 0);
          await assert.rejects(
            apply(input, "invalid"),
            /CATALOG_REJECTED_NO_WRITES/,
          );
        }
      },
    );
    await t.test(
      "existing city can be reused without appearing in cities input",
      async () => {
        const input = structuredClone(catalog);
        input.cities = [];
        const preview = await dry(input);
        assert.equal(preview.rejected, 0);
        assert.equal(preview.reused, 3);
        assert.equal((await apply(input, preview.confirmation)).created, 0);
      },
    );
    await t.test(
      "PostgreSQL normalization matches actual canonical constraints",
      async () => {
        const input = structuredClone(catalog);
        input.cities[0].name = `\t${city.name}\n`;
        input.localities[0].name = `\n${input.localities[0].name}\t`;
        input.propertyTypes[0].code = `\t${input.propertyTypes[0].code.toLowerCase()}\n`;
        const report = await dry(input);
        assert.equal(report.rejected, 0);
        assert.equal(report.reused, 4);
        assert.equal((await apply(input, report.confirmation)).created, 0);
      },
    );
    await t.test(
      "real CLI previews/applies safely and never prints credentials or parser input",
      async () => {
        const directory = await mkdtemp(join(tmpdir(), "rentdekho-m11-"));
        const path = join(directory, "synthetic-catalog.json");
        const run = (args) =>
          spawnSync(
            process.execPath,
            [
              "--conditions=react-server",
              "scripts/operator-provision.mjs",
              ...args,
            ],
            { encoding: "utf8", env: { ...process.env, DATABASE_URL: url } },
          );
        try {
          await writeFile(path, JSON.stringify(catalog));
          const preview = run([
            "catalog",
            "--operator",
            "--dry-run",
            "--file",
            path,
          ]);
          assert.equal(preview.status, 0, preview.stdout);
          const result = run([
            "catalog",
            "--operator",
            "--apply",
            "--file",
            path,
            "--confirm",
            JSON.parse(preview.stdout).confirmation,
          ]);
          assert.equal(result.status, 0, result.stdout);
          assert.equal(JSON.parse(result.stdout).reused, 4);
          const user = await createUser();
          const roleArgs = [
            "supplier",
            "--operator",
            "--user-id",
            user.id,
            "--role",
            "OWNER",
          ];
          const supplierPreview = run([...roleArgs, "--dry-run"]);
          assert.equal(supplierPreview.status, 0);
          const assigned = run([
            ...roleArgs,
            "--apply",
            "--confirm",
            JSON.parse(supplierPreview.stdout).confirmation,
          ]);
          assert.equal(assigned.status, 0);
          assert.equal(JSON.parse(assigned.stdout).updated, 1);
          await writeFile(path, '{"SECRET_CANARY": invalid}');
          const invalid = run([
            "catalog",
            "--operator",
            "--dry-run",
            "--file",
            path,
          ]);
          assert.equal(invalid.status, 1);
          assert.equal(JSON.parse(invalid.stdout).error, "INVALID_JSON");
          for (const output of [
            preview,
            result,
            supplierPreview,
            assigned,
            invalid,
          ]) {
            assert.equal(output.stderr, "");
            assert.ok(!output.stdout.includes(url));
            assert.ok(!output.stdout.includes("SECRET_CANARY"));
            if (target.password)
              assert.ok(!output.stdout.includes(target.password));
          }
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    );
    await t.test(
      "unchanged OWNER/BROKER submission consumes provisioned references",
      async () => {
        const source = await readFile(
          new URL(
            "../src/server/listings/prisma-submission-repository.ts",
            import.meta.url,
          ),
          "utf8",
        );
        const { createPrismaListingSubmissionRepository } = await import(
          `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replace('import "server-only";', ""))).toString("base64")}`
        );
        const storedCity = await prisma.city.findFirst({
          where: { name: city.name },
        });
        const locality = await prisma.locality.findFirst({
          where: { cityId: storedCity.id },
        });
        const type = await prisma.propertyType.findUnique({
          where: { code: catalog.propertyTypes[0].code },
        });
        const amenity = await prisma.amenity.findUnique({
          where: { code: catalog.amenities[0].code },
        });
        for (const user of [owner, broker]) {
          const actor = await prisma.user.findUnique({
            where: { id: user.id },
            select: { id: true, role: true },
          });
          const result = await createListingSubmission(
            actor,
            {
              cityId: storedCity.id,
              localityId: locality.id,
              propertyTypeId: type.id,
              amenityIds: [amenity.id],
              title: `M11 synthetic ${suffix}`,
              rent: "12500.50",
            },
            createPrismaListingSubmissionRepository(prisma),
          );
          const listing = await prisma.listing.findUnique({
            where: { id: result.id },
            include: { amenities: true },
          });
          assert.equal(listing.ownerId, actor.id);
          assert.equal(listing.status, "PENDING_REVIEW");
          assert.equal(listing.rentAmountPaise, 1250050n);
          assert.equal(listing.amenities[0].amenityId, amenity.id);
        }
      },
    );
  } finally {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.listing.deleteMany({ where: { ownerId: { in: users } } });
        await tx.user.deleteMany({ where: { id: { in: users } } });
        const cities = await tx.city.findMany({
          where: { name: city.name },
          select: { id: true },
        });
        await tx.locality.deleteMany({
          where: { cityId: { in: cities.map((row) => row.id) } },
        });
        await tx.city.deleteMany({
          where: { id: { in: cities.map((row) => row.id) } },
        });
        await tx.propertyType.deleteMany({
          where: { code: { in: trackedCodes } },
        });
        await tx.amenity.deleteMany({ where: { code: { in: trackedCodes } } });
      });
      assert.equal(
        await prisma.user.count({ where: { id: { in: users } } }),
        0,
      );
      assert.equal(
        await prisma.listing.count({ where: { ownerId: { in: users } } }),
        0,
      );
      assert.equal(await prisma.city.count({ where: { name: city.name } }), 0);
      assert.equal(
        await prisma.locality.count({
          where: { name: catalog.localities[0].name },
        }),
        0,
      );
      assert.equal(
        await prisma.propertyType.count({
          where: { code: catalog.propertyTypes[0].code },
        }),
        0,
      );
      assert.equal(
        await prisma.amenity.count({
          where: { code: catalog.amenities[0].code },
        }),
        0,
      );
      t.diagnostic("Zero leftover M11 users, listings or reference fixtures.");
    } finally {
      await prisma.$disconnect();
    }
  }
});
