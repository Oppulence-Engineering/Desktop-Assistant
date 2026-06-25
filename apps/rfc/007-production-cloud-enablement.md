# RFC 007: Production Enablement for Cloud Background Workflows

|                  |                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**          | 007                                                                                                                                                                                          |
| **Status**       | Draft                                                                                                                                                                                        |
| **Track**        | Cloud-native background workflows                                                                                                                                                            |
| **Owners**       | `apps/rowboat-api` · Platform/Infra (Hetzner k3s, Temporal Cloud, Infisical)                                                                                                                 |
| **Created**      | 2026-06-05                                                                                                                                                                                   |
| **Last updated** | 2026-06-06                                                                                                                                                                                   |
| **Gates**        | the production rollout of [RFC 001](./complete-001-api-owned-scheduler.md), [003](./complete-003-cloud-event-ingestion.md), [004](./complete-004-cloud-agent-runtime.md), [005](./complete-005-temporal-schedule-integration.md) |
| **Refs**         | Supersedes former cloud workflow production-enablement plan; operational deployment reference: [`docs/BACKEND_DEPLOYMENT.md`](../../docs/BACKEND_DEPLOYMENT.md).                             |

## Summary

The local **kind** environment runs the full stack — Rowboat API, worker, Temporal,
Postgres, Redis, devstack — and the happy-path smoke test passes
(`scripts/rowboat-api-kind.sh`, parent RFC §4.5). Staging/production chart values are
**pre-wired for Temporal Cloud** (API-key auth over TLS) but ship with cloud execution
**disabled** (`TEMPORAL_ENABLED: "false"`, `worker.enabled: false`) until a namespace + key
are provisioned. This RFC defines the work to safely flip it on — first staging, then
production — with the observability and runbooks to operate it.

## Current state (grounded)

The code and chart are ready; only the switch is off.

| Fact                                                           | Evidence                                                                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporal client is Cloud-aware (API key ⇒ TLS)                 | `Dial` (`workflow.go:91-105`); `Config.TemporalUseTLS()` (`appconfig/config.go:247`)                                                                                 |
| All Temporal config keys exist                                 | `appconfig/config.go:137-146,229-235`: `TEMPORAL_ENABLED/ADDRESS/NAMESPACE/TASK_QUEUE/WORKER_ENABLED/API_KEY/TLS_ENABLED`                                            |
| Boot validation                                                | `Config.Validate()` requires address/namespace/queue when enabled (`config.go:258-267`); worker refuses to start unless `TEMPORAL_ENABLED` (`cmd/worker/main.go:46`) |
| Worker is a separate, gated Deployment with its own `/metrics` | `charts/rowboat-api/templates/worker-deployment.yaml` (gated on `worker.enabled`; sets `TEMPORAL_WORKER_ENABLED=true`; `/healthz` on metrics port)                   |
| Worker ServiceMonitor                                          | `templates/worker-servicemonitor.yaml` (gated on `worker.enabled && serviceMonitor.enabled`)                                                                         |
| Run metrics emitted from worker activities                     | `internal/backgroundtaskmetrics/metrics.go` (9 series); worker serves them (`cmd/worker/main.go:78-101`)                                                             |
| Staging/prod values pre-wired, **disabled**                    | `values-staging.yaml:32-42`, `values-production.yaml:33-43` (`TEMPORAL_ENABLED: "false"`, `worker.enabled: false`, placeholder `<namespace>.<account>`)              |
| Secrets via existing Secret / Infisical                        | `existingSecret: rowboat-api-secrets`; `INFISICAL_ENABLED` (`values-production.yaml:25`)                                                                             |

## Goals

- Enable API-native background-task execution in **staging** on Temporal Cloud.
- Validate Cloud connectivity, then **promote to production** after a soak.
- Worker deployment with metrics scraping and alerting.
- Secrets sourced through Infisical / Kubernetes Secret (never inlined in values).
- Alerts for run failures, queue latency, worker health; documented runbooks; clean rollback.

## Non-Goals

- Self-hosting Temporal in production (we use Temporal Cloud; local kind uses
  `temporalio/auto-setup`).
- Migrating all desktop tasks to API execution by default (local stays the default).
- Enabling unbounded cloud tool execution before [RFC 004](./complete-004-cloud-agent-runtime.md)
  ships (the deterministic-artifact runtime is the safe interim; the LLM runtime gates on
  RFC 004 + `CLOUD_RUNTIME_ENABLED`).

## Required infrastructure

| Item                                        | Owner                          | Notes                                                                 |
| ------------------------------------------- | ------------------------------ | --------------------------------------------------------------------- | ----------------------- |
| Temporal Cloud namespace (staging + prod)   | Platform                       | e.g. `rowboat-staging.<acct>`, `rowboat.<acct>`                       |
| Temporal API key per namespace              | Platform                       | least-privilege; rotation cadence below                               |
| Task queue `rowboat-api-background-tasks`   | code default (`config.go:232`) | no manual setup; created on first poll                                |
| `TEMPORAL_API_KEY` in `rowboat-api-secrets` | Platform via Infisical         | **never** in values; projected by external-secrets/Infisical operator |
| Infisical paths/env entries                 | Platform                       | `INFISICAL_ENVIRONMENT: staging                                       | production` already set |
| Metrics scraping for API + worker pods      | Platform                       | ServiceMonitors already templated; ensure Prometheus selects them     |

## Helm configuration

The change per environment is small — flip the four switches and point at the namespace.
**Staging** (`values-staging.yaml`):

```yaml
config:
  TEMPORAL_ENABLED: "true"
  TEMPORAL_ADDRESS: rowboat-staging.<account>.tmprl.cloud:7233
  TEMPORAL_NAMESPACE: rowboat-staging.<account>
  TEMPORAL_TLS_ENABLED: "true" # API key implies TLS anyway (config.go:248)
  TEMPORAL_WORKER_ENABLED: "true" # also set at pod level by worker-deployment.yaml:51
worker:
  enabled: true
  replicaCount: 1
serviceMonitor:
  enabled: true # already true in staging
# TEMPORAL_API_KEY lives in rowboat-api-secrets (Infisical), NOT here.
```

**Production** (`values-production.yaml`): same, namespace `rowboat.<account>`, plus:

```yaml
worker:
  enabled: true
  replicaCount: 2 # already defaulted; size from staging soak
  resources: # tune from staging utilization
    requests: { cpu: 200m, memory: 256Mi }
    limits: { cpu: "1", memory: 512Mi }
```

> The worker pod **forces** `TEMPORAL_WORKER_ENABLED=true` regardless of the ConfigMap
> (`worker-deployment.yaml:51-52`), so the API and worker can share the ConfigMap while only
> the worker registers activities. The API process dials Temporal only when
> `TEMPORAL_ENABLED=true` (`cmd/server/wire.go:100-116`) and adds a `temporal` readiness
> check (`CheckHealth`, `wire.go:108`).

## Rollout plan

### Phase 1 — Staging connectivity

- Provision namespace + key; project into `rowboat-api-secrets`.
- Deploy API with `TEMPORAL_ENABLED=true` and worker `replicaCount: 1`.
- Verify: API `/readyz` includes a passing `temporal` check; worker logs
  `"rowboat-api temporal worker started"` (`cmd/worker/main.go:124`).
- Run a manual api-target task from the desktop against staging; verify it reaches
  `succeeded`.

### Phase 2 — Staging soak (several days)

- Run scheduled + manual cloud tasks. Monitor failure rate + queue latency.
- Verify artifact pullback, cancel/retry/rerun, and that logs carry run + workflow ids
  (`runLogFields`, `handler.go:1815`).
- Enable [RFC 001](./complete-001-api-owned-scheduler.md) scheduler (single replica) and confirm
  desktop-closed firing; then [RFC 005](./complete-005-temporal-schedule-integration.md) cron behind
  its flag.

### Phase 3 — Production limited enablement

- Enable worker; keep api-target **task creation** behind a feature flag / internal
  allowlist. Run internal dogfood tasks only. Watch for regressions.

### Phase 4 — Production GA

- Remove allowlist after reliability targets hold (SLOs below).
- Enable user-facing api-execution controls. Local desktop execution remains the default
  unless product decides otherwise.

## SLOs (define before GA; drive the alerts)

| SLO                    | Target                      | Source metric                                                             |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------- |
| Cloud run success rate | ≥ 99% over 1h               | `cloud_runs_completed_total` / (`…completed` + `cloud_runs_failed_total`) |
| Queue latency p95      | ≤ 30s                       | `cloud_run_queue_latency_seconds`                                         |
| Run duration p95       | ≤ 5m (the activity ceiling) | `cloud_run_duration_seconds`                                              |
| Worker availability    | ≥ 99.9%                     | `up{job=~".*worker.*"}`                                                   |
| Scheduler freshness    | tick ≤ 2×interval           | `cloud_scheduler_tick_duration_seconds` (RFC 001)                         |

## Alerts (PromQL, against real series)

All series exist in `internal/backgroundtaskmetrics/metrics.go` (or the RFC 001/003/004
additions). Examples:

```promql
# Worker deployment unavailable
absent(up{app_kubernetes_io_component="worker"} == 1)

# No worker metrics received (scrape gap) for 5m
absent_over_time(cloud_runs_completed_total[5m]) and on() (hour() >= 0)

# Cloud run failure rate > 10% over 15m
sum(rate(cloud_runs_failed_total[15m]))
  / clamp_min(sum(rate(cloud_runs_completed_total[15m])) + sum(rate(cloud_runs_failed_total[15m])), 1)
  > 0.10

# Failure spike by error code (which class is breaking)
sum by (error_code) (rate(cloud_runs_failed_total[15m])) > 0.05

# Queue latency p95 > 60s for 10m
histogram_quantile(0.95, sum(rate(cloud_run_queue_latency_seconds_bucket[10m])) by (le)) > 60

# Temporal start failures (control-plane) climbing
rate(cloud_runs_failed_total{error_code="temporal_start_failed"}[10m]) > 0

# Artifact sync failure spike
rate(cloud_run_artifact_sync_failures_total[15m]) > 0

# Scheduler stalled (RFC 001): no ticks in 2 min
rate(cloud_scheduler_ticks_total[2m]) == 0
```

> The cardinality discipline in `metrics.go:8` (label only by `trigger`/`error_code`, never
> by slug/user/run) is what makes `sum by (error_code)` cheap and these alerts safe at scale.

## Operational runbooks

Create under `docs/runbooks/` (link from `BACKEND_DEPLOYMENT.md`):

| Runbook                               | Trigger                                                     | First moves                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Temporal Cloud outage**             | `temporal` readiness failing; `temporal_start_failed` spike | Confirm via Temporal status; the API still serves non-cloud routes; **RFC 001 loop continues for windows**; queue drains on recovery (Temporal retains schedules). Rollback switch: `TEMPORAL_ENABLED=false` (cloud triggers 503 cleanly via `triggerAPIRun`, `handler.go:1122`). |
| **Worker crash loop**                 | worker pod `CrashLoopBackOff`                               | Check logs for dial/start failures (the worker retries dial every 5s, `cmd/worker/main.go:108`); verify `TEMPORAL_API_KEY` present; check resource limits/OOM.                                                                                                                    |
| **Runs stuck queued**                 | runs `status=queued`, queue latency rising                  | Worker down or not registered on the queue; verify `worker.enabled` + task-queue name match (`rowboat-api-background-tasks`); scale worker.                                                                                                                                       |
| **Runs stuck running (no heartbeat)** | `last_heartbeat_at` stale, no terminal                      | Activity hung; Temporal will time out at 5m → `activity_timeout`; inspect the run's `error_code`; if RFC 004, check runtime limits.                                                                                                                                               |
| **High failure by error code**        | `cloud_runs_failed_total{error_code}` alert                 | Pivot on `error_code` (taxonomy in `errcodes.go`): `db_error`→DB health; `artifact_write_failed`→artifact path; `temporal_*`→control plane; `runtime_*`→RFC 004 limits.                                                                                                           |
| **Secret rotation**                   | scheduled / suspected leak                                  | Rotate `TEMPORAL_API_KEY` in Infisical → roll worker + API; old key valid until revoked; verify readiness post-roll.                                                                                                                                                              |

## Security

- **Never inline `TEMPORAL_API_KEY`** in values files (the staging/prod values say this
  explicitly, `values-staging.yaml:30`). Project from `rowboat-api-secrets` via
  Infisical/external-secrets.
- Rotate the API key on a defined cadence (e.g. 90 days) and on suspicion; runbook above.
- Restrict Temporal namespace access (least-privilege key; separate keys per environment).
- Ensure logs never include secret material (the worker/handler log run/workflow ids, not
  credentials; `Dial` reads the key from config, never logs it).
- Verify every background-task route enforces user authz — already true: routes sit behind
  `RequireJWT` (`wire.go:183-211`) and the ORM interceptors scope every entity per user
  (`internal/db/interceptors.go`). The scheduler/worker run `auth.WithInternal` deliberately
  (cross-tenant system components) and take no external input.

## Code-level implementation playbook

This RFC is mostly operational, but there are still repo-level changes and preflight
commands that should be explicit so staging/prod flips are repeatable.

### 1. Chart toggles already present

The chart lives at `charts/rowboat-api`:

| File                                   | Current role                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `templates/worker-deployment.yaml`     | Gated by `worker.enabled`; command `/rowboat-api-worker`; forces `TEMPORAL_WORKER_ENABLED=true`; exposes metrics port + `/healthz`. |
| `templates/worker-service.yaml`        | Metrics service for the worker.                                                                                                     |
| `templates/worker-servicemonitor.yaml` | Scrape config when `worker.enabled && serviceMonitor.enabled`.                                                                      |
| `values-staging.yaml`                  | Temporal Cloud placeholders, `TEMPORAL_ENABLED=false`, `worker.enabled=false`, ServiceMonitor true.                                 |
| `values-production.yaml`               | Same placeholders, prod API autoscaling 3-20, worker disabled by default.                                                           |

The first production-enablement PR should not invent a second chart. It should parameterize
the existing worker and add the RFC 001 scheduler chart pieces in the same style.

### 2. Helm values patch checklist

For staging:

```yaml
config:
  TEMPORAL_ENABLED: "true"
  TEMPORAL_ADDRESS: rowboat-staging.<account>.tmprl.cloud:7233
  TEMPORAL_NAMESPACE: rowboat-staging.<account>
  TEMPORAL_TASK_QUEUE: rowboat-api-background-tasks
  TEMPORAL_TLS_ENABLED: "true"
  TEMPORAL_WORKER_ENABLED: "true"
worker:
  enabled: true
  replicaCount: 1
serviceMonitor:
  enabled: true
existingSecret: rowboat-api-secrets
```

For production, start with the same but keep user-facing task creation allowlisted:

```yaml
worker:
  enabled: true
  replicaCount: 2
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
    limits:
      cpu: "1"
      memory: 512Mi
```

Do not set `TEMPORAL_API_KEY` in values. It must come from `rowboat-api-secrets`.

### 3. Build and Docker changes when RFC 001 lands

Current `apps/rowboat-api/Makefile` builds the API and worker (`Makefile:15-19`). When the
scheduler lands, production enablement must include:

- `bin/rowboat-api-scheduler` in `make build`
- Dockerfile copies for all three binaries
- scheduler Deployment/Service/ServiceMonitor
- image smoke that `docker run <image> /rowboat-api-worker --help` is not required, but
  the binary exists in the image

This avoids the common failure where Helm renders a Deployment whose command does not exist
in the image.

### 4. Preflight commands

Before staging flip:

```sh
kubectl -n rowboat-staging get secret rowboat-api-secrets -o jsonpath='{.data.TEMPORAL_API_KEY}' | wc -c
helm lint charts/rowboat-api
helm template rowboat-api charts/rowboat-api \
  -f charts/rowboat-api/values-staging.yaml \
  --set config.TEMPORAL_ENABLED=true \
  --set worker.enabled=true >/tmp/rowboat-api-staging.yaml
rg 'TEMPORAL_API_KEY:|tmprl.cloud|rowboat-api-worker|ServiceMonitor' /tmp/rowboat-api-staging.yaml
```

Expected:

- secret value length > 0
- rendered worker Deployment exists
- rendered worker ServiceMonitor exists when `serviceMonitor.enabled=true`
- no literal API key appears in rendered YAML
- Temporal address/namespace are no longer placeholders

After deploy:

```sh
kubectl -n rowboat-staging rollout status deploy/rowboat-api-worker
kubectl -n rowboat-staging logs deploy/rowboat-api-worker --tail=100 | rg 'temporal worker started|dial temporal|start temporal worker'
kubectl -n rowboat-staging port-forward svc/rowboat-api-worker 9090:9090
curl -fsS localhost:9090/healthz
curl -fsS localhost:9090/metrics | rg 'cloud_runs_|cloud_run_'
```

### 5. API readiness and Temporal checks

`cmd/server/wire.go` dials Temporal only when `TEMPORAL_ENABLED=true` and registers a
readiness check (`wire.go:100-111`). That means flipping `TEMPORAL_ENABLED` can make API
pods fail readiness if Temporal Cloud credentials are wrong. This is desirable for staging,
but in production use a canary/rolling strategy:

1. Deploy one API pod with Temporal enabled.
2. Verify `/readyz` passes and logs show no dial errors.
3. Roll remaining API pods.
4. Then enable worker.

If the API should keep serving non-cloud routes during a Temporal incident, keep the
existing behavior in mind: `TEMPORAL_ENABLED=false` removes the readiness check and cloud
triggers return `temporal_unavailable` through `triggerAPIRun` (`handler.go:1121-1123`).

### 6. Smoke run payload

Use the existing API path, not a Temporal CLI, for validation. The system invariant is the
full Rowboat path:

1. Desktop/API creates an `executionTarget=api` background task.
2. `POST /v1/background-tasks/{slug}/trigger`.
3. API inserts queued run row.
4. API starts Temporal.
5. Worker claims and completes.
6. Artifact is readable.

The staging smoke should assert:

```json
{
  "trigger": "manual",
  "executor": "api",
  "status": "succeeded",
  "temporalWorkflowId": "background-task/<user>/<slug>/<run>",
  "progressPercent": 100,
  "errorCode": ""
}
```

And metrics:

- `cloud_runs_triggered_total{trigger="manual"} >= 1` on API or worker metrics depending
  process scrape
- `cloud_runs_completed_total >= 1` on worker metrics
- `cloud_run_queue_latency_seconds_bucket` has observations

### 7. Alert wiring details

PromQL snippets in this RFC assume scrape labels. Normalize chart labels before creating
alerts:

```yaml
app.kubernetes.io/name: rowboat-api-worker
app.kubernetes.io/component: worker
app.kubernetes.io/instance: rowboat-api
```

Then use selectors that survive release-name changes:

```promql
up{app_kubernetes_io_component="worker"} == 0
```

If Prometheus relabels `app.kubernetes.io/component` into a different label name, update
the alert examples in the runbook with the actual label from `/api/v1/series`.

### 8. Rollback matrix

| Symptom                                 | Immediate rollback                                                                  | Data impact                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| API readiness fails after Temporal flip | Set `TEMPORAL_ENABLED=false`; roll API                                              | No run data loss; cloud trigger endpoint returns clean 503 while disabled.       |
| Worker crash loop                       | Set `worker.enabled=false`; keep API Temporal enabled if manual starts should queue | Queued/running workflows wait in Temporal; restart worker to drain.              |
| Temporal start failures from API        | Disable API Temporal or fix key/namespace                                           | Failed start rows remain with `temporal_start_failed`, auditable.                |
| Runtime tool failures after RFC 004     | Set `CLOUD_RUNTIME_ENABLED=false`                                                   | Reverts to deterministic artifacts; schedules/events still create runs.          |
| Scheduler duplicate risk                | Set scheduler replicas to 1 or `CLOUD_SCHEDULER_ENABLED=false`                      | Existing runs unaffected; timed cloud triggers pause/fallback depending RFC 005. |

### 9. Production allowlist mechanics

Use a simple env or DB list first:

```go
type CloudExecutionGate struct {
	AllowedUserIDs map[uuid.UUID]struct{}
	EnabledForAll bool
}
```

Check it in task create/patch when `execution_target` becomes `api`. Do not block:

- reading existing API-target tasks
- listing cloud runs
- retry/rerun of already-created internal dogfood tasks if the user is still allowlisted

Return `403` with code `cloud_execution_not_enabled` so the desktop can show a targeted
message instead of a generic failure.

## Environment readiness, dashboards, and runbook details

### Staging readiness checklist

Do not start the soak until all are true:

| Check                     | Evidence                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Temporal namespace exists | Temporal Cloud UI/API shows namespace and retention.                                                                           |
| API key present           | Kubernetes secret contains non-empty `TEMPORAL_API_KEY`.                                                                       |
| API readiness passes      | `/readyz` includes `temporal: ok`.                                                                                             |
| Worker ready              | worker pod `/healthz` and log `rowboat-api temporal worker started`.                                                           |
| Metrics scraped           | Prometheus has `cloud_runs_completed_total` from worker job.                                                                   |
| Manual cloud run succeeds | Run row terminal `succeeded`, artifact exists, events present.                                                                 |
| Cancel smoke passes       | Running task can be stopped and row becomes `stopped`.                                                                         |
| Retry smoke passes        | Failed run creates `trigger=retry`, `attempt=previous+1`.                                                                      |
| Rollback tested           | Flip `worker.enabled=false`; API remains healthy or intentionally returns 503 for cloud triggers depending `TEMPORAL_ENABLED`. |

### Dashboard panels

Create one dashboard before production allowlist:

| Panel                           | Query                                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud run starts by trigger     | `sum by (trigger) (rate(cloud_runs_triggered_total[5m]))`                                                                                       |
| Success/failure/stopped         | `sum(rate(cloud_runs_completed_total[5m]))`, `sum by(error_code)(rate(cloud_runs_failed_total[5m]))`, `sum(rate(cloud_runs_stopped_total[5m]))` |
| Queue latency p50/p95           | `histogram_quantile(0.95, sum(rate(cloud_run_queue_latency_seconds_bucket[5m])) by (le))`                                                       |
| Duration p50/p95                | `histogram_quantile(0.95, sum(rate(cloud_run_duration_seconds_bucket[5m])) by (le))`                                                            |
| Worker pod restarts             | `sum by(pod) (increase(kube_pod_container_status_restarts_total{container=~".*worker.*"}[1h]))`                                                 |
| Scheduler ticks                 | `sum(rate(cloud_scheduler_ticks_total[5m]))`                                                                                                    |
| Scheduler duplicates suppressed | `sum(rate(cloud_scheduler_duplicate_suppressed_total[5m]))`                                                                                     |
| Runtime limit failures          | `sum by(error_code)(rate(cloud_runs_failed_total{error_code=~"runtime_.*"}[15m]))`                                                              |

Add dashboard variables for namespace/environment and release/component label.

### Soak exit criteria

Staging soak exits only when all hold for at least several business days:

- Manual API runs complete reliably.
- Scheduled RFC 001 runs fire with desktop closed.
- If RFC 004 is enabled, runtime budget failures are explainable and not systemic.
- Queue p95 stays under target with 1 worker replica or documented scaling change.
- No unknown error-code bucket dominates failures.
- Worker restarts are either zero or explained by deploys.
- Secret rotation has been rehearsed once in staging.

### Secret rotation runbook in detail

1. Create new Temporal API key in Temporal Cloud for the same namespace.
2. Write it to Infisical / external secret backing `rowboat-api-secrets`.
3. Wait for Kubernetes Secret refresh, or force sync depending operator.
4. Restart API pods one at a time; readiness should pass.
5. Restart worker pods; they reconnect with the new key.
6. Trigger one manual cloud run.
7. Revoke old key.
8. Watch `temporal_start_failed` and worker dial logs for 15 minutes.

Never revoke the old key before API and worker pods have demonstrably loaded the new one.

### Production rollout timeline

| Day   | Action                                               | Gate                                 |
| ----- | ---------------------------------------------------- | ------------------------------------ |
| D-3   | Render Helm, verify secrets, run staging smoke       | No placeholders, no inlined secrets. |
| D-2   | Enable prod API Temporal readiness on one/canary pod | `/readyz` passes.                    |
| D-1   | Enable prod worker with no public exposure           | Worker metrics scraped.              |
| D0    | Add internal user-id allowlist                       | Internal manual run succeeds.        |
| D1-D7 | Dogfood scheduled/event/runtime paths                | SLOs hold, no high-severity alerts.  |
| D8+   | Expand allowlist or GA                               | Product/support signoff.             |

### Incident severity guide

| Severity | Examples                                               | Action                                                             |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| SEV1     | API unavailable due to Temporal readiness after deploy | Roll back `TEMPORAL_ENABLED`; restore API first.                   |
| SEV2     | Cloud runs cannot start, non-cloud API healthy         | Disable user-facing API-target creation; fix Temporal/worker.      |
| SEV2     | Duplicate scheduled runs across users/tasks            | Disable scheduler or reduce to one replica; inspect RFC 002 lease. |
| SEV3     | Runtime artifacts poor/empty but runs complete         | Disable `CLOUD_RUNTIME_ENABLED`; leave scheduler/worker on.        |
| SEV3     | Artifact pull failures in desktop                      | Keep cloud execution on; fix desktop/API artifact path.            |

## Test plan

- `helm template` validation for staging + production with Temporal enabled (assert worker
  Deployment + ServiceMonitor render; assert no secret value inlined).
- Secret-presence check: `TEMPORAL_API_KEY` resolvable in the target namespace before flip.
- Staging smoke (reuse `scripts/rowboat-api-kind.sh` shape against staging): trigger a cloud
  run, poll to `succeeded`, read events, check artifact.
- Staging cancel/retry smoke.
- Worker metrics scrape validation (Prometheus shows `cloud_runs_*` from the worker job).
- Production preflight: Temporal enabled, worker up, but **no public feature exposure**
  (allowlist on).

## Acceptance criteria

- Staging runs api-target tasks on Temporal Cloud.
- Production deploys the worker safely with metrics + alerts wired.
- Secrets sourced through Infisical / Kubernetes Secret.
- Run failures and queue latency are observable (SLOs + alerts above).
- Rollback is a flag flip: `worker.enabled=false` + `TEMPORAL_ENABLED=false` (cloud triggers
  degrade to a clean 503, no data loss; schedules persist in Temporal).

## Alternatives considered

- **Self-host Temporal in production** (as kind does with `auto-setup`) — rejected:
  operational burden (Cassandra/Postgres + Elasticsearch + history retention) vs Temporal
  Cloud's managed durability. kind self-hosts only for zero-cost local dev.
- **Run the worker inside the API pod** — rejected: couples worker crashes to API
  availability and prevents independent scaling; the separate Deployment already exists.
- **Enable production directly after staging connectivity (skip soak)** — rejected: the
  soak is where queue-latency sizing, failure-mode coverage, and resource limits come from.

## Decisions

Resolved forks (consolidated in [`README.md`](./README.md#consolidated-decisions)):

- **Worker sizing → staging 1 replica; production starts at 2** with requests `200m/256Mi`,
  limits `1/512Mi` — a concrete starting point (overrides the chart's `100m/128Mi`
  placeholder), **re-tuned from the Phase-2 soak's** observed CPU/memory + queue latency
  before GA.
- **Topology → single-region worker (US-East), one Temporal namespace per environment.** The
  API stays multi-region for LLM-gateway latency; background execution centralizes on one
  region/namespace until load justifies otherwise. Revisit when queue latency or regional
  data-residency demands it.
- **Phase-3 allowlist → a simple DB/env list of user ids** (no new feature-flag system). The
  api-target task-creation path checks the list; removing it at GA is a config change.

### Deferred (driven by the soak; not blocking)

- Final HPA bounds for the worker (the API already autoscales 3–20 in prod); add a worker
  HPA only if soak shows queue-latency pressure under load.
