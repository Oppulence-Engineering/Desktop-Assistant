# Rowboat Oppulence Product Integration Plan

**Goal:** Define how Rowboat should integrate with Canvas, Billflow, and Corinthian without blurring product ownership, auth boundaries, or agent execution contracts.

**Recommendation:** Build first-party **Oppulence product connectors** in Rowboat, backed by product-specific **MCP servers**. Use **OAuth/OIDC-style account linking** only where Rowboat needs user or organization delegation. Do not copy Plaid's model directly for first-party products; Plaid is an external-provider linking flow, while Canvas, Billflow, and Corinthian are owned product domains.

**Related context:** See `docs/superpowers/plans/2026-05-20-rowboat-apps-architecture-map.md` for the current Rowboat app map.

---

## Executive Summary

MCPs, connectors, and OAuth are not interchangeable. They solve different parts of the integration problem:

| Layer | Purpose | What Rowboat should build |
|---|---|---|
| Connector | Product install/config surface | `Canvas`, `Billflow`, and `Corinthian` connector records in Rowboat |
| MCP | Agent tool/resource execution protocol | `canvas-mcp`, `billflow-mcp`, `corinthian-mcp` |
| OAuth/OIDC | User/org delegation and account linking | Use only when a human/org must grant access |
| Service auth | First-party service-to-service calls | Signed JWTs, client credentials, or WorkOS/OIDC-backed service tokens |
| Events/webhooks | Product-to-Rowboat change propagation | Product events ingested into Rowboat for agent triggers and knowledge updates |

The correct architecture is:

```text
Rowboat
  |
  |-- Connector Registry
  |     |-- Canvas Connector
  |     |-- Billflow Connector
  |     |-- Corinthian Connector
  |
  |-- Agent Runtime
  |     |-- MCP client
  |     |-- tool authorization policy
  |     |-- audit logging
  |
  |-- Product MCP Servers
  |     |-- canvas-mcp
  |     |-- billflow-mcp
  |     |-- corinthian-mcp
  |
  |-- Shared Identity/Auth
        |-- org identity
        |-- user identity
        |-- service tokens
        |-- optional OAuth/OIDC consent
```

---

## Decision

### Build Connectors

Rowboat needs a durable connector layer because users and organizations need a way to install, configure, inspect, disable, and audit product integrations.

Each connector should own:

- Product name and environment.
- Tenant/org mapping.
- Enabled scopes.
- Credential reference, never raw secrets in agent prompts.
- Available MCP tools and resources.
- Health/status checks.
- Rate limits.
- Audit log policy.
- Default agent workflows.
- Webhook/event subscriptions.

Connectors are the product experience. MCP is the execution protocol behind them.

### Build MCP Servers

MCP is the right shape for exposing product capabilities to Rowboat agents. Each product should expose a bounded MCP server with tools/resources that preserve that product's domain rules.

Prefer one MCP server per product:

```text
canvas-mcp       -> Canvas content, assets, publishing, analytics
billflow-mcp     -> invoices, vendors, payments, reconciliation, cash position
corinthian-mcp   -> client files, intake, status, notifications, support/admin actions
```

Only combine MCP servers if the underlying products already share the same backend, permission model, and operational owner. Otherwise, keep product MCPs separate.

### Use OAuth/OIDC Where Needed

Use OAuth/OIDC when Rowboat needs delegated access from a user or organization.

Good OAuth/OIDC use cases:

- A user connects their Canvas workspace to Rowboat.
- An org admin grants Rowboat access to Billflow data.
- A user authorizes Rowboat to act as them for a narrow set of product actions.
- Rowboat needs refreshable delegated access without storing passwords.

Do not use OAuth as the main internal service-to-service mechanism when both systems are first-party services. Use signed service tokens or client credentials for backend calls, and pair them with explicit product/org scopes.

---

## Why Not Plaid-Style For Everything

Plaid is a third-party financial-data provider. The Plaid flow is appropriate when a user links an external financial institution and Billflow receives provider-scoped tokens.

For Oppulence first-party products:

- Rowboat should not store raw Plaid tokens.
- Rowboat should not bypass Billflow's Plaid abstraction.
- Billflow should own Plaid token lifecycle, webhooks, account linking, compliance rules, and bank-data permissions.
- Rowboat should call Billflow through scoped Billflow tools or APIs.

The pattern should be:

```text
User links bank account
  -> Billflow Plaid flow
  -> Billflow stores provider tokens
  -> Billflow exposes safe domain tools
  -> Rowboat calls Billflow MCP/API
```

Not:

```text
User links bank account
  -> Rowboat stores Plaid tokens
  -> Rowboat directly reads bank data
  -> Billflow becomes bypassed
```

---

## Product Integration Shape

### Canvas Connector

**Purpose:** Let Rowboat agents search, reason over, create, update, and publish Canvas-owned content or assets while preserving Canvas permissions and publishing rules.

Potential resources:

- Projects.
- Assets.
- Docs/pages.
- Campaigns.
- University or learning content.
- Analytics/events.

Potential tools:

- `canvas.search_projects`
- `canvas.search_assets`
- `canvas.get_project`
- `canvas.create_content_draft`
- `canvas.update_content_draft`
- `canvas.request_publish`
- `canvas.export_asset`
- `canvas.get_analytics_summary`

Ownership rule:

```text
Canvas owns content state, publishing rules, asset storage, and Canvas-specific analytics.
Rowboat owns agent orchestration, prompts, workflow state, and cross-product reasoning.
```

### Billflow Connector

**Purpose:** Let Rowboat agents help with AP/AR workflows, cash-flow questions, vendor/payment reasoning, invoice drafting, and reconciliation without directly owning Plaid or financial-provider tokens.

Potential resources:

- Vendors.
- Customers.
- Invoices.
- Bills.
- Payments.
- Bank accounts, through Billflow's safe abstraction.
- Reconciliation records.
- Cash-flow snapshots.

Potential tools:

- `billflow.list_invoices`
- `billflow.get_invoice`
- `billflow.create_invoice_draft`
- `billflow.search_vendors`
- `billflow.get_cash_position`
- `billflow.explain_cash_flow_change`
- `billflow.suggest_reconciliation_match`
- `billflow.prepare_payment_run`

Ownership rule:

```text
Billflow owns financial data, Plaid integration, accounting rules, payment workflows, and compliance boundaries.
Rowboat owns agent orchestration and cross-product workflow automation.
```

### Corinthian Connector

**Purpose:** Let Rowboat agents interact with Corinthian's client/workspace data, intake flows, support/admin actions, notifications, and document state through Corinthian's established product boundary.

Potential resources:

- Clients.
- Workspaces.
- Documents.
- Intake records.
- Status records.
- Notifications.
- Support/admin bundles.

Potential tools:

- `corinthian.search_clients`
- `corinthian.get_client_status`
- `corinthian.search_documents`
- `corinthian.create_intake_task`
- `corinthian.classify_document`
- `corinthian.prepare_support_bundle`
- `corinthian.trigger_notification`

Ownership rule:

```text
Corinthian owns client/workspace data, native/worker surfaces, notification policy, and product-specific offline or desktop behavior.
Rowboat owns agent orchestration and cross-product workflow automation.
```

---

## Connector Manifest

Each first-party connector should be represented by a manifest. This keeps the Rowboat connector UI, agent runtime, audit layer, and deployment config aligned.

Example shape:

```json
{
  "id": "billflow",
  "displayName": "Billflow",
  "environment": "production",
  "auth": {
    "type": "first_party_oidc",
    "requiresUserDelegation": true,
    "requiresOrgAdminConsent": true
  },
  "scopes": [
    "invoices:read",
    "invoices:write",
    "vendors:read",
    "cash_position:read",
    "reconciliation:suggest"
  ],
  "mcp": {
    "serverId": "billflow-mcp",
    "transport": "http",
    "baseUrl": "https://api.billflow.example.com/mcp"
  },
  "events": [
    "invoice.created",
    "invoice.updated",
    "payment.failed",
    "bank_account.updated"
  ],
  "audit": {
    "logToolCalls": true,
    "logResourceIds": true,
    "redactSecrets": true
  }
}
```

The exact schema can evolve, but Rowboat needs this class of object before product integrations become serious. Otherwise, tools will become one-off code paths that are hard to govern.

---

## Auth Model

Use three separate auth modes:

### 1. Human Session Auth

Used when a signed-in Rowboat user installs or configures a connector.

Expected data:

- `userId`
- `orgId`
- role or permissions
- connector install permissions

### 2. Product Delegation

Used when Rowboat acts on behalf of a user or organization inside Canvas, Billflow, or Corinthian.

Expected data:

- delegated subject
- product org/workspace ID
- scopes
- expiration/refresh policy
- revocation state

This can be OAuth/OIDC authorization-code flow if the product has a user-facing consent boundary.

### 3. Service-To-Service Auth

Used when Rowboat backend calls product backend APIs or MCP servers.

Expected data:

- service identity
- Rowboat org/project context
- target product
- connector install ID
- signed request or client credentials

This should be the default backend-to-backend path for first-party products.

---

## Event Model

Product integrations should not rely only on polling. Each product should emit events that Rowboat can ingest.

Example events:

```text
canvas.asset.updated
canvas.project.published

billflow.invoice.created
billflow.invoice.updated
billflow.payment.failed
billflow.bank_account.updated

corinthian.document.ingested
corinthian.client.status_updated
corinthian.notification.failed
```

Rowboat should use these events to:

- Refresh product knowledge.
- Trigger agents.
- Update workflow state.
- Create tasks.
- Notify users.
- Maintain cross-product timelines.

Event payloads should use stable references rather than dumping full sensitive records:

```json
{
  "eventId": "evt_123",
  "eventType": "billflow.invoice.updated",
  "occurredAt": "2026-05-21T10:00:00Z",
  "orgId": "org_123",
  "product": "billflow",
  "resourceType": "invoice",
  "resourceId": "inv_456",
  "actorId": "user_789"
}
```

---

## Shared Resource Model

Rowboat should normalize product references into a small shared model.

```text
ConnectedResource
  id
  connectorInstallId
  orgId
  product
  resourceType
  resourceId
  displayName
  externalUrl
  permissions
  lastSyncedAt
  createdAt
  updatedAt
```

This lets Rowboat agents reason across products without copying each product's full database model.

Example cross-product workflow:

```text
Billflow payment failed
  -> Rowboat receives billflow.payment.failed
  -> Rowboat checks related customer/project context
  -> Rowboat searches Canvas campaign/project assets
  -> Rowboat checks Corinthian client status
  -> Rowboat drafts a response or task plan
  -> Product-specific actions execute through the owning product MCP
```

---

## Security Rules

Baseline rules:

- Never put provider tokens in prompts.
- Never let Rowboat store raw Plaid tokens.
- Never bypass a product's domain API for write actions.
- Every MCP call must include org/user/product context.
- Every tool call must be audited.
- Every connector install must be revocable.
- Product MCP servers must enforce authorization even if Rowboat already checked it.
- Sensitive fields should be redacted before they reach agent-visible context.
- High-risk actions should support approval gates.

High-risk action examples:

- Sending payment instructions.
- Creating or submitting invoices.
- Publishing Canvas content.
- Sending Corinthian notifications.
- Exporting sensitive client or financial documents.

---

## Rollout Plan

### Phase 1: Connector Contract

- [ ] Define the connector manifest schema.
- [ ] Add connector install records in Rowboat.
- [ ] Add connector health/status checks.
- [ ] Add connector audit log records.
- [ ] Add scope and permission enforcement at tool execution time.

### Phase 2: Shared Auth Boundary

- [ ] Define shared `orgId` and product workspace mapping.
- [ ] Add service-to-service token validation.
- [ ] Add optional OAuth/OIDC delegation for products that need user consent.
- [ ] Add connector revocation and credential rotation.

### Phase 3: Billflow First Vertical Slice

- [ ] Build `billflow-mcp`.
- [ ] Expose read-only invoice, vendor, payment, and cash-position tools.
- [ ] Keep Plaid fully inside Billflow.
- [ ] Add Billflow event ingestion into Rowboat.
- [ ] Add one end-to-end Rowboat workflow using Billflow data.

Billflow should come first because the Plaid boundary forces the correct separation between external-provider auth and first-party product tools.

### Phase 4: Canvas Connector

- [ ] Build `canvas-mcp`.
- [ ] Expose project/content/asset search.
- [ ] Add draft creation/update tools.
- [ ] Add publish/export actions behind approval gates.
- [ ] Add Canvas update events into Rowboat.

### Phase 5: Corinthian Connector

- [ ] Build `corinthian-mcp`.
- [ ] Expose client/workspace/document search.
- [ ] Add intake/task/document-classification tools.
- [ ] Add notification/support actions behind approval gates.
- [ ] Add Corinthian events into Rowboat.

### Phase 6: Cross-Product Workflows

- [ ] Add workflows that combine data from multiple connectors.
- [ ] Add user-facing audit trails for cross-product actions.
- [ ] Add approval UI for high-risk tool calls.
- [ ] Add product-specific failure recovery paths.

---

## Implementation Notes For Rowboat

Rowboat already has agent/tool concepts, project-scoped APIs, MCP/Composio/custom tool support, and hosted/desktop app surfaces. The integration work should extend that shape rather than creating a separate automation system.

Suggested Rowboat surfaces:

```text
apps/rowboat
  app/projects/[projectId]/connectors
  app/actions/connector.actions.ts
  src/entities/models/connector-install.ts
  src/application/use-cases/connectors/*
  src/application/policies/connector-tool-authorization.policy.ts
  src/infrastructure/repositories/mongodb.connector-installs.repository.ts
  src/application/lib/mcp/oppulence-connectors/*
```

Suggested MCP deployment ownership:

```text
canvas repo      owns canvas-mcp
billflow repo    owns billflow-mcp
corinthian repo  owns corinthian-mcp
rowboat repo     owns connector registry, agent runtime integration, and cross-product workflows
```

---

## Open Questions

- What is the canonical shared organization ID across Oppulence products?
- Should connectors be installed per Rowboat project, per organization, or both?
- Should Canvas, Billflow, and Corinthian expose MCP directly, or should each expose product APIs and have a thin MCP adapter?
- Which high-risk actions require human approval by default?
- Where should cross-product audit logs live: only in Rowboat, or also mirrored back to each product?
- Which product should be the first production pilot after Billflow read-only tools?

---

## Final Architecture Principle

Keep product ownership strict:

```text
Products own their data, permissions, domain rules, and external providers.
Rowboat owns agent orchestration, connector installation, cross-product reasoning, and audited tool execution.
MCP connects the two.
OAuth/OIDC grants access when a human or org needs to delegate authority.
```
