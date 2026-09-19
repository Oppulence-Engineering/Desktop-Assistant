# rowboat-www

Marketing site plus the authenticated Oppulence dashboard.

## Repository Map

```text
app/          Next.js routes, layouts, and route-private components
components/   Reusable product components and component conventions
config/       Architecture, contract-generation, growth-standard templates, and quality policy
docs/         Application-specific design and engineering records
e2e/          Playwright end-to-end and accessibility coverage
hooks/        Shared React hooks
lib/          Auth, API, storage, and domain integration code
public/       Static assets
quality/      Repository policy and architecture tests
scripts/      Contributor automation, `npm run gen`, and container entrypoints
stores/       Ephemeral Zustand stores (generated; not for navigation or server data)
types/        Cross-cutting application types
```

Files kept at the application root are either contributor entry points
(`README.md`, `AGENTS.md`, and `package.json`) or files discovered there by
Next.js and its standard tooling. Repository-owned policy belongs under
`config/`; executable automation belongs under `scripts/`; engineering records
belong under `docs/`.

Read `AGENTS.md` before making architectural changes, `components/README.md`
before adding React components, and `quality/README.md` before changing a
verification baseline.

## Getting Started

Copy `.env.example` to `.env.local`, then start rowboat-api with WorkOS
configured and run the web app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The marketing site is
public; `/app` redirects through WorkOS when there is no dashboard session.

### Local full stack

```bash
npm run dev:stack   # validates env + API healthz, hot reload on :18082
npm run dev:local   # same ports without the preflight (see scripts/dev-local.sh)
```

Both point at rowboat-api on `18080`. Start the API with `docker compose -f
docker-compose.rowboat-api.yml up -d` or `make api-up` from the repo root.

### Developer tooling (dev only)

Floating **Dev** panel (bottom-right): Web Vitals, BFF request log (with
`requestId` / `errorCode`), live axe, MSW personas, session helpers, stack
health. Route catalog: [http://localhost:18082/dev/routes](http://localhost:18082/dev/routes).

| Tool                    | How                                                                  |
| ----------------------- | -------------------------------------------------------------------- |
| TanStack Query Devtools | Product routes — corner toggle                                       |
| React Scan              | Toolbar overlay — unnecessary re-renders                             |
| React Grab              | Hold **Space** — pick elements; MCP on `:5567`–`:5570`               |
| MSW                     | Dev toolkit → Tools → enable mocks + persona                         |
| Storybook               | `npm run storybook` — `@oppulence/ui` plus colocated product stories |
| Scaffolding             | `npm run gen` — pages, components, Zod, hooks, mutations, stores     |
| React Doctor            | `npm run dev:doctor`                                                 |
| Contracts drift         | `npm run dev:contracts`                                              |

See `docs/product-flow.md` (auth/BFF sequence) and `docs/dev-debt.md` (eslint
legacy burn-down). Per-route READMEs live under `app/(product)/app/*/README.md`.

### Cursor + MCP

React Grab loads from `unpkg.com` in development and exposes an MCP server on
localhost. In Cursor, add an MCP server pointing at the port shown in the
browser console when Grab is active — then ask the agent to inspect the
selected DOM node. CSP in `next.config.ts` already allows `unpkg.com` and
localhost MCP ports in dev.

This app installs with **npm** (`package-lock.json`); the Docker image builds
with `npm ci`. Running `pnpm install` here writes a `pnpm-lock.yaml` that fails
`quality/repository-policies`.

## Authentication

rowboat-www authenticates through rowboat-api's WorkOS AuthKit broker:

1. `/api/auth/workos/login` creates a PKCE verifier/challenge and asks
   rowboat-api for `/v1/auth/workos/login-url`.
2. WorkOS redirects back to `/api/auth/callback` (with `/api/auth/workos/callback` retained as an alias).
3. rowboat-www validates the sealed PKCE state cookie, posts the code verifier
   to rowboat-api `/v1/auth/workos/exchange`, and stores the returned token
   bundle in a sealed HTTP-only cookie.
4. Dashboard calls go to `/api/rowboat/v1/...`. The Next route verifies the
   sealed session, refreshes via `/v1/auth/workos/refresh` when needed, attaches
   `Authorization: Bearer ...`, and proxies to rowboat-api.
5. `/api/auth/session` calls rowboat-api `/v1/me`, which performs first-sight
   onboarding and returns local user/billing state.

This follows WorkOS AuthKit guidance to use authorization-code + PKCE and keep
session tokens in secure HTTP-only cookies rather than browser storage:

- https://workos.com/docs/authkit/nextjs
- https://workos.com/docs/authkit/sessions
- https://workos.com/docs/reference/authkit/authentication/get-authorization-url

Required production env:

```bash
ROWBOAT_WWW_API_PROXY_URL=https://api.oppulence.io
ROWBOAT_WWW_PUBLIC_API_BASE_URL=https://api.oppulence.io
ROWBOAT_WWW_AUTH_API_BASE_URL=https://api.oppulence.io
ROWBOAT_WWW_SESSION_SECRET=<32+ random characters>
```

Local development uses an insecure fallback session secret. Production refuses
to seal or verify auth cookies without `ROWBOAT_WWW_SESSION_SECRET`.

## Support chat

Plain's chat widget is mounted on both the marketing site and the dashboard by
`components/features/support/support-chat.tsx`. Threads land in the same Plain
workspace as the desktop app's in-app feedback (`POST /v1/feedback`), so there
is one support inbox rather than one per surface.

```bash
ROWBOAT_WWW_PLAIN_CHAT_APP_ID=<chat app id>
ROWBOAT_WWW_PLAIN_CHAT_SECRET=<chat secret from Settings → Chat, not the workspace API key>
# Optional. Comma-separated Plain label ids applied to every chat thread.
# Defaults to the "Brand: Oppulence" label.
ROWBOAT_WWW_PLAIN_CHAT_LABEL_TYPE_IDS=lt_01M20XH6PFZ1F5EY4V19WWP7DG
# Local only: load the widget. Email-hash identify is opt-in everywhere —
# a mismatched Chat secret fails launch with "email hash is invalid".
# ROWBOAT_WWW_PLAIN_CHAT_ENABLED=1
# ROWBOAT_WWW_PLAIN_CHAT_IDENTIFY=1
```

Both come from Plain under **Settings → Chat**. With no app id the widget is
skipped entirely and the vendor script never loads, which is the default for
local development.

Every thread opened from the widget carries the `Brand: Oppulence` label, since
the Plain workspace is shared with other brands. The desktop app's feedback
relay applies the same label server-side via the API's
`PLAIN_ALWAYS_LABEL_TYPE_IDS`, so all Oppulence tickets are filterable
regardless of which surface they came from.

Signed-in users are linked by their verified viewer id (`externalId`) and
email. The email is an unverified inbox hint unless
`ROWBOAT_WWW_PLAIN_CHAT_IDENTIFY=1` also mints the HMAC Plain uses as a
bearer credential. That hash stays opt-in: a mismatched Chat secret takes
the widget down. Anonymous visitors chat unauthenticated and Plain's own
email verification identifies them.

## Verification

```bash
npm run verify:fast
npm run verify
npm run test:e2e:smoke   # authenticated report smoke (@smoke)
npm run test:e2e:ui      # Playwright UI mode
```

`verify:fast` is the development feedback loop. Run the complete `verify`
gauntlet before opening or updating a pull request. E2E uses
`e2e/fake-rowboat-api.mjs` (connectors + revenue/report fixtures) and
`e2e/auth.setup.ts` for seeded sessions.
