# Temporal standards

Workflow functions coordinate deterministic state. They MUST NOT perform
network/database/filesystem calls, use wall-clock/random UUID APIs, start raw
goroutines, iterate nondeterministically when order affects commands, or read
mutable process configuration. Use `workflow.Now`, deterministic identifiers,
selectors/futures, activities, signals, and Temporal APIs.

Activities own side effects and therefore MUST tolerate retry. Each activity
defines or inherits deliberate start-to-close/schedule-to-close timeouts,
retry policy, cancellation behavior, and heartbeats for long work. Provider
writes need stable idempotency keys and ambiguous-result reconciliation.

Workflow IDs are stable business identifiers. Duplicate starts must be an
explicit policy, not accidental behavior. Long-running workflow behavior
changes use `workflow.GetVersion` or a compatible deployment/versioning
strategy so recorded histories replay. Signal handlers validate duplicates and
out-of-order delivery. Cancellation must reach activities and leave persisted
state explainable.

Tests should use Temporal's test environment for orchestration, retries,
signals, cancellation, and replay-sensitive paths; activity tests use real Ent
test persistence and fake providers where useful. The `rbtemporal` typed
analyzer run by `make architecture` catches obvious forbidden API calls only in
functions accepting `workflow.Context`; it does not prove determinism, so
review and workflow tests remain required.
