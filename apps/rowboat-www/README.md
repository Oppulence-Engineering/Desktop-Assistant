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

## Authentication

rowboat-www authenticates through rowboat-api's WorkOS AuthKit broker:

1. `/api/auth/workos/login` creates a PKCE verifier/challenge and asks
   rowboat-api for `/v1/auth/workos/login-url`.
2. WorkOS redirects back to `/api/auth/workos/callback`.
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
ROWBOAT_WWW_SESSION_SECRET=<32+ random characters>
```

Local development uses an insecure fallback session secret. Production refuses
to seal or verify auth cookies without `ROWBOAT_WWW_SESSION_SECRET`.

## Verification

```bash
npm run verify:fast
npm run verify
```

`verify:fast` is the development feedback loop. Run the complete `verify`
gauntlet before opening or updating a pull request.
