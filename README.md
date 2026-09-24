# RentDekho

RentDekho.in is a hyperlocal rental marketplace initially focused on Bhilwara,
Rajasthan, India.

## Current stage

Milestone 3: deployment baseline. The application contains an accessible
placeholder homepage, quality checks, and a lightweight health endpoint. Product
features, external services, and CI are not implemented.

## Local setup

Install Node.js **24.21.0**, recorded in [`.nvmrc`](.nvmrc), and use its bundled
npm **11.19.0**, also recorded in `package.json`.

From the repository root, install the locked dependencies:

```sh
npm ci
```

No environment variables, database, or other external services are required. The
tracked [`.env.example`](.env.example) records this baseline; do not create or
commit real credentials.

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

Deploy to a normal Node.js environment that provides Node.js 24.21.0 and runs
`npm ci`, `npm run build`, and `npm start`. This repository does not select a
hosting provider or require platform-specific configuration.

## Validation

```sh
npm run typecheck
npm run lint
npm run format:check
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
