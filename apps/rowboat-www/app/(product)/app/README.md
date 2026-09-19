# Product shell (`/app`)

**Goal:** Authenticated Oppulence dashboard — chat home, agents, workflows, revenue, report, settings.

**Auth:** Server layout calls `requireSession`; `proxy.ts` redirects anonymous users before stream.

**Client boundary:** `product-dashboard-client.tsx` (sidebar, header, command palette, chat provider). Leaf routes own their panels under `_components/`.

**BFF:** Browser data through `/api/rowboat/v1/...`. Server prefetch talks to Go with the sealed session (`prefetch.ts` on revenue and report).

**State:** TanStack Query for remote data, nuqs (`search-params.ts`) for shareable view-state, `useState` for local UI.

**New routes:** `npm run gen -- page --route <name> --title "<Title>"`. Add `--operation <operationId>` when the page should prefetch a GET. Do not add surfaces to `product-dashboard-client.tsx`. See `docs/growth-standard.md`.

**Perf:** Prefer TanStack Query over manual polling; use React Scan + Dev toolkit API tab when tuning.
