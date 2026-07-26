# RFC 033: Integration Parity Surface — Littlebird-Class Coverage on the Sensor Rails

|                  |                                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**          | 033                                                                                                                                                                                                                                 |
| **Status**       | Reframed — catalog and client experience over RFC 020                                                                                                                                                                               |
| **Track**        | Product packaging — how certified connector capabilities become a coherent integration surface in both clients                                                                                                                      |
| **Owners**       | `apps/rowboat-api`, `apps/rowboat-www`, `apps/x`, connector platform                                                                                                                                                                |
| **Created**      | 2026-07-23                                                                                                                                                                                                                          |
| **Last updated** | 2026-07-26                                                                                                                                                                                                                          |
| **Depends on**   | [RFC 012](./012-connector-suite-and-consent-broker.md), [RFC 020](./020-native-third-party-action-engine.md), [RFC 032](./032-detection-sensor-integrations.md)                                                                     |
| **Related**      | [RFC 013](./013-oppulence-product-connector-fabric.md), [RFC 030](./complete-030-revenue-memory-outbound-governance.md), [RFC 034](./034-floating-overlay-assistant.md), [RFC 035](./035-meeting-intelligence-commitment-ledger.md) |
| **Supersedes**   | none; extends RFC 032's ranking with a parity lane it deliberately excluded                                                                                                                                                         |

## Main point

Horizontal assistants make integration breadth legible through a searchable
catalog, coherent connection flows, reusable tools, and an MCP long tail.
Oppulence needs that legibility, but current broker entries are not equivalent
to production-grade connectors.

[RFC 020](./020-native-third-party-action-engine.md) owns the package, SDK,
runtime, ingestion, relationship-mapping, certification, and scale program.
This RFC owns the user-facing surface over certified releases: discovery,
connection, capability explanation, health, account selection, and honest
catalog positioning in both web and desktop.

## Littlebird reference (what parity means)

| Reference surface           | Their mechanics                                 | Oppulence answer                                                                     |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Visible first-party catalog | Searchable, named integrations and operations   | RFC 020 certified connector releases rendered from one catalog                       |
| Regular additions           | Repeatable internal authoring conventions       | RFC 020 packages, SDK/compiler, conformance, promotion, and ownership                |
| MCP long tail               | User-supplied external servers                  | Policy-wrapped MCP bridge with schema snapshots, effect classes, audit, and approval |
| Connection UX               | Provider-specific authorization and credentials | RFC 012 broker plus RFC 020 multi-account connection model                           |
| Tool use                    | Search, read, and write capabilities            | Typed operations narrowed by context, scope, policy, and certification               |

## Why this RFC exists

RFC 032 correctly rejects logo-wall building, but connector quality that users
cannot discover or understand has no product value. This RFC creates a bounded
presentation lane with four rules:

1. **Certified-first.** A registry entry does not receive a production claim
   until its RFC 020 release reaches the required certification tier.
2. **One catalog.** Web, desktop, docs, and marketing derive names,
   capabilities, scopes, status, and certification from the compiled catalog.
3. **Relationship contribution.** Every promoted connector names the evidence,
   identity, recommendation, or action value it adds to RFC 036.
4. **Honest breadth.** Native, provider MCP, custom, preview, verified,
   relationship-grade, and action-grade inventory remain distinguishable.

## The parity catalog

**Wave 1 — expose the reference set accurately.** Gmail, Google Calendar,
Slack, and HubSpot receive complete cards, capability/scope explanations,
multi-account connection, health, and certification state as their RFC 020
packages pass each gate.

**Wave 2 — expand by relationship signal.** Microsoft 365, Salesforce, meeting
providers, DocuSign, Stripe, support systems, and task systems follow the
catalog strategy in RFC 020 and sensor priority in RFC 032. Task systems can
contribute assigned, due, untouched, and completed commitment evidence.

**Wave 3 — expose the governed long tail.** Provider MCP, user MCP, custom HTTP,
and community packages appear with their actual runtime and certification
class. They do not inherit first-party or relationship-grade claims.

## Constraints

- RFC 023 and RFC 036 govern every consequential external action regardless of
  which connector executes it; connectors get read/observe first and act only
  after action-grade certification.
- RFC 031 storage tiering applies to parity sensors exactly as to mail: metadata breadth, content by reference, evidence snapshots only for actions.
- No client may hard-code an operation, scope explanation, health state, or
  certification that differs from the effective server catalog.
- A catalog card cannot be used to bypass RFC 020 package and release gates.

## Decisions

1. **Signal value determines first-party priority.** A provider without
   relationship evidence, identity, recommendation, or action value stays in
   the long tail until customer demand proves otherwise.
2. **No screen observation.** Littlebird's deepest "integration" is watching the screen. We do not follow (see RFC 034's posture); our breadth story is consented connectors + MCP.
3. **Marketing counts honestly.** The integrations page distinguishes certified
   first-party packages, provider MCP, community/custom packages, and potential
   compatibility.
4. **Parity applies to both clients.** Connector discovery and administration
   are not desktop-only or web-only.

## Test plan

- Shared catalog fixture and snapshot tests in web and desktop.
- Connect, multi-account, reconnect, disconnect, degraded, repair, selector,
  approval, and receipt cross-client E2E.
- One relationship-grade E2E per promoted observer: connect → event → evidence
  → identity → relationship change with source link.
- Consent and capability copy rendered from RFC 012/020 contracts rather than
  hand-written client tables.
- Marketing inventory check against the effective stable catalog and
  certification mix.

## Non-goals

- Defining connector package or runtime mechanics already owned by RFC 020.
- Matching Littlebird's screen-observation capture.
- Integration-count-gated pricing tiers.
- Treating listed or MCP-compatible integrations as relationship-grade without
  certification.
