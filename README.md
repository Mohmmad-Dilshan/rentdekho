# RentDekho

RentDekho.in is a hyperlocal rental marketplace initially focused on Bhilwara,
Rajasthan, India.

## Current stage

Milestone 4: domain and data foundation. The application contains an accessible
placeholder homepage, quality checks, a lightweight health endpoint, and a
PostgreSQL/Prisma schema. Product features and external services are not implemented.

## Local setup

Install Node.js **24.21.0**, recorded in [`.nvmrc`](.nvmrc), and use its bundled
npm **11.19.0**, also recorded in `package.json`.

From the repository root, install the locked dependencies:

```sh
npm ci
```

Copy [`.env.example`](.env.example) to an ignored `.env` file and set `DATABASE_URL`
to the connection URL for your local PostgreSQL instance. Do not commit credentials.
The application does not connect to the database until server code imports the Prisma
client.

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
```

The typecheck command generates Next.js route types and runs TypeScript without
emitting application files. Run these checks separately from the production build.

To apply formatting, run the following command. It writes changes to project files:

```sh
npm run format
```

On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`
(for example, `npm.cmd run dev`).

See [the architecture notes](docs/architecture.md) for the approved structure and
decisions deferred to later milestones.
