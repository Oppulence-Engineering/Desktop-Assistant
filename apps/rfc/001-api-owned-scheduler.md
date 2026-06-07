# RFC 001: API-Owned Scheduler for Cloud Background Tasks

|                       |                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**               | 001                                                                                                                                                                                                          |
| **Status**            | Draft                                                                                                                                                                                                        |
| **Track**             | Cloud-native background workflows                                                                                                                                                                            |
| **Owners**            | `apps/rowboat-api` (Go backend) · `apps/x` (desktop control plane)                                                                                                                                           |
| **Created**           | 2026-06-05                                                                                                                                                                                                   |
| **Last updated**      | 2026-06-06                                                                                                                                                                                                   |
| **Depends on**        | [RFC 002 — Durable Schedule State](./002-durable-schedule-state.md) (required before >1 replica)                                                                                                             |
| **Enables / related** | [RFC 005 — Temporal Schedules](./005-temporal-schedule-integration.md), [RFC 003 — Event Ingestion](./003-cloud-event-ingestion.md), [RFC 006 — Desktop Control Plane](./006-desktop-cloud-control-plane.md) |
| **Parent docs**       | [`docs/CLOUD_NATIVE_BACKGROUND_WORKFLOWS_RFC.md`](../../docs/CLOUD_NATIVE_BACKGROUND_WORKFLOWS_RFC.md) §6.3, [`..._API_PLAN.md`](../../docs/CLOUD_NATIVE_BACKGROUND_WORKFLOWS_API_PLAN.md)                   |

## RFC map

```mermaid
flowchart LR
    R001[RFC 001<br/>API scheduler loop] -->|requires for HA| R002[RFC 002<br/>Durable lease state]
    R001 -->|exact cron migrates to| R005[RFC 005<br/>Temporal Schedules]
    R003[RFC 003<br/>Event ingestion] -->|reuses run-start service| R001
    R001 -->|runs execute in| R004[RFC 004<br/>Cloud runtime]
    R001 -->|surfaced by| R006[RFC 006<br/>Desktop UX]
    R007[RFC 007<br/>Prod enablement] -.gates.-> R001
```

## Summary

API-target background tasks already **execute** in the cloud (Temporal worker), but
their **timed triggers** are still initiated by the desktop. The desktop scheduler
(`apps/x/packages/core/src/background-tasks/scheduler.ts`) polls local task files every
15 seconds and, when an `executionTarget: api` task is due, calls
`triggerCloudRunBestEffort()` → `POST /v1/background-tasks/{slug}/trigger`. If the
desktop app is closed, **no API-target cron/window task ever fires.**

This RFC moves cron/window trigger evaluation for API-target tasks into the
Rowboat API deployment so scheduled cloud runs fire while the desktop is offline. It
deliberately reuses the existing run-start path — it does **not** introduce a second
way to create runs.

## Current state (grounded)

| Fact                                                                         | Evidence                                                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Task schema supports `execution_target` (`desktop`/`api`, default `desktop`) | `ent/schema/background_task.go:44-46`                                                                                            |
| Triggers stored as validated JSON in `triggers_json`                         | `ent/schema/background_task.go:41`                                                                                               |
| Manual API trigger → queued run → Temporal start                             | `internal/backgroundtasks/handler.go:1120` (`triggerAPIRun`)                                                                     |
| Run creation helper                                                          | `handler.go:1272` (`createRun`)                                                                                                  |
| Temporal start contract                                                      | `internal/backgroundtaskworkflow/workflow.go:117` (`StartBackgroundTaskRun`), `WorkflowName = "rowboat.background_tasks.api.v1"` |
| Timed evaluation lives on the desktop                                        | `scheduler.ts` (15 s poll) + `schedule/utils.ts` (`dueTimedTrigger`, `isCronDue`, `isWindowDue`)                                 |
| Desktop dispatch by target                                                   | `scheduler.ts:65-71` (`executionTarget === 'api'` → `triggerCloudRunBestEffort`)                                                 |

Net effect: a cloud task with `cronExpr` or `windows` is **cloud-executed but
desktop-scheduled**. Closing the laptop silently pauses every scheduled cloud job.

## Goals

- Evaluate API-target `cronExpr` / `windows` triggers inside the Rowboat API deployment.
- Fire scheduled cloud runs while the desktop is offline.
- **Bit-for-bit reuse** of the existing run-start sequence (`triggerAPIRun`) so HTTP- and
  scheduler-initiated runs are indistinguishable downstream (same events, same metrics,
  same Temporal workflow id shape).
- Preserve desktop trigger semantics for `cronExpr` (2-minute grace) and `windows`
  (once-per-day, anchored at `startTime`).
- Be safe with a single replica from day one; be safe with N replicas once RFC 002 lands.
- Leave `executionTarget: desktop` scheduling entirely on the desktop.

### Measurable acceptance signals

- With the desktop process killed, an API-target task with `cronExpr: "*/5 * * * *"`
  produces a `trigger=cron`, `executor=api` run within one grace window of each
  occurrence.
- `cloud_runs_triggered_total{trigger="cron"}` increments without any HTTP request to
  `/trigger`.
- Two scheduler replicas produce exactly one run per cycle (RFC 002 lease).

## Non-Goals

- Replacing the desktop scheduler for `executionTarget: desktop` tasks.
- Event-trigger routing — owned by [RFC 003](./003-cloud-event-ingestion.md).
- Immediately replacing the loop with Temporal Schedules — that is the staged migration
  in [RFC 005](./005-temporal-schedule-integration.md). This loop ships first and remains
  the fallback.
- Per-task user timezones — v1 evaluates in **UTC** (the server TZ); a task-level `timezone`
  field is a committed fast-follow (see [Decisions](#decisions)).

## Design

### Component shape

Add a long-lived scheduler component. Two deployment shapes are viable; the recommended
v1 is **(A)** for operational isolation, mirroring the worker:

|           | (A) Separate `cmd/scheduler` Deployment _(recommended)_ | (B) Goroutine inside `cmd/server`                          |
| --------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Isolation | Own pod, own crash domain, own `/metrics`               | Shares API pod lifecycle                                   |
| HA story  | Scale independently; lease gates duplicates (RFC 002)   | Every API replica would evaluate → needs lease immediately |
| Precedent | Matches `cmd/worker` (`cmd/worker/main.go`)             | —                                                          |
| Cost      | One more Deployment                                     | None                                                       |

Recommended: `apps/rowboat-api/cmd/scheduler` + a `charts/rowboat-api/templates/scheduler-deployment.yaml`
gated on `scheduler.enabled`, structurally identical to `worker-deployment.yaml` (own
`/metrics`, `/healthz`, `command: ["/rowboat-api-scheduler"]`).

### The reusable run-start service (the crux)

Today the queued-run-then-Temporal-start logic is inlined in `triggerAPIRun`
(`handler.go:1120-1195`). Extract it verbatim into an internal service so the HTTP handler
and the scheduler share one code path:

```go
// internal/backgroundtaskruns/starter.go  (new; or fold into internal/backgroundtasks)
package backgroundtaskruns

// Starter owns the canonical "create queued api run → emit queued event →
// start Temporal workflow → persist temporal ids → count metric" sequence.
// It is the ONLY way an executor=api run is created. HTTP, scheduler (RFC 001),
// and event router (RFC 003) all call Start.
type Starter struct {
	client   *ent.Client
	temporal backgroundtaskworkflow.Controller
	log      *zap.Logger
}

type StartParams struct {
	User             *ent.User
	Task             *ent.BackgroundTask
	Trigger          string // manual | cron | window | event | retry
	RequestedContext string
	RunIDPrefix      string // "api-trigger-", "sched-cron-", "event-", …
	// Optional lineage (retry path):
	PreviousRunID string
	RetryOfRunID  string
	Attempt       *int
}

// Start mirrors handler.triggerAPIRun exactly: createRun(status=queued,
// executor=api, temporal_workflow_id precomputed) → appendSystemEvent(EventQueued)
// → temporal.StartBackgroundTaskRun → UpdateOneID(temporal ids) → metrics.Triggered.
// On Temporal start failure it marks the run failed with
// ErrCodeTemporalStartFailed (handler.go:1162-1178 behavior).
func (s *Starter) Start(ctx context.Context, p StartParams) (*ent.BackgroundTaskRun, error)
```

The HTTP handler's `triggerAPIRun` becomes a thin wrapper that resolves the user/task
from the request and calls `Starter.Start`. **No behavior change** to the HTTP path is in
scope here beyond the refactor; the scheduler then becomes a second caller.

> Why this matters: `viewRun`, the desktop transcript poller, the
> `temporal_workflow_id` index, and every `cloud_runs_*` series assume one creation
> shape. A parallel "scheduler-only" insert path would drift these. See parent RFC
> §5.1 for the flow this preserves.

### Trigger evaluation (port of desktop semantics)

Port `schedule/utils.ts` to Go in `internal/backgroundscheduler`. The three pure
functions must match the desktop bit-for-bit so a task behaves identically whether
desktop- or cloud-scheduled:

```go
const (
	cronGrace    = 2 * time.Minute // schedule/utils.ts GRACE_MS
	retryBackoff = 5 * time.Minute // schedule/utils.ts RETRY_BACKOFF_MS
)

// dueTimedTrigger returns "cron" | "window" | "" — pure cycle check, no backoff.
// Anchored on lastRunAt (advances only on SUCCESS), matching scheduler.ts:53.
func dueTimedTrigger(tr Triggers, lastRunAt *time.Time, now time.Time) string

// isCronDue: find the most-recent occurrence at-or-before now (prev, not
// next-after-lastRun); fire iff lastRunAt < occurrence AND now <= occurrence+grace.
// Mirrors schedule/utils.ts:55-75. Requires a cron lib with a "previous tick".
func isCronDue(expr string, lastRunAt *time.Time, now time.Time) bool

// isWindowDue: now within [start,end] band AND lastRunAt before today's cycle
// start. Once per day per window. Mirrors schedule/utils.ts:77-92.
func isWindowDue(start, end string, lastRunAt *time.Time, now time.Time) bool

// backoffRemaining: > 0 if lastAttemptAt within retryBackoff. schedule/utils.ts:48.
func backoffRemaining(lastAttemptAt *time.Time, now time.Time) time.Duration
```

**Cron library note.** The JS side uses `cron-parser`'s `.prev()`. Go's common
`robfig/cron` exposes only `Next()`. To get the most-recent occurrence ≤ now without
scanning, use **`github.com/adhocore/gronx`** (`PrevTick(expr, inclusive)`) or compute
`prev` by stepping `Next()` from `now - maxPlausibleInterval`. **Decision: `gronx`** — its
`PrevTick`/`NextTick` mirror the JS `cron-parser.prev()` semantics directly, with no
hand-rolled occurrence stepping (see [Decisions](#decisions)).

### Evaluation loop

```go
// internal/backgroundscheduler/scheduler.go
func (s *Scheduler) tick(ctx context.Context) error {
	metrics.Ticks.Inc()
	tasks, err := s.client.BackgroundTask.Query().
		Where(
			backgroundtask.ActiveEQ(true),
			backgroundtask.ExecutionTargetEQ("api"),
			backgroundtask.TriggersJSONNotNil(),
		).
		// NOTE: runs as internal context — bypasses per-user tenant scoping
		// (internal/db/interceptors.go). The scheduler is cross-tenant by design.
		All(auth.WithInternal(ctx))
	if err != nil { return err }
	metrics.TasksScanned.Add(float64(len(tasks)))

	for _, task := range tasks {
		tr, err := parseTriggers(task.TriggersJSON)
		if err != nil { metrics.Errors.Inc(); s.logSkip(task, "bad_triggers", err); continue }

		// In-flight backstop (scheduler.ts:38-48): lastAttemptAt newer than
		// lastRunAt AND still in backoff ⇒ a prior attempt never completed.
		if inFlight(task) && backoffRemaining(task.LastAttemptAt, now) > 0 { continue }

		source := dueTimedTrigger(tr, task.LastRunAt, now) // "cron" | "window" | ""
		if source == "" { continue }
		metrics.DueTasks.WithLabelValues(source).Inc()

		if d := backoffRemaining(task.LastAttemptAt, now); d > 0 {
			metrics.BackoffSuppressed.Inc(); s.logSkip(task, "backoff", d); continue
		}

		// --- RFC 002 lease gate (no-op when single replica / lease disabled) ---
		key := scheduleKey(source, tr, now) // see RFC 002
		lease, ok, err := s.leases.Acquire(ctx, task, source, key, s.owner, s.leaseTTL)
		if err != nil { metrics.Errors.Inc(); continue }
		if !ok { metrics.DuplicateSuppressed.Inc(); continue }

		run, err := s.starter.Start(ctx, runStartParams(task, source))
		if err != nil {
			metrics.Errors.Inc()
			_ = s.leases.Release(ctx, lease.ID, err) // let it expire; do NOT set last_run_id
			continue
		}
		_ = s.leases.Complete(ctx, lease.ID, run.RunID)
		metrics.RunsTriggered.WithLabelValues(source).Inc()
		s.logFire(task, source, key, run)
	}
	return s.cleanupExpiredLeases(ctx) // RFC 002
}
```

Run-ID prefixes for provenance: `sched-cron-<uuid>` and `sched-window-<uuid>` (mirrors
the existing `api-trigger-` / `retry-` / `remote-trigger-` prefixes in `handler.go`).

### Single-evaluator safety (the fallback under the lease)

At-most-once-per-cycle ultimately relies on the **same task runtime fields the desktop
uses** (`last_run_at` advances only on success; `last_attempt_at` anchors backoff — set
today by `MarkRunRunning`, `workflow.go:214-219`). A single evaluator with `last_run_at`
cycle-anchoring cannot double-fire within a cycle.

**Chosen implementation order ([`README.md`](./README.md)) lands RFC 002 _before_ this loop
ships**, so the lease exists on day one and multi-replica is a `replicaCount` change, not a
code change. The single-evaluator property documented here remains the correctness fallback
if the lease is ever disabled.

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant S as Scheduler (cmd/scheduler)
    participant DB as Postgres
    participant St as Starter (shared)
    participant T as Temporal
    participant W as Worker

    loop every CLOUD_SCHEDULER_POLL_INTERVAL
        S->>DB: SELECT active api tasks w/ triggers_json
        Note over S: dueTimedTrigger + backoff + in-flight checks
        S->>DB: AcquireScheduleLease(task, key)  %% RFC 002
        alt lease acquired
            S->>St: Start(task, trigger=cron|window)
            St->>DB: INSERT run (queued, executor=api, wf_id)
            St->>DB: append temporal.queued
            St->>T: StartWorkflow(rowboat.background_tasks.api.v1)
            St->>DB: UPDATE run SET temporal ids
            S->>DB: CompleteScheduleLease(key, run_id)
            T->>W: dispatch → run executes (RFC 004)
        else duplicate / not due / backoff
            S->>S: increment suppression metric, skip
        end
    end
```

## Configuration

New env keys (registered in `internal/appconfig/config.go` `Config` + `Load`, defaults in
the same style as `TEMPORAL_*`):

| Env                             | Default               | Meaning                                                                                                         |
| ------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CLOUD_SCHEDULER_ENABLED`       | `false`               | Master switch; scheduler exits 0 if false (mirrors `TEMPORAL_WORKER_ENABLED` guard in `cmd/worker/main.go:46`). |
| `CLOUD_SCHEDULER_POLL_INTERVAL` | `15s`                 | Tick cadence. 15 s matches the desktop loop.                                                                    |
| `CLOUD_SCHEDULER_LEASE_TTL`     | `60s`                 | Lease lifetime (RFC 002). Must exceed one tick.                                                                 |
| `CLOUD_SCHEDULER_REPLICA_ID`    | pod name (`HOSTNAME`) | Lease owner identity.                                                                                           |
| `CLOUD_SCHEDULER_TIMEZONE`      | `UTC`                 | TZ for cron prev-occurrence + window band math. UTC for v1 (see [Decisions](#decisions)).                       |

`Config.Validate()` gains: if `CLOUD_SCHEDULER_ENABLED` then `TEMPORAL_ENABLED` must be
true (the scheduler needs a Temporal client to start runs), matching the worker's invariant.

## Observability

Metrics live in `internal/backgroundscheduler/metrics.go` (leaf package, same registry
pattern documented in `internal/backgroundtaskmetrics/metrics.go`). **Cardinality rule
holds: never label by `taskSlug`/`userId`/`runId`.**

| Series                                       | Type      | Labels    | Notes                                                                  |
| -------------------------------------------- | --------- | --------- | ---------------------------------------------------------------------- |
| `cloud_scheduler_ticks_total`                | counter   | —         | one per loop iteration                                                 |
| `cloud_scheduler_tasks_scanned_total`        | counter   | —         | summed each tick                                                       |
| `cloud_scheduler_due_tasks_total`            | counter   | `trigger` | matched a cycle                                                        |
| `cloud_scheduler_runs_triggered_total`       | counter   | `trigger` | runs actually started (reconcile against `cloud_runs_triggered_total`) |
| `cloud_scheduler_duplicate_suppressed_total` | counter   | —         | lease not acquired                                                     |
| `cloud_scheduler_backoff_suppressed_total`   | counter   | —         | in backoff window                                                      |
| `cloud_scheduler_errors_total`               | counter   | `stage`   | `parse`/`lease`/`start`/`query`                                        |
| `cloud_scheduler_tick_duration_seconds`      | histogram | —         | loop latency; alert if > poll interval                                 |

Structured log fields (one line per decision, via `zap`, mirroring `runLogFields` in
`handler.go:1815`): `taskSlug`, `userId`, `trigger`, `scheduleKey`, `runId`, `decision`
(`fired|skip_not_due|skip_backoff|skip_inflight|skip_duplicate|error`),
`occurrenceAt`, `graceRemainingMs`.

## Failure modes & edge cases

| Case                                    | Behavior                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Temporal unavailable at start           | `Starter.Start` marks run `failed` / `temporal_start_failed` (handler.go:1162). Lease released; `last_run_id` **not** set so cycle remains unfired and retries next tick within grace.                                                                       |
| Scheduler crash mid-tick                | At-least-once tick semantics; lease + `last_run_at` make run creation at-most-once per cycle. Partial run insert without Temporal start → next tick sees a `failed` run, cycle still unfired.                                                                |
| Missed occurrences (downtime > grace)   | By design: cron honors the 2-minute grace (no replay storm). Windows fire if `now` is still inside the band. Matches desktop. **Document this**: downtime longer than grace skips that cron occurrence.                                                      |
| Clock skew across replicas              | Cron uses occurrence math, not wall-clock equality; small skew tolerated. Lease TTL must exceed max skew + tick.                                                                                                                                             |
| `triggers_json` malformed               | `validJSON` validator (`background_task.go:87`) blocks malformed JSON at write time, but shape (`cronExpr`/`windows`) can still be wrong → count `errors{stage=parse}`, skip, log.                                                                           |
| Task deactivated between scan and start | Re-check `active` inside the lease transaction, or accept one stale fire (idempotent: next tick won't fire an inactive task).                                                                                                                                |
| Timezone divergence                     | Desktop windows use **device-local** time; cloud uses `CLOUD_SCHEDULER_TIMEZONE` (UTC default). A task moved desktop→cloud may shift window wall-times. v1 evaluates in UTC (decided); the desktop labels cloud schedules so the shift is visible (RFC 006). |

## Security

- Scheduler runs with `auth.WithInternal(ctx)` (bypasses tenant interceptors) — it is a
  trusted cross-tenant component, exactly like the worker activities (`workflow.go:190`).
  It must never accept external input; its only inputs are DB rows.
- No new external surface. No secrets beyond DB + Temporal creds already in the worker pod.
- Runs it creates inherit the task's owner via the `user` edge; downstream authz is
  unchanged (ORM interceptors still scope reads).

## Migration & code changes

- **No schema change** in this RFC for single-replica (reuses existing task fields). The
  lease table is [RFC 002](./002-durable-schedule-state.md).
- New packages: `internal/backgroundscheduler` (loop, due math, metrics),
  `internal/backgroundtaskruns` (extracted `Starter`).
- Refactor `handler.triggerAPIRun` to call `Starter.Start` (pure refactor; covered by
  existing `handler_cloud_test.go`).
- New binary `cmd/scheduler/main.go` (clone `cmd/worker/main.go` structure: config load,
  telemetry, db open, metrics server, signal-aware loop).
- New chart template `scheduler-deployment.yaml` + `scheduler.enabled` value.

## Code-level implementation playbook

This section is the concrete worklist an implementer can follow in the current repo. The
important constraint is that scheduler-created runs must look exactly like
`POST /v1/background-tasks/{slug}/trigger` runs once they enter the database. The existing
workflow proves why: `MarkRunRunning` updates a pre-existing row by `run_id` + `task_id`
(`workflow.go:196-213`) and then advances task runtime fields (`last_attempt_at`,
`last_run_id`). A scheduler path that starts Temporal before inserting the row will fail.

### 1. Extract the run starter before touching scheduling

Create `apps/rowboat-api/internal/backgroundtaskruns/starter.go`:

```go
type Starter struct {
	Client   *ent.Client
	Temporal backgroundtaskworkflow.Controller
	Log      *zap.Logger
}

type Params struct {
	User             *ent.User
	Task             *ent.BackgroundTask
	Trigger          string
	RequestedContext string
	RunIDPrefix      string
	PreviousRunID    string
	RetryOfRunID     string
	Attempt          *int
	QueuedMessage    string
}
```

`Start(ctx, Params)` performs the existing `handler.triggerAPIRun` sequence without an
HTTP dependency:

| Step                             | Existing source                             | New service behavior                                                                                                                |
| -------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Validate trigger/status/executor | `validateRunTrigger`, ent validators        | Keep validation in this package or expose small validators; reject before insert.                                                   |
| Mint run id                      | `api-trigger-` in `handler.go:1125`         | Prefix supplied by caller: `api-trigger-`, `sched-cron-`, `sched-window-`, `event-`, `retry-`.                                      |
| Precompute workflow id           | `workflow.WorkflowID`, `handler.go:1126`    | Always set on create so `viewRun` shows it immediately.                                                                             |
| Insert run                       | `createRun`, `handler.go:1272`              | Insert `status=queued`, `executor=api`, `temporal_status=Starting`, `progress_percent=0`, `progress_message=Queued for API worker.` |
| Append queued event              | `appendSystemEvent`, `handler.go:1148`      | Append `temporal.queued` with `trigger`, `runId`, and `requestedBy` (`http`/`scheduler`/`event`).                                   |
| Start Temporal                   | `StartBackgroundTaskRun`, `handler.go:1154` | Same `StartInput` fields; no extra payload in Temporal history.                                                                     |
| Start failure                    | `handler.go:1162-1177`                      | Mark row `failed`, `temporal_status=StartFailed`, `error_code=temporal_start_failed`, `completed_at=now`; return the run + error.   |
| Store Temporal ids               | `handler.go:1180-1185`                      | Set `temporal_workflow_id`, `temporal_run_id`, `temporal_status=Started`; increment revision.                                       |
| Metrics/logs                     | `handler.go:1191-1192`                      | Increment `cloud_runs_triggered_total{trigger}` and log using the same field set.                                                   |

The HTTP handler then becomes:

```go
func (h *Handler) triggerAPIRun(w http.ResponseWriter, r *http.Request, u *ent.User, task *ent.BackgroundTask, trigger, requestedContext string) {
	run, err := h.runStarter.Start(r.Context(), backgroundtaskruns.Params{
		User: u, Task: task, Trigger: trigger, RequestedContext: requestedContext,
		RunIDPrefix: "api-trigger-", QueuedMessage: "Queued for API worker.",
	})
	// Preserve current HTTP status mapping: 503 when Temporal is nil, 502 on start
	// failure, 202 with viewRun on success.
}
```

Do this first and run the existing cloud handler tests before adding a scheduler. This is
the foundation shared by RFC 003 and RFC 005 as well.

### 2. Add scheduler config in `internal/appconfig`

Add fields next to the existing Temporal block (`appconfig/config.go:136-146`):

| Field                                  | Env                         | Default  | Notes                                                  |
| -------------------------------------- | --------------------------- | -------- | ------------------------------------------------------ |
| `CloudSchedulerEnabled bool`           | `CLOUD_SCHEDULER_ENABLED`   | `false`  | Main guard; command exits cleanly when false.          |
| `CloudSchedulerInterval time.Duration` | `CLOUD_SCHEDULER_INTERVAL`  | `15s`    | Matches desktop `POLL_INTERVAL_MS` (`scheduler.ts:8`). |
| `CloudSchedulerLeaseTTL time.Duration` | `CLOUD_SCHEDULER_LEASE_TTL` | `90s`    | Must exceed tick + max start latency + clock skew.     |
| `CloudSchedulerTimezone string`        | `CLOUD_SCHEDULER_TIMEZONE`  | `UTC`    | v1 fixed default; per-task TZ is later.                |
| `CloudSchedulerOwner string`           | `CLOUD_SCHEDULER_OWNER`     | hostname | Prefer pod name via downward API.                      |

`Validate()` should require Temporal config when `CloudSchedulerEnabled=true`, because
the scheduler only creates `executor=api` runs and needs `Starter.Start` to launch the
workflow. If `TEMPORAL_ENABLED=false`, fail fast at process boot instead of silently
scanning tasks it cannot start.

### 3. Create `cmd/scheduler`

Clone the worker entrypoint shape (`cmd/worker/main.go`):

1. `appconfig.Load()`, set `ServiceName = "rowboat-api-scheduler"`.
2. Initialize logger/tracing.
3. Open DB with `db.Open`.
4. Start a `/metrics` + `/healthz` server on `METRICS_ADDR`, just like
   `cmd/worker/main.go:77-98`.
5. Dial Temporal using `backgroundtaskworkflow.Dial`; build
   `backgroundtaskworkflow.NewStarter`.
6. Build `backgroundtaskruns.Starter`.
7. Build `backgroundscheduler.Scheduler` with `{Client, Starter, Leases, Clock, Config}`.
8. Run `Scheduler.Run(ctx)` until SIGINT/SIGTERM.

The scheduler should not import `internal/backgroundtasks` (the HTTP handler package).
That would drag HTTP request/view concerns into a background process and recreate the
coupling the starter extraction removes.

### 4. Parse triggers with typed structs, not string inspection

Add `internal/backgroundscheduler/triggers.go`:

```go
type Triggers struct {
	CronExpr string   `json:"cronExpr"`
	Windows  []Window `json:"windows"`
}
type Window struct {
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
}
```

Validation rules copied from shared Zod (`live-note.ts:60-68` / `background-task.ts:73-80`):

- `cronExpr`: optional, non-empty string if present. Invalid cron means skip + metric, not
  process crash.
- `windows`: optional array; each time must match `^([01]\d|2[0-3]):[0-5]\d$`.
- Empty `{}` means manual-only; no scheduler action.
- Unknown fields are ignored for forwards compatibility.

The due evaluator must accept `now time.Time` so tests are deterministic and so all math is
explicitly `UTC` (`now.In(location)` only after the v1 timezone decision is applied).

### 5. Query shape for each tick

The scheduler is cross-tenant by design, so every ent query must use
`auth.WithInternal(ctx)`; otherwise the interceptors in `internal/db/interceptors.go` will
return `ErrNoViewer`. The task query should load the user edge because `Starter.Start`
needs the owner:

```go
tasks, err := s.client.BackgroundTask.Query().
	Where(
		backgroundtask.ActiveEQ(true),
		backgroundtask.ExecutionTargetEQ("api"),
		backgroundtask.TriggersJSONNotNil(),
	).
	WithUser().
	All(auth.WithInternal(ctx))
```

Then, for every task:

1. If `task.Edges.User == nil`, count `errors{stage="user_edge"}` and skip. A run without
   a user edge cannot be created safely.
2. Parse `TriggersJSON`; skip parse errors.
3. Apply the in-flight guard exactly like `scheduler.ts:34-48`:
   `last_attempt_at > last_run_at && backoffRemaining(last_attempt_at) > 0`.
4. Compute due source with the pure due math. Cron wins if both cron and a window are due,
   matching `schedule/utils.ts:32-36`.
5. If due, check backoff (`scheduler.ts:56-60`).
6. Acquire the RFC 002 lease. In single-replica kind this can be a no-op implementation,
   but keep the call in the loop so multi-replica is a config change.
7. Call `Starter.Start`.
8. Complete the lease with the run id.

### 6. Scheduler run parameters

For `cron`, set:

```go
Trigger: "cron"
RunIDPrefix: "sched-cron-"
RequestedContext: fmt.Sprintf(
	"Scheduled cron trigger fired at %s for expression %q. Occurrence: %s.",
	now.Format(time.RFC3339), expr, occurrence.Format(time.RFC3339),
)
```

For `window`, set:

```go
Trigger: "window"
RunIDPrefix: "sched-window-"
RequestedContext: fmt.Sprintf(
	"Scheduled window trigger fired at %s inside %s-%s window. Cycle date: %s.",
	now.Format(time.RFC3339), start, end, cycleDate,
)
```

Keep `requested_context` short. It is inserted into the artifact verbatim today
(`buildArtifact`, `workflow.go:503-505`) and will be part of the LLM context in RFC 004.

### 7. Chart and image changes

Current `Makefile` builds `bin/rowboat-api` and `bin/rowboat-api-worker` only. Add:

```make
CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/rowboat-api-scheduler ./cmd/scheduler
```

Update `apps/rowboat-api/Dockerfile` to copy the third binary. Add
`charts/rowboat-api/templates/scheduler-deployment.yaml`, `scheduler-service.yaml`, and
`scheduler-servicemonitor.yaml`, mirroring the worker chart:

- `command: ["/rowboat-api-scheduler"]`
- labels `app.kubernetes.io/component: scheduler`
- `CLOUD_SCHEDULER_OWNER` from `metadata.name`
- `TEMPORAL_ENABLED=true`
- `/healthz` and `/metrics` on the metrics port
- `scheduler.enabled: false` in base/staging/prod; `true` only in kind during first E2E

## PR slicing, parity fixtures, and failure drills

Ship the scheduler as a sequence of small PRs. Each PR should leave the tree deployable and
should have a single rollback story.

| PR    | Scope                                                              | Must prove                                                                            |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------- |
| 001-A | Extract `backgroundtaskruns.Starter`; HTTP handler delegates to it | `handler_cloud_test.go` output is unchanged for manual trigger, start failure, retry. |
| 001-B | Pure Go trigger parser + due math, no DB loop                      | Golden tests copied from `schedule/utils.ts`; cron/window parity documented.          |
| 001-C | Scheduler loop with fake starter and no-op lease                   | Unit test scans synthetic tasks and records intended fires only.                      |
| 001-D | Wire real `Starter` + RFC 002 lease                                | Integration test creates queued API run and lease completion in one tick.             |
| 001-E | `cmd/scheduler` + metrics + Docker/Helm                            | `helm template` renders scheduler and binary exists in image.                         |
| 001-F | kind E2E desktop-closed cron/window                                | Scheduled cloud run appears with `executor=api`, `trigger=cron                        | window`. |

### Desktop parity fixtures

Create a table-driven fixture file that both TypeScript and Go can reason about. If a shared
JSON fixture is too much for v1, copy the cases exactly in both languages and name them the
same:

| Case                       | Trigger       | Last run      | Now        | Expected                                                       |
| -------------------------- | ------------- | ------------- | ---------- | -------------------------------------------------------------- |
| `cron_never_ran_immediate` | `*/5 * * * *` | `nil`         | `14:03`    | due, matching desktop's current `!lastRunAt` shortcut.         |
| `cron_within_grace`        | `0 * * * *`   | `12:00`       | `13:01:30` | due for `13:00`.                                               |
| `cron_outside_grace`       | `0 * * * *`   | `12:00`       | `13:03:00` | not due.                                                       |
| `cron_already_advanced`    | `0 * * * *`   | `13:00`       | `13:01`    | not due.                                                       |
| `window_first_today`       | `09:00-12:00` | `nil`         | `10:15`    | due.                                                           |
| `window_already_today`     | `09:00-12:00` | `09:30 today` | `10:15`    | not due.                                                       |
| `window_boundary_start`    | `09:00-12:00` | `yesterday`   | `09:00`    | due.                                                           |
| `window_boundary_end`      | `09:00-12:00` | `yesterday`   | `12:00`    | due, because desktop uses `nowMinutes > endMinutes` to reject. |
| `window_after_end`         | `09:00-12:00` | `yesterday`   | `12:01`    | not due.                                                       |

Be explicit about the known semantic mismatch: the desktop currently evaluates windows in
device-local time (`new Date().getHours()` in `schedule/utils.ts:83`); v1 cloud evaluates in
UTC. That is accepted only because RFC 006 labels cloud schedules as cloud/UTC managed.

### Scheduler pagination and backpressure

The first query can load all active API tasks because current scale is small, but the code
should not make that permanent. Define the loop around pages:

```go
const defaultPageSize = 500
for offset := 0; ; offset += pageSize {
	tasks, err := query.Offset(offset).Limit(pageSize).All(ctx)
	if err != nil { return err }
	if len(tasks) == 0 { break }
	for _, task := range tasks { s.evaluateTask(ctx, task, now) }
	if len(tasks) < pageSize { break }
}
```

Metrics should make saturation visible before it becomes an incident:

- `cloud_scheduler_tick_duration_seconds` p95 should stay below half the interval.
- `cloud_scheduler_tasks_scanned_total / ticks` gives average scan size.
- `cloud_scheduler_errors_total{stage="query"}` should page the owner if non-zero.
- A future `cloud_scheduler_tick_skipped_total` should increment if a tick is still running
  when the next interval arrives.

### Failure drills

Run these manually in kind before staging:

1. Kill the scheduler pod after it acquires a lease but before `Starter.Start` returns.
   Expected: lease expires; next pod steals; at most one run.
2. Make Temporal unavailable (`TEMPORAL_ADDRESS` bad) and let a due cron tick occur.
   Expected: failed run with `temporal_start_failed`, no lease completion, no task
   `last_run_at` advancement.
3. Corrupt one task's `triggers_json` shape while leaving valid JSON.
   Expected: parse error metric, other tasks still evaluated.
4. Set task inactive between scan and start.
   Expected: either stale single fire is logged as accepted tradeoff, or implementation
   re-checks active in `Starter.Start` and skips. Document the chosen behavior in code.
5. Run two scheduler replicas against `*/1 * * * *`.
   Expected: exactly one run per minute, duplicate-suppressed metric increments.

## Rollout

1. Land the `Starter` refactor behind no flag (pure refactor; existing tests guard it).
2. Add scheduler binary + chart, **disabled by default** (`CLOUD_SCHEDULER_ENABLED=false`).
3. Enable in **kind** (`values-kind.yaml`), single replica. Validate: close desktop, cron
   task fires.
4. Enable in **staging**, single replica, soak (reuse [RFC 007](./007-production-cloud-enablement.md) soak).
5. **Gate:** do not exceed one replica until RFC 002 lease tests pass.
6. Enable multiple replicas in staging; verify `duplicate_suppressed` > 0 and exactly one
   run per cycle.
7. Production via RFC 007 phases.

## Test plan

Unit (`internal/backgroundscheduler/..._test.go`) — port the desktop scenarios:

- `isCronDue`: never-run fires; within grace fires; outside grace skipped; already-ran-this-occurrence skipped.
- `isWindowDue`: inside band first-time fires; second time same day skipped; adjacent windows sharing an endpoint both fire; before/after band skipped.
- `backoffRemaining`: zero outside window, positive inside, monotonic.
- `dueTimedTrigger`: cron wins over window when both due; neither → "".
- In-flight backstop: `lastAttemptAt > lastRunAt` within backoff → skip.

Integration:

- `Starter.Start` from scheduler creates `trigger=cron`/`window`, `executor=api` runs with
  Temporal ids — assert parity with `triggerAPIRun` output (same `viewRun` shape).
- Lease prevents duplicate run creation under concurrent ticks (RFC 002 harness).

kind E2E (extends `scripts/rowboat-api-kind.sh`): create API-target cron task, **kill the
desktop process**, assert a `succeeded` cloud run appears within two grace windows.

## Acceptance criteria

- API-target cron/window tasks run with the desktop closed.
- `executionTarget: desktop` tasks remain desktop-scheduled (scheduler ignores them).
- HTTP- and scheduler-initiated runs are byte-identical downstream (events, metrics, IDs).
- Duplicate scheduled runs are prevented across replicas (with RFC 002).
- Run history shows `trigger=cron` / `trigger=window`; logs/metrics explain every decision.

## Alternatives considered

- **Goroutine in `cmd/server`** — rejected for v1 (every API replica would evaluate,
  forcing the lease immediately and coupling scheduler crashes to the API). Revisit if a
  separate Deployment proves operationally heavy.
- **Skip the loop, go straight to Temporal Schedules (RFC 005)** — rejected as the
  _first_ step: Temporal Schedules cover only exact cron, not windows, and require the
  schedule-sync/reconciler machinery. The loop ships value sooner and becomes the fallback.
- **Reuse the desktop scheduler over a tunnel** — rejected; defeats the offline goal.

## Decisions

Resolved forks (consolidated in [`README.md` → Decisions](./README.md#consolidated-decisions)):

- **Component shape → separate `cmd/scheduler` Deployment.** Own crash domain + `/metrics`,
  mirrors `cmd/worker`, scales independently. A goroutine in `cmd/server` would force every
  API replica to evaluate (and the lease immediately).
- **Cron library → `github.com/adhocore/gronx`.** Native `PrevTick`/`NextTick` reproduce the
  desktop's `cron-parser.prev()` cycle math without hand-rolled stepping.
- **Timezone → UTC for v1** (`CLOUD_SCHEDULER_TIMEZONE=UTC`). Cron prev-occurrence and window
  bands evaluate in UTC; "once per day" means the UTC day. The desktop labels cloud schedules
  so the wall-clock shift from device-local time is visible ([RFC 006](./006-desktop-cloud-control-plane.md)).
- **Per-task timezone → committed fast-follow (post-v1).** A task-level `timezone` field adds
  a TZ segment to the [RFC 002](./002-durable-schedule-state.md) schedule key, sets Temporal
  `TimeZoneName` ([RFC 005](./005-temporal-schedule-integration.md)), and gets a desktop TZ
  label (RFC 006). This is the single cross-cutting follow-up tracked across the set.
- **Lease from day one.** Implementation order lands RFC 002 first, so the loop is
  lease-aware on first ship; single→multi replica is a config change.

### Deferred (needs production data; not blocking)

- Poll-interval tuning (15 s default) once staging scan latency is measured.
