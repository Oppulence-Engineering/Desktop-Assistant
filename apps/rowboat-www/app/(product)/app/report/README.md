# Open promises report (`/app/report`)

**Goal:** 90-day Gmail scan → open promises report with export.

**URL state:** `?scan=<id>` identifies the active leak scan (shareable, no localStorage).

**Client:** `components/features/report/open-promises-report/open-promises-report.tsx` — TanStack Query for sources, scans, poll until complete, report fetch.

**BFF endpoints:**

- `GET /api/rowboat/v1/relationship-sources`
- `GET/POST /api/rowboat/v1/revenue-leak-scans`
- `GET /api/rowboat/v1/open-promises-report`

**Dev:** Enable MSW persona **Revenue queue** or use fake API in e2e. React Grab (Space) + Scan toolbar for render tuning.
