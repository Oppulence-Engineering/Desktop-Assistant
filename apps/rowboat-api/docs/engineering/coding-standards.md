# Go coding standards

## Mechanical correctness

Handwritten Go MUST pass `goimports`, `go vet`, and the configured
`golangci-lint` suite. Formatting debates are delegated to tools. Generated
files are regenerated instead of manually reformatted.

Packages SHOULD be small and cohesive, exported APIs minimal, zero values
sensible where practical, and important exported behavior documented. Avoid
unnecessary pointers, mutable package globals, reflection, generic machinery,
and large consumer-owned interfaces.

## Context, resources, and concurrency

Every I/O-capable operation accepts and propagates `context.Context`.
Request/activity code MUST NOT replace its caller context with
`context.Background()`. Derive deadlines where ownership changes and always
call cancellation functions.

The code that starts a goroutine owns its completion and error path. Concurrency
must be bounded; shutdown must be deterministic. Close response bodies, rows,
files, timers, and other resources, handling close errors when they affect
durability. Panic is reserved for impossible programmer/startup conditions,
never request control flow.

## Errors

Wrap causal errors with `%w`. Match semantics with `errors.Is`/`errors.As`, not
text. Use typed or sentinel domain errors for stable decisions such as invalid
state transitions. Handlers map internal errors to stable problem codes and do
not return secrets, SQL/provider details, or stack traces.

Discarded errors need a reason and must concern a best-effort operation whose
failure is genuinely non-actionable. Cleanup errors should be joined or logged
with operation context when they can matter.

## Logging and observability

Use structured `zap` fields and preserve OpenTelemetry context. Include safe
identifiers useful for correlation: request/trace ID, tenant/workspace ID,
workflow/run ID, entity/action ID, provider, and operation. Never log tokens,
credentials, secrets, raw sensitive bodies, or authentication material.
Metric labels must be bounded; user/entity/request IDs are traces/log fields,
not Prometheus labels.

## Outbound calls

Use `internal/outbound` or an equivalent explicitly configured client. Calls
require context cancellation, deadlines, pooled transports, response bounds,
and bounded concurrency. Retries require a classified transient failure and an
idempotent operation/provider key. Non-idempotent writes are not automatically
retried; ambiguous results enter reconciliation/manual review.

## Comments

Comments explain security assumptions, invariants, provider quirks, retries,
concurrency, idempotency, compatibility, and surprising decisions. They should
not narrate obvious syntax. Enduring design decisions belong in RFC/engineering
docs rather than only beside an implementation.
