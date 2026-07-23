# RFC 033: Integration Parity Surface — Littlebird-Class Coverage on the Sensor Rails

|                  |                                                                                                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**          | 033                                                                                                                                                                                                                        |
| **Status**       | Draft                                                                                                                                                                                                                      |
| **Track**        | Product/platform - how the connector surface reaches perceived parity with horizontal assistants without abandoning the sensor-first build rule                                                                            |
| **Owners**       | `rowboat/apps/rowboat-api` (broker, action engine), `apps/x/packages/core` (MCP, tools)                                                                                                                                    |
| **Created**      | 2026-07-23                                                                                                                                                                                                                 |
| **Last updated** | 2026-07-23                                                                                                                                                                                                                 |
| **Depends on**   | [RFC 012](./012-connector-suite-and-consent-broker.md), [RFC 020](./020-native-third-party-action-engine.md), [RFC 032](./032-detection-sensor-integrations.md)                                                            |
| **Related**      | [RFC 013](./013-oppulence-product-connector-fabric.md), [RFC 030](./030-revenue-memory-outbound-governance.md), [RFC 034](./034-floating-overlay-assistant.md), [RFC 035](./035-meeting-intelligence-commitment-ledger.md) |
| **Supersedes**   | none; extends RFC 032's ranking with a parity lane it deliberately excluded                                                                                                                                                |

## Main point

Littlebird ships **nine first-party integrations plus MCP at a paid tier** and markets "hundreds of integrations" off that combination. We already own deeper rails than they do — a consent broker (RFC 012), shipped broker connectors (`apps/rowboat-api/internal/connectors/default_connectors.json`: Google, Slack, HubSpot, Stripe, Notion, Linear, GitHub), a declarative provider/action catalog (RFC 020), and a desktop MCP client (`apps/x/packages/core/src/mcp/mcp.ts`). Parity is therefore **not a build problem, it is a packaging problem**: expose what is shipped, add four cheap task-tool manifests, and market the MCP long tail the same way they do. The sensor-first rule from RFC 032 stays the law for anything that costs real effort.

## Littlebird reference (what parity means)

| Littlebird surface              | Their mechanics                                                                                                                         | Our answer                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 9 live first-party integrations | Asana, ClickUp, GitHub, Gmail, Google Calendar, Linear, Notion, TickTick, Todoist; "search them, act in them, write back with judgment" | Broker connectors + RFC 020 manifests; read/act/watch semantics per RFC 013     |
| "List grows every week"         | Weekly first-party additions                                                                                                            | RFC 020 declarative manifests make an addition a data change, not a code change |
| MCP access (Power tier, $42/mo) | Long-tail via user-supplied MCP servers                                                                                                 | Already shipped in the desktop (`core/src/mcp`); surface + market it            |
| Gmail/GCal free, rest paid      | Integration count as an upgrade lever                                                                                                   | Watch free / Chase paid already gates by outcome, not by connector count        |

## Why this RFC exists

RFC 032 correctly banned logo-wall building — but a prospect comparing us to a horizontal assistant sees their integrations page ("nine live, growing weekly, hundreds via MCP") against our silence. Losing the comparison on **packaging** when we are ahead on **plumbing** is an unforced error. This RFC creates a bounded parity lane with three rules:

1. **Shipped-first.** Anything in `default_connectors.json` gets a tool surface and a marketing card before any new pipe is built.
2. **Manifest-only additions.** New parity connectors must be expressible as RFC 020 declarative manifests (OpenAPI-bootstrapped). If one needs custom Go, it exits this lane and queues behind RFC 032's sensor ranking.
3. **Every parity connector names its ledger contribution.** Task tools are not exempt: Asana/Linear/ClickUp/Todoist supply the _slipping-commitment_ signal (assigned, due, untouched) that feeds RFC 032's "spoken commitments" detector class — a promise tracked in a task tool that stalls is the same slip as one made in a meeting.

## The parity catalog

**Wave 1 — expose what is shipped (no new pipes).** Gmail, Google Calendar, Slack, HubSpot, Stripe, Notion, Linear, GitHub. Work: agent tool coverage over each (read + act per RFC 013 semantics), connector cards on the marketing site, and consent-screen copy per RFC 012.

**Wave 2 — manifest additions for task parity.** Asana, ClickUp, Todoist, TickTick as RFC 020 manifests: `tasks.list/search/create/complete`, watch on due/overdue where the API supports it. This closes the visible gap with Littlebird's nine and powers the slipping-commitment detector.

**Wave 3 — the long tail is MCP, not manifests.** Surface the desktop MCP client in product and marketing ("bring any of the hundreds of MCP servers"), with the RFC 012 scope model deciding what an MCP tool may touch. We match their "hundreds" claim with the same mechanism they use, at every paid tier rather than only the top one.

## Constraints

- The RFC 030 verification/suppression gate governs every outbound action regardless of which connector executes it; parity connectors get **read/watch by default, act only where RFC 023 approval semantics exist**.
- RFC 031 storage tiering applies to parity sensors exactly as to mail: metadata breadth, content by reference, evidence snapshots only for actions.
- Nothing in this lane may delay a Tier 1–2 sensor from RFC 032; parity work is explicitly interruptible.

## Decisions

1. **Task tools are in, social/design tools are out.** Canva/Miro/Klaviyo-class integrations (Littlebird's creative lane) contribute no slip signal and no wedge value; they stay out until a design partner names one with a detector attached.
2. **No screen observation.** Littlebird's deepest "integration" is watching the screen. We do not follow (see RFC 034's posture); our breadth story is consented connectors + MCP.
3. **Marketing counts honestly.** The integrations page lists first-party connectors and separately says "hundreds more via MCP" — the same framing Littlebird uses, which we can make true on day one.

## Test plan

- Contract tests per manifest action against recorded fixtures (RFC 020's harness).
- One end-to-end per Wave-2 provider: connect → task created → task goes overdue → slipping-commitment signal appears in the ledger with a source link.
- Consent-screen snapshot tests: every parity connector renders scope copy from the RFC 012 catalog, no hand-written screens.

## Non-goals

- Building any connector requiring custom Go in this lane.
- Matching Littlebird's screen-observation capture.
- Integration-count-gated pricing tiers.
