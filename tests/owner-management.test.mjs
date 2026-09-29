import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import {
  AuthenticationRequiredError,
  AuthorizationError,
} from "../src/server/auth/authorization-rules.ts";
import {
  getOwnerListing,
  listOwnerListings,
  OwnerListingInputError,
  transitionOwnerListing,
} from "../src/server/listings/owner-management.ts";

const owner = { id: "owner-1", role: "OWNER" };
const broker = { id: "broker-1", role: "BROKER" };
const listingId = "cm9listing000000000000001";

function repository(status = "PUBLISHED", ownerId = owner.id) {
  const listing = { id: listingId, ownerId, status, title: "Owned listing" };
  return {
    listing,
    calls: [],
    async listOwn(id) {
      this.calls.push({ operation: "list", id });
      return id === listing.ownerId ? [listing] : [];
    },
    async findOwn(id, requestedId) {
      this.calls.push({ operation: "find", id, requestedId });
      return id === listing.ownerId && requestedId === listing.id
        ? listing
        : null;
    },
    async transition(input) {
      this.calls.push(input);
      if (
        input.ownerId !== listing.ownerId ||
        input.listingId !== listing.id ||
        input.expectedStatus !== listing.status
      )
        return false;
      if (input.action === "MARK_RENTED" && listing.status === "PUBLISHED") {
        listing.status = "RENTED";
        return true;
      }
      if (
        input.action === "WITHDRAW" &&
        ["PUBLISHED", "PENDING_REVIEW"].includes(listing.status)
      ) {
        listing.status = "ARCHIVED";
        return true;
      }
      return false;
    },
  };
}

test("anonymous and non-owner roles cannot read or mutate", async () => {
  const db = repository();
  for (const actor of [
    null,
    { id: "tenant-1", role: "TENANT" },
    { id: "admin-1", role: "ADMIN" },
  ]) {
    const expected = actor ? AuthorizationError : AuthenticationRequiredError;
    await assert.rejects(listOwnerListings(actor, db), expected);
    await assert.rejects(getOwnerListing(actor, listingId, db), expected);
    await assert.rejects(
      transitionOwnerListing(actor, listingId, "MARK_RENTED", "PUBLISHED", db),
      expected,
    );
  }
  assert.deepEqual(db.calls, []);
});

test("OWNER and BROKER see only their own listings", async () => {
  for (const actor of [owner, broker]) {
    const db = repository("PUBLISHED", actor.id);
    assert.equal((await listOwnerListings(actor, db)).length, 1);
    assert.equal((await getOwnerListing(actor, listingId, db)).id, listingId);
    assert.equal(
      await getOwnerListing(actor, "cm9unknown00000000000001", db),
      null,
    );
    assert.equal(await getOwnerListing(actor, "bad", db), null);
  }
});

test("guessed or other-owner ID has the same private not-found and mutation result", async () => {
  const db = repository("PUBLISHED", "another-owner");
  assert.equal(await getOwnerListing(owner, listingId, db), null);
  assert.deepEqual(
    await transitionOwnerListing(
      owner,
      listingId,
      "MARK_RENTED",
      "PUBLISHED",
      db,
    ),
    { outcome: "unavailable" },
  );
  assert.deepEqual(
    await transitionOwnerListing(owner, listingId, "WITHDRAW", "PUBLISHED", db),
    { outcome: "unavailable" },
  );
  assert.equal(db.listing.status, "PUBLISHED");
});

for (const [from, action, to] of [
  ["PUBLISHED", "MARK_RENTED", "RENTED"],
  ["PUBLISHED", "WITHDRAW", "ARCHIVED"],
  ["PENDING_REVIEW", "WITHDRAW", "ARCHIVED"],
]) {
  test(`${from} ${action} changes only to ${to}`, async () => {
    const db = repository(from);
    assert.deepEqual(
      await transitionOwnerListing(owner, listingId, action, from, db),
      { outcome: "updated" },
    );
    assert.equal(db.listing.status, to);
  });
}

for (const from of ["DRAFT", "REJECTED", "RENTED", "EXPIRED", "ARCHIVED"]) {
  for (const action of ["MARK_RENTED", "WITHDRAW"]) {
    test(`${from} cannot ${action}`, async () => {
      const db = repository(from);
      assert.deepEqual(
        await transitionOwnerListing(owner, listingId, action, "PUBLISHED", db),
        { outcome: "unavailable" },
      );
      assert.equal(db.listing.status, from);
    });
  }
}

test("invalid action and listing ID cannot reach repository", async () => {
  const db = repository();
  await assert.rejects(
    transitionOwnerListing(owner, listingId, "PUBLISHED", "PUBLISHED", db),
    OwnerListingInputError,
  );
  await assert.rejects(
    transitionOwnerListing(owner, "bad", "WITHDRAW", "PUBLISHED", db),
    OwnerListingInputError,
  );
  await assert.rejects(
    transitionOwnerListing(
      owner,
      listingId,
      "MARK_RENTED",
      "PENDING_REVIEW",
      db,
    ),
    OwnerListingInputError,
  );
  assert.deepEqual(db.calls, []);
});

test("duplicate owner action has one winner and one stale result", async () => {
  const db = repository();
  const results = await Promise.all([
    transitionOwnerListing(owner, listingId, "MARK_RENTED", "PUBLISHED", db),
    transitionOwnerListing(owner, listingId, "MARK_RENTED", "PUBLISHED", db),
  ]);
  assert.deepEqual(results.map((result) => result.outcome).sort(), [
    "unavailable",
    "updated",
  ]);
});

test("withdrawal and approval race has one winner", async () => {
  const db = repository("PENDING_REVIEW");
  const withdrawal = transitionOwnerListing(
    owner,
    listingId,
    "WITHDRAW",
    "PENDING_REVIEW",
    db,
  );
  const adminApproval = Promise.resolve().then(() => {
    if (db.listing.status !== "PENDING_REVIEW") return false;
    db.listing.status = "PUBLISHED";
    return true;
  });
  const [ownerResult, adminResult] = await Promise.all([
    withdrawal,
    adminApproval,
  ]);
  assert.equal(
    Number(ownerResult.outcome === "updated") + Number(adminResult),
    1,
  );
});

test("server actions ignore submitted owner and status fields", async () => {
  const source = await readFile(
    new URL("../src/app/my/listings/[listingId]/actions.ts", import.meta.url),
    "utf8",
  );
  const serviceUrl = new URL(
    "../src/server/listings/owner-management.ts",
    import.meta.url,
  ).href;
  const rulesUrl = new URL(
    "../src/server/auth/authorization-rules.ts",
    import.meta.url,
  ).href;
  const harness = `
    import { transitionOwnerListing, OwnerListingInputError } from ${JSON.stringify(serviceUrl)};
    import { AuthenticationRequiredError, AuthorizationError } from ${JSON.stringify(rulesUrl)};
    export const writes = [];
    export let currentStatus = "PUBLISHED";
    export function setStatus(status) { currentStatus = status; }
    const requireRole = async () => ({ id: "session-owner", role: "OWNER" });
    const prisma = {};
    const revalidatePath = () => {};
    const redirect = (url) => { throw new Error("redirect:" + url); };
    const createPrismaOwnerListingRepository = () => ({
      findOwn: async (ownerId, id) => ({ id, status: currentStatus }),
      transition: async (input) => { writes.push(input); return true; }
    });
  `;
  const actions = await import(
    `data:text/javascript;base64,${Buffer.from(
      harness +
        stripTypeScriptTypes(
          source.replace(/import[\s\S]*?from\s+"[^"]+";/g, ""),
        ),
    ).toString("base64")}`
  );
  for (const [action, status, expectedAction] of [
    ["markListingRented", "PUBLISHED", "MARK_RENTED"],
    ["withdrawPublishedListing", "PUBLISHED", "WITHDRAW"],
    ["withdrawPendingListing", "PENDING_REVIEW", "WITHDRAW"],
  ]) {
    actions.setStatus(status);
    const form = new FormData();
    form.set("listingId", listingId);
    form.set("ownerId", "another-owner");
    form.set("targetStatus", "PUBLISHED");
    form.set("currentStatus", "DRAFT");
    await assert.rejects(actions[action]({ error: null }, form), /redirect:/);
    assert.deepEqual(actions.writes.at(-1), {
      ownerId: "session-owner",
      listingId,
      action: expectedAction,
      expectedStatus: status,
    });
  }
});
