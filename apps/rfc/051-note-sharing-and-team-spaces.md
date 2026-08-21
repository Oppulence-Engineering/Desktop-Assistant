# RFC 051: Relationship Sharing and Team Workspaces

|                |                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**        | 051                                                                                                                                                                            |
| **Status**     | Draft — rescoped by RFC 055                                                                                                                                                    |
| **Track**      | Rowboat collaboration · relationship evidence                                                                                                                                  |
| **Owners**     | `apps/rowboat-api`, web, desktop, authorization, product                                                                                                                       |
| **Created**    | 2026-08-12                                                                                                                                                                     |
| **Updated**    | 2026-08-21                                                                                                                                                                     |
| **Depends on** | [RFC 011](./complete-011-identity-and-authorization-plane.md), [RFC 036](./036-relationship-state-engine.md)                                                                   |
| **Related**    | [RFC 015](./015-rowboat-platform-workos-fga-and-widget-auth.md), [RFC 050](./050-enterprise-controls.md), [RFC 055](./055-capture-product-boundary-and-rowboat-integration.md) |

## 1. Decision

Rowboat shares relationship workspaces, evidence-backed views, decisions,
recommendations, and action history. Generic capture-note and transcript sharing
belongs to the capture product.

A capture transcript may be referenced as source evidence inside a Rowboat
workspace only when its consent and sharing policy permit it. Connecting the
capture product does not automatically make every transcript visible to a team.

## 2. Collaboration model

The authorization resource is a relationship workspace, not a local Markdown
file or capture note. Roles are:

- `owner` — manages membership, policy, deletion, and export;
- `editor` — corrects identity, evidence, and relationship state;
- `operator` — reviews and approves allowed actions;
- `viewer` — reads authorized projections and evidence; and
- `external_viewer` — sees a deliberately published, redacted view.

Permissions are enforced server-side through the same FGA model used by API,
web, desktop, MCP, and action execution.

## 3. Evidence visibility

Visibility is evaluated independently for:

- the relationship projection;
- each evidence item;
- exact transcript or message spans;
- attachments and raw source artifacts;
- identity hypotheses; and
- action/audit records.

A projection may be shareable while a sensitive source span is withheld. The UI
must state that evidence exists but is unavailable rather than silently making a
claim appear unsupported.

## 4. Capture-product sources

Capture artifacts enter under RFC 055 with consent, retention, and transfer
classifications. Rowboat must preserve those restrictions when deriving and
sharing evidence.

- Raw audio is never shared merely because a relationship workspace is shared.
- Transcript access requires an allowed capture-artifact policy.
- Source deletion or revoked consent retracts or tombstones affected evidence.
- A user may publish a redacted excerpt without publishing the whole transcript.
- Capture-product team spaces remain distinct from Rowboat relationship
  workspaces; cross-product membership is not assumed.

## 5. Sharing surfaces

Rowboat may support:

- direct member invitations;
- organization and domain policy;
- expiring external views;
- project-level relationship workspaces;
- revocation and access audit; and
- exported evidence packets with provenance.

Public unauthenticated links default to disabled. Enabling them requires an
organization policy, explicit artifact selection, expiration, and revocation.

## 6. Definition of done

- Every relationship workspace has server-enforced roles and audit history.
- Evidence and projection visibility can differ without leaking source content.
- Capture consent and retention restrictions survive derivation and sharing.
- Raw audio and full transcripts are never shared by implication.
- Revocation takes effect across API, web, desktop, MCP, and cached views.
- External views expire and can be revoked immediately.
- Capture-product collaboration remains separately owned and documented.
