# AGENTS.md — rowboat-www Engineering Guide

This file describes the established implementation patterns in `rowboat-www`
and the production-grade direction expected for future changes.

## Application Role

`rowboat-www` is a Next.js 16 App Router application with three responsibilities:

1. A public, mostly static marketing website.
2. An authenticated Oppulence dashboard.
3. A backend-for-frontend (BFF) that authenticates browser requests and proxies
   them to the Go service in `apps/rowboat-api`.

The application is self-hosted in Kubernetes using Docker, Helm, multiple
replicas, and an HPA. Do not assume that it is deployed on Vercel.

## Repository Organization

- Keep Next.js and standard tool discovery files at the application root.
- Put manually invoked architecture, contract, and quality configuration under
  `config/`; its ownership map is documented in `config/README.md`.
- Put executable contributor and deployment automation under `scripts/`.
- Put engineering records under `docs/`, while keeping domain-specific
  guidance beside the code it governs, such as `components/README.md` and
  `quality/README.md`.
- Do not add a new root-level file when an existing owned directory fits. If a
  tool supports an explicit configuration path, add its config to the relevant
  `config/` category and wire the path through `package.json`.
- When moving configuration, update scripts, policy tests, Docker/CI inputs,
  and contributor documentation in the same change.

## Current Implementation Patterns

### Routing and rendering

- The application uses the App Router under `app/`.
- `app/(marketing)` is a route group for public pages.
- Marketing pages use Server Components, `generateStaticParams`,
  `generateMetadata`, and small Client Component islands.
- `app/(product)/app/layout.tsx` is the server-authenticated product boundary;
  `proxy.ts` guarantees anonymous requests receive an HTTP redirect before
  streaming starts.
- `/app`, `/app/agents`, `/app/workflows`, `/app/settings`, and `/app/revenue`
  are real Server Component routes. They currently share the legacy
  `product-dashboard-client.tsx` island while features are extracted.
- Route handlers under `app/api` provide auth, public API documentation,
  downloads, public plan responses, and the authenticated Go API proxy.
- Next.js Cache Components and partial prefetching are enabled.

### Authentication and API boundary

- WorkOS authorization-code authentication uses PKCE.
- PKCE state and dashboard sessions are encrypted with AES-256-GCM and stored
  in HTTP-only cookies.
- Browser code never receives the WorkOS access token or refresh token.
- Browser requests use same-origin `/api/rowboat/v1/...` endpoints.
- The Next.js BFF verifies and refreshes the session, attaches the bearer token,
  and streams the Go API response back to the browser.
- `rowboat-api` remains the final authentication and authorization authority.
- Redirect targets must pass through `safeReturnTo`; never introduce arbitrary
  post-authentication redirect URLs.

Preserve this BFF boundary. Do not move access tokens into browser storage and
do not call protected Go API endpoints directly from Client Components.

### Data access

- Auth and cloud-workflow responses use Zod runtime schemas.
- `config/contracts/orval.config.ts` generates fetch clients, Zod schemas, and
  MSW mocks from the Go OpenAPI contract into `lib/api/generated`.
- Some older clients still rely on TypeScript casts after parsing JSON; their
  exact migration seams are recorded in `eslint.config.mjs`.
- Live product behavior uses SSE, polling, and effect-driven client requests.
- Independent requests are generally parallelized with `Promise.all`.
- Chat transcripts are organization/user-scoped and memory-only. Non-sensitive
  browser preferences can use `lib/storage/scoped-storage.ts`, which adds
  identity scoping, schema versioning, Zod validation, and TTL enforcement.

### UI and styling

- Tailwind CSS is the primary styling mechanism.
- Shared primitives come from `@oppulence/ui` and Radix UI.
- New product and route-private components must follow
  `components/README.md` and be created with `npm run component:new`.
- New shared primitives must use `npm run ui:add`; do not silently overwrite
  an existing customized primitive.
- The marketing site also uses MUI icons.
- Heavy dashboard features include TipTap, XYFlow, Shiki, Streamdown, and
  relationship graph components.

### Deployment

- Docker builds run from the monorepo root because this app depends on
  `packages/ui` and `packages/relationship-contract`.
- Kubernetes runs at least two replicas and can scale to four.
- Pods run as non-root with a read-only root filesystem and dropped Linux
  capabilities.
- `/healthz` is used for liveness and `/readyz` for readiness.
- Deployment includes public smoke tests.

## Required Direction for New Work

### Generate and organize React components

Use the repository generators instead of manually creating new component and
test scaffolds. The generator encodes ownership, naming, Server/Client
boundaries, accessibility, and testing conventions that CI enforces.

Choose ownership before generating:

| Component ownership | Use when                                     | Destination                                          |
| ------------------- | -------------------------------------------- | ---------------------------------------------------- |
| Shared primitive    | Domain-neutral UI reused across applications | `packages/ui/src/components/`                        |
| Product feature     | Reusable within one product domain           | `components/features/<domain>/<component>/`          |
| Route-private       | Used only by one product route subtree       | `app/(product)/app/<route>/_components/<component>/` |

#### Generate a product feature component

```bash
npm run component:new -- --kind feature --domain agents --name agent-card
```

This creates:

```text
components/features/agents/agent-card/
├── agent-card.tsx
└── agent-card.test.tsx
```

#### Generate a route-private component

```bash
npm run component:new -- \
  --kind route \
  --route revenue/relationships \
  --name relationship-toolbar
```

This creates the component and its test under:

```text
app/(product)/app/revenue/relationships/_components/relationship-toolbar/
```

#### Generate a Client Component only when required

Server Components are the default. Add `--client` only when the component
requires hooks, event handlers, or browser APIs:

```bash
npm run component:new -- \
  --kind route \
  --route workflows \
  --name schedule-form \
  --client
```

The `--client` template adds both `"use client"` and `import "client-only"` so
the module cannot accidentally enter a server-only graph.

#### Generate a shared UI primitive

Shared primitives must remain domain-neutral and contain no application,
data-access, authentication, or storage imports. Add them through the shadcn
wrapper:

```bash
npm run ui:add -- <primitive>
```

Inspect a proposed update before changing an existing customized primitive:

```bash
npm run ui:add -- button --diff
npm run ui:add -- button --view
```

Do not let the CLI silently overwrite an existing primitive. Review the diff
and apply intentional changes manually.

#### Generator contract

- Names and domains use kebab-case. Route values are slash-separated,
  kebab-case path segments.
- `--dry-run` prints the planned paths without writing files.
- The generator refuses to overwrite existing files and intentionally has no
  `--force` mode.
- Generated components use named component and Props exports, a semantic
  section root, a stable `data-slot`, native element props, and the shared
  `cn` utility. Do not add barrel exports.
- Every generated component includes a colocated Testing Library test. Tests
  should exercise the public, accessible contract through roles, names, and
  user-visible behavior rather than implementation details.
- `config/architecture/component-baseline.json` is an exact legacy baseline,
  not a place to register new exceptions.

After generation, implement the component and extend its generated test, then
run:

```bash
npm test
npm run verify:fast
```

Before merge, run `npm run verify`. Architecture rules `WEB019` and `WEB020`
enforce valid component placement and colocated tests. See
`components/README.md` for the complete component contract and migration
guidance.

### Use route-based product architecture

Do not add another major dashboard surface to the internal `view` switch in
`app/(product)/app/product-dashboard-client.tsx`.

New product areas should be real routes beneath a server-authenticated product
layout. The target structure is:

```text
app/
├── (marketing)/
├── (auth)/
└── (product)/
    └── app/
        ├── layout.tsx
        ├── loading.tsx
        ├── error.tsx
        ├── chat/page.tsx
        ├── relationships/page.tsx
        ├── agents/page.tsx
        ├── workflows/page.tsx
        └── settings/page.tsx
```

The product layout should perform the initial session check on the server,
redirect unauthenticated users before hydration, and pass only serializable
display/session data to a small Client Component provider.

Use URL paths and search parameters for meaningful navigation, selected
resources, and shareable filters. Do not make React state the only source of
truth for product navigation.

### Keep client boundaries narrow

- Server Components are the default.
- Add `"use client"` only where hooks, event handlers, or browser APIs require
  it.
- Keep stateful leaves client-side rather than marking entire pages client-side.
- Use `next/dynamic` for large editors, graphs, settings panels, and other
  features not needed during the initial render.
- Do not statically import every product area into a single route chunk.
- Add route-level `loading.tsx` and `error.tsx` boundaries for independently
  fallible product areas.

### Use a consistent validated data layer

- All untrusted network responses must be runtime-validated.
- Prefer shared Zod schemas or a generated client based on the Go API's OpenAPI
  contract.
- Do not introduce new `return (await response.json()) as T` patterns.
- Centralize error-envelope parsing, status handling, request IDs, timeouts,
  and authentication redirects.
- Use `AbortController` for cancellable requests.
- Polling must not allow overlapping asynchronous intervals.
- Prefer one query/cache layer, such as SWR or TanStack Query, for request
  deduplication, cancellation, mutations, retries, and revalidation.
- Continue parallelizing independent server and client requests.

Server Actions are not automatically preferable here. Use them for tightly
coupled RSC form mutations when appropriate. Continue using route handlers for
the Go API BFF, SSE, public endpoints, and APIs consumed outside React forms.

### Protect browser-stored data

Chat history contains potentially sensitive customer information.

- Prefer server-side conversation history when possible.
- If device-local storage remains necessary, namespace records by organization
  and user, version the schema, apply retention, and clear records on logout or
  account changes.
- Runtime-validate data read from browser storage.
- Never store access tokens, refresh tokens, secrets, or unnecessary personal
  information in `localStorage`, `sessionStorage`, or IndexedDB.
- All storage access must handle disabled storage and quota errors.

### Maintain the auth security model

- Keep tokens in encrypted HTTP-only cookies or migrate to an opaque server
  session; never expose them to client JavaScript.
- Keep `Secure`, `SameSite`, and root path cookie protections.
- Test real token bundles against browser cookie size limits.
- Test simultaneous requests during refresh-token rotation.
- Plan for cookie-encryption key rotation.
- Prefer a `__Host-` cookie prefix in production when migration permits it.
- Return stable public error codes. Do not expose raw internal service errors,
  internal URLs, or validation traces in sign-in query strings.
- Forward a narrow allowlist of request headers through the API proxy where
  practical.
- Enforce request-size and rate limits for authentication and public mutation
  endpoints at the ingress, BFF, or Go API boundary.

### Do not serve untrusted HTML from the application origin

`app/api/reference/route.ts` redirects to the external documentation origin;
it must never return downloaded upstream HTML as same-origin content. The
marketing iframe is sandboxed.

When touching API documentation:

- Prefer a separate documentation origin, or render a trusted local API
  reference from `/api/openapi`.
- Do not proxy arbitrary upstream HTML as `oppulence.io` content.
- If an iframe remains, sandbox it without `allow-same-origin` unless a reviewed
  threat model explicitly requires otherwise.
- Apply a restrictive Content Security Policy.

### Treat performance as a product requirement

- Do not add new uses of `images.unoptimized` as a workaround.
- Convert large marketing PNGs to appropriately sized AVIF or WebP assets.
- Use `next/image` with accurate `sizes` values.
- Reserve `priority` or `loading="eager"` for true above-the-fold LCP images.
- Keep below-the-fold screenshots lazy.
- Remove the global `/config.js` script if no runtime consumer remains; if it is
  required, load it only for routes that consume it.
- Run `next experimental-analyze` before and after major dashboard dependency or
  route changes.

### Add explicit error handling and observability

- Add `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, and
  route-specific error boundaries as appropriate.
- Add server instrumentation and structured logging.
- Propagate or generate request IDs across the browser, BFF, and Go API.
- Report uncaught client/server exceptions to the configured monitoring system.
- Capture Core Web Vitals for the marketing and dashboard surfaces.
- Never log complete prompts, model events, relationship evidence, tokens, or
  customer data to the production browser console.
- Debug logging must be environment-gated and sanitized.

### Accessibility and metadata

- Never disable browser zoom. Remove or avoid `maximumScale: 1` and
  `userScalable: false` viewport settings.
- Use `suppressHydrationWarning` only on the smallest known mismatch boundary.
- Use `next/image` for stable local product images unless the image is dynamic
  user/model output that cannot use the optimizer.
- Maintain keyboard behavior, focus restoration, semantic controls, reduced
  motion behavior, and useful accessible names.
- Add and maintain `robots.ts`, `sitemap.ts`, Open Graph imagery, canonical URLs,
  and unique metadata for public marketing pages.

### Production container requirements

- Prefer `output: "standalone"` for the Docker deployment.
- Copy `.next/standalone`, `.next/static`, and `public` into the runtime image
  instead of the complete development dependency tree.
- Keep runtime and CI Node versions aligned. Upgrade to Node.js 24 after
  compatibility testing.
- Preserve the non-root user, read-only root filesystem, resource limits,
  health probes, and topology constraints.
- Readiness must validate required runtime configuration and should perform a
  short, bounded dependency check when appropriate. Liveness should remain
  shallow.
- If ISR, cache tags, or revalidation become product-critical, configure and
  test a shared cache across all Kubernetes replicas.

## Security Headers

Production responses should define and test, at minimum:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Permissions-Policy`
- A reviewed `frame-ancestors` policy

Coordinate header ownership between Next.js and the Kubernetes ingress so
values are not silently duplicated or overwritten.

## Testing and Quality Gates

Every pull request affecting `rowboat-www` should run:

```bash
npm ci
npm run verify:ci
```

Required test coverage should include:

- PKCE creation, state verification, expiration, and safe return targets.
- Cookie sealing, tamper rejection, expiration, size, and key rotation.
- Missing, expired, refreshed, and concurrently refreshed sessions.
- API proxy path/header behavior and unauthorized responses.
- Runtime schemas and public error-envelope behavior.
- Public plan-response validation and abuse limits.
- Playwright flows for login, logout, principal dashboard routes, navigation,
  refresh/deep linking, and public plan responses.
- Accessibility checks for critical marketing and dashboard routes.

Build success alone is not an adequate production quality gate.

## Deployment Dependency Rules

`rowboat-www` depends on:

- `apps/rowboat-www/**`
- `packages/ui/**`
- `packages/relationship-contract/**`
- `packages/eslint-plugin-oppulence-web/**`
- `charts/rowboat-www/**`
- `scripts/rowboat-www-smoke.sh`

CI and deployment path filters must include all of these inputs. A shared
package change must rebuild and deploy the web application.

## Verification Commands

From `apps/rowboat-www`:

```bash
npm ci
npm run verify       # complete local merge gate
npm run verify:ci    # adds browser, accessibility, bundle, and Lighthouse gates
npm run verify:fast  # formatting, lint, and type checking while iterating
```

From the monorepo root, after building the image:

```bash
make www-smoke
```

For bundle-sensitive changes:

```bash
npm run analyze
npm run bundle:check
```

The Vercel CLI is not currently installed. If Vercel tooling is needed, install
it with `npm i -g vercel` to enable workflows such as `vercel env pull`,
`vercel deploy`, and `vercel logs`.

## Priority Order

When improving production readiness, use this order:

1. Extract the shared dashboard client island into narrow route-owned islands.
2. Migrate every legacy JSON cast and raw fetch to generated/validated clients.
3. Remove exact migration exceptions from `eslint.config.mjs` one at a time.
4. Introduce dynamic imports and optimized image/font delivery.
5. Add structured observability, request IDs, and exception reporting.
6. Move remaining raw browser preferences to scoped storage.
7. Lower bundle and Lighthouse regression budgets as improvements land.
8. Complete marketing metadata, accessibility, and SEO conventions.

## Change Discipline

- Preserve unrelated user changes in the monorepo.
- Do not weaken the BFF or cookie security model for convenience.
- Prefer incremental route extraction over a large dashboard rewrite.
- Measure bundle, runtime, and user-facing behavior before and after structural
  changes.
- Update this file when the architecture or production requirements materially
  change.
