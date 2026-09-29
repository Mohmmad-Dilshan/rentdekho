import "server-only";
import { createHash } from "node:crypto";

const groups = ["cities", "localities", "propertyTypes", "amenities"];
const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = (city) =>
  JSON.stringify([city.canonicalName, city.canonicalState, city.countryCode]);

export class ProvisioningError extends Error {
  constructor(code, report) {
    super(code);
    this.name = "ProvisioningError";
    this.report = report;
  }
}

function objectWithKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function text(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes("\0")
  );
}

// Use the database's own collation, casing and POSIX whitespace semantics.
async function normalizedText(tx, value) {
  const [row] = await tx.$queryRaw`
    SELECT regexp_replace(${value}::text, '^[[:space:]]+|[[:space:]]+$', '', 'g') AS display,
      lower(regexp_replace(${value}::text, '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS canonical,
      upper(regexp_replace(${value}::text, '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS code`;
  if (!row.display) throw new ProvisioningError("EMPTY_FIELD");
  return row;
}

async function normalizeCity(tx, city) {
  if (
    !objectWithKeys(city, ["name", "state", "countryCode"]) ||
    !text(city.name) ||
    !text(city.state) ||
    typeof city.countryCode !== "string" ||
    !/^[A-Z]{2}$/.test(city.countryCode)
  ) {
    throw new ProvisioningError("INVALID_CITY_FIELDS");
  }
  const name = await normalizedText(tx, city.name);
  const state = await normalizedText(tx, city.state);
  return {
    name: name.display,
    canonicalName: name.canonical,
    state: state.display,
    canonicalState: state.canonical,
    countryCode: city.countryCode,
  };
}

function checkConfirmation(mode, confirm, digest, report) {
  if (mode !== "dry-run" && mode !== "apply")
    throw new ProvisioningError("INVALID_MODE");
  if (mode === "apply" && confirm !== digest) {
    throw new ProvisioningError(
      "DRY_RUN_CONFIRMATION_REQUIRED_OR_STALE",
      report,
    );
  }
}

export async function provisionSupplier(
  prisma,
  { userId, role, mode, confirm },
) {
  if (mode !== "dry-run" && mode !== "apply")
    throw new ProvisioningError("INVALID_MODE");
  if (typeof userId !== "string" || !/^[a-z0-9]{10,36}$/.test(userId)) {
    throw new ProvisioningError("EXACT_USER_ID_REQUIRED");
  }
  if (role !== "OWNER" && role !== "BROKER")
    throw new ProvisioningError("UNSUPPORTED_TARGET_ROLE");
  return prisma.$transaction(
    async (tx) => {
      if (mode === "dry-run") await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, updatedAt: true },
      });
      if (!user) throw new ProvisioningError("ACCOUNT_NOT_FOUND");
      if (user.role !== "TENANT" && user.role !== role)
        throw new ProvisioningError("ROLE_TRANSITION_REFUSED");
      const report = {
        operation: "supplier",
        mode,
        userId,
        fromRole: user.role,
        toRole: role,
        updated: 0,
        reused: user.role === role ? 1 : 0,
        wouldUpdate: user.role === "TENANT" ? 1 : 0,
      };
      const digest = fingerprint({
        userId,
        role,
        currentRole: user.role,
        updatedAt: user.updatedAt,
      });
      report.confirmation = digest;
      checkConfirmation(mode, confirm, digest, report);
      if (mode === "apply" && user.role === "TENANT") {
        const result = await tx.user.updateMany({
          where: { id: userId, role: "TENANT", updatedAt: user.updatedAt },
          data: { role },
        });
        if (result.count !== 1)
          throw new ProvisioningError("ACCOUNT_CHANGED_RETRY_DRY_RUN");
        report.updated = 1;
      }
      return report;
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
}

async function planCatalog(tx, input) {
  const report = {
    operation: "catalog",
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    conflicts: 0,
    created: 0,
    reused: 0,
    wouldCreate: 0,
    errors: [],
    changes: [],
  };
  if (
    !objectWithKeys(input, groups) ||
    groups.some((group) => !Array.isArray(input[group])) ||
    groups.reduce((total, group) => total + input[group].length, 0) > 1000
  ) {
    throw new ProvisioningError("INVALID_CATALOG_SHAPE_OR_SIZE", report);
  }
  const plan = [];
  const cities = new Map();
  for (const group of groups) {
    const seen = new Set();
    for (const [index, row] of input[group].entries()) {
      try {
        let data, key, existing, cityKey;
        if (group === "cities") {
          data = await normalizeCity(tx, row);
          key = identity(data);
          existing = await tx.city.findUnique({
            where: {
              canonicalName_canonicalState_countryCode: {
                canonicalName: data.canonicalName,
                canonicalState: data.canonicalState,
                countryCode: data.countryCode,
              },
            },
          });
        } else if (group === "localities") {
          if (!objectWithKeys(row, ["name", "city"]) || !text(row.name))
            throw new ProvisioningError("INVALID_LOCALITY_FIELDS");
          const city = await normalizeCity(tx, row.city);
          cityKey = identity(city);
          let parent = cities.get(cityKey);
          if (!parent) {
            const found = await tx.city.findUnique({
              where: {
                canonicalName_canonicalState_countryCode: {
                  canonicalName: city.canonicalName,
                  canonicalState: city.canonicalState,
                  countryCode: city.countryCode,
                },
              },
            });
            if (!found) throw new ProvisioningError("UNKNOWN_CITY");
            if (found.name !== city.name || found.state !== city.state)
              throw new ProvisioningError("CONFLICTING_CITY_DEFINITION");
            parent = { id: found.id, data: city };
            cities.set(cityKey, parent);
          }
          if (
            parent.data.name !== city.name ||
            parent.data.state !== city.state
          )
            throw new ProvisioningError("CONFLICTING_CITY_DEFINITION");
          const name = await normalizedText(tx, row.name);
          data = { name: name.display, canonicalName: name.canonical };
          key = JSON.stringify([cityKey, data.canonicalName]);
          existing = parent.id
            ? await tx.locality.findUnique({
                where: {
                  cityId_canonicalName: {
                    cityId: parent.id,
                    canonicalName: data.canonicalName,
                  },
                },
              })
            : null;
        } else {
          if (
            !objectWithKeys(row, ["code", "label"]) ||
            !text(row.code) ||
            !text(row.label)
          )
            throw new ProvisioningError("INVALID_REFERENCE_FIELDS");
          data = {
            code: (await normalizedText(tx, row.code)).code,
            label: (await normalizedText(tx, row.label)).display,
          };
          key = data.code;
          existing = await tx[
            group === "propertyTypes" ? "propertyType" : "amenity"
          ].findUnique({ where: { code: data.code } });
        }
        if (seen.has(key))
          throw new ProvisioningError("DUPLICATE_CANONICAL_IDENTITY");
        seen.add(key);
        if (
          existing &&
          Object.entries(data).some(
            ([field, value]) => existing[field] !== value,
          )
        ) {
          throw new ProvisioningError("CONFLICTING_EXISTING_DEFINITION");
        }
        if (group === "cities") cities.set(key, { id: existing?.id, data });
        const item = {
          group,
          index,
          key,
          data,
          cityKey,
          existingId: existing?.id,
        };
        plan.push(item);
        report.accepted++;
        if (existing) report.reused++;
        else report.wouldCreate++;
        report.changes.push({
          group,
          row: index + 1,
          action: existing ? "reuse" : "create",
        });
      } catch (error) {
        if (!(error instanceof ProvisioningError)) throw error;
        report.rejected++;
        if (error.message.startsWith("DUPLICATE")) report.duplicates++;
        if (error.message.startsWith("CONFLICTING")) report.conflicts++;
        report.errors.push({ group, row: index + 1, code: error.message });
      }
    }
  }
  return { report, plan, cities };
}

export async function provisionCatalog(prisma, input, { mode, confirm }) {
  if (mode !== "dry-run" && mode !== "apply")
    throw new ProvisioningError("INVALID_MODE");
  return prisma.$transaction(
    async (tx) => {
      if (mode === "dry-run") await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const { report, plan, cities } = await planCatalog(tx, input);
      report.mode = mode;
      report.confirmation = fingerprint(plan);
      if (report.rejected) {
        if (mode === "apply")
          throw new ProvisioningError("CATALOG_REJECTED_NO_WRITES", report);
        return report;
      }
      checkConfirmation(mode, confirm, report.confirmation, report);
      if (mode === "apply") {
        for (const item of plan) {
          if (item.existingId) continue;
          const model = {
            cities: "city",
            localities: "locality",
            propertyTypes: "propertyType",
            amenities: "amenity",
          }[item.group];
          const data =
            item.group === "localities"
              ? { ...item.data, cityId: cities.get(item.cityKey).id }
              : item.data;
          const created = await tx[model].create({
            data,
            select: { id: true },
          });
          if (item.group === "cities") cities.get(item.key).id = created.id;
          report.created++;
        }
      }
      return report;
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
}
