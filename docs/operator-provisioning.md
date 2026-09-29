# M11 controlled supply provisioning

These commands are privileged host operations, not application features. Only
operators authorized to access the deployment host and its PostgreSQL credentials
may run them. Restrict shell access and database credentials accordingly. The
`--operator` flag acknowledges this responsibility; it does not authenticate an
operator. No HTTP route, public UI, role selector, or ADMIN promotion command exists.

Use Node 24.21.0 / npm 11.19.0 from the repository root. Commands use process
`DATABASE_URL`, falling back to the ignored local `.env` only when it is unset.
Verify the intended database in your secure operator environment before running.
Never pass credentials on the command line or put them in catalogs, logs or Git.
The explicit `react-server` Node condition permits the server-only service in this
host process; it does not make the service accessible through the application.

## Existing supplier accounts

The person first registers through the unchanged authentication flow as TENANT.
Obtain and independently verify their exact `User.id` through authorized database
inspection. Email searches, names, lists of IDs and fuzzy identities are not accepted.
The command never creates an account or changes its identity/authentication data.

```sh
npm run operator:provision -- supplier --operator --dry-run --user-id <exact-user-id> --role OWNER
npm run operator:provision -- supplier --operator --apply --user-id <exact-user-id> --role OWNER --confirm <dry-run-confirmation>
```

Use BROKER instead of OWNER for an approved broker. Review the first command's
summary before applying. Only TENANT to OWNER/BROKER is supported. Assigning the
same role again is a no-op, including no `updatedAt` change. OWNER to BROKER,
BROKER to OWNER, ADMIN modification, unsupported targets and missing accounts are
refused. Repeat the dry run after any changed account state; confirmation is bound
to the ID, target, current role and current update timestamp.

## Reference catalog contract

Use UTF-8 JSON with exactly four arrays: `cities`, `localities`, `propertyTypes`,
`amenities`. Empty arrays are allowed. Maximum file size is 1 MiB and maximum total
rows is 1,000. Required string fields have at most 200 characters and must be
nonempty after PostgreSQL whitespace normalization. Unknown object fields are rejected.

| Array         | Exact row fields               | Identity                                        |
| ------------- | ------------------------------ | ----------------------------------------------- |
| cities        | `name`, `state`, `countryCode` | Canonical name + canonical state + country code |
| localities    | `name`, `city`                 | Resolved city + canonical locality name         |
| propertyTypes | `code`, `label`                | Normalized code                                 |
| amenities     | `code`, `label`                | Normalized code                                 |

`city` on a locality is an object with exactly `name`, `state`, `countryCode`,
matching a valid city in the catalog or an existing database city. Country codes
must be two uppercase ASCII letters. Do not use transient import IDs as city references.

PostgreSQL performs casing and POSIX whitespace trimming using the same expressions
as the committed CHECK constraints. Name/state display casing is retained; their
canonical keys are lowercase. Codes become uppercase and trimmed. Labels are trimmed.
Existing identities must have matching normalized display values/labels; changing
their spelling, casing or label is a conflict, not an implicit update. Duplicate
canonical identities within one array are rejected even when identical. Locality
names may repeat in different cities.

The following illustrates structure only. These are explicitly synthetic placeholders,
not approved Bhilwara records. Do not apply this example to a real database.

```json
{
  "cities": [
    {
      "name": "Synthetic Test City",
      "state": "Test State",
      "countryCode": "IN"
    }
  ],
  "localities": [
    {
      "name": "Synthetic Test Locality",
      "city": {
        "name": "Synthetic Test City",
        "state": "Test State",
        "countryCode": "IN"
      }
    }
  ],
  "propertyTypes": [{ "code": "TEST_HOME", "label": "Synthetic test home" }],
  "amenities": [{ "code": "TEST_AMENITY", "label": "Synthetic test amenity" }]
}
```

Real catalog records must come from an approved, reviewed source. Keep that catalog
and its approval record under the team's version-control process, outside the database;
M11 deliberately supplies no real catalog. Operators must check names, city membership
and classification quality; normalization cannot prove real-world correctness.

```sh
npm run operator:provision -- catalog --operator --dry-run --file <approved-catalog.json>
npm run operator:provision -- catalog --operator --apply --file <approved-catalog.json> --confirm <dry-run-confirmation>
```

Dry run uses a PostgreSQL READ ONLY transaction. It reports accepted/rejected rows,
duplicates, conflicts, per-row error codes, create/reuse plans and a confirmation
digest. An invalid catalog exits nonzero and must not be applied. Accepted means
individually valid rows, not approval of a catalog containing rejected rows.

Apply replans inside a serializable transaction and checks the reviewed digest
before writing. It creates missing records and reuses matches; it never updates or
deletes reference data. Any invalid row or later database failure rolls back the
entire operation. Concurrent changes may cause a serialization failure or stale
confirmation: repeat dry run and review, rather than automatically retrying writes.
Repeat an already applied catalog with a new dry run; all matching rows are reused.

## Execution records and recovery

Each invocation emits one JSON summary with operation, mode, timestamp, source
basename, counts, plans/role assignment, confirmation and safe error codes.
No passwords, session tokens, connection URLs, auth secrets or raw database
exceptions are printed. User IDs in role summaries are operational identifiers;
restrict access to these records. Capture stdout and exit status in your approved
operator record system; M11 does not introduce a persistent audit table.

`created`/`updated` count completed writes in a successful apply. Dry runs report
`wouldCreate`/`wouldUpdate`; `reused` includes already matching records. Invalid
input/state exits 1. Unexpected database/file failures use a generic safe code.
Use secured database/host diagnostics for investigation without publishing credentials.

Failed transactions leave no partial rows. If a connection is lost during commit,
the client cannot establish the outcome: inspect the exact account or rerun a dry
run before retrying. A successfully committed operation has no automatic undo;
corrections, role revocation and catalog changes require a separately authorized
procedure. Do not delete referenced rows as recovery.

## Separate initial ADMIN bootstrap

This is a manually controlled database procedure, not a supplier command:

1. Have the designated initial administrator register normally as TENANT.
2. Through authorized database access, verify their exact User ID and identity.
3. In a transaction, inspect and lock that exact user row. Verify that no ADMIN
   exists and that the intended row is still TENANT. Abort if either check fails.
4. Use a parameterized database statement to update only that ID with source role
   TENANT to ADMIN, also maintaining `updatedAt`. Require exactly one affected row.
5. Commit, retain a restricted operation record, and sign out/in to verify access.

Serialize bootstrap through a single authorized operator/maintenance window; the
schema does not impose a unique-ADMIN constraint. Do not edit Account password
hashes, session tokens, or authentication secrets. Further ADMIN provisioning is
outside M11 and must not reuse the supplier command.

## Synthetic validation

Use a separately created, migrated disposable local database named
`rentdekho_m11_test_<unique-suffix>`. Set **both** process `DATABASE_URL` and
`M11_TEST_DATABASE_URL` to it when running the full suite. Do not change `.env`.
The first variable directs existing M9 tests; the second explicitly opts into M11
integration tests, which refuse remote hosts and unrelated database names.

```sh
npm run prisma:migrate:deploy
npm run test:provisioning
npm test
```

Tests create unique synthetic users/reference rows and pending submissions, remove
them transactionally in `finally`, and assert zero leftovers. Tests never provision
real accounts. Without `M11_TEST_DATABASE_URL`, M11 database coverage is explicitly
skipped; non-database command tests still run. After verifying cleanup, dispose of
the test database through authorized database operations.
