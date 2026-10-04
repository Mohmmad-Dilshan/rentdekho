import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

// Opt-in production integration test: no new browser dependency is installed.
test(
  "production listing pipeline, browser money validity, authorization and M9 lifecycle",
  { timeout: 480_000 },
  async (t) => {
    const base = process.env.M10_BASE_URL;
    const playwrightModule = process.env.M10_PLAYWRIGHT_MODULE;
    assert.ok(
      base && playwrightModule,
      "Set M10_BASE_URL and M10_PLAYWRIGHT_MODULE; see README M10 prerequisites.",
    );
    const origin = new URL(base).origin;
    assert.ok(
      ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
      "Use a local production server and disposable development database.",
    );
    if (!process.env.DATABASE_URL && existsSync(".env"))
      process.loadEnvFile(".env");
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required.");
    const { chromium } = await import(playwrightModule);
    const prisma = new PrismaClient();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const emails = [];
    const contexts = [];
    const runtimeErrors = [];
    let browser, cityId, localityId, propertyTypeId, amenityId;
    let submissionRequest, approveRequest, rejectRequest;
    const password = `M10-${randomUUID()}`;

    function capture(page, kind) {
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      page.on("request", (request) => {
        if (!request.headers()["next-action"]) return;
        const snapshot = {
          headers: {
            "next-action": request.headers()["next-action"],
            "content-type": request.headers()["content-type"],
            origin,
          },
          body: request.postDataBuffer(),
        };
        if (kind === "submission") submissionRequest = snapshot;
        if (kind === "moderation") {
          // Each test clicks one decision at a time; assign its snapshot below.
          page.lastActionRequest = snapshot;
        }
      });
    }

    async function noOverflow(page) {
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "No horizontal overflow",
      );
    }

    async function publicVisibility(id, title, visible) {
      const anonymous = contexts[0];
      const detail = await anonymous.request.get(`${origin}/rentals/${id}`);
      assert.equal(detail.status(), visible ? 200 : 404);
      const detailText = await detail.text();
      if (visible) assert.ok(detailText.includes(title));
      else
        assert.ok(
          !detailText.includes(title),
          "Private title absent from detail/metadata response",
        );
      const feed = await anonymous.request.get(
        `${origin}/rentals?locality=${localityId}`,
      );
      assert.equal(feed.status(), 200);
      assert.equal((await feed.text()).includes(title), visible);
      const sitemap = await anonymous.request.get(`${origin}/sitemap.xml`);
      assert.equal(sitemap.status(), 200);
      assert.equal((await sitemap.text()).includes(`/rentals/${id}`), visible);
      if (visible) {
        for (const privateField of ["ownerId", ...emails])
          assert.ok(!detailText.includes(privateField));
      }
    }

    async function provision(role) {
      const context = await browser.newContext();
      contexts.push(context);
      const email = `m10-${role.toLowerCase()}-${suffix}@example.invalid`;
      emails.push(email);
      const signupOptions = {
        headers: { origin },
        data: { name: `M10 ${role}`, email, password },
      };
      let signup = await context.request.post(
        `${origin}/api/auth/sign-up/email`,
        signupOptions,
      );
      if (signup.status() === 429) {
        // Respect the real authentication limiter; never disable or bypass it.
        const retrySeconds = Number(
          signup.headers()["x-retry-after"] ||
            signup.headers()["retry-after"] ||
            10,
        );
        assert.ok(
          Number.isFinite(retrySeconds) &&
            retrySeconds >= 0 &&
            retrySeconds <= 60,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, (retrySeconds + 1) * 1000),
        );
        signup = await context.request.post(
          `${origin}/api/auth/sign-up/email`,
          signupOptions,
        );
      }
      assert.equal(signup.status(), 200, `Temporary ${role} signup`);
      const user = await prisma.user.update({
        where: { email },
        data: { role },
        select: { id: true },
      });
      await context.clearCookies();
      const page = await context.newPage();
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      await page.goto(`${origin}/sign-in`);
      await page.locator('[name="email"]').fill(email);
      await page.locator('[name="password"]').fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/account");
      return { context, page, id: user.id };
    }

    async function fillListing(
      page,
      title,
      {
        rent = "12500.50",
        deposit = "25000.25",
        contact = "9876543210",
        consent = true,
      } = {},
    ) {
      assert.equal((await page.goto(`${origin}/listings/new`)).status(), 200);
      await page.locator('[name="cityId"]').selectOption(cityId);
      await page.locator('[name="localityId"]').selectOption(localityId);
      await page
        .locator('[name="propertyTypeId"]')
        .selectOption(propertyTypeId);
      await page.locator('[name="title"]').fill(title);
      await page
        .locator('textarea[name="description"]')
        .fill("M10 temporary integration description");
      await page.locator('[name="rent"]').fill(rent);
      await page.locator('[name="securityDeposit"]').fill(deposit);
      await page.locator('[name="contactPhone"]').fill(contact);
      if (consent) await page.locator('[name="contactConsent"]').check();
      await page.locator('[name="availableFrom"]').fill("2026-10-01");
      await page
        .locator('[name="furnishingStatus"]')
        .selectOption("SEMI_FURNISHED");
      await page.locator('[name="tenantPreference"]').selectOption("FAMILY");
      await page.locator(`input[value="${amenityId}"]`).check();
    }

    async function submit(actor, label, amounts) {
      const title = `M10 ${label} ${suffix}`;
      await fillListing(actor.page, title, amounts);
      // These fields must never control identity or publish a submission.
      await actor.page.locator("form").evaluate((form) => {
        for (const [name, value] of Object.entries({
          ownerId: "another-owner",
          status: "PUBLISHED",
          targetStatus: "PUBLISHED",
        })) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.append(input);
        }
      });
      await actor.page
        .getByRole("button", { name: "Submit listing", exact: true })
        .click();
      await actor.page.waitForURL("**/listings/submitted");
      const listing = await prisma.listing.findFirst({
        where: { ownerId: actor.id, title },
        include: { amenities: true },
      });
      assert.ok(listing);
      assert.equal(listing.status, "PENDING_REVIEW");
      assert.equal(listing.localityId, localityId);
      assert.equal(listing.propertyTypeId, propertyTypeId);
      assert.equal(
        listing.rentAmountPaise,
        amounts?.rent === "12500" ? 1250000n : 1250050n,
      );
      assert.equal(
        listing.securityDepositAmountPaise,
        amounts?.deposit === "" ? null : 2500025n,
      );
      assert.equal(
        listing.description,
        "M10 temporary integration description",
      );
      assert.equal(
        listing.availableFrom.toISOString().slice(0, 10),
        "2026-10-01",
      );
      assert.equal(listing.furnishingStatus, "SEMI_FURNISHED");
      assert.equal(listing.tenantPreference, "FAMILY");
      assert.equal(
        listing.contactPhone,
        amounts?.contact === "" ? null : "+919876543210",
      );
      assert.equal(
        Boolean(listing.contactConsentAt),
        amounts?.consent !== false,
      );
      assert.deepEqual(
        listing.amenities.map((item) => item.amenityId),
        [amenityId],
      );
      await publicVisibility(listing.id, title, false);
      return listing;
    }

    async function moderate(admin, listing, decision) {
      assert.equal(
        (
          await admin.page.goto(`${origin}/admin/listings/${listing.id}`)
        ).status(),
        200,
      );
      await noOverflow(admin.page);
      const review = await admin.page.locator("body").innerText();
      assert.ok(review.includes("Supplier-provided contact"));
      assert.ok(review.includes(listing.contactPhone ?? "Not provided"));
      assert.ok(
        review.includes(
          listing.contactConsentAt ? "Given for this listing" : "Not given",
        ),
      );
      assert.ok(review.includes("does not verify ownership"));
      await admin.page
        .getByRole("button", {
          name:
            decision === "APPROVE" ? "Approve and publish" : "Reject listing",
          exact: true,
        })
        .click();
      await admin.page
        .getByRole("status")
        .filter({
          hasText:
            decision === "APPROVE" ? "Listing published." : "Listing rejected.",
        })
        .waitFor();
      const saved = { ...admin.page.lastActionRequest, listingId: listing.id };
      if (decision === "APPROVE") approveRequest = saved;
      else rejectRequest = saved;
      assert.equal(
        (await prisma.listing.findUnique({ where: { id: listing.id } })).status,
        decision === "APPROVE" ? "PUBLISHED" : "REJECTED",
      );
      await publicVisibility(listing.id, listing.title, decision === "APPROVE");
    }

    async function replay(context, snapshot, id, route) {
      const body = snapshot.body.toString("utf8");
      assert.ok(
        body.includes(snapshot.listingId),
        "Replay uses captured real action payload",
      );
      return context.request.post(`${origin}${route}`, {
        headers: snapshot.headers,
        data: Buffer.from(body.replaceAll(snapshot.listingId, id)),
      });
    }

    try {
      browser = await chromium.launch({
        executablePath:
          process.env.M10_CHROME_EXECUTABLE ||
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
        headless: true,
      });
      const anonymous = await browser.newContext();
      contexts.push(anonymous);
      const city = await prisma.city.create({
        data: {
          name: `M10 Test City ${suffix}`,
          canonicalName: `m10 test city ${suffix}`,
          state: "Rajasthan",
          canonicalState: "rajasthan",
        },
      });
      cityId = city.id;
      const locality = await prisma.locality.create({
        data: {
          cityId,
          name: `M10 Test Locality ${suffix}`,
          canonicalName: `m10 test locality ${suffix}`,
        },
      });
      localityId = locality.id;
      const type = await prisma.propertyType.create({
        data: {
          code: `M10${suffix}`.toUpperCase(),
          label: "M10 temporary home",
        },
      });
      propertyTypeId = type.id;
      const amenity = await prisma.amenity.create({
        data: {
          code: `M10${suffix}`.toUpperCase(),
          label: "M10 temporary amenity",
        },
      });
      amenityId = amenity.id;

      for (const path of [
        "/",
        "/rentals",
        "/api/health",
        "/robots.txt",
        "/sitemap.xml",
      ])
        assert.equal(
          (await anonymous.request.get(`${origin}${path}`)).status(),
          200,
          path,
        );
      for (const path of ["/listings/new", "/admin/listings", "/my/listings"]) {
        const response = await anonymous.request.get(`${origin}${path}`, {
          maxRedirects: 0,
        });
        assert.equal(response.status(), 307);
        assert.equal(response.headers().location, "/sign-in");
      }
      assert.match(
        await (await anonymous.request.get(`${origin}/robots.txt`)).text(),
        /Disallow: \/my/,
      );
      const owner = await provision("OWNER");
      const broker = await provision("BROKER");
      const admin = await provision("ADMIN");
      const tenant = await provision("TENANT");
      capture(owner.page, "submission");
      capture(broker.page, "submission");
      capture(admin.page, "moderation");

      await t.test(
        "desktop and 375px actual input validity rejects invalid money",
        async () => {
          for (const width of [1280, 375]) {
            await owner.page.setViewportSize({ width, height: 900 });
            await fillListing(owner.page, `M10 validity ${suffix}`);
            for (const [field, values] of Object.entries({
              rent: [
                ["12500", true],
                ["12500.5", true],
                ["12500.50", true],
                ["0.01", true],
                ["000.10", true],
                ["0", false],
                ["0.00", false],
                ["000.00", false],
                ["", false],
                ["-1", false],
                ["12..5", false],
                ["12.345", false],
              ],
              securityDeposit: [
                ["25000", true],
                ["25000.5", true],
                ["25000.25", true],
                ["", true],
                ["-1", false],
                ["12..5", false],
                ["12.345", false],
              ],
            })) {
              for (const [value, expected] of values) {
                const input = owner.page.locator(`[name="${field}"]`);
                await input.fill(value);
                assert.equal(
                  await input.evaluate((element) => element.checkValidity()),
                  expected,
                  `${width}px ${field}: ${value || "empty"}`,
                );
              }
            }
            await owner.page.locator('[name="rent"]').fill("-1");
            await owner.page
              .getByRole("button", { name: "Submit listing", exact: true })
              .click();
            assert.ok(owner.page.url().endsWith("/listings/new"));
            assert.equal(
              await prisma.listing.count({ where: { ownerId: owner.id } }),
              0,
            );
            await noOverflow(owner.page);
          }
        },
      );

      await owner.page.setViewportSize({ width: 1280, height: 900 });
      const rented = await submit(owner, "rented");
      const submissionSnapshot = submissionRequest;
      await t.test(
        "real submission action denies a tenant even when UI is bypassed",
        async () => {
          const response = await tenant.context.request.post(
            `${origin}/listings/new`,
            {
              headers: submissionSnapshot.headers,
              data: submissionSnapshot.body,
            },
          );
          assert.match(await response.text(), /Only owner and broker/);
          assert.equal(
            await prisma.listing.count({ where: { ownerId: tenant.id } }),
            0,
          );
        },
      );
      const archived = await submit(broker, "archived", {
        rent: "12500",
        deposit: "",
      });
      const rejected = await submit(owner, "rejected");
      const pending = await submit(owner, "pending withdrawal");
      const raced = await submit(broker, "moderation race");
      await moderate(admin, rented, "APPROVE");
      await moderate(admin, rejected, "REJECT");

      await t.test(
        "consented public call action works on desktop and 375px mobile",
        async () => {
          for (const width of [1280, 375]) {
            const page = await anonymous.newPage();
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`${origin}/rentals/${rented.id}`);
            const call = page.getByRole("link", {
              name: /Call listing contact at/,
            });
            assert.equal(await call.getAttribute("href"), "tel:+919876543210");
            const box = await call.boundingBox();
            assert.ok(box.width >= 44 && box.height >= 44);
            assert.match(
              await page.locator("body").innerText(),
              /has not verified who owns it/,
            );
            await noOverflow(page);
            await page.close();
          }
        },
      );
      const unavailable = await submit(owner, "contact unavailable", {
        contact: "",
        consent: false,
      });
      await moderate(admin, unavailable, "APPROVE");
      const unconsented = await submit(broker, "contact unconsented", {
        consent: false,
      });
      await moderate(admin, unconsented, "APPROVE");
      await t.test(
        "published missing and unconsented contact stay unavailable on desktop and mobile",
        async () => {
          for (const [listing, width] of [
            [unavailable, 1280],
            [unconsented, 375],
          ]) {
            const page = await anonymous.newPage();
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`${origin}/rentals/${listing.id}`);
            assert.match(
              await page.locator("body").innerText(),
              /Contact is unavailable for this listing/,
            );
            assert.equal(await page.locator('a[href^="tel:"]').count(), 0);
            await noOverflow(page);
            await page.close();
          }
        },
      );

      await t.test(
        "non-admin actions cannot approve another owner's pending listing",
        async () => {
          for (const actor of [owner, broker, tenant]) {
            assert.match(
              await (
                await actor.context.request.get(`${origin}/admin/listings`)
              ).text(),
              /Administration is unavailable/,
            );
            for (const snapshot of [approveRequest, rejectRequest]) {
              const response = await replay(
                actor.context,
                snapshot,
                raced.id,
                `/admin/listings/${raced.id}`,
              );
              assert.match(await response.text(), /permission to moderate/);
            }
          }
          assert.equal(
            (await prisma.listing.findUnique({ where: { id: raced.id } }))
              .status,
            "PENDING_REVIEW",
          );
          assert.match(
            await (
              await tenant.context.request.get(`${origin}/listings/new`)
            ).text(),
            /submission is unavailable/,
          );
        },
      );

      await t.test(
        "competing real moderation actions have exactly one winner",
        async () => {
          const replies = await Promise.all([
            replay(
              admin.context,
              approveRequest,
              raced.id,
              `/admin/listings/${raced.id}`,
            ),
            replay(
              admin.context,
              rejectRequest,
              raced.id,
              `/admin/listings/${raced.id}`,
            ),
          ]);
          const bodies = await Promise.all(
            replies.map((reply) => reply.text()),
          );
          assert.equal(
            bodies.filter((body) =>
              /Listing published\.|Listing rejected\./.test(body),
            ).length,
            1,
          );
          assert.equal(
            bodies.filter((body) =>
              body.includes("This review is stale or the listing has changed"),
            ).length,
            1,
          );
          const result = await prisma.listing.findUnique({
            where: { id: raced.id },
          });
          await publicVisibility(
            raced.id,
            raced.title,
            result.status === "PUBLISHED",
          );
        },
      );

      await admin.page.setViewportSize({ width: 375, height: 900 });
      await moderate(admin, archived, "APPROVE");
      for (const [actor, listing, button, status, width] of [
        [owner, rented, "Mark rented", "RENTED", 1280],
        [broker, archived, "Withdraw listing", "ARCHIVED", 375],
        [owner, pending, "Withdraw listing", "ARCHIVED", 375],
      ]) {
        await actor.page.setViewportSize({ width, height: 900 });
        assert.equal(
          (await actor.page.goto(`${origin}/my/listings`)).status(),
          200,
        );
        await noOverflow(actor.page);
        assert.equal(
          (
            await actor.page.goto(`${origin}/my/listings/${listing.id}`)
          ).status(),
          200,
        );
        await noOverflow(actor.page);
        await actor.page
          .getByRole("button", { name: button, exact: true })
          .click();
        await actor.page
          .getByRole("status")
          .filter({
            hasText:
              status === "RENTED"
                ? "Listing marked rented."
                : "Listing withdrawn.",
          })
          .waitFor();
        assert.equal(
          (await prisma.listing.findUnique({ where: { id: listing.id } }))
            .status,
          status,
        );
        await publicVisibility(listing.id, listing.title, false);
      }
      assert.equal(
        (
          await broker.context.request.get(`${origin}/my/listings/${rented.id}`)
        ).status(),
        404,
      );
      assert.equal(
        (
          await owner.context.request.get(
            `${origin}/my/listings/${archived.id}`,
          )
        ).status(),
        404,
      );
      assert.equal(
        (await admin.context.request.get(`${origin}/admin/listings`)).status(),
        200,
      );
      await broker.page.setViewportSize({ width: 375, height: 900 });
      const mobile = await submit(broker, "mobile valid", {
        rent: "12500",
        deposit: "",
      });
      await moderate(admin, mobile, "REJECT");

      await t.test(
        "published correction hides reviewed content and contact until reapproval on desktop",
        async () => {
          const original = await submit(owner, "published correction");
          await moderate(admin, original, "APPROVE");
          await owner.page.setViewportSize({ width: 1280, height: 900 });
          await owner.page.goto(`${origin}/my/listings/${original.id}`);
          await owner.page
            .getByRole("link", { name: "Correct listing" })
            .click();
          await owner.page.waitForURL(`**/my/listings/${original.id}/edit`);
          assert.match(
            await owner.page.locator("body").innerText(),
            /immediately removes the listing and its contact from public view/,
          );
          assert.equal(
            await owner.page.locator('[name="reviewVersion"]').inputValue(),
            String(original.reviewVersion),
          );
          await owner.page.locator('[name="rent"]').fill("0");
          assert.equal(
            await owner.page
              .locator('[name="rent"]')
              .evaluate((input) => input.checkValidity()),
            false,
          );
          await owner.page
            .getByRole("button", { name: "Submit correction for review" })
            .click();
          assert.ok(
            owner.page.url().endsWith(`/my/listings/${original.id}/edit`),
          );
          const correctedTitle = `M13 corrected published ${suffix}`;
          await owner.page.locator('[name="title"]').fill(correctedTitle);
          await owner.page.locator('[name="rent"]').fill("13500.75");
          await owner.page.locator('[name="contactPhone"]').fill("9123456789");
          assert.equal(
            await owner.page.locator('[name="contactConsent"]').isChecked(),
            false,
            "Changing a public number requires new consent",
          );
          await owner.page.locator("form").evaluate((form) => {
            for (const [name, value] of Object.entries({
              ownerId: "another-owner",
              status: "PUBLISHED",
              role: "ADMIN",
            })) {
              const input = document.createElement("input");
              input.type = "hidden";
              input.name = name;
              input.value = value;
              form.append(input);
            }
          });
          await noOverflow(owner.page);
          await owner.page
            .getByRole("button", { name: "Submit correction for review" })
            .click();
          await owner.page.waitForURL(
            new RegExp(`/my/listings/${original.id}\\?updated=corrected$`),
          );
          assert.match(
            await owner.page.getByRole("status").innerText(),
            /not public while pending/,
          );
          const pendingCorrection = await prisma.listing.findUnique({
            where: { id: original.id },
          });
          assert.equal(pendingCorrection.status, "PENDING_REVIEW");
          assert.equal(
            pendingCorrection.reviewVersion,
            original.reviewVersion + 1,
          );
          assert.equal(pendingCorrection.ownerId, owner.id);
          assert.equal(pendingCorrection.title, correctedTitle);
          assert.equal(pendingCorrection.rentAmountPaise, 1350075n);
          assert.equal(pendingCorrection.contactPhone, "+919123456789");
          assert.equal(pendingCorrection.contactConsentAt, null);
          assert.equal(
            await prisma.listing.count({
              where: { ownerId: owner.id, title: correctedTitle },
            }),
            1,
          );
          await publicVisibility(original.id, original.title, false);
          await publicVisibility(original.id, correctedTitle, false);
          const privateDetail = await anonymous.request.get(
            `${origin}/rentals/${original.id}`,
          );
          assert.ok(!(await privateDetail.text()).includes("+919123456789"));
          assert.match(
            await owner.page.locator("body").innerText(),
            /corrected published/,
          );
          await admin.page.goto(`${origin}/admin/listings/${original.id}`);
          assert.match(
            await admin.page.locator("body").innerText(),
            /Review version/,
          );
          assert.equal(
            await admin.page
              .locator('[name="reviewVersion"]')
              .first()
              .inputValue(),
            String(pendingCorrection.reviewVersion),
          );
          await moderate(admin, pendingCorrection, "APPROVE");
          await publicVisibility(original.id, correctedTitle, true);
          const republished = await anonymous.newPage();
          await republished.goto(`${origin}/rentals/${original.id}`);
          assert.equal(await republished.locator('a[href^="tel:"]').count(), 0);
          assert.match(
            await republished.locator("body").innerText(),
            /Contact is unavailable/,
          );
          await republished.close();
        },
      );

      await t.test(
        "375px pending correction rejects stale ADMIN approve and reject, then exposes consented contact only after fresh review",
        async () => {
          const original = await submit(broker, "pending correction");
          const staleApprove = await admin.context.newPage();
          const staleReject = await admin.context.newPage();
          for (const page of [staleApprove, staleReject]) {
            page.on("pageerror", (error) => runtimeErrors.push(error.message));
            await page.setViewportSize({ width: 375, height: 900 });
            await page.goto(`${origin}/admin/listings/${original.id}`);
            assert.equal(
              await page.locator('[name="reviewVersion"]').first().inputValue(),
              String(original.reviewVersion),
            );
            await noOverflow(page);
          }
          await broker.page.setViewportSize({ width: 375, height: 900 });
          await broker.page.goto(`${origin}/my/listings/${original.id}/edit`);
          assert.match(
            await broker.page.locator("body").innerText(),
            /pending listing remains private/,
          );
          assert.equal(
            await broker.page.locator('[name="title"]').inputValue(),
            original.title,
          );
          const correctedTitle = `M13 corrected pending ${suffix}`;
          await broker.page.locator('[name="title"]').fill(correctedTitle);
          await broker.page.locator('[name="contactPhone"]').fill("9987654321");
          await broker.page.locator('[name="contactConsent"]').check();
          await noOverflow(broker.page);
          await broker.page
            .getByRole("button", { name: "Submit correction for review" })
            .click();
          await broker.page.waitForURL(
            new RegExp(`/my/listings/${original.id}\\?updated=corrected$`),
          );
          const corrected = await prisma.listing.findUnique({
            where: { id: original.id },
          });
          assert.equal(corrected.status, "PENDING_REVIEW");
          assert.equal(corrected.reviewVersion, original.reviewVersion + 1);
          assert.equal(corrected.contactPhone, "+919987654321");
          assert.ok(corrected.contactConsentAt);
          await publicVisibility(original.id, correctedTitle, false);
          const hiddenDetail = await anonymous.request.get(
            `${origin}/rentals/${original.id}`,
          );
          assert.ok(!(await hiddenDetail.text()).includes("+919987654321"));
          for (const [page, decision] of [
            [staleApprove, "Approve and publish"],
            [staleReject, "Reject listing"],
          ]) {
            await page
              .getByRole("button", { name: decision, exact: true })
              .click();
            await page
              .getByRole("alert")
              .filter({ hasText: /stale or the listing has changed/ })
              .waitFor();
            const stillPending = await prisma.listing.findUnique({
              where: { id: original.id },
            });
            assert.equal(stillPending.status, "PENDING_REVIEW");
            assert.equal(stillPending.reviewVersion, corrected.reviewVersion);
            assert.equal(stillPending.title, correctedTitle);
          }
          await admin.page.setViewportSize({ width: 375, height: 900 });
          await admin.page.goto(`${origin}/admin/listings/${original.id}`);
          assert.match(
            await admin.page.locator("body").innerText(),
            /corrected pending/,
          );
          assert.equal(
            await admin.page
              .locator('[name="reviewVersion"]')
              .first()
              .inputValue(),
            String(corrected.reviewVersion),
          );
          await noOverflow(admin.page);
          await moderate(admin, corrected, "APPROVE");
          const publicPage = await anonymous.newPage();
          await publicPage.setViewportSize({ width: 375, height: 900 });
          await publicPage.goto(`${origin}/rentals/${original.id}`);
          assert.equal(
            await publicPage
              .getByRole("link", { name: /Call listing contact at/ })
              .getAttribute("href"),
            "tel:+919987654321",
          );
          await noOverflow(publicPage);
          await publicPage.close();
          await staleApprove.close();
          await staleReject.close();
        },
      );

      await t.test(
        "correction route denies cross-owner and unauthorized roles",
        async () => {
          const brokerListing = await submit(broker, "correction IDOR");
          for (const actor of [owner, tenant, admin]) {
            assert.equal(
              (
                await actor.context.request.get(
                  `${origin}/my/listings/${brokerListing.id}/edit`,
                )
              ).status(),
              404,
            );
          }
          assert.equal(
            (
              await anonymous.request.get(
                `${origin}/my/listings/${brokerListing.id}/edit`,
                { maxRedirects: 0 },
              )
            ).status(),
            307,
          );
        },
      );
      await t.test(
        "old pending correction form cannot depublish a newly approved listing",
        async () => {
          const listing = await submit(owner, "stale pending form");
          await owner.page.goto(`${origin}/my/listings/${listing.id}/edit`);
          assert.equal(
            await owner.page.locator('[name="expectedStatus"]').inputValue(),
            "PENDING_REVIEW",
          );
          await owner.page
            .locator('[name="title"]')
            .fill(`M13 stale owner ${suffix}`);
          await moderate(admin, listing, "APPROVE");
          await owner.page
            .getByRole("button", { name: "Submit correction for review" })
            .click();
          await owner.page
            .getByRole("alert")
            .filter({ hasText: /changed or is unavailable/ })
            .waitFor();
          const saved = await prisma.listing.findUnique({
            where: { id: listing.id },
          });
          assert.equal(saved.status, "PUBLISHED");
          assert.equal(saved.reviewVersion, listing.reviewVersion);
          assert.equal(saved.title, listing.title);
          await publicVisibility(listing.id, listing.title, true);
        },
      );
      assert.deepEqual(runtimeErrors, [], "No browser runtime errors");
    } finally {
      // Cleanup only records belonging to this run's unique fixture identities.
      try {
        const users = await prisma.user.findMany({
          where: { email: { in: emails } },
          select: { id: true },
        });
        await prisma.listing.deleteMany({
          where: { ownerId: { in: users.map((user) => user.id) } },
        });
        await prisma.user.deleteMany({ where: { email: { in: emails } } });
        if (localityId)
          await prisma.locality.delete({ where: { id: localityId } });
        if (cityId) await prisma.city.delete({ where: { id: cityId } });
        if (propertyTypeId)
          await prisma.propertyType.delete({ where: { id: propertyTypeId } });
        if (amenityId)
          await prisma.amenity.delete({ where: { id: amenityId } });
        assert.equal(
          await prisma.user.count({ where: { email: { in: emails } } }),
          0,
        );
        if (localityId)
          assert.equal(
            await prisma.listing.count({ where: { localityId } }),
            0,
          );
        t.diagnostic(
          "All temporary pipeline users, sessions/accounts, listings and references cleaned up.",
        );
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
        if (browser) await browser.close();
        await prisma.$disconnect();
      }
    }
  },
);
