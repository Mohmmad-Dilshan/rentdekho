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
- **Built-in styling:** a small global stylesheet serves the placeholder. Use
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

## Current scope and deferred decisions

The foundation contains the application scaffold, placeholder homepage, runtime
and dependency declarations, TypeScript configuration, and setup documentation.
Milestone 2 adds linting and formatting guardrails. TypeScript, lint, and formatting
checks run separately from the production build.

Milestone 3 adds a portable deployment baseline. Node.js 24.21.0 and npm 11.19.0
remain required. No environment variable is currently needed; `.env.example`
documents that fact and local `.env*` files remain ignored. `poweredByHeader` is
disabled in the Next.js configuration, and browser production source maps use the
framework default of being disabled.

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

Authentication, listing submission or display, administration, search, payments,
database queries from application routes, media uploads, reviews, chat,
notifications, analytics, and seed data are not implemented. CI, Git hooks, and
testing frameworks are not included in this milestone.

PostgreSQL and managed object storage are recommendations for future structured
data and photos. Providers, database tooling, migrations, authentication, hosting,
and domain rules will be selected in their respective milestones. They add no
dependencies or service requirements to this scaffold.
