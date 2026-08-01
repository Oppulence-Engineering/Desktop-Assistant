# Pilot setup, data map, and version policy

## Workspace checklist

- Record the named workspace administrator, release owner, connector owner, and support contact.
- Assign roles explicitly: viewers inspect; contributors correct/review; executors approve/act; admins manage sources, members, keys, flags, and diagnostics.
- Agree the source combination, history window, retention override, private-channel boundary, and enabled action channel before authorization.
- Start read-only. Verify ten eligible relationships, one identity review, all four Mission Control answers, evidence access, correction parity, source disconnect, and diagnostics export before considering writes.
- Review the exact destination and progressive write scope before enabling an action provider.

## Customer-visible data map

| Data                                             | Purpose                                                    | Storage and boundary                                                                   | Default retention/deletion behavior                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Provider credentials                             | Read evidence or perform an approved write                 | Sealed credential broker; never relationship DTOs, telemetry, or support exports       | Revocation stops use immediately; disconnect clears collection state.                                              |
| Source lifecycle                                 | Explain consent, backfill, lag, scope, failure, and repair | Workspace-scoped metadata; cursor/watermark and raw errors remain sensitive            | Retained for audit; redacted diagnostics use one-way refs and categorical errors.                                  |
| Observations                                     | Immutable source event history                             | Tenant-encrypted payload plus normalized metadata and content hash                     | Bounded by source/customer policy; key destruction makes ciphertext unrecoverable.                                 |
| Assertions and snapshots                         | Deterministic current and prior relationship state         | Versioned, source-linked, workspace-authorized                                         | Retained as audit history while supporting evidence is permitted; retraction changes authority, not history.       |
| Identity candidates and lineage                  | Prevent silent merges and support compensation             | Exact anchor hashes/previews, impact counts, decisions, moved refs                     | Immutable decisions/lineage retained for audit; raw evidence remains separately governed.                          |
| Recommendations, approvals, executions, outcomes | Govern external action and learn from results              | Exact revision, actor, policy, idempotency marker, receipt, categorical outcome        | Audit-retained; payload/body follows communication retention policy.                                               |
| Meeting recording/transcript                     | Create reviewed conversation evidence                      | Local desktop artifact until publication; shared approved evidence is tenant encrypted | Local delete removes device artifact. Published evidence follows workspace retention and explicit shared deletion. |
| Trust telemetry                                  | Activation, safety, reliability, and quality               | Bounded event/reason categories and internal IDs; no raw content or addresses          | Operational retention only; support bundle emits aggregates, not correlations.                                     |

Disconnect stops new collection and makes completeness truthful. It does not silently erase historical evidence the agreed policy permits. A deletion request, legal hold, and cryptographic erasure each remain distinct, audited operations.

## Supported versions

- API and generated TypeScript SDK share one checked-in OpenAPI contract. Contract drift blocks release.
- Web is supported only at the deployed API-compatible revision.
- Desktop beta supports the current release and immediately previous patch release. Older clients remain read-only if their runtime schema cannot validate the current Mission Control or publication contract.
- Connector packages must declare source/event versions and preserve stable external IDs. A breaking adapter change requires a new version and replay evidence.
- Projector, detector, extraction, outcome-learning, diagnostics, and Mission Control contracts are versioned independently. Rollback uses recorded versions and replay; it never rewrites observations.
- The release owner records the exact web, desktop, API, SDK, connector, projector, and detector versions in every governed-action signoff.
