# RFC 036: Relationship State Engine and Client Parity

|                  |                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**          | 036                                                                                                                                                                                                                                                          |
| **Status**       | Implementing                                                                                                                                                                                                                                                 |
| **Track**        | Product foundation — relationship intelligence                                                                                                                                                                                                               |
| **Owners**       | `apps/rowboat-api`, `apps/rowboat-www`, `apps/x`                                                                                                                                                                                                             |
| **Created**      | 2026-07-26                                                                                                                                                                                                                                                   |
| **Last updated** | 2026-07-26                                                                                                                                                                                                                                                   |
| **Depends on**   | [RFC 022](./022-unified-entity-graph.md), [RFC 023](./023-closed-loop-actions.md), [RFC 029](./029-founder-operating-memory.md), [RFC 030](./complete-030-revenue-memory-outbound-governance.md), [RFC 031](./031-tiered-mail-storage-for-revenue-memory.md) |
| **Supersedes**   | RFC 022's local-vault-only authority for customer relationships; RFC 030's statement that the queue itself is the product                                                                                                                                    |

## Decision

Oppulence maintains a shared, living model of customer-account relationships.
Email, calendar, Slack, CRM, meetings, notes, and desktop context are observers
of that model, not competing systems of relationship truth.

The backend is authoritative for shared relationship identity, observations,
assertions, projected state, recommendations, corrections, approvals, and
team-visible history. Desktop knowledge remains user-owned working memory,
local evidence, and an offline cache. Web and desktop are equal clients of the
same relationship contract.

V1 covers customer accounts from prospect through former customer.

## Domain

### Relationship

A stable, tenant-scoped account identity with aliases, domains, external
references, current projection version, and these state dimensions:

- lifecycle: `prospect`, `evaluation`, `contracting`, `onboarding`,
  `active_customer`, `renewal`, `churned`, `former_customer`;
- engagement: `unknown`, `increasing`, `steady`, `declining`, `dormant`;
- sentiment: `unknown`, `positive`, `mixed`, `negative`;
- health: `unknown`, `healthy`, `needs_attention`, `critical`;
- summary, next action, participants, commitments, risks, and milestones.

Health is qualitative. V1 exposes no numeric score.

### Observation

An immutable provider- or client-emitted event:

- source and source account;
- external id and source version;
- event and receipt time;
- event type, normalized facts, bounded summary, content hash;
- encrypted raw payload when retention permits;
- resolved relationship and participants.

Ingestion is idempotent on tenant, source, external id, and source version.

### Assertion

A provenance-bearing claim with a dimension, value, validity time, confidence,
reason, source type, and supporting observations.

Precedence is:

1. user correction;
2. explicit source fact;
3. deterministic derivation;
4. AI inference.

Within one precedence level, the latest valid assertion wins; confidence and id
provide deterministic tie-breaking. AI never writes projected state directly.

### Snapshot

An immutable projection checkpoint containing the full state, version, changed
dimensions, and winning assertion ids. Snapshots power replay verification and
the client-facing "what changed?" experience.

### Recommendation

The existing governed RevenueAction lifecycle is the first recommendation
implementation. It already supports evidence, revision binding, evaluation,
approval, rejection, idempotent execution, and outcomes. Revenue recovery is
one detector; recommendations are not limited to revenue leaks.

## Identity resolution

Stable provider ids and explicit CRM associations win. Verified emails and
account domains are secondary signals. Similar names alone never merge.

If identifiers resolve to more than one account, ingestion fails closed with a
review-required conflict. A later identity-review surface may confirm, reject,
or link the candidate; automatic fuzzy merging is prohibited.

## API

The authenticated contract is:

- `POST /v1/relationship-observations/batch`
- `GET|POST /v1/relationships`
- `GET /v1/relationships/{id}`
- `GET /v1/relationships/{id}/timeline`
- `GET /v1/relationships/{id}/changes`
- `GET /v1/relationships/{id}/evidence/{evidenceId}`
- `POST /v1/relationships/{id}/corrections`
- `GET /v1/relationship-sources/status`
- `POST /v1/relationship-recommendations/{id}/approve`
- `POST /v1/relationship-recommendations/{id}/reject`

Relationship detail returns the current state, participants, commitments, and
recommendations. Timeline and evidence are separate bounded reads.

## Adapter boundary

Initial observer families are Gmail, Google Calendar, Slack, and HubSpot.
Desktop additionally emits meeting, note, voice-note, and browser observations.

Adapters normalize provider events. They may emit source facts and candidate AI
assertions, but they cannot mutate relationship fields or decide precedence.
Source cursors and freshness are independently visible so missing evidence
cannot masquerade as healthy state.

## Web and desktop parity

Both clients must provide:

1. relationship list and filtering;
2. relationship detail;
3. explainable current state;
4. what changed;
5. unified timeline;
6. participants and roles;
7. commitments, risks, and milestones;
8. recommendations;
9. evidence inspection;
10. corrections;
11. approval and rejection;
12. reconciliation state;
13. source connection and freshness.

Desktop keeps its existing Home, Email, Meetings, Knowledge, Agents, Browser,
and Workspaces destinations. Relationships is a new primary destination that
orchestrates those capabilities; it does not replace Knowledge.

Desktop-native capture is not a parity exception. Web sees the resulting
observation, state change, recommendation, or execution outcome through the
shared relationship record.

## Security and retention

- Every row is tenant-scoped at ORM read and mutation boundaries.
- Raw observation payloads are sealed before database storage.
- Searchable plaintext is bounded to the minimum useful metadata.
- Raw evidence retention defaults to 365 days.
- Corrections, approvals, identity decisions, and executions are audited.
- Account deletion removes metadata and destroys the encryption boundary.
- Evidence reads re-check tenant authorization before decrypting.

Per-tenant envelope keys backed by KMS remain the production hardening target;
the current service-level AES-GCM sealer provides application-layer encryption
until that key-management migration lands.

## Failure behavior

- Duplicate delivery returns the original observation.
- Out-of-order delivery reprojects deterministically by validity time.
- Invalid assertions reject the batch.
- Ambiguous identity fails closed.
- Missing or stale sources appear as source-health problems, not relationship
  conclusions.
- Offline desktop writes retain client idempotency keys and reconcile by
  appending observations, never last-write-wins.
- An action cannot execute without the existing policy and approval invariants.

## Release gate

Use one Acme fixture across HubSpot, Calendar, Gmail, and Slack:

1. HubSpot creates the account and lifecycle.
2. Calendar records discovery and onboarding meetings.
3. Gmail records a promise and overdue response.
4. Slack reveals a blocker.
5. Both clients render the same snapshot and explanation.
6. Desktop correction appears on web.
7. Web approval appears on desktop.
8. Execution occurs once and becomes timeline evidence.

No relationship feature ships unless the shared API tests and both client
parity checks pass.
