import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import {
  ProvisioningError,
  provisionCatalog,
  provisionSupplier,
} from "../src/server/provisioning/operator-provisioning.mjs";

let prisma;
let operation = "unknown";
let mode = "unknown";
let source = "unspecified";
try {
  const { values, positionals, tokens } = parseArgs({
    allowPositionals: true,
    tokens: true,
    options: {
      operator: { type: "boolean" },
      "dry-run": { type: "boolean" },
      apply: { type: "boolean" },
      confirm: { type: "string" },
      file: { type: "string" },
      "user-id": { type: "string" },
      role: { type: "string" },
    },
  });
  operation = positionals[0];
  mode = values.apply ? "apply" : "dry-run";
  const suppliedOptions = tokens
    .filter((token) => token.kind === "option")
    .map((token) => token.name);
  if (
    new Set(suppliedOptions).size !== suppliedOptions.length ||
    !values.operator ||
    positionals.length !== 1 ||
    Boolean(values.apply) === Boolean(values["dry-run"]) ||
    !["catalog", "supplier"].includes(operation) ||
    (values.apply && !/^[a-f0-9]{64}$/.test(values.confirm ?? "")) ||
    (values["dry-run"] && values.confirm) ||
    (operation === "catalog" &&
      (!values.file || values["user-id"] || values.role)) ||
    (operation === "supplier" &&
      (values.file || !values["user-id"] || !values.role))
  ) {
    throw new ProvisioningError("INVALID_OPERATOR_ARGUMENTS_SEE_DOCS");
  }
  source =
    operation === "catalog"
      ? basename(values.file).replace(/[^A-Za-z0-9_.-]/g, "_")
      : "explicit-user-id";
  let input;
  if (operation === "catalog") {
    const metadata = await stat(values.file);
    if (!metadata.isFile() || metadata.size > 1024 * 1024)
      throw new ProvisioningError("CATALOG_MUST_BE_FILE_AT_MOST_1_MIB");
    const bytes = await readFile(values.file);
    if (bytes.length > 1024 * 1024)
      throw new ProvisioningError("CATALOG_EXCEEDS_1_MIB");
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new ProvisioningError("INVALID_JSON");
    }
  }
  // Host/database access is the authority. --operator is an acknowledgement, not authentication.
  if (!process.env.DATABASE_URL && existsSync(".env"))
    process.loadEnvFile(".env");
  if (!process.env.DATABASE_URL)
    throw new ProvisioningError("DATABASE_CONFIGURATION_REQUIRED");
  prisma = new PrismaClient({ log: [] });
  const report =
    operation === "catalog"
      ? await provisionCatalog(prisma, input, { mode, confirm: values.confirm })
      : await provisionSupplier(prisma, {
          userId: values["user-id"],
          role: values.role,
          mode,
          confirm: values.confirm,
        });
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      operation,
      mode,
      source,
      ...report,
    }),
  );
  if (report.rejected) process.exitCode = 1;
} catch (error) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      operation: ["catalog", "supplier"].includes(operation)
        ? operation
        : "unknown",
      mode,
      source,
      error:
        error instanceof ProvisioningError
          ? error.message
          : "OPERATION_FAILED_CHECK_STATE_BEFORE_RETRY",
      ...(error instanceof ProvisioningError && error.report
        ? { report: error.report }
        : {}),
    }),
  );
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect();
}
