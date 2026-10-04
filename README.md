# RentDekho

RentDekho.in is a hyperlocal rental marketplace initially focused on Bhilwara,
Rajasthan, India.

## Current stage

Milestone 13 adds controlled supplier corrections and ADMIN re-review to the
Bhilwara-first rental marketplace. Published rentals can be browsed and called when
the listing has a consented contact number. Authenticated OWNER/BROKER accounts can
submit and correct their own listings; ADMIN controls publication. Media remains
deferred.

M11 adds host-only supplier and reference-data provisioning. See the
[operator guide](docs/operator-provisioning.md) for authority, reviewed dry runs,
transactional apply, the JSON contract and separate initial-ADMIN bootstrap.
No public role management or reference-data dashboard is introduced.

## Local setup

Install Node.js **24.21.0**, recorded in [`.nvmrc`](.nvmrc), and use its bundled
npm **11.19.0**, also recorded in `package.json`.

From the repository root, install the locked dependencies:

```sh
npm ci
```

Copy [`.env.example`](.env.example) to an ignored `.env` file. Set `DATABASE_URL` to
the connection URL for your local PostgreSQL instance, `BETTER_AUTH_SECRET` to a
strong secret, and `BETTER_AUTH_URL` to the local application origin (normally
`http://localhost:3000`). Do not commit credentials. `BETTER_AUTH_TRUSTED_ORIGINS`
is optional and only needed for additional trusted origins.

## Database foundation

RentDekho uses PostgreSQL with Prisma ORM. The schema is in
[`prisma/schema.prisma`](prisma/schema.prisma), and the server-only client boundary
is in [`src/server/db/prisma.ts`](src/server/db/prisma.ts). Generated Prisma Client
files are regenerated as needed.

City and locality display names retain their human-readable form alongside required
canonical lowercase, trimmed keys. Property-type and amenity codes are required to
be uppercase and trimmed. PostgreSQL check constraints verify this normalization and
also prevent non-positive rent or negative deposits; Prisma 6 cannot express those
checks in its schema DSL, so they are maintained in the initial migration SQL.

Create and apply a local development migration only after configuring a real local
PostgreSQL database:

```sh
npm run prisma:migrate:dev -- --name initial_domain
npm run prisma:generate
```

Use `npm run prisma:migrate:deploy` to apply committed migrations in a deployment
environment. Never run `prisma migrate dev` against production.

## Identity and permissions foundation

RentDekho uses [Better Auth](https://better-auth.com) with its Prisma adapter for
email/password accounts and persistent database-backed sessions. Better Auth owns
password hashing, session cookies, CSRF protection, and session invalidation; this
project does not implement custom password or token cryptography.

The minimal public flow is available at `/sign-up` and `/sign-in`. `/account` is a
small protected page that confirms the current server-side session and provides
sign-out. The Better Auth route is mounted at `/api/auth/[...all]`. It is an
authentication integration endpoint, not a general product API.

`User` remains the ownership anchor for future listings through `Listing.ownerId`.
Every newly registered account receives the `TENANT` role at the server/database
boundary. The role enum also reserves `OWNER`, `BROKER`, and `ADMIN` for future
approved workflows; registration cannot set a role. Server-only helpers in
`src/server/auth/authorization.ts` provide `getCurrentUser`, `requireUser`,
`requireRole`, and `requireListingOwnership` for future server-side operations.

Production requires `BETTER_AUTH_SECRET` and a correct `BETTER_AUTH_URL`. Supply
both through the hosting environment, never through `NEXT_PUBLIC_*` variables. Keep
the authentication route on the same origin unless `BETTER_AUTH_TRUSTED_ORIGINS` is
explicitly configured. Email verification delivery, password-recovery email,
social login, profile management, and administrative interfaces are intentionally
not implemented.

## Development

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Stop the server with `Ctrl+C`.

## Production-like local run

Build and serve the application with the same commands used by a standard Node.js
hosting environment:

```sh
npm run build
npm start
```

`npm start` serves the completed production build at
[http://localhost:3000](http://localhost:3000). A deployment health check can
request [http://localhost:3000/api/health](http://localhost:3000/api/health), which
returns HTTP 200 with `{ "status": "ok" }`. It does not contact external services.

Deploy to a normal Node.js environment that provides Node.js 24.21.0, a PostgreSQL
database, and `DATABASE_URL`, then runs `npm ci`, `npm run prisma:migrate:deploy`,
`npm run build`, and `npm start`. This repository does not select a hosting provider
or require platform-specific configuration.

## Validation

```sh
npm run typecheck
npm run lint
npm run format:check
npm run prisma:validate
npm test
```

The typecheck command generates Next.js route types and runs TypeScript without
emitting application files. Run these checks separately from the production build.
`npm test` uses Node.js's built-in test runner for service/action regressions and
PostgreSQL owner, provisioning, contact, and correction suites. Database suites
skip when their `DATABASE_URL` or M11/M12/M13 test database URL is absent; use
separate migrated, disposable databases to exercise them.

The `RentDekho CI` workflow runs these checks and `npm run build` on pushes and
pull requests to `main`, using Node.js 24.21.0, npm 11.19.0, and `npm ci`.
It starts a disposable PostgreSQL 16 service, applies the committed migrations
to separate owner, M11, M12, and M13 test databases, and requires `npm test`
to finish without skipped tests. The production browser pipeline remains a
separate opt-in check; it needs a running production server, Chrome, and a
Playwright module as described below.

To apply formatting, run the following command. It writes changes to project files:

```sh
npm run format
```

On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`
(for example, `npm.cmd run dev`).

See [the architecture notes](docs/architecture.md) for the approved structure and
decisions deferred to later milestones.

## Listing submission foundation

Authenticated `OWNER` and `BROKER` accounts can use `/listings/new` to submit a
rental listing. The server derives ownership from the active session, validates
every submitted value and reference ID, stores money as integer paise, and always
creates the listing with `PENDING_REVIEW` status. A browser cannot set `ownerId` or
publish a listing through this flow.

The form loads existing cities, localities, property types, and amenities from
PostgreSQL. It intentionally creates no reference data. If cities, localities, or
property types have not been provisioned through controlled operations, submission
is unavailable. Public registration remains `TENANT`; owner and broker roles are
provisioned outside the application until a future approved role-management flow.

## Moderation and publishing foundation

Only authenticated `ADMIN` accounts can access `/admin/listings` and review a
pending submission. An administrator can explicitly approve or reject a listing;
the only M7 transitions are `PENDING_REVIEW` to `PUBLISHED` and
`PENDING_REVIEW` to `REJECTED`. Each action authorizes the active session on the
server and conditionally updates only a listing that is still pending, so a stale
review cannot overwrite an earlier decision.

`PUBLISHED` is the visibility state for a future public discovery milestone. M7
does not create public listing routes, owner dashboards, rejection reasons, or a
moderation history.

## M8 public marketplace

Public server-rendered routes `/`, `/rentals`, and `/rentals/[listingId]` use a
separate read-only public discovery repository. Every listing read, including
metadata and sitemap reads, requires `PUBLISHED` and selects no owner or auth data.
Unknown query parameters are ignored; malformed or duplicate values normalize to
no filter. Locality and property type use reference IDs from published inventory.
Discovery fetches 13 records for a 12-item page, ordered by createdAt DESC, id DESC.
A validated base64url date/ID cursor implements a keyset predicate without offsets.

M8 adds only the Listing(status, createdAt, id) index, via migration
`20260926000000_add_public_listing_discovery_index`. Apply using the existing
migration deployment workflow. No records are seeded. Empty inventory has an honest
empty state; database errors have a separate retry state. Contact and images remain
unavailable. Public pages are dynamic, with system fonts and responsive text cards.
Sitemap URLs use the configured BETTER_AUTH_URL origin; without it the sitemap is
empty. No production origin or canonical URL is assumed. Robots excludes internal,
auth and admin paths; robots is not an access-control mechanism.

Run `npm test` for mock-based public boundary coverage alongside M5â€“M7 tests.
A real configured PostgreSQL database is required for successful marketplace smoke
tests and migration application. No M9 features are included.

## M9 owner listing management

Authenticated OWNER and BROKER accounts can open `/my/listings` from `/account`
to see up to 25 of their newest listings and view their own listing details.
They can mark a published listing rented or withdraw a pending-review or
published listing. These changes are final in M9. Each action checks the session,
role, ownership, and source status in one conditional database update. A listing
that becomes RENTED or ARCHIVED is no longer public. Other statuses have no M9
action. No schema change or new dependency is needed.

## M10 listing pipeline regression checks

Submission and moderation `"use server"` modules export async actions and erased
types only. Initial UI state lives in the consuming client component. Money
inputs accept unsigned integers or decimals with one or two fractional digits;
rent is required and must be positive on the server, while an empty deposit is
stored as null. Server validation remains authoritative.

`npm test` includes `tests/listing-actions.test.mjs`, which imports the action
source with boundary doubles, runs the installed Next.js export validator, and
checks server authorization and invalid-input rejection.

Run `npm run test:pipeline:browser` separately against a local **production**
server built with `npm run build`. It requires the same disposable PostgreSQL
database as the server, valid process/local authentication configuration, Chrome,
and an already available Playwright installation. No browser package is added to
the project's dependencies. Set these process variables before running it:

- `M10_BASE_URL`: the local server origin, for example `http://localhost:3109`.
- `M10_PLAYWRIGHT_MODULE`: a file URL to the existing Playwright `index.mjs`.
- `M10_CHROME_EXECUTABLE`: optional Chrome path; the default is the standard
  Windows Chrome installation.

The browser test exercises actual HTML input validity, OWNER/BROKER submission,
ADMIN approval/rejection, unauthorized action requests, competing moderation,
public detail/discovery/metadata/sitemap visibility, and M9 terminal actions on
desktop and 375px mobile. It creates uniquely identified disposable users,
references and listings, then removes them in `finally`, including cascaded
authentication records. Never run it against production data. Without its
prerequisites the opt-in command fails rather than silently passing.

## M12 consented listing contact

During listing submission, an OWNER or BROKER may provide a listing-specific Indian
mobile number and separately consent to its public display. Enter ten digits beginning
with 6–9, optionally prefixed by `+91`; the server stores the normalized `+91` form.
The server rejects malformed numbers and consent without a valid number. A valid
number without consent remains private. ADMIN can see the submitted number and consent
while reviewing the pending listing. Approval does **not** verify ownership of the
number, the supplier, the property, or availability.

Only a `PUBLISHED` listing with consent and a valid stored number shows a call link
on its public detail page. Other statuses, discovery cards, metadata and sitemap
never expose contact. Existing listings have no fabricated number and honestly show
contact unavailable. Contact can attract unsolicited calls because it is public.
Suppliers should use a number they are authorized and willing to publish.

M13 allows a supplier to correct the number on the same listing through re-review.
For urgent removal, the existing withdrawal action remains available. There is no
WhatsApp, chat, lead inbox or phone verification.
Apply the committed M12 migration with the existing migration deployment workflow.
Passing M12 validation does not establish production launch readiness.

## M13 controlled supplier corrections and re-review

An authenticated OWNER or BROKER can open "Correct listing" from their own listing
detail page for a `PENDING_REVIEW` or `PUBLISHED` listing. The correction form reuses
submission fields and server validation, including rent, references, amenities and
listing-specific contact consent. Every correction requires a fresh consent
choice before a phone number can be displayed publicly. The same listing ID and owner are kept;
the correction does not create a replacement listing.

Submitting a correction to a published listing atomically stores the corrected
content and returns it to `PENDING_REVIEW`. It immediately disappears from public
discovery, detail, metadata and sitemap, including the call action, until ADMIN
approves the corrected version. A correction to a pending listing replaces the
pending content in place and remains private. The form warns suppliers of this
temporary loss of visibility; withdrawal is still available for urgent removal.

Each listing starts at review version 1, including rows that existed before M13.
Every accepted correction increments the version. ADMIN sees the current version
and corrected content, and approval or rejection conditionally matches both
`PENDING_REVIEW` and the version that was reviewed. A stale review must reload;
it cannot decide newer content. Owner terminal actions also condition on the
expected version and source status. `RENTED`, `ARCHIVED` and `REJECTED` listings
cannot be corrected through this flow. M13 adds no new listing status or moderation
history. Apply its committed migration through the existing deployment workflow.
