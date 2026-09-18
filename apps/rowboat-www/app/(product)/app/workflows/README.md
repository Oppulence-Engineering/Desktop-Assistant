# Workflows (`/app/workflows`)

**Goal:** Scheduled and on-demand cloud workflow runs.

**Client:** `components/workflows/cloud-workflows-view.tsx`, visual builder for schedules.

**BFF:** `/api/rowboat/v1/background-tasks`, `/api/rowboat/v1/background-task-runs`.

**Note:** Heavy client chunk — use `next/dynamic` patterns when extending.
