# RentDekho

RentDekho.in is a hyperlocal rental marketplace initially focused on Bhilwara,
Rajasthan, India.

## Current stage

Milestone 1: minimal project scaffold. The application contains an accessible
placeholder homepage. Product features and external services have not been
implemented.

## Local setup

Install Node.js 24 LTS using the exact version recorded in [`.nvmrc`](.nvmrc).
Use npm, which is bundled with Node.js.

From the repository root, install the locked dependencies:

```sh
npm ci
```

No environment variables, database, or other external services are required.

## Development

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Stop the server with `Ctrl+C`.

## Validation and production build

```sh
npm run typecheck
npm run build
npm start
```

The typecheck command generates Next.js route types and runs TypeScript without
emitting application files. The build command creates the production build;
`npm start` serves that build at [http://localhost:3000](http://localhost:3000).

On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`
(for example, `npm.cmd run dev`).

See [the architecture notes](docs/architecture.md) for the approved structure and
decisions deferred to later milestones.
