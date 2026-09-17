# Product shell (`/app`)

**Goal:** Authenticated Oppulence dashboard — chat home, agents, workflows, revenue, report, settings.

**Auth:** Server layout calls `requireSession`; `proxy.ts` redirects anonymous users before stream.

**Client boundary:** `product-dashboard-client.tsx` (sidebar, header, command palette). Leaf routes render via `dashboard-route-content.tsx`.

**BFF:** All data through `/api/rowboat/v1/...`.

**Perf:** Prefer TanStack Query over manual polling; use React Scan + Dev toolkit API tab when tuning.
