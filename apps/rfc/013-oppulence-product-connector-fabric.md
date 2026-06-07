# RFC 013: Oppulence Product Connector Fabric

|                  |                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**          | 013                                                                                                                                                                                                                                                                                                                      |
| **Status**       | Draft                                                                                                                                                                                                                                                                                                                    |
| **Track**        | Cross-portfolio cockpit                                                                                                                                                                                                                                                                                                  |
| **Owners**       | `apps/x`, `apps/rowboat-api`, Canvas/Cadence/Corinthian product owners                                                                                                                                                                                                                                                   |
| **Created**      | 2026-06-06                                                                                                                                                                                                                                                                                                               |
| **Last updated** | 2026-06-06                                                                                                                                                                                                                                                                                                               |
| **Depends on**   | [RFC 012](./012-connector-suite-and-consent-broker.md), desktop MCP client, product-owned MCP/API surfaces                                                                                                                                                                                                               |
| **Enables**      | [RFC 008](./008-conduit-eigen-faculties.md), cross-portfolio cockpit                                                                                                                                                                                                                                                     |
| **Parent docs**  | [`docs/architecture-cross-portfolio-cockpit.md`](../../docs/architecture-cross-portfolio-cockpit.md), [`docs/superpowers/plans/2026-05-21-oppulence-product-integrations.md`](../../docs/superpowers/plans/2026-05-21-oppulence-product-integrations.md), [`docs/one-pager-product.md`](../../docs/one-pager-product.md) |

## Summary

The cross-portfolio cockpit depends on a base connector fabric before Conduit and
Eigen can become useful faculties. Canvas, Cadence, and Corinthian own different
financial systems of record; Rowboat owns the user-owned corpus and agent
orchestration layer. This RFC defines the connector manifest, MCP mount, mirror,
event, shared resource, and action-review contracts that let those systems plug
into Rowboat without blurring product ownership.

RFC 008 covers Conduit and Eigen specifically. This RFC covers the base portfolio
fabric they assume exists.

## Naming note

The docs use both **Cadence** and **Billflow**. This RFC uses **Cadence** as the
product-facing name and treats **Billflow** as the legacy/API naming where it
already exists. Scope prefixes may remain `billflow:*` until a deliberate rename
migration is planned.

## Current state

| Plane                                | State                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Rowboat relationship plane           | Desktop already syncs Gmail, Calendar, Fireflies/meeting data into a local Markdown vault. |
| Canvas revenue/AR plane              | Has an MCP server shape in the portfolio.                                                  |
| Corinthian AR execution/memory plane | Has a standalone MCP server and approval-token patterns.                                   |
| Cadence AP/spend plane               | Has product APIs and MCP consumer infra, but no canonical MCP server/shim yet.             |
| Connector auth                       | Defined by RFC 012, not yet product-complete.                                              |
| Cloud eventing/runtime               | Defined by RFCs 003 and 004.                                                               |

## Goals

- Represent each Oppulence product as an installable connector with health,
  scopes, tenant mapping, MCP URL, events, and audit policy.
- Mount product MCP servers for Read access.
- Mirror durable product identity into the local vault as Markdown notes.
- Route product events into Rowboat for live-note updates and cloud triggers.
- Keep product write actions behind review and product-owned authorization.
- Normalize product references without copying product databases.

## Non-Goals

- Rebuilding Canvas, Cadence, or Corinthian data models in Rowboat.
- Direct DB access across products.
- Storing external-provider tokens such as Plaid in Rowboat.
- Shipping Conduit/Eigen internals; see RFC 008.
- Co-marketing the products as one suite.

## Connector manifest

Each first-party connector has a manifest consumed by rowboat-api, the desktop,
and cloud runtime tool registration.

```json
{
  "id": "cadence",
  "legacyIds": ["billflow"],
  "displayName": "Cadence",
  "environment": "production",
  "auth": {
    "type": "first_party_oauth",
    "requiresUserDelegation": true,
    "requiresOrgAdminConsent": true
  },
  "audience": "billflow-api",
  "scopes": ["billflow:invoices.read", "billflow:vendors.read", "billflow:payments.execute"],
  "mcp": {
    "serverId": "cadence-mcp",
    "transport": "http",
    "baseUrl": "https://api.cadence.solomon-ai.co/v1/mcp"
  },
  "events": ["billflow.invoice.created", "billflow.payment.failed"],
  "audit": {
    "logToolCalls": true,
    "logResourceIds": true,
    "redactSecrets": true
  }
}
```

Manifests start config-backed. They can move to a table once product teams need
self-service registration.

## Four seams

### Read

The desktop mounts product MCP servers using the connector registry and short-lived
resource tokens from RFC 012. Agents call tools as `mcp:{server}:{tool}`.

Read tools must be:

- Narrowly scoped.
- Product-owned.
- Audited by the product MCP server.
- Safe to expose to the model after redaction.

### Mirror

Mirror durable identity into the local vault, not volatile numbers. Examples:

| Product    | Mirror durable notes                         | Query on demand                                 |
| ---------- | -------------------------------------------- | ----------------------------------------------- |
| Canvas     | customer, invoice, collection case identity  | current balance, live forecast, latest aging    |
| Cadence    | vendor, AP invoice, payment run identity     | current bank balance, reconciliation confidence |
| Corinthian | customer/case, communication thread identity | next-best-action, current dunning queue         |

Mirrored notes must preserve user edits and `live:` frontmatter. Sync code follows
the existing `sync_gmail.ts`/`sync_fireflies.ts` pattern and emits `RowboatEvent`
records after material changes.

### Watch

Products emit stable-reference events into RFC 003 cloud event ingestion and,
where the desktop is online, local `events/pending`.

Payload rule: events carry references and a concise gist, not full sensitive
records.

Example:

```json
{
  "eventId": "evt_123",
  "eventType": "billflow.payment.failed",
  "occurredAt": "2026-06-06T14:00:00Z",
  "product": "cadence",
  "orgId": "org_123",
  "resourceType": "payment",
  "resourceId": "pay_456",
  "actorId": "user_789"
}
```

### Act

Write/external-effect tools remain product-owned and product-authorized.
Rowboat's role is to propose, review, and call the MCP action after approval. The
product enforces:

- Required OAuth scopes.
- Product RLS/tenant checks.
- Approval tokens for high-risk or money-moving actions.
- Domain-specific caps and policies.

## Shared resource model

Rowboat stores lightweight references so agents can reason across products without
copying full databases.

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

This model supports cross-links in notes, event-to-resource joins, and audit
timelines.

## Product connectors

### Canvas

Primary purpose: revenue/AR and customer financial truth.

Read/Mirror:

- customers
- invoices
- transactions
- AR aging
- forecasts
- collection cases

Watch:

- `canvas.invoice.updated`
- `canvas.payment.received`
- `canvas.promise.broken`
- `canvas.forecast.changed`

Act:

- draft invoice changes
- request dunning action
- categorize transaction
- send invoice only behind high-risk confirmation

### Cadence

Primary purpose: AP/spend, vendors, approvals, payment/reconciliation truth.

Required first work: ship `cadence-mcp` or a thin MCP shim over existing REST.

Read/Mirror:

- vendors
- AP invoices
- approval state
- reconciliation records
- payment runs

Watch:

- `billflow.invoice.created`
- `billflow.invoice.updated`
- `billflow.approval.required`
- `billflow.payment.failed`
- `billflow.bank_account.updated`

Act:

- suggest reconciliation match
- prepare payment run
- approve/reject AP invoice only with money-moving approval token
- initiate vendor payment only with money-moving approval token

### Corinthian

Primary purpose: AR execution, communication memory, collections behavior.

Read/Mirror:

- cases
- communications
- payment promises
- reminders/dunning outcomes
- AR reports

Watch:

- `corinthian.reply.received`
- `corinthian.promise.broken`
- `corinthian.case.escalated`
- `corinthian.payment.received`

Act:

- draft customer follow-up
- send customer-facing message only after review
- initiate payments/refunds only with money-moving approval token

## Tenant mapping

Each connector install must pin:

- Rowboat user id.
- WorkOS user id.
- Optional WorkOS org id.
- Product workspace/team/org id.
- Granted scopes.
- Product environment.

The desktop must never blend product tenants into one vault unless the user has
explicitly connected those tenants to the same Rowboat workspace.

## Cloud runtime integration

RFC 004's `connector.read.*` tool namespace depends on this fabric.

Tool invocation scope includes:

```text
UserID
WorkOSOrgID
ConnectorInstallID
ProductWorkspaceID
TaskSlug
RunID
AllowedScopes
```

The runtime resolves connector credentials internally. Tokens never enter prompts.

## Desktop UX

Settings gains a Connected Products surface:

- product name and icon
- environment
- tenant/workspace name
- granted scopes
- connected date and last used date
- health state
- disconnect action
- sync/mirror state
- recent product events

The first cockpit surface is not a marketing page; it is the actual federated note
and connector state the operator needs.

## Rollout

1. Land connector manifest schema.
2. Add connector install/status/health data to rowboat-api and desktop settings.
3. Canvas + Corinthian read-only MCP mounts.
4. `sync_canvas.ts` mirrors customers/invoices/cases into the vault.
5. Cadence read-only MCP shim.
6. `sync_cadence.ts` mirrors vendors/AP invoices/payment runs.
7. Product events into RFC 003 cloud ingestion.
8. Cross-product live notes.
9. High-risk write actions behind approval tokens.
10. Combined loops with Conduit/Eigen per RFC 008.

## Test plan

- Unit: manifest validation and legacy id aliasing (`billflow` -> `cadence`).
- Unit: connected resource upsert/idempotency.
- Unit: mirror render preserves frontmatter and user edits.
- Unit: tenant mapping prevents mixed-product workspace leakage.
- Integration: connect Canvas -> list MCP tools -> mirror customer note.
- Integration: Cadence event -> `CloudEvent` -> linked `trigger=event` run.
- Integration: high-risk tool returns approval challenge and executes only after
  valid approval token.
- E2E: Acme note renders relationship + AR + AP + communication context from
  multiple connectors.

## Detailed implementation design

### Connector manifest schema

The manifest should be machine-validated. A concrete shape:

```json
{
  "schema_version": "2026-06-06",
  "product_id": "cadence",
  "legacy_ids": ["billflow"],
  "display_name": "Cadence",
  "audience": "mcp:cadence",
  "description": "Accounts payable and payment operations.",
  "capabilities": {
    "read": true,
    "mirror": true,
    "watch": true,
    "act": true
  },
  "resources": [
    {
      "type": "vendor",
      "stable_id_field": "vendor_id",
      "mirror": true,
      "volatile": false
    },
    {
      "type": "payment_run",
      "stable_id_field": "payment_run_id",
      "mirror": false,
      "volatile": true
    }
  ],
  "tools": [
    {
      "name": "cadence.vendor.get",
      "scope": "cadence.read",
      "risk": "low"
    },
    {
      "name": "cadence.payment_run.propose",
      "scope": "cadence.payment_run.approve_request",
      "risk": "high"
    }
  ],
  "events": [
    {
      "type": "invoice.created",
      "source": "cadence",
      "scope": "cadence.watch"
    }
  ]
}
```

Manifests are not UI-only metadata. They drive desktop settings, MCP mounting,
scope requests, mirror jobs, and event routing.

### Resource identity rules

Every mirrored resource needs a stable identity triple:

```text
product_id + tenant_id + external_id
```

The vault path may be human-readable, but identity must not depend on path text:

```text
product: cadence
tenant: ten_123
resource_type: vendor
external_id: ven_456
rowboat_resource_id: cadence/ten_123/vendor/ven_456
```

If a vendor/customer/invoice is renamed, the existing note is updated or moved
with redirect metadata. A rename must not create a duplicate entity.

### Mirror document frontmatter

Mirrored notes should carry enough metadata to re-sync safely:

```yaml
---
rowboat:
  mirror: true
  product: cadence
  tenant_id: ten_123
  resource_type: vendor
  external_id: ven_456
  source_updated_at: 2026-06-06T12:00:00Z
  last_synced_at: 2026-06-06T12:05:00Z
  schema_version: 2026-06-06
  checksum: sha256:abc123
---
```

The generated portion of the note should be bounded by markers so user-authored
comments can survive sync:

```md
<!-- rowboat:mirror:start -->

Generated mirror content.

<!-- rowboat:mirror:end -->

User notes below this line stay untouched.
```

### Sync algorithm

Mirror jobs use idempotent upserts:

1. Load connector connection and tenant mapping.
2. Fetch changed resources by cursor if product supports it.
3. Normalize product objects into shared resource models.
4. Compute content checksum for generated block.
5. Upsert resource identity row.
6. Patch generated block only when checksum changed.
7. Preserve user-authored blocks.
8. Write sync cursor after durable note write.
9. Emit sync metrics and audit events.

Cursor writes happen after note writes. This may reprocess a resource after a
crash, but it prevents data loss.

### Conflict handling

Conflicts are handled by ownership:

| Field/source             | Owner   | Conflict behavior                       |
| ------------------------ | ------- | --------------------------------------- |
| Product canonical fields | Product | Mirror overwrites generated block.      |
| User commentary          | User    | Sync preserves user block.              |
| Relationship annotations | Rowboat | Merge by stable relationship id.        |
| Volatile balances/status | Product | Query live, do not mirror as canonical. |
| Action approvals         | Product | Display result, do not edit manually.   |

If generated block markers are deleted, the sync should recreate the generated
block below frontmatter and emit a warning event.

### Read seam

Read tools answer direct product questions without writing local notes:

```json
{
  "tool": "cadence.vendor.get",
  "input": {
    "vendor_id": "ven_456"
  },
  "output": {
    "vendor": {
      "id": "ven_456",
      "name": "Acme Supplies",
      "status": "active"
    },
    "source": {
      "product": "cadence",
      "tenant_id": "ten_123",
      "retrieved_at": "2026-06-06T12:00:00Z"
    }
  }
}
```

Reads are best for volatile state: balances, open cases, current payment-run
status, liquidity projections, and correspondence windows.

### Mirror seam

Mirror is for durable identity and durable relationship context:

- customers
- vendors
- counterparties
- contracts
- invoice headers
- dispute threads
- case metadata
- forecast scenario definitions

Mirror should not try to keep high-frequency numbers exact. High-frequency
numbers should be linked or refreshed on demand.

### Watch seam

Product watch events normalize into RFC 003 cloud events:

```json
{
  "source": "cadence",
  "event_type": "payment_run.status_changed",
  "tenant_id": "ten_123",
  "external_id": "payrun_789",
  "dedupe_key": "cadence:ten_123:payment_run.status_changed:payrun_789:42",
  "occurred_at": "2026-06-06T12:00:00Z",
  "summary": "Payment run moved to approval_required."
}
```

Watch payloads must be small. Large product data should be fetched by read tools
during the triggered run.

### Act seam

Act tools split into three categories:

| Category        | Example                                   | Policy                                           |
| --------------- | ----------------------------------------- | ------------------------------------------------ |
| Draft/propose   | Draft customer reply, propose payment run | Allowed with act scope, no external effect.      |
| External effect | Send message, open case, trigger refresh  | Requires action confirmation.                    |
| Money-touching  | Release payment, change payment terms     | Requires product-owned approval token and audit. |

Agents may prepare a proposal artifact before approval. They may not execute a
money-touching action just because the proposal exists.

### Product-specific resource maps

#### Canvas

Primary resources:

- customer
- account
- invoice
- payment promise
- case
- communication thread

Mirror candidates:

- customer profile
- invoice header
- open case summary
- correspondence thread index

Read candidates:

- current AR aging
- invoice status
- latest customer communication
- next recommended collection action

Watch candidates:

- invoice overdue
- payment promise broken
- dispute opened
- reply received

Act candidates:

- draft reply
- create follow-up task
- send approved message

#### Cadence

Primary resources:

- vendor
- AP invoice
- payment run
- approval
- cash impact estimate

Mirror candidates:

- vendor profile
- AP invoice header
- payment policy notes

Read candidates:

- payment-run status
- invoices due this week
- vendor risk flags
- cash requirements

Watch candidates:

- new AP invoice
- approval required
- payment failed
- vendor change

Act candidates:

- propose payment-run adjustment
- request approval
- execute approved payment action only through product policy

#### Corinthian

Primary resources:

- counterparty
- contract
- obligation
- compliance case
- evidence packet

Mirror candidates:

- contract summary
- obligation list
- case metadata

Read candidates:

- active obligation status
- contract clause lookup
- compliance exceptions

Watch candidates:

- obligation due
- exception opened
- counterparty change

Act candidates:

- draft notice
- create review task
- package evidence for approval

#### Conduit

Primary resources:

- correspondence thread
- dispute
- evidence item
- send/reply action

Mirror candidates:

- correspondence index
- dispute summary
- evidence bindings

Read candidates:

- recent thread messages
- linked invoice/case evidence
- reply status

Watch candidates:

- inbound reply
- dispute escalated
- evidence missing

Act candidates:

- draft response
- bind evidence to invoice/case
- send approved reply

#### Eigen

Primary resources:

- scenario
- forecast run
- breach
- sensitivity

Mirror candidates:

- scenario definitions
- forecast note summaries
- breach explanation notes

Read candidates:

- current runway
- liquidity floor breach
- scenario comparison

Watch candidates:

- breach detected
- forecast stale
- major cash movement

Act candidates:

- simulate
- schedule stress job
- propose recommendation, never move money

### Desktop connected-products UX states

Each connector tile needs distinct states:

| State              | Meaning                                       | Primary action     |
| ------------------ | --------------------------------------------- | ------------------ |
| `not_connected`    | No grant exists.                              | Connect            |
| `connecting`       | Consent flow started.                         | Continue/cancel    |
| `active`           | Grant valid and product health ok.            | View details       |
| `degraded`         | Product reachable but one capability failing. | Retry/check status |
| `reauth_required`  | OAuth refresh failed or grant expired.        | Reconnect          |
| `revoked`          | User disconnected.                            | Connect again      |
| `disabled`         | Admin/product disabled connector.             | Contact admin      |
| `unsupported_plan` | User lacks entitlement.                       | Upgrade            |

The UI should not flatten all failures into "disconnected"; that hides policy
and provider failures from support.

### Event-to-note routing

Product events should carry enough context for matching:

- product id
- tenant id
- resource type
- external id
- relationship ids
- suggested note paths
- semantic tags
- event severity

The router can match events to:

- a mirrored product note
- a live note that watches a customer/vendor/counterparty
- a cross-portfolio cockpit note
- an agent workflow that owns the event type

### Data retention

Mirrored notes are user-owned and stay until the user deletes them. Connector
state and audit rows should follow security retention:

- active connection rows: until disconnect/delete
- revoked connection tombstones: retain for audit window
- event payloads: short retention unless referenced by a note/run
- mirrored generated block: remains in the vault after disconnect, marked stale
- product access tokens: delete immediately on disconnect/revoke

Disconnecting a connector stops future refresh and watch events. It does not
silently delete the user's local notes.

### Performance constraints

Sync jobs should be bounded:

- max resources per sync batch
- max generated markdown bytes per note
- cursor checkpoint frequency
- backoff on product rate limits
- per-connector concurrency limit
- desktop CPU/I/O budget for local mirroring

Large historical imports should run as explicit backfills, not as an automatic
side effect of connecting a product.

### Developer workflow

To add a product connector:

1. Add manifest.
2. Add scope catalog entries in RFC 012 format.
3. Add product MCP mount config.
4. Add resource normalizers.
5. Add mirror renderer.
6. Add event normalization.
7. Add desktop settings copy/icons.
8. Add sync fixture data.
9. Add integration test for connect -> read -> mirror.
10. Add one negative test for tenant mismatch.

## Acceptance criteria

- Canvas, Cadence, and Corinthian have manifest-backed connector definitions.
- The desktop can mount product MCPs from connector state, not hand-edited config.
- At least one product mirrors durable identity into the vault.
- Product events can trigger live-note/cloud-agent work while the desktop is
  closed.
- Writes stay product-owned, scoped, reviewed, and audited.

## Decisions

- **Products own data and domain rules.** Rowboat owns orchestration and the
  user-owned corpus.
- **Mirror durable identity; query volatile state.** Prevents sync storms and stale
  financial numbers.
- **Cadence is the product name; Billflow may remain a technical prefix until
  migration.**
- **MCP is the execution protocol; connectors are the install/config/audit product
  surface.**
- **No Plaid bypass.** External financial-provider tokens stay inside the owning
  product.
