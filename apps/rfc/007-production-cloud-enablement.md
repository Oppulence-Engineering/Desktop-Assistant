# RFC 007: Production Enablement for Cloud Background Workflows

| | |
| --- | --- |
| **RFC** | 007 |
| **Status** | Draft |
| **Track** | Cloud-native background workflows |
| **Owners** | `apps/rowboat-api` · Platform/Infra (Hetzner k3s, Temporal Cloud, Infisical) |
| **Created** | 2026-06-05 |
| **Last updated** | 2026-06-05 |
| **Gates** | the production rollout of [RFC 001](./001-api-owned-scheduler.md), [003](./003-cloud-event-ingestion.md), [004](./004-cloud-agent-runtime.md), [005](./005-temporal-schedule-integration.md) |
| **Parent docs** | [`docs/CLOUD_NATIVE_BACKGROUND_WORKFLOWS_RFC.md`](../../docs/CLOUD_NATIVE_BACKGROUND_WORKFLOWS_RFC.md) §6.4, [`docs/BACKEND_DEPLOYMENT.md`](../../docs/BACKEND_DEPLOYMENT.md) |

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

| Fact | Evidence |
| --- | --- |
| Temporal client is Cloud-aware (API key ⇒ TLS) | `Dial` (`workflow.go:91-105`); `Config.TemporalUseTLS()` (`appconfig/config.go:247`) |
| All Temporal config keys exist | `appconfig/config.go:137-146,229-235`: `TEMPORAL_ENABLED/ADDRESS/NAMESPACE/TASK_QUEUE/WORKER_ENABLED/API_KEY/TLS_ENABLED` |
| Boot validation | `Config.Validate()` requires address/namespace/queue when enabled (`config.go:258-267`); worker refuses to start unless `TEMPORAL_ENABLED` (`cmd/worker/main.go:46`) |
| Worker is a separate, gated Deployment with its own `/metrics` | `charts/rowboat-api/templates/worker-deployment.yaml` (gated on `worker.enabled`; sets `TEMPORAL_WORKER_ENABLED=true`; `/healthz` on metrics port) |
| Worker ServiceMonitor | `templates/worker-servicemonitor.yaml` (gated on `worker.enabled && serviceMonitor.enabled`) |
| Run metrics emitted from worker activities | `internal/backgroundtaskmetrics/metrics.go` (9 series); worker serves them (`cmd/worker/main.go:78-101`) |
| Staging/prod values pre-wired, **disabled** | `values-staging.yaml:32-42`, `values-production.yaml:33-43` (`TEMPORAL_ENABLED: "false"`, `worker.enabled: false`, placeholder `<namespace>.<account>`) |
| Secrets via existing Secret / Infisical | `existingSecret: rowboat-api-secrets`; `INFISICAL_ENABLED` (`values-production.yaml:25`) |

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
- Enabling unbounded cloud tool execution before [RFC 004](./004-cloud-agent-runtime.md)
  ships (the deterministic-artifact runtime is the safe interim; the LLM runtime gates on
  RFC 004 + `CLOUD_RUNTIME_ENABLED`).

## Required infrastructure

| Item | Owner | Notes |
| --- | --- | --- |
| Temporal Cloud namespace (staging + prod) | Platform | e.g. `rowboat-staging.<acct>`, `rowboat.<acct>` |
| Temporal API key per namespace | Platform | least-privilege; rotation cadence below |
| Task queue `rowboat-api-background-tasks` | code default (`config.go:232`) | no manual setup; created on first poll |
| `TEMPORAL_API_KEY` in `rowboat-api-secrets` | Platform via Infisical | **never** in values; projected by external-secrets/Infisical operator |
| Infisical paths/env entries | Platform | `INFISICAL_ENVIRONMENT: staging|production` already set |
| Metrics scraping for API + worker pods | Platform | ServiceMonitors already templated; ensure Prometheus selects them |

## Helm configuration

The change per environment is small — flip the four switches and point at the namespace.
**Staging** (`values-staging.yaml`):

```yaml
config:
  TEMPORAL_ENABLED: "true"
  TEMPORAL_ADDRESS: rowboat-staging.<account>.tmprl.cloud:7233
  TEMPORAL_NAMESPACE: rowboat-staging.<account>
  TEMPORAL_TLS_ENABLED: "true"        # API key implies TLS anyway (config.go:248)
  TEMPORAL_WORKER_ENABLED: "true"     # also set at pod level by worker-deployment.yaml:51
worker:
  enabled: true
  replicaCount: 1
serviceMonitor:
  enabled: true                        # already true in staging
# TEMPORAL_API_KEY lives in rowboat-api-secrets (Infisical), NOT here.
```

**Production** (`values-production.yaml`): same, namespace `rowboat.<account>`, plus:

```yaml
worker:
  enabled: true
  replicaCount: 2                      # already defaulted; size from staging soak
  resources:                           # tune from staging utilization
    requests: { cpu: 200m, memory: 256Mi }
    limits:   { cpu: "1",  memory: 512Mi }
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
- Enable [RFC 001](./001-api-owned-scheduler.md) scheduler (single replica) and confirm
  desktop-closed firing; then [RFC 005](./005-temporal-schedule-integration.md) cron behind
  its flag.

### Phase 3 — Production limited enablement

- Enable worker; keep api-target **task creation** behind a feature flag / internal
  allowlist. Run internal dogfood tasks only. Watch for regressions.

### Phase 4 — Production GA

- Remove allowlist after reliability targets hold (SLOs below).
- Enable user-facing api-execution controls. Local desktop execution remains the default
  unless product decides otherwise.

## SLOs (define before GA; drive the alerts)

| SLO | Target | Source metric |
| --- | --- | --- |
| Cloud run success rate | ≥ 99% over 1h | `cloud_runs_completed_total` / (`…completed` + `cloud_runs_failed_total`) |
| Queue latency p95 | ≤ 30s | `cloud_run_queue_latency_seconds` |
| Run duration p95 | ≤ 5m (the activity ceiling) | `cloud_run_duration_seconds` |
| Worker availability | ≥ 99.9% | `up{job=~".*worker.*"}` |
| Scheduler freshness | tick ≤ 2×interval | `cloud_scheduler_tick_duration_seconds` (RFC 001) |

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

| Runbook | Trigger | First moves |
| --- | --- | --- |
| **Temporal Cloud outage** | `temporal` readiness failing; `temporal_start_failed` spike | Confirm via Temporal status; the API still serves non-cloud routes; **RFC 001 loop continues for windows**; queue drains on recovery (Temporal retains schedules). Rollback switch: `TEMPORAL_ENABLED=false` (cloud triggers 503 cleanly via `triggerAPIRun`, `handler.go:1122`). |
| **Worker crash loop** | worker pod `CrashLoopBackOff` | Check logs for dial/start failures (the worker retries dial every 5s, `cmd/worker/main.go:108`); verify `TEMPORAL_API_KEY` present; check resource limits/OOM. |
| **Runs stuck queued** | runs `status=queued`, queue latency rising | Worker down or not registered on the queue; verify `worker.enabled` + task-queue name match (`rowboat-api-background-tasks`); scale worker. |
| **Runs stuck running (no heartbeat)** | `last_heartbeat_at` stale, no terminal | Activity hung; Temporal will time out at 5m → `activity_timeout`; inspect the run's `error_code`; if RFC 004, check runtime limits. |
| **High failure by error code** | `cloud_runs_failed_total{error_code}` alert | Pivot on `error_code` (taxonomy in `errcodes.go`): `db_error`→DB health; `artifact_write_failed`→artifact path; `temporal_*`→control plane; `runtime_*`→RFC 004 limits. |
| **Secret rotation** | scheduled / suspected leak | Rotate `TEMPORAL_API_KEY` in Infisical → roll worker + API; old key valid until revoked; verify readiness post-roll. |

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
