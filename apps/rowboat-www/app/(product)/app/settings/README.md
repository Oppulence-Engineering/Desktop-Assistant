# Settings (`/app/settings`)

**Goal:** Connections, models, appearance, account, and environment preferences.

**URL state:** `?section=` deep-links settings panels.

**Client:** `components/app-settings.tsx`.

**BFF:** `/api/rowboat/v1/connectors`, `/api/rowboat/v1/me`, connector OAuth start/claim via BFF.

**E2E:** `e2e/connectors.spec.ts` exercises Google OAuth with fake rowboat-api.
