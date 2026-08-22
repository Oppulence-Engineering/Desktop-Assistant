# HTTP and API design

Handlers translate HTTP to domain concepts. Validate path/query/body input,
reject unknown or trailing JSON where compatibility permits, cap bodies before
reading, require JSON content types on normal mutating APIs, and pass request
context downstream. Streaming endpoints need explicit deadline/body/security
exceptions rather than broad middleware bypasses.

Responses use explicit DTOs whenever persistence models contain sensitive,
internal, or unstable fields. Pagination is bounded and deterministic with a
stable cursor/order. Status codes reflect semantics; create/update/replay
behavior must be consistent and documented.

Errors use `internal/httpx` RFC 9457 problem details with stable
machine-readable codes, request ID, trace ID, and server-owned retryability.
Internal/provider/database details are logged safely, not returned. API changes
must consider existing desktop/SDK clients; prefer additive evolution and keep
OpenAPI enrichment, route registration, tests, and SDK generation together.

Each endpoint declares its authorization class as specified in
[security.md](security.md). Provider callbacks/webhooks verify state,
signature, timestamp/replay constraints, or OIDC identity before trusted
persistence. Public capability tokens travel in headers, never URLs or logs.
