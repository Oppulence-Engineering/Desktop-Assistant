# RFC 004: Cloud-Safe Agent Runtime for API Background Tasks

| | |
| --- | --- |
| **RFC** | 004 |
| **Status** | Draft |
| **Track** | Cloud-native background workflows |
| **Owners** | `apps/rowboat-api` (Go backend / Temporal worker) |
| **Created** | 2026-06-05 |
| **Last updated** | 2026-06-05 |
| **Depends on** | existing Temporal worker (`internal/backgroundtaskworkflow`), LLM gateway (`internal/llm`), connectors (`internal/connectors`), secrets (`internal/secrets`) |
| **Consumed by** | [RFC 001](./001-api-owned-scheduler.md) & [RFC 003](./003-cloud-event-ingestion.md) (their runs execute through this runtime), [RFC 007](./007-production-cloud-enablement.md) (must land before unbounded cloud tools GA) |
| **Parent docs** | [`docs/CLOUD_NATIVE_BACKGROUND_WORKFLOWS_RFC.md`](../../docs/CLOUD_NATIVE_BACKGROUND_WORKFLOWS_RFC.md) §4.3, [`..._API_PLAN.md`](../../docs/CLOUD_NATIVE_BACKGROUND_WORKFLOWS_API_PLAN.md) |

## Summary

The Temporal worker today proves durable execution by producing a **deterministic
markdown artifact** — `ExecuteAPITask` (`internal/backgroundtaskworkflow/workflow.go:236`)
builds a static document from the task's name/instructions/trigger via `buildSummary` and
`buildArtifact` (`workflow.go:479-509`). There is **no LLM call, no tools, no connector
access**. That was the right scaffold for proving the orchestration; it is not yet useful
work.

This RFC defines the first **production cloud runtime**: an LLM-backed, tool-scoped,
connector-aware, limit-bounded execution path that the `ExecuteAPITask` activity delegates
to — while preserving the existing run/event/artifact model byte-for-byte.

## Current state (grounded)

The execution activity, today, in full shape (`workflow.go:236-296`):

```
ExecuteAPITask(ctx, StartInput):
  auth.WithInternal(ctx)
  load task (BackgroundTask + user)
  update run: progress 50, "Building API-native task artifact." + temporal.progress
  summary  := buildSummary(task, in)        // static string
  artifact := buildArtifact(task, in, …)    // static markdown
  upsertArtifact(task, runID, artifact)     // → BackgroundTaskArtifact (workflow.go:404)
  update run: progress 90 + temporal.artifact_updated
  return RunOutput{Summary: summary}
```

Surrounding it (unchanged by this RFC): `MarkRunRunning` (claims the run, sets `executor=api`,
`workflow.go:189`), `MarkRunDone`/`MarkRunFailed` (terminal states + metrics,
`workflow.go:299/349`), the 5-minute activity start-to-close + 3× retry policy
(`workflow.go:153-161`), and `ClassifyRunError` → `error_code` taxonomy
(`internal/backgroundtaskworkflow/errcodes.go`). **This RFC swaps the *body* of
`ExecuteAPITask`, nothing around it.**

## Goals

- Run useful background jobs fully in the API worker (LLM-generated artifacts, connector
  reads).
- LLM access through the **Rowboat API gateway** (`internal/llm`) so billing/credits/quota
  (`internal/quota`, `internal/credits`) apply uniformly.
- A **limited, auditable** tool surface (explicit allowlist; deny by default).
- Connector access via **cloud-safe, server-held credentials** only.
- Keep user data scoped and isolated (per-run identity on every tool call).
- Preserve the existing artifact + event model (`temporal.*` events, `index.md` artifact,
  revision/provenance fields).
- Bound runtime so a task can't loop forever or blow up cost.

## Non-Goals

- Arbitrary shell execution in the cloud (explicitly disallowed).
- Mirroring the desktop filesystem or every desktop tool in v1.
- Unbounded multi-hour agent loops.
- Replacing the desktop agent runtime for `executionTarget: desktop` tasks.

## Runtime model

### The seam

`ExecuteAPITask` becomes a thin adapter that builds a `RunInput`, calls
`Runtime.Execute`, and maps the result onto the existing event/artifact writes:

```go
// internal/backgroundtaskworkflow/workflow.go (revised ExecuteAPITask body, abridged)
func (a *Activities) ExecuteAPITask(ctx context.Context, in StartInput) (RunOutput, error) {
	ctx = auth.WithInternal(ctx)
	task, err := a.loadTask(ctx, in) // existing load + classify (workflow.go:243-252)
	if err != nil { return RunOutput{}, err }

	out, err := a.runtime.Execute(ctx, runtime.RunInput{
		UserID: in.UserID, TaskID: in.TaskID, Slug: in.Slug, RunID: in.RunID,
		Trigger: in.Trigger, RequestedContext: in.RequestedContext,
		Instructions: task.Instructions, Model: task.Model, Provider: task.Provider,
		Artifacts: a.artifactStore(task),     // ArtifactStore bound to this task
		Events:    a.eventSink(in),           // EventSink → appendEvent (workflow.go:436)
		Tools:     a.toolRegistry(in, task),  // scoped ToolRegistry
		LLM:       a.llmClient(in),           // gateway-backed LLMClient
		Limits:    a.limits,                  // from config
	})
	if err != nil {
		return RunOutput{}, mapRuntimeError(err) // → taggedError(code,…) (errcodes.go:55)
	}
	return RunOutput{Summary: out.Summary}, nil
}
```

`Runtime.Execute` owns the agent loop; the activity owns the durable boundary. Heartbeats
(`SetLastHeartbeatAt`, already written at `workflow.go:202,257,280`) continue from inside
the runtime via the `EventSink`/progress callbacks so Temporal sees liveness during long
LLM calls.

### Core interfaces

`internal/backgroundtaskruntime/runtime.go`:

```go
type RunInput struct {
	UserID, TaskID, Slug, RunID string
	Trigger, RequestedContext   string
	Instructions                string
	Model, Provider             string // optional per-task override (background_task.go:43-44)
	Artifacts ArtifactStore
	Events    EventSink
	Tools     ToolRegistry
	LLM       LLMClient
	Limits    Limits
}

type RunOutput struct {
	Summary       string
	ArtifactBytes int
	LLMCalls      int
	ToolCalls     int
}

type Runtime interface {
	// Execute runs the bounded agent loop. It emits progress via Events, reads/writes
	// the artifact via Artifacts, and calls only tools the Registry permits. It must be
	// deterministic-safe to call from a Temporal activity (no global mutable state).
	Execute(ctx context.Context, in RunInput) (RunOutput, error)
}

type ArtifactStore interface {           // wraps upsertArtifact (workflow.go:404)
	Read(ctx context.Context) (body, contentType string, revision int, err error)
	Write(ctx context.Context, body, contentType string) (revision int, err error)
}

type EventSink interface {               // wraps appendEvent (workflow.go:436)
	Progress(ctx context.Context, percent int, message string) error
	Emit(ctx context.Context, eventType string, payload map[string]any) error // temporal.* vocab
}

type LLMClient interface {               // gateway-backed; billing applies
	Complete(ctx context.Context, req LLMRequest) (LLMResponse, error)
}

type Tool interface {
	Name() string
	JSONSchema() json.RawMessage         // parameters schema for the model
	Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error)
}

type ToolRegistry interface {
	// Lookup returns a tool only if it is on the allowlist AND the scope permits it;
	// otherwise (nil, ErrToolNotAllowed) — deny by default.
	Lookup(name string) (Tool, error)
	List() []Tool                        // advertised to the model
}
```

### The agent loop (bounded)

```mermaid
flowchart TD
    A[Execute] --> B[load artifact + recent run history as context]
    B --> C[LLM.Complete with instructions + context + tool schemas]
    C --> D{tool calls?}
    D -- yes --> E[ToolRegistry.Lookup each]
    E -->|allowed| F[Tool.Invoke with ToolScope]
    E -->|denied| X[emit tool_denied, count, continue]
    F --> G[append results, emit temporal.progress]
    G --> H{limit hit?<br/>LLM calls / tool calls / duration / bytes}
    H -- yes --> L[fail run: limit_exceeded errorCode]
    H -- no --> C
    D -- no --> I[final summary + artifact]
    I --> J[Artifacts.Write → temporal.artifact_updated]
    J --> K[return RunOutput]
```

## Cloud tool surface

Initial **allowlist** (deny-by-default registry):

| Tool | Backed by | Scope |
| --- | --- | --- |
| `llm.complete` | `internal/llm` gateway | implicit (the `LLMClient`, billed) |
| `artifact.read` / `artifact.write` | `ArtifactStore` (this task's `index.md`) | task-scoped |
| `run_history.read` | recent `BackgroundTaskRun` rows for this task | task-scoped, read-only |
| `event.read` | linked `CloudEvent` payload ([RFC 003](./003-cloud-event-ingestion.md)) | run-scoped, read-only |
| `connector.read.*` | `internal/connectors` server-held tokens | user+connector scoped |
| `notify.enqueue` | notification path, if available | user-scoped |

Explicitly **disallowed in v1** (the registry has no entry; `Lookup` returns
`ErrToolNotAllowed`):

- Local filesystem access beyond the artifact store.
- Shell execution.
- Arbitrary network fetch (only vetted, named tools).
- Any desktop-only tool.

> Deny-by-default is enforced structurally: the registry is constructed from an explicit
> slice; unknown names can't resolve. A unit test asserts `Lookup("shell")` →
> `ErrToolNotAllowed`.

## Secrets & connectors

Credential sources, in priority order:

1. **Platform credentials** (vendor LLM keys, etc.) — from `internal/secrets`
   (`secrets.NewFromConfig` + Infisical refresh, wired at `wire.go:52-56`). Never the
   user's.
2. **User OAuth tokens** — only when the user has explicitly connected the provider and the
   API holds a valid token (the connector/OAuth broker, `internal/connectors` /
   `internal/google`, with refresh). Tokens are decrypted via `crypto.Sealer`
   (`internal/crypto`) at use, never logged, never returned to model text.
3. **Per-tool scoped** — a tool receives a narrowly-scoped credential for exactly its call;
   no raw secret passthrough into prompts or outputs.

Every tool invocation carries an immutable scope:

```go
type ToolScope struct {
	UserID      string
	WorkspaceID string // when available
	TaskSlug    string
	RunID       string
	Allowed     []string // capability scopes, e.g. ["gmail.readonly"]
}
```

A tool that needs a connector token resolves it *inside* `Invoke` from the scope's
`UserID` + capability — it is never handed a bearer by the model. If the user hasn't
connected the provider, the tool fails with a classified error (`connector_unavailable`,
see taxonomy below), not a silent empty result.

## Artifact handling

Writes go through `ArtifactStore`, never raw DB code — wrapping the existing
`upsertArtifact` (`workflow.go:404-434`), which already:

- sets `updated_by_run_id` (provenance, `background_task_artifact.go:35`),
- sets `content_type` (default `text/markdown`, `background_task_artifact.go:37`),
- increments `revision` (`AddRevision(1)`),
- and is followed by a `temporal.artifact_updated` event (`workflow.go:287`).

Additions:

- **Preserve-on-failure:** if the run fails before a successful write, the prior artifact is
  untouched (today's upsert is the only writer; the runtime must not partially write).
  Write the new body in a single `Write` call at the end of a successful loop.
- **Content type:** the runtime may set non-markdown `content_type` for artifacts that
  round-trip to the desktop (the field already exists for this).
- V1 keeps a single `index.md` per task (the artifact edge is 1:1,
  `background_task.go:61-63`). Multi-artifact support is a future additive change (new
  entity), explicitly out of scope.

## Runtime limits

Configurable, enforced inside `Execute`; breaching one fails the run with a specific
`error_code` (so it shows in `cloud_runs_failed_total{error_code}`):

| Limit | Default | Env | On breach `error_code` |
| --- | --- | --- | --- |
| Max wall-clock per run | `4m` (< the 5m activity start-to-close, `workflow.go:154`) | `CLOUD_RUNTIME_MAX_DURATION` | `runtime_deadline_exceeded` |
| Max LLM calls per run | `12` | `CLOUD_RUNTIME_MAX_LLM_CALLS` | `runtime_llm_budget_exceeded` |
| Max tool calls per run | `24` | `CLOUD_RUNTIME_MAX_TOOL_CALLS` | `runtime_tool_budget_exceeded` |
| Max artifact bytes | `1 MiB` | `CLOUD_RUNTIME_MAX_ARTIFACT_BYTES` | `runtime_artifact_too_large` |
| Max event payload bytes | `64 KiB` | `CLOUD_RUNTIME_MAX_EVENT_BYTES` | `runtime_event_too_large` |
| Max retry attempts | `3` (Temporal policy, `workflow.go:159`) | `TEMPORAL_*` (existing) | inherited |

> **Duration coupling:** the runtime deadline must be *strictly less* than the activity
> `StartToCloseTimeout` (5 min), or Temporal will fire `activity_timeout`
> (`ErrCodeActivityTimeout`) before the runtime's own `runtime_deadline_exceeded`, hiding
> the real cause. **Decided:** `EventSink.Progress` drives `activity.RecordHeartbeat` in v1
> (cheap, future-proofs liveness during long LLM calls); raising the ceiling later is then a
> `CLOUD_RUNTIME_MAX_DURATION` + activity-`StartToCloseTimeout` bump, heartbeats already in place.

### Error-code taxonomy additions

Extend `internal/backgroundtaskworkflow/errcodes.go` (the existing taxonomy + `knownErrorCodes`
map + `IsKnownErrorCode`) with runtime codes, all non-retryable via `taggedError`
(`errcodes.go:55`) since retrying won't change the outcome:

```
runtime_deadline_exceeded, runtime_llm_budget_exceeded, runtime_tool_budget_exceeded,
runtime_artifact_too_large, runtime_event_too_large, llm_call_failed,
tool_not_allowed, tool_invoke_failed, connector_unavailable
```

Keep the desktop's mirror in sync (the file comment at `errcodes.go:11` already mandates
this). `ClassifyRunError` (`errcodes.go:65`) needs no change — tagged runtime errors carry
their code through the Temporal `ApplicationError.Type()` already.

## Observability

`internal/backgroundtaskmetrics/metrics.go` gains (same leaf-package + cardinality rule):

| Series | Type | Labels |
| --- | --- | --- |
| `cloud_runtime_llm_calls_total` | counter | `provider` |
| `cloud_runtime_tool_calls_total` | counter | `tool` (bounded allowlist names only) |
| `cloud_runtime_tool_failures_total` | counter | `tool` |
| `cloud_runtime_limit_exceeded_total` | counter | `limit` |
| `cloud_runtime_artifact_bytes` | histogram | — |
| `cloud_runtime_llm_latency_seconds` | histogram | `provider` |

> `tool` is a label only because the allowlist is small and fixed — it satisfies the
> bounded-cardinality rule. Never label by `taskSlug`/`runId`/`userId` (logs/traces carry
> those, per `metrics.go:8`).

Logs (`zap`, mirroring `runLogFields`, `handler.go:1815`): `runId`, `taskSlug`, `userId`,
`toolName`, `durationMs`, `errorCode`, `llmCalls`, `toolCalls`, `artifactBytes`.

## Migration & code changes

- New package `internal/backgroundtaskruntime` (interfaces + a `DefaultRuntime`
  implementation + `NoopRuntime` that reproduces today's static-artifact behavior for the
  fallback path / tests).
- `Activities` (`workflow.go:183`) gains a `Runtime` field + `Limits`; `cmd/worker/main.go`
  constructs the runtime with the LLM gateway, connector registry, secrets, and config
  limits (the worker currently builds only `Client`+`Log`, `cmd/worker/main.go:131-134`).
- Extend `errcodes.go` taxonomy.
- Extend `metrics.go`.
- **No ent schema change** (artifact/run/event entities already carry every field the
  runtime needs: `updated_by_run_id`, `content_type`, `error_code`, `error_details`,
  `progress_*`, `last_heartbeat_at`).

Feature flag: `CLOUD_RUNTIME_ENABLED` selects `DefaultRuntime` vs `NoopRuntime`, so the
worker can ship the runtime dark and flip per environment (kind → staging → prod), keeping
the deterministic artifact as an instant rollback.

## Test plan

- Unit: runtime executes a simple LLM-backed artifact task against a fake `LLMClient`
  (deterministic responses) and writes via a fake `ArtifactStore` (revision increments).
- Unit: `LLMClient` failure → `llm_call_failed` classified code; `MarkRunFailed` records it
  (assert `cloud_runs_failed_total{error_code="llm_call_failed"}`).
- Unit: `Lookup("shell")` and `Lookup("fs.write")` → `ErrToolNotAllowed`; denied tool emits
  `tool_denied`, doesn't abort the loop.
- Unit: each limit breach fails predictably with its code; duration limit fires *before* the
  Temporal activity timeout.
- Unit: artifact write increments revision and sets `updated_by_run_id`; failure before
  write leaves the prior artifact intact.
- Integration: Temporal worker (test env) runs the full workflow with `DefaultRuntime`,
  emits `temporal.{running,progress,artifact_updated,completed}`, persists artifact + events
  — assert parity with the existing happy-path harness (`handler_cloud_test.go` style).

## Acceptance criteria

- API-target tasks produce useful **LLM-generated** artifacts in the cloud.
- Tool access is explicit, scoped, and auditable; unknown tools are impossible to call.
- Runtime failures yield actionable `error_code` + `error_details` (surfaced to the desktop,
  per `errcodes.go`).
- The existing desktop cloud-run UI inspects runtime events/artifacts unchanged (same
  `temporal.*` vocabulary, same artifact endpoint).
- Cost/loop bounded by enforced limits; breaches are observable.

## Alternatives considered

- **Run the desktop agent (`apps/x/.../background-tasks/agent.ts`) server-side** — rejected:
  it assumes a local filesystem and desktop tool surface; porting it wholesale brings the
  exact unsafe capabilities this RFC excludes. The cloud runtime is a deliberately smaller,
  safer surface.
- **No interfaces, inline LLM call in `ExecuteAPITask`** — rejected: untestable without
  Temporal, and it would hard-wire one tool/credential strategy. The `Runtime`/`ToolRegistry`
  seam keeps the activity thin and the loop unit-testable.
- **Let tools receive bearer tokens from the model** — rejected outright (prompt-injection →
  credential exfiltration). Tools resolve credentials from `ToolScope` internally.

## Decisions

Resolved forks (consolidated in [`README.md`](./README.md#consolidated-decisions)):

- **Agent loop → hand-rolled bounded loop** (no external Go agent framework). Keeps the
  dependency surface small and the loop deterministic/unit-testable behind the `Runtime`
  interface. Revisit only if multi-tool orchestration outgrows it.
- **Temporal heartbeats → wired in v1** via `EventSink.Progress → activity.RecordHeartbeat`.
  Cheap insurance; lets the duration ceiling rise later without a liveness gap.
- **v1 connector read tools → Gmail + Google Calendar (read-only)**, matching the first
  [RFC 003](./003-cloud-event-ingestion.md) event sources. Other connectors are additive
  registry entries, deny-by-default until added.
- **Limits → per-tenant via config/env in v1; no per-task override.** A task can't raise its
  own budget; tenant-level overrides (a power user with higher LLM budget) come later if
  needed.
- **Runtime selection → `CLOUD_RUNTIME_ENABLED` flag** picks `DefaultRuntime` (LLM-backed)
  vs `NoopRuntime` (today's deterministic artifact), so the runtime ships dark and the
  deterministic path is an instant rollback.

### Deferred (needs a real workload; not blocking)

- Raising `CLOUD_RUNTIME_MAX_DURATION` above 4 m (and the matching activity timeout) once a
  genuinely long-running task exists — heartbeats are already wired for it.
