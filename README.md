# RentDekho

RentDekho.in is a hyperlocal rental marketplace initially focused on Bhilwara,
Rajasthan, India.

## Current stage

Milestone 7: moderation and publishing foundation. The application contains an accessible
placeholder homepage, quality checks, a lightweight health endpoint, a
PostgreSQL/Prisma schema, minimal email/password authentication, owner-side listing
submission, and ADMIN-only listing moderation. Public marketplace features and
external services are not implemented.

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
`npm test` uses Node.js's built-in test runner and exercises the in-memory
authentication flow and authorization rules without a PostgreSQL connection.

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
