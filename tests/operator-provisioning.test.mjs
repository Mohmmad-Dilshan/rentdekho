import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  provisionSupplier,
  provisionCatalog,
} from "../src/server/provisioning/operator-provisioning.mjs";

test("supplier requires one exact stable ID and supported target role", async () => {
  const database = {
    $transaction: () => {
      throw new Error("Unexpected database access");
    },
  };
  for (const userId of [
    undefined,
    "",
    "owner@example.invalid",
    ["abcdefghij", "klmnopqrst"],
    "abcdefghij,klmnopqrst",
  ]) {
    await assert.rejects(
      provisionSupplier(database, { userId, role: "OWNER", mode: "dry-run" }),
      /EXACT_USER_ID_REQUIRED/,
    );
  }
  for (const role of ["ADMIN", "TENANT", "UNKNOWN"]) {
    await assert.rejects(
      provisionSupplier(database, {
        userId: "abcdefghij",
        role,
        mode: "dry-run",
      }),
      /UNSUPPORTED_TARGET_ROLE/,
    );
  }
});

test("invalid mode cannot reach any provisioning transaction", async () => {
  const database = {
    $transaction: () => {
      throw new Error("Unexpected database access");
    },
  };
  await assert.rejects(
    provisionSupplier(database, { mode: "invalid" }),
    /INVALID_MODE/,
  );
  await assert.rejects(
    provisionCatalog(database, {}, { mode: "invalid" }),
    /INVALID_MODE/,
  );
});

test("operator command refuses missing acknowledgement, ambiguous and unsupported flags", () => {
  for (const args of [
    ["supplier", "--dry-run", "--user-id", "abcdefghij", "--role", "OWNER"],
    [
      "supplier",
      "--operator",
      "--apply",
      "--user-id",
      "abcdefghij",
      "--role",
      "OWNER",
    ],
    ["supplier", "--operator", "--dry-run", "--apply"],
    [
      "supplier",
      "--operator",
      "--dry-run",
      "--email",
      "secret@example.invalid",
    ],
    [
      "supplier",
      "--operator",
      "--dry-run",
      "--user-id",
      "abcdefghij",
      "--user-id",
      "klmnopqrst",
      "--role",
      "OWNER",
    ],
    ["SECRET_CANARY", "--operator", "--dry-run"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--conditions=react-server", "scripts/operator-provision.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout);
    assert.ok(output.error);
    assert.ok(!result.stdout.includes("SECRET_CANARY"));
    assert.ok(!result.stdout.includes("secret@example.invalid"));
    assert.equal(result.stderr, "");
  }
});

test("server-only service rejects ordinary Node imports", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import './src/server/provisioning/operator-provisioning.mjs'",
    ],
    { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be imported from a Client Component/);
});
