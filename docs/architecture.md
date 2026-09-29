# Architecture

## Approved approach

RentDekho uses a modular monolith: one repository and one deployable Next.js
application. This keeps development, deployment, and debugging manageable while
allowing feature boundaries to grow with the product.

Next.js App Router provides routing, server rendering, and future server
endpoints within that application. Server rendering supports discoverability of
future public marketplace pages. A separate API service is not needed for the
foundation. Standard Node.js hosting is supported; the hosting provider remains
undecided.

## Foundation choices

- **TypeScript with strict checking:** catch incompatible data shapes and unsafe
  assumptions during development.
- **Node.js 24 LTS:** use the exact version recorded in `.nvmrc` for consistent
  local and deployment environments.
- **npm and `package-lock.json`:** reproduce dependency versions with `npm ci`.
- **Built-in styling:** a small global stylesheet serves the public marketplace. Use
  CSS Modules when component-specific styles are needed.
- **ESLint:** Next.js Core Web Vitals and TypeScript recommended presets check
  framework usage and TypeScript code separately from the production build.
- **Prettier:** standalone formatting commands keep code and documentation
  consistent. `eslint-config-prettier` disables ESLint rules that could conflict
  with formatting; Prettier runs separately from ESLint.
- **Editor consistency:** two-space indentation and LF line endings are recorded
  in repository configuration for Windows and Linux development.
- **Deployment baseline:** standard Node.js hosting runs `npm ci`, `npm run build`,
  and `npm start`. The application does not depend on a hosting provider, cloud
  SDK, container runtime, database, or external service.
- **Runtime health check:** `GET /api/health` returns HTTP 200 and
  `{ "status": "ok" }` without authentication, a database query, or business
  behavior. It is intended only for process readiness checks.
- **PostgreSQL and Prisma ORM:** PostgreSQL stores persistent application data;
  Prisma provides the schema, migrations, generated client, and type-safe server
  access. The project uses the provider-neutral PostgreSQL connector rather than a
  managed database service.
- **Better Auth:** email/password authentication uses Better Auth with its Prisma
  adapter. The library provides password hashing, signed session cookies, CSRF
  protections, and session lifecycle handling, so this codebase does not implement
  authentication cryptography itself.

## Application boundaries

`src/app` contains the root layout, route pages, and global styles. Components
remain server-rendered by default; introduce client components only when browser
interaction requires them.

As features are approved, introduce feature modules and shared components where
they have a concrete purpose. Keep business rules outside page components. Keep
future database access and secrets in server-only modules, and validate input at
server boundaries. Do not create empty modules or speculative abstractions.

`prisma/schema.prisma` is the source of truth for the data model, including the
PostgreSQL connection environment variable. Migrations live in `prisma/migrations`.
`src/server/db/prisma.ts` is the sole database-client boundary and imports
`server-only`, preventing client components from using database credentials.

`src/server/auth/auth.ts` is the server-only authentication configuration. It uses
the existing singleton Prisma client and is mounted only through
`src/app/api/auth/[...all]/route.ts`. `src/server/auth/authorization.ts` contains
small composable server-only helpers for resolving a session, requiring a user or a
role, and verifying listing ownership against `Listing.ownerId`. Route middleware is
not the authorization boundary: future mutations must call these helpers or perform
equivalent server-side checks.

## Current scope and deferred decisions

The foundation contains the application scaffold, placeholder homepage, runtime
and dependency declarations, TypeScript configuration, and setup documentation.
Milestone 2 adds linting and formatting guardrails. TypeScript, lint, and formatting
checks run separately from the production build.

Milestone 3 adds a portable deployment baseline. Node.js 24.21.0 and npm 11.19.0
remain required. `.env.example` documents configuration keys while local `.env*`
files remain ignored. `poweredByHeader` is disabled in the Next.js configuration,
and browser production source maps use the framework default of being disabled.

Milestone 4 adds the initial PostgreSQL domain schema. `Listing` is the primary
rental entity: a future recurring or historical property record can be introduced
only when the product needs it. A listing belongs to one `User` account, which may
later represent an owner or broker without imposing an authentication model now.
Cities and localities support Bhilwara-first operation and later expansion without
storing exact addresses or coordinates.

`PropertyType` is a reference model rather than an enum so categories such as room,
1 RK, 1/2/3 BHK, house, flat, portion, and PG can be managed without a schema
migration. `Amenity` and `ListingAmenity` provide a normalized many-to-many
relationship. Listing status, furnishing state, and tenant preference are database
enums. Rent and deposit are integer paise (`BigInt`), never floating point.
`availableFrom` is a date-only optional field. No reference data or property data is
seeded in this milestone.

Display names are distinct from canonical identity keys. City and locality writes
must store lowercase values with leading and trailing whitespace removed in their
canonical fields; property-type and amenity codes must be uppercase and trimmed.
Unique constraints use those canonical values, and PostgreSQL `CHECK` constraints
verify they match the display values or code normalization. The same migration-level
checks require positive rent and a non-negative deposit when present. Prisma 6 does
not model `CHECK` constraints in its schema DSL, so the migration documents and
enforces them directly.

Local development uses an ignored `.env` file containing `DATABASE_URL`. Run
`prisma migrate dev` only with a real development PostgreSQL database; it creates
and applies migrations and uses a shadow database. Production applies committed
migrations with `prisma migrate deploy`. Do not use development migrations in
production.

Milestone 5 evolves `User` into the identity anchor without changing its listing
ownership relationship. An account has a required email and display name,
email-verification state, optional image, and a `UserRole` enum. New registrations
always default to `TENANT`; `OWNER`, `BROKER`, and `ADMIN` are reserved for later
server-authorized workflows. Better Auth's standard `Account`, `Session`, and
`Verification` models store provider credentials, persistent session records, and
future verification tokens. Password values are library-managed hashes in `Account`
and are never read, logged, or handled by application code. Deleting a user cascades
only to its authentication accounts and sessions; `Listing.ownerId` remains
`RESTRICT` so an account with listings cannot be deleted accidentally.

Authentication configuration is private to server modules. `BETTER_AUTH_SECRET`
and `BETTER_AUTH_URL` are required deployment settings, while
`BETTER_AUTH_TRUSTED_ORIGINS` is optional for an explicitly configured additional
origin. None uses `NEXT_PUBLIC_*`. Better Auth retains its default CSRF checks and
uses secure cookie defaults in production. Email delivery, mandatory email
verification, recovery flows, social providers, profiles, role-management UI, and
admin capabilities remain deferred.

Advanced search, payments, media uploads, reviews, chat,
notifications, analytics, role-management UI, email delivery, and seed data are not
implemented. The identity foundation has a small Node.js built-in test suite that
uses Better Auth's in-memory adapter; PostgreSQL integration tests, CI, and Git hooks
remain deferred.

PostgreSQL and managed object storage are recommendations for future structured
data and photos. Providers, database tooling, migrations, authentication, hosting,
and domain rules will be selected in their respective milestones. They add no
dependencies or service requirements to this scaffold.

Milestone 6 adds the owner-side listing-submission boundary at `/listings/new`.
Only server-side `OWNER` and `BROKER` authorization may create a listing. The
submission action derives `ownerId` from the authenticated session, ignores mass
assignment fields, validates server input and database reference IDs, and uses a
Prisma transaction for reference checks plus listing and amenity creation. Every
new listing is forced to `PENDING_REVIEW`; no M6 path can create a published listing.
The form reads existing reference rows and deliberately does not seed or manage city,
locality, property-type, or amenity data.

Milestone 7 adds the ADMIN-only moderation boundary. The pending-review queue and
internal detail route select only listing data, reference labels, amenities, and the
owner's display name and email; authentication records are never exposed. Dedicated
approve and reject server actions independently require `ADMIN`, and the moderation
service repeats that authorization. It maps explicit decisions only to
`PENDING_REVIEW â†’ PUBLISHED` or `PENDING_REVIEW â†’ REJECTED`.

The Prisma moderation repository uses one conditional update matching both the
listing ID and `PENDING_REVIEW`. A zero-row update is treated as stale or no longer
pending, preventing competing reviews from overwriting an earlier decision. The
update changes only `status`; Prisma updates `updatedAt`. M7 does not retain a
moderation history or rejection reason; those require a future approved data-model
decision. `PUBLISHED` is reserved as the state a future public discovery feature may
query, but M7 exposes no public listing route.

## M8 public discovery

`public-discovery.ts` validates allowlisted URL inputs and cursor shape, bounds
pages to 12 results plus one lookahead, and coordinates read-only listing access.
`prisma-public-listings-repository.ts` is a dedicated server-only adapter: discovery,
detail, filter reference options and sitemap queries enforce PUBLISHED. Explicit
selects exclude ownership, authentication and moderation data. Detail and metadata
share the same published-only lookup and not-found behavior.

Pagination uses a validated createdAt/id tuple and a strict less-than keyset
predicate with descending ordering. The only schema change is a composite index on
status, createdAt DESC, id DESC. No public write operation exists. Filter options
come from real reference rows with published listings. Arbitrary query keys cannot
become Prisma fields. Public routes stay dynamic without caching infrastructure.

The small shared header, footer, filters and text-first cards use global CSS tokens,
system fonts and mobile-first layouts. Zero inventory and database failures are
separate states. Contact infrastructure, media and M9 remain deferred. Sitemap uses
the configured application origin, never an invented domain. Robots excludes private
areas but authorization continues to be enforced by existing server helpers.

The M8 sitemap contains at most 49,998 published listing URLs plus the homepage and
rental discovery URL (50,000 URLs total). This bounded single-sitemap implementation
is sufficient for the initial marketplace, but older entries are omitted above that
inventory size. Revisit sitemap partitioning before approaching this limit. Current
inventory size cannot be verified without a configured database connection.

## M9 owner listing management

`owner-management.ts` defines owner/broker role checks, listing-ID validation and
the two allowed actions. `prisma-owner-listings-repository.ts` uses explicit
private selects and scopes every read and write to the authenticated `ownerId`.
The `/my/listings` pages derive identity only from the session. A non-owned or
missing detail uses the same not-found response.

The only owner transitions are PUBLISHED to RENTED and PENDING_REVIEW or
PUBLISHED to ARCHIVED. An atomic conditional update includes listing ID,
owner ID and permitted source status. A zero-row update is a stale or unavailable
result. This is compatible with the existing conditional admin moderation update:
only one of competing transitions can win. Public discovery, detail and sitemap
continue to use PUBLISHED-only queries. M9 adds no migration, editing, reopening,
or contact/lead flow.

## M10 production listing pipeline reliability

Submission and moderation initial-state objects are defined in their client
components, so their `"use server"` modules expose only async actions at runtime.
Their existing state types remain type-only exports. Submission's HTML money
patterns use literal regex backslashes in JSX attributes; the unchanged service
continues validating money, roles and reference relationships on the server.

Action regressions exercise the installed Next.js runtime export validator.
The opt-in production Chrome/PostgreSQL pipeline test exercises actual routes,
browser validity, authorized and tampered requests, conditional moderation races,
and public visibility through the existing M9 lifecycle. It cleans up its unique
fixtures. M10 adds no schema, migration, dependency or lifecycle transition.

## M11 controlled supply provisioning

`scripts/operator-provision.mjs` is a privileged host CLI, backed by the server-only
`src/server/provisioning/operator-provisioning.mjs` service. Host/database credential
access is the operator authority; the explicit acknowledgement flag is not an
application authorization mechanism. No route or client imports this service.

Existing TENANT accounts can become OWNER or BROKER, with same-role no-ops and
conditional source-role/timestamp updates. ADMIN and cross-supplier transitions are
refused. Reference catalogs contain only the four existing models; PostgreSQL itself
normalizes canonical keys using the existing constraint expressions. Read-only dry
runs produce a digest of the plan; apply verifies it in a serializable transaction
before creating missing records. Matching rows are reused; conflicts are refused.
No reference updates/deletes, schema changes or new dependencies are introduced.

See [the operator guide](operator-provisioning.md) for the input contract, execution
records, separately controlled initial-ADMIN bootstrap and disposable integration
testing. Public registration and all existing listing flows remain unchanged.
