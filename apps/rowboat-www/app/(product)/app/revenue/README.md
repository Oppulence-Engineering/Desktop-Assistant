# Revenue (`/app/revenue`)

**Goal:** Commitment register, recovery queue, scans, impact, governed actions, workspace sources.

**URL state:** `?tab=` selects sub-view (commitments default).

**Client:** `components/revenue/*` loaded from dashboard route content.

**BFF:** `/api/rowboat/v1/revenue-actions`, leak scans, workspace link, semantic search.

**Perf trap:** Relationship graph and polling tabs — use Query Devtools + React Scan unnecessary-render mode.
