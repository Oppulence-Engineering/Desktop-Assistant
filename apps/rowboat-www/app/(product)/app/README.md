# Product shell (`/app`)

**Goal:** Authenticated Oppulence dashboard — chat home, agents, workflows, revenue, report, settings.

**Auth:** Server layout calls `requireSession`; `proxy.ts` redirects anonymous users before stream.

**Client boundary:** `components/features/dashboard/dashboard-shell/` (sidebar, header, command palette, chat provider). Leaf routes own their panels under `_components/`.

**BFF:** Browser data through `/api/rowboat/v1/...`. Server prefetch talks to Go with the sealed session (`prefetch.ts` on revenue and report).

**State:** TanStack Query for remote data, nuqs (`search-params.ts`) for shareable view-state, `useState` for local UI.

**New routes:** `npm run gen -- page --route <name> --title "<Title>"`. Add `--operation <operationId>` when the page should prefetch a GET. Do not add surfaces to `components/features/dashboard/product-dashboard-client/product-dashboard-client.tsx`. See `docs/growth-standard.md`.

**Perf:** Leaf pages return a Suspense boundary immediately (`PrefetchHydration` seeds TanStack Query behind it). Do not export `instant = false` on a leaf — auth already blocks in the product layout. Prefer TanStack Query over manual polling; use React Scan + Dev toolkit API tab when tuning.
