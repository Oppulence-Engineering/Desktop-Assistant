# RFC 023: Operating Business Objects — Closed-Loop Actions with Human-in-the-Loop Approval

|                       |                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**               | 023                                                                                                                                                                                                                                                                                                                                              |
| **Status**            | Draft                                                                                                                                                                                                                                                                                                                                            |
| **Track**             | Agent execution · "close the loop" on finance objects                                                                                                                                                                                                                                                                                            |
| **Owners**            | `apps/rowboat-api` (runtime tools, approval tokens, event round-trip) · `apps/x` (cockpit approval UX)                                                                                                                                                                                                                                           |
| **Created**           | 2026-06-10                                                                                                                                                                                                                                                                                                                                       |
| **Last updated**      | 2026-06-10                                                                                                                                                                                                                                                                                                                                       |
| **Depends on**        | [RFC 004 — Cloud-Safe Agent Runtime](./complete-004-cloud-agent-runtime.md) (tool registry), [RFC 003 — Cloud Event Ingestion](./complete-003-cloud-event-ingestion.md) (the watch leg), [RFC 012 — Connector Suite & Consent Broker](./012-connector-suite-and-consent-broker.md) (money-touching approval tokens)                              |
| **Enables / related** | [RFC 013 — Product Connector Fabric](./013-oppulence-product-connector-fabric.md) (the **Act** seam this RFC operationalises), [RFC 020 — Native Action Engine](./020-native-third-party-action-engine.md), [RFC 022 — Unified Entity Graph](./022-unified-entity-graph.md), [RFC 026 — Finance Command Center](./026-finance-command-center.md) |
| **Supersedes**        | none                                                                                                                                                                                                                                                                                                                                             |

## Summary

Today Solomon's agents **draft** — they can write an email about an overdue invoice — but they cannot **operate the object**: advance a dunning sequence, approve a vendor bill, mark a dispute. This RFC builds the closed loop: an agent **proposes** a typed finance action, the operator **approves** it in the cockpit (one click), the action **executes** against the product via its Act-seam tool using a **single-use scoped approval token**, the product's resulting state change comes **back as a `CloudEvent`** ([RFC 003](./complete-003-cloud-event-ingestion.md)), and that event **updates** the originating live-note/thread — closing the loop. This is exactly the "Live Note objective = _keep Acme's overdue AR moving_ → run the dunning cadence, watch for the Stripe payment, update the thread, escalate" pattern, with a human in the loop and a full audit trail. Money never moves without an explicit, scoped, expiring approval.

## Current state (grounded)

| Fact                                                                                                    | Evidence                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The cloud runtime tool surface is **deny-by-default**, constructed per run                              | `apps/rowboat-api/internal/backgroundtaskruntime/tool_registry.go:5-15` (`registry` "deny-by-default"; `NewRegistry(tools)`)                                 |
| Tools resolve only if allowlisted (`Lookup` → `ErrToolNotAllowed`)                                      | `tool_registry.go:31-33`                                                                                                                                     |
| Inbound product state changes arrive as `CloudEvent`s — but the source enum lacks product sources today | `apps/rowboat-api/ent/schema/cloud_event.go:37` (`gmail, google_calendar, slack, webhook, internal`)                                                         |
| Runs carry an append-only audit log + can link to the triggering event                                  | `apps/rowboat-api/ent/schema/background_task_run_event.go`, `background_task_run.go` (`cloud_event_id` FK, per RFC 003)                                      |
| A permission-request/approval pattern already exists on-device (code mode)                              | `apps/x/packages/core/src/code-mode/acp/permission-registry.ts`                                                                                              |
| Money-touching approval tokens are specified but unbuilt                                                | [RFC 012 § "money-touching approval tokens"](./012-connector-suite-and-consent-broker.md), [RFC 013 "Act" seam](./013-oppulence-product-connector-fabric.md) |

**Problem.** Without an approval + execution + watch loop, agents can only suggest; the operator still does every action by hand. The value of the command center is **doing the work**, safely.

## Goals

- A typed **ActionProposal** the runtime emits (never executes directly) for finance operations.
- A cockpit **approval card** (approve / edit / reject) that issues a **single-use, scoped, expiring** approval token.
- **Execution** of the approved action via the product Act-seam tool ([RFC 013](./013-oppulence-product-connector-fabric.md)/[020](./020-native-third-party-action-engine.md)) with the token.
- **Watch**: correlate the product's resulting `CloudEvent` back to the proposal and **update** the originating live-note/thread.
- A complete **audit chain**: proposal → approval → execution → resulting event, queryable per object and per run.
- **Hard guarantee**: no money-moving action executes without a matching, unexpired, single-use token.

### Measurable acceptance signals

- A sandbox "advance dunning" round-trip completes: proposal rendered → approved → executed → resulting `conduit.*` event updates the live-note, all four linked by ids.
- Replaying or reusing an approval token is rejected (single-use proven).
- 0 money-moving executions occur in tests without a valid token (enforced, not conventional).

## Non-Goals

- Defining each product's action catalog/schemas — owned by the products + [RFC 013](./013-oppulence-product-connector-fabric.md)/[020](./020-native-third-party-action-engine.md). This RFC owns the **propose→approve→execute→watch** machinery and the **token** contract.
- Fully autonomous (no-human) money movement — explicitly out of scope; a future policy tier may auto-approve **non-financial** actions only (see Deferred).
- The semantic recall ([RFC 021](./complete-021-semantic-memory-index.md)) or identity ([RFC 022](./022-unified-entity-graph.md)) layers — consumed here, not built here.

## Design

### The loop

```mermaid
sequenceDiagram
  participant LN as Live Note / bg-task (objective)
  participant RT as Agent runtime (RFC 004)
  participant CK as Cockpit (apps/x)
  participant BR as Approval broker (rowboat-api)
  participant P as Product (Conduitt/Cadence) Act seam
  participant EV as Cloud events (RFC 003)

  LN->>RT: objective "keep Acme AR moving"
  RT->>RT: gather context (RFC 021/022)
  RT-->>CK: ActionProposal {kind, target, params, rationale}
  CK->>BR: approve(proposalId)  (operator clicks)
  BR-->>CK: ApprovalToken {scope=this action, exp, single-use}
  CK->>P: execute(action, token)   (Act seam, RFC 013/020)
  P-->>EV: state change → CloudEvent {source: conduit, …}
  EV->>RT: route (RFC 003) → update originating note/thread
  RT-->>LN: loop closed; audit chain recorded
```

### ActionProposal (what the runtime emits)

The runtime never calls a money-touching tool directly. Instead an allowlisted **propose-only** tool records a typed proposal:

```ts
type ActionProposal = {
  id: string; // ULID
  runId: string; // originating background_task_run
  entityId?: string; // RFC 022 entity this concerns (e.g. Acme)
  target: string; // resourceRef, e.g. "conduit:invoice:inv_456"
  kind: string; // "conduit.dunning.advance" | "cadence.bill.approve" | …
  params: Record<string, unknown>; // product-defined, schema-validated
  financial: boolean; // true ⇒ requires money-touching token (RFC 012)
  rationale: string; // why; shown on the card
  status: "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";
};
```

`kind`/`params` schemas come from the product manifests ([RFC 020](./020-native-third-party-action-engine.md)); the runtime tool registry exposes a **`propose-action`** tool (allowlisted) and **never** the raw execute tool to the model.

### Approval & token

- The cockpit renders pending proposals as **approval cards** (reuse the code-mode permission-request UX, `permission-registry.ts`): rationale, target object, diff/preview, and Approve / Edit params / Reject.
- On approve, the **broker** (`rowboat-api`) issues an **ApprovalToken** bound to `{proposalId, target, kind, params-hash, operatorUserId, exp}`, **single-use**, short TTL (default 5 min). For `financial: true`, this is the money-touching token from [RFC 012](./012-connector-suite-and-consent-broker.md) (step-up auth may be required per RFC 011).
- **Edit** re-hashes params → invalidates any prior token for that proposal (no approve-then-swap).

### Execute (Act seam)

- The approved action calls the product's Act-seam tool ([RFC 013](./013-oppulence-product-connector-fabric.md)) — via the native action engine ([RFC 020](./020-native-third-party-action-engine.md)) or the product MCP server — **passing the token**. The product (or the broker on its behalf) verifies the token: matches `kind/target/params-hash`, unexpired, unused; then marks it consumed.
- Execution and its immediate result are written to the run's append-only event log (`background_task_run_event`).

### Watch (close the loop)

- The product emits its state change as a `CloudEvent` (the source enum is extended to include `conduit`, `cadence`, `eigen`, `corinthian`, `canvas` — see [Migration](#migration--code-changes)).
- [RFC 003](./complete-003-cloud-event-ingestion.md) routing correlates the event back to the proposal/run (via `target` resourceRef + a `correlationId` echoed in the action) and **re-triggers the originating live-note** with the result context, which updates the thread (paid / promised / escalate).
- The audit chain `proposal → token → execution event → resulting CloudEvent` is queryable per object.

## Data model

```go
// apps/rowboat-api/ent/schema/action_proposal.go (new)
field.String("proposal_id").Unique()
field.String("run_id")                              // edge → background_task_run
field.String("entity_id").Optional()               // RFC 022
field.String("target")                              // resourceRef
field.String("kind")
field.JSON("params", map[string]any{})
field.Bool("financial").Default(false)
field.String("status")                              // pending|approved|rejected|executed|failed|expired
field.String("correlation_id")                      // echoed to product, matched on the return event
field.Time("expires_at").Optional()

// apps/rowboat-api/ent/schema/approval_token.go (new)
field.String("token_hash").Unique()                 // store hash, never the token
field.String("proposal_id")
field.String("params_hash")                         // binds token to exact params
field.String("operator_user_id")
field.Time("expires_at")
field.Bool("consumed").Default(false)
```

`background_task_run.cloud_event_id` (existing, RFC 003) links the **return** event to the run; `correlation_id` links it to the **proposal**.

## API surface

| Method | Path                                  | Auth                              | Purpose                                                  |
| ------ | ------------------------------------- | --------------------------------- | -------------------------------------------------------- |
| `GET`  | `/v1/action-proposals?status=pending` | bearer                            | Cockpit pending queue.                                   |
| `POST` | `/v1/action-proposals/{id}/approve`   | bearer (+ step-up if `financial`) | Issue a single-use, scoped token.                        |
| `POST` | `/v1/action-proposals/{id}/reject`    | bearer                            | Reject with reason.                                      |
| `POST` | `/v1/action-proposals/{id}/execute`   | bearer + token                    | Call the Act seam; verify+consume token.                 |
| `GET`  | `/v1/objects/{resourceRef}/audit`     | bearer                            | Full proposal→token→execution→event chain for an object. |

## Configuration

| Key                                  | Default                    | Meaning                                                                                                      |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `approval.tokenTtl`                  | `5m`                       | Token lifetime.                                                                                              |
| `approval.requireStepUpForFinancial` | `true`                     | Force re-auth ([RFC 011](./complete-011-identity-and-authorization-plane.md)) before money-moving approvals. |
| `approval.watchTimeout`              | `24h`                      | If no return event by then, mark proposal `executed_unconfirmed` + alert.                                    |
| `runtime.proposeOnlyKinds`           | all `financial:true` kinds | Kinds the model may only **propose**, never auto-execute.                                                    |

## Observability

| Series                          | Type      | Labels                                   | Notes                                                          |
| ------------------------------- | --------- | ---------------------------------------- | -------------------------------------------------------------- |
| `action_proposals_total`        | counter   | `kind`, `status`                         | Funnel; `kind` is low-cardinality (catalog), never per-object. |
| `approval_token_issued_total`   | counter   | `financial{true,false}`                  | Token issuance.                                                |
| `approval_token_rejected_total` | counter   | `reason{expired,reused,params_mismatch}` | Security signal.                                               |
| `action_loop_close_seconds`     | histogram | `kind`                                   | Time from execution to return event.                           |

## Migration & code changes

- Extend `cloud_event.go:37` source enum to add `conduit`, `cadence`, `eigen`, `corinthian`, `canvas` (also required by [RFC 008](./008-conduit-eigen-faculties.md)/[013](./013-oppulence-product-connector-fabric.md)); regenerate ent.
- New ent schemas `action_proposal.go`, `approval_token.go`; new `internal/actions/` (broker: propose/approve/execute/watch) in `apps/rowboat-api`.
- Runtime: add an allowlisted **`propose-action`** tool to the registry (`tool_registry.go`); **never** expose raw execute tools to the model.
- Desktop: approval-card UI (reuse `permission-registry.ts` UX) + a cockpit "Actions" queue; live-note runner consumes return events to update threads.
- [RFC 003](./complete-003-cloud-event-ingestion.md) router: correlate return events to proposals via `correlation_id` + `target`.

## Code-level implementation playbook

### WP1 — Propose (no money path yet)

1. `propose-action` runtime tool → persists `ActionProposal{status:pending}`; model can only propose.
2. Cockpit pending queue + approval card (read-only execution stub).

### WP2 — Approve + token

3. `internal/actions` broker: `approve` issues a single-use scoped token (hash stored), `params_hash`-bound, TTL; step-up for `financial`.
4. Token verify+consume primitive (idempotent, replay-safe).

### WP3 — Execute via Act seam

5. `execute` calls the product Act tool ([RFC 013](./013-oppulence-product-connector-fabric.md)/[020](./020-native-third-party-action-engine.md)) with the token; record execution event.

### WP4 — Watch + close

6. Extend `CloudEvent` sources; router correlates return events to proposals; re-trigger the originating live-note with result context; write the audit chain; expose `/v1/objects/{ref}/audit`.

## Security

- **No money moves without a token.** The model never holds an execute capability; execution requires a broker-issued, single-use, params-bound, expiring token. Enforced server-side (verify+consume), not by convention.
- **Step-up auth** ([RFC 011](./complete-011-identity-and-authorization-plane.md)) for `financial` approvals; configurable but on by default.
- **Params binding**: the token hashes the exact params; editing params invalidates the token — defeats approve-then-swap.
- **Replay protection**: single-use; reuse logged + rejected (`approval_token_rejected_total{reused}`).
- **Least privilege**: product Act tokens scope to one object + one action (Corinthian-style), not a blanket capability.
- **Audit**: every state transition is append-only and linked; supports finance review/compliance.

## Failure modes & edge cases

| Case                                         | Behavior                                             | Recovery                                          |
| -------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Token expires before execute                 | `execute` rejected                                   | Re-approve (fresh card).                          |
| Product executes but no return event arrives | `executed_unconfirmed` after `watchTimeout`          | Alert + re-poll the product Read seam; reconcile. |
| Duplicate return events (at-least-once)      | Idempotent by `correlation_id`                       | First closes loop; rest no-op.                    |
| Operator edits params after approval         | Prior token invalidated                              | New approval required.                            |
| Product down at execute                      | `failed{upstream}`                                   | Surfaced on the card; retry is a new proposal.    |
| Two operators approve same proposal          | First consumes token; second sees `already_executed` | No double-execution.                              |

## Test plan

- **Unit**: token issue/verify/consume (single-use, TTL, params-hash binding); proposal state machine transitions.
- **Integration (sandbox)**: full dunning round-trip — propose → approve → execute → `conduit.*` return event → live-note updated; assert audit chain links proposal↔token↔execution↔event.
- **Security**: reused token rejected; edited-params token rejected; financial approval blocked without step-up.
- **Resilience**: missing return event → `executed_unconfirmed` + reconcile; duplicate events idempotent.

## Acceptance criteria

- A sandbox finance action closes the loop end-to-end with a full, queryable audit chain.
- Money-moving execution is impossible without a valid single-use token (proven by test).
- The originating live-note updates from the product's return event automatically.

## Alternatives considered

- **Let the model call execute tools directly with a confirm flag** — rejected: a prompt-injected or mistaken model could move money; capability must be brokered, not flagged.
- **Blanket per-session approval** ("approve all dunning today") — deferred to a policy tier; v1 is per-action to establish trust and audit.
- **Poll the product for state instead of events** — rejected as primary (latency, cost); polling is the **reconcile fallback** when a return event is missing.

## Decisions

Resolved forks (consolidated in [`README.md`](./README.md)):

- **The model proposes; it never executes.** Execution is brokered behind a single-use, params-bound, expiring token.
- **Loop closes via `CloudEvent` round-trip** ([RFC 003](./complete-003-cloud-event-ingestion.md)), correlated by `correlation_id` + `resourceRef`; polling is fallback only.
- **`financial` actions require step-up** and money-touching tokens ([RFC 012](./012-connector-suite-and-consent-broker.md)).
- **Audit chain is first-class** and queryable per object.

### Deferred (needs trust data; not blocking)

- A **policy tier** for auto-approving **non-financial** low-risk actions (e.g., "send the reminder") under explicit operator-set rules, A2A-delegation-bounded ([RFC 018](./018-a2a-delegation-and-agent-identity.md)).
- Batch approvals ("approve all 12 step-1 reminders") with per-item tokens.
- Simulation/preview mode that dry-runs an action against the product's sandbox before real execution.
