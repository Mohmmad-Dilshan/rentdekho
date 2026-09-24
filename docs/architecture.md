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

## Application boundaries

`src/app` contains the root layout, route pages, and global styles. Components
remain server-rendered by default; introduce client components only when browser
interaction requires them.

As features are approved, introduce feature modules and shared components where
they have a concrete purpose. Keep business rules outside page components. Keep
future database access and secrets in server-only modules, and validate input at
server boundaries. Do not create empty modules or speculative abstractions.

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

Authentication, property listings, administration, search, payments, database
integration, and media uploads are not implemented. CI, Git hooks, and testing
frameworks are not included in this milestone.

PostgreSQL and managed object storage are recommendations for future structured
data and photos. Providers, database tooling, migrations, authentication, hosting,
and domain rules will be selected in their respective milestones. They add no
dependencies or service requirements to this scaffold.
