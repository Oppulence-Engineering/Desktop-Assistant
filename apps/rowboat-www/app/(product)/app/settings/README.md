# Settings (`/app/settings`)

**Goal:** Connections, appearance, account, and supported product preferences.

**URL state:** `?settings=` deep-links settings panels. Legacy `extensions`,
`models`, and `environment` values are normalized by `lib/product-navigation.ts`.

**Client:** `components/app-settings.tsx`.

**BFF:** `/api/rowboat/v1/connectors`, `/api/rowboat/v1/me`, connector OAuth start/claim via BFF.

**E2E:** `e2e/connectors.spec.ts` exercises Google OAuth with fake rowboat-api.
