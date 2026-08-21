# RFC 048: Relationship API, MCP Server, and Capture-Artifact Ingestion

|                |                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**        | 048                                                                                                                                                                       |
| **Status**     | Draft — rescoped by RFC 055                                                                                                                                               |
| **Track**      | Rowboat ecosystem · graph distribution · capture integration                                                                                                              |
| **Owners**     | `apps/rowboat-api`, `apps/x`, SDK/CLI, security                                                                                                                           |
| **Created**    | 2026-08-12                                                                                                                                                                |
| **Updated**    | 2026-08-21                                                                                                                                                                |
| **Depends on** | [RFC 010](./complete-010-rowboat-api-service-plane.md), [RFC 011](./complete-011-identity-and-authorization-plane.md)                                                     |
| **Related**    | [RFC 020](./020-native-third-party-action-engine.md), [RFC 036](./036-relationship-state-engine.md), [RFC 055](./055-capture-product-boundary-and-rowboat-integration.md) |

## 1. Decision

Make Rowboat's relationship system programmable through three surfaces:

1. a documented, versioned public API for relationships, evidence,
   recommendations, and governed actions;
2. an MCP server that exposes authorized relationship tools to user-selected AI
   clients; and
3. a versioned capture-artifact ingestion API implementing RFC 055.

Dictation control, capture-note CRUD, and the local dictation CLI belong to the
capture product. Rowboat's CLI may inspect graph state and submit or approve
Rowboat actions, but it does not become a second controller for capture internals.

## 2. Existing foundation

`apps/rowboat-api` already supplies authenticated REST surfaces, OpenAPI
generation, organization/project authorization, relationship objects, evidence,
background tasks, and governed action proposals. `apps/x` already consumes MCP
servers as a client.

The missing product surfaces are a stable external graph contract, a Rowboat
MCP server, and the explicit capture-ingestion seam.

## 3. Public relationship API

The API exposes opaque IDs, cursor pagination, idempotency keys, deterministic
error envelopes, rate-limit headers, and audit correlation IDs for:

- people, organizations, relationships, and source mappings;
- evidence and exact source spans;
- commitments, risks, milestones, and recommendations;
- action proposals, approvals, executions, and audit history; and
- capture-artifact ingestion status and deletion propagation.

Raw provider credentials and internal model prompts are never exposed.

## 4. MCP server

The MCP server is a thin adapter over the same authorization and service layer,
not a privileged parallel backend. Read tools may search relationships, inspect
evidence, and retrieve timelines. Write tools create typed proposals; they do
not bypass approval or execute consequential actions directly.

Tool output includes source and freshness metadata so clients can distinguish
facts, projections, recommendations, and unresolved identity hypotheses.

## 5. Capture ingestion

The ingestion endpoint accepts the versioned `CaptureArtifact` envelope from
RFC 055 and provides:

- schema negotiation and compatibility errors;
- idempotency by source product, artifact ID, and version;
- content-hash verification;
- asynchronous processing status;
- exact transcript-span preservation;
- consent and retention enforcement;
- source profile and participant hints; and
- deletion, merge, and correction tombstones.

Continuous sync uses an outbox on the capture side and idempotent acknowledgement
on the Rowboat side. Neither product reads the other's database.

## 6. Security

- Tokens are scoped by organization, project, capability, and product.
- Capture ingestion cannot invoke external actions.
- MCP tools use the same FGA decisions as HTTP handlers.
- Sensitive fields are excluded from logs and traces.
- Revocation fails closed and is testable without relying on token expiration.
- Schema downgrade cannot discard consent or deletion fields silently.

## 7. Definition of done

- The published OpenAPI contract covers the relationship and ingestion surfaces.
- An MCP conformance suite proves auth parity with the HTTP API.
- Capture sync is idempotent, retryable, observable, and deletion-aware.
- Every derived evidence record links to the source artifact and exact span.
- MCP and CLI writes create proposals rather than bypassing governance.
- No Rowboat API or CLI reaches into the capture product's local database.
