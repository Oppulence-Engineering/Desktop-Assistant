# Trustworthy First Account runbooks

Every procedure starts with the administrator-exported `tfa-support-v1` diagnostics bundle. It contains one-way workspace, connection, and provider-account references; categorical errors and counts; and no names, addresses, evidence text, action bodies, tokens, cursors, raw errors, or correlation identifiers. Do not request database dumps or raw customer evidence for initial triage.

## Sync lag, revoked scope, or stalled backfill

1. Inspect the source check, lifecycle, lag, missing-scope count, retry count, and last-success timestamps in the bundle.
2. If the source reports missing or revoked scope, use Reconnect and explain only the missing capability. Do not request write scopes during read-only onboarding.
3. For a rate limit or provider outage, leave state degraded, observe bounded retry, and do not present it as complete.
4. For a stale cursor, use Resync. The lifecycle must move through rebuilding and partial before live.
5. Verify affected Mission Control views are unsafe while the source is degraded and return to complete only after a successful observation and sync.
6. If lag persists, disable the source capability for that workspace and escalate to the connector owner with the redacted bundle.

## Bad identity decision

1. Stop action channels that depend on the affected destination.
2. Open the identity candidate and inspect immutable decisions, impact counts, moved-object references, and lineage.
3. Use a compensating split or undo only when there is no requested, ambiguous, or in-flight action on the moved graph.
4. If compensation is refused, preserve the fail-closed state and escalate to the identity owner; never edit relationship foreign keys manually.
5. Confirm observations, assertions, actions, outcomes, and audit history returned to their recorded before-relationship IDs.
6. Re-open Mission Control in both clients and confirm an equal state version and aggregate hash.

## Projection failure or dead letter

1. Confirm `projection_dead_letter` or projection backlog in diagnostics. Mission Control must show rebuilding and block external action.
2. Fix or roll back the incompatible projector before retrying.
3. Replay a bounded tenant or relationship at an explicit evaluation boundary:
   `go run ./apps/rowboat-api/cmd/relationship-projector replay --user-id <uuid> --relationship-id <uuid> --at <RFC3339>`.
4. Repair a known failed/dead job with a categorical reason:
   `go run ./apps/rowboat-api/cmd/relationship-projector repair --user-id <uuid> --job-id <uuid> --reason projector_rollback`.
5. Verify the replacement job completes, the state hash is deterministic on replay, and no partial state version was published.
6. Re-enable the projector only after the golden corpus and race suite pass.

## Duplicate prevention

1. Disable the affected action capability; do not delete the action, approval, execution marker, or provider receipt.
2. Compare the action revision, approved revision, decision ID, and persisted idempotency marker. Never expose the marker to customer support channels.
3. If the outcome is unknown, follow uncertain execution below. Never invoke Execute to discover provider state.
4. Confirm worker redelivery returns the existing requested, sent, or ambiguous row and provider write count remains one.
5. Treat any verified duplicate as a rollout-stopping P0, preserve provider receipts, and keep the channel disabled until the concurrency and fault suite passes.

## Uncertain execution

1. Confirm the UI says outcome uncertain rather than succeeded or failed.
2. Leave the action in `ambiguous`; do not edit, reapprove, or resend it.
3. Allow only bounded read-only lookup by the persisted provider marker.
4. If found, normalize the receipt and mark sent. If not found, continue the bounded schedule. After the limit, require manual review.
5. If the marker is missing or the backend cannot reconcile, move directly to manual review.
6. Record any later provider outcome in the same relationship timeline before deciding whether a new action is appropriate.

## Evidence deletion and credential revocation

1. Confirm legal hold and configured retention policy before deletion.
2. Disconnect first to stop new collection and immediately downgrade completeness.
3. Revoke the provider credential in the broker; tokens never belong in relationship DTOs or diagnostics.
4. Use the relationship conversation-deletion workflow for shared conversation artifacts. Local desktop deletion removes the device recording/transcript but explicitly reports when published evidence remains under workspace policy.
5. For cryptographic erasure, destroy the tenant evidence key only through the audited key endpoint and verify prior ciphertext cannot be opened.
6. Verify derived artifacts, indexes, caches, and local copies follow the configured policy and that the deletion receipt is idempotent.

## Escalation severity

- P0: cross-tenant exposure, unauthorized/duplicate write, incorrect auto-merge, or unknown provider result shown as success.
- P1: correction displaced, material value without evidence, stale source shown complete, unrecoverable lineage, raw evidence in telemetry/support bundle, or decision-changing client parity drift.
- P2: activation/SLO miss with truthful degraded state and no trust-boundary breach.

P0 and P1 incidents pause promotion and keep `release_gate_approval` disabled.
