# rowboat-www

Marketing site plus the authenticated Oppulence dashboard.

## Repository Map

```text
app/          Next.js routes, layouts, and route-private components
components/   Reusable product components and component conventions
config/       Architecture, contract-generation, and quality policy
docs/         Application-specific design and engineering records
e2e/          Playwright end-to-end and accessibility coverage
hooks/        Shared React hooks
lib/          Auth, API, storage, and domain integration code
public/       Static assets
quality/      Repository policy and architecture tests
scripts/      Contributor automation and container entrypoints
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

First, run rowboat-api with WorkOS configured, then start the web app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The marketing site is
public; `/app` redirects through WorkOS when there is no dashboard session.

To develop against the local `rowboat-api` stack on the port the packaged
container uses, run `npm run dev:local` instead. It serves the same app with
hot reload on [http://localhost:18082](http://localhost:18082) and points at
the API on `18080`. If a prebuilt `rowboat-www-local` container is running on
that port, the script stops it first — a container serves a baked production
image and will not reflect your edits.

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
ROWBOAT_WWW_PLAIN_CHAT_SECRET=<chat secret>
# Optional. Comma-separated Plain label ids applied to every chat thread.
# Defaults to the "Brand: Oppulence" label.
ROWBOAT_WWW_PLAIN_CHAT_LABEL_TYPE_IDS=lt_01M20XH6PFZ1F5EY4V19WWP7DG
```

Both come from Plain under **Settings → Chat**. With no app id the widget is
skipped entirely and the vendor script never loads, which is the default for
local development.

Every thread opened from the widget carries the `Brand: Oppulence` label, since
the Plain workspace is shared with other brands. The desktop app's feedback
relay applies the same label server-side via the API's
`PLAIN_ALWAYS_LABEL_TYPE_IDS`, so all Oppulence tickets are filterable
regardless of which surface they came from.

Signed-in users are identified by an HMAC-SHA256 hash of their verified email,
minted server-side in `/api/support/chat`. Plain treats that hash as a bearer
credential for the customer's identity, so the secret stays server-side and is
never exposed to the browser bundle. Anonymous visitors chat unauthenticated
and Plain's own email verification identifies them.

## Verification

```bash
npm run verify:fast
npm run verify
```

`verify:fast` is the development feedback loop. Run the complete `verify`
gauntlet before opening or updating a pull request.
