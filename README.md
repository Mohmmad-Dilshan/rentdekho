# RentDekho

RentDekho.in is a hyperlocal rental marketplace initially focused on Bhilwara,
Rajasthan, India.

## Current stage

Milestone 2: foundation guardrails. The application contains an accessible
placeholder homepage, with TypeScript, linting, and formatting checks for continued
development. Product features, external services, and CI are not implemented.

## Local setup

Install Node.js **24.21.0**, recorded in [`.nvmrc`](.nvmrc), and use its bundled
npm **11.19.0**, also recorded in `package.json`.

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
npm run lint
npm run format:check
npm run build
npm start
```

The typecheck command generates Next.js route types and runs TypeScript without
emitting application files. Run the typecheck, lint, and formatting checks
separately from the production build. The build command creates the production
build; `npm start` serves that build at [http://localhost:3000](http://localhost:3000).

To apply formatting, run the following command. It writes changes to project files:

```sh
npm run format
```

On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`
(for example, `npm.cmd run dev`).

See [the architecture notes](docs/architecture.md) for the approved structure and
decisions deferred to later milestones.
