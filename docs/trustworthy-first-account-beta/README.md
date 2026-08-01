# Trustworthy First Account beta operations

This directory is the operational companion to [RFC 038](../../apps/rfc/038-trustworthy-first-account-beta.md). The code path can be verified in CI, but a design-partner write is not authorized merely because code merged. The release register remains fail-closed until a named owner attaches current evidence and signs every gate required for that stage.

## Release workflow

1. Run `make -C apps/rowboat-api tfa-release-register-validate` after editing the register.
2. Run the full verification commands in the RFC implementation-evidence section.
3. Replace a gate's status with `passed` only after attaching durable evidence, `verifiedBy`, and an RFC3339 `verifiedAt` timestamp.
4. Assign `releaseOwner`, record the decision, and run `make -C apps/rowboat-api tfa-release-governed-check`.
5. Only after that check passes may an administrator enable `release_gate_approval` with reason `release_owner_signoff`, followed by one provider action capability at `design_partner_governed_action`.

The runtime separately verifies that the provider is live and carries the exact progressive write scope. A repository signoff cannot override identity ambiguity, stale evidence, policy, revision, approval, destination, or idempotency checks.

## Named owners and default decisions

These role owners are defaults until the release owner records named people in the evidence register.

| Decision               | Accountable role         | Beta default                                                                                                                                                                                       |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pilot cohort           | Product lead             | Three small customer-facing B2B teams; Google plus HubSpot is the primary path, Google plus Slack is supported.                                                                                    |
| Historical window      | Connector lead           | Gmail 90 days, Calendar 180 days, Slack 90 days, HubSpot 365 days; narrower customer retention wins.                                                                                               |
| Detector source safety | Intelligence lead        | Quiet-account and missing-next-step signals require their relationship sources to be current. Confirmed commitments remain visible while source degradation is shown separately.                   |
| Changed-since-review   | Product lead             | User-specific acknowledgement, with the shared immutable state version visible to the team.                                                                                                        |
| First HubSpot write    | Connector lead           | A relationship-associated note; a constrained task is allowed only when the reviewed action type and due date explicitly request it.                                                               |
| Slack visibility       | Security lead            | Connected public channels and explicitly selected private channels only; no direct-message ingestion in the first beta.                                                                            |
| Disconnect retention   | Privacy lead             | Stop collection immediately. Retain source-linked derived history only for the configured workspace window; deletion requests and key destruction remain authoritative.                            |
| Go/no-go sample        | Product lead             | At least three design partners and 20 reviewed relationships per partner; at least 90% of reviews accept or deliberately correct all four answers; every invariant guardrail remains at zero.      |
| Kill switches          | On-call engineering lead | Connector lead owns source switches, intelligence lead owns detectors/ranking, actions lead owns executors, desktop lead owns publication, SRE owns the global beta and release-approval switches. |

## Pilot operating rhythm

- Daily: authorization failures, time-to-first-relationship, source lag, dead projections, identity backlog, and uncertain actions.
- Weekly: every identity merge, correction, rejected recommendation, ambiguous execution, web/desktop drift, cost per accepted assertion, and a four-question trust interview.
- Before promotion: credential revocation, disconnect, deletion, key erasure, projector repair, duplicate-write prevention, provider-timeout reconciliation, and rollback drills.
- After any guardrail breach: disable the narrowest capability immediately, preserve history, export redacted diagnostics, and follow the relevant runbook.

See [runbooks.md](./runbooks.md), [rollout-and-rollback.md](./rollout-and-rollback.md), and [pilot-data-map.md](./pilot-data-map.md).
