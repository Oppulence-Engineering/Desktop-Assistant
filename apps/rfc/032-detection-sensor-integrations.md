# RFC 032: Detection Sensor Integrations for Revenue Memory

|                  |                                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**          | 032                                                                                                                                                                                                                                 |
| **Status**       | Draft                                                                                                                                                                                                                               |
| **Track**        | Product/platform - which integrations the warm-revenue loop adds after Gmail and Outlook, and in what order                                                                                                                         |
| **Owners**       | `rowboat/apps/rowboat-api` (connectors, detection, ledger)                                                                                                                                                                          |
| **Created**      | 2026-07-22                                                                                                                                                                                                                          |
| **Last updated** | 2026-07-22                                                                                                                                                                                                                          |
| **Depends on**   | [RFC 012](./012-connector-suite-and-consent-broker.md), [RFC 019](./019-google-push-infrastructure.md), [RFC 030](./complete-030-revenue-memory-outbound-governance.md), [RFC 031](./031-tiered-mail-storage-for-revenue-memory.md) |
| **Related**      | [RFC 022](./022-unified-entity-graph.md), [RFC 023](./023-closed-loop-actions.md), [email-001](./email-001-mailbox-provider-foundation.md) (Outlook provider), [013](./013-oppulence-product-connector-fabric.md)                   |
| **Supersedes**   | none; sequences the connector roadmap that RFC 030's detection layer consumes                                                                                                                                                       |

## Main point

An integration earns its place by the slip-signals it adds to the ledger, not by logo-wall value. Every integration is a **sensor**. Each sensor contributes one or more of five signal types:

| Signal type                  | Meaning                                                  | Example detector                                      |
| ---------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| **Silence**                  | A thread or channel that was alive went quiet            | Proposal email unanswered for 6 days                  |
| **Engagement without reply** | The counterparty is looking but not responding           | Proposal opened 4 times, never signed, never answered |
| **Money-state**              | Work, invoices, and payments out of their expected state | Signed work never invoiced; invoice past due          |
| **Stage-state**              | A tracked deal stuck in one stage too long               | CRM deal in "Proposal Sent" for 21 days               |
| **Spoken commitments**       | Promises made in meetings that never became actions      | "Revised pricing by Friday" said, nothing sent        |

All sensors write to the one RFC 022/030 ledger under RFC 031's storage rules: metadata breadth, derived signals for the relevant, content by reference, evidence snapshots for actions. The compound signal is the product: _"opened your proposal 4 times, no reply, no meeting booked, last invoice still unpaid"_ is a sentence no single-source competitor can say.

## Why this RFC exists

After Gmail and Outlook the obvious failure mode is integration sprawl: building connectors because prospects name tools, not because the connector detects anything. This RFC fixes the ranking rule (detector value for the services-principal ICP), the order, and the explicit non-goals, so each new connector must name the detector it powers before it is built.

Inventory note: several sensors already exist as shipped connectors or tools — native Google and Slack OAuth, and the broker connectors for HubSpot, Stripe, Notion, Linear, and GitHub (`internal/connectors/default_connectors.json`). For those, the work is wiring detection, not building the pipe.

## Tier 0 — the base (in scope of the wedge already)

- **Gmail + Google Calendar**, then **Outlook + Microsoft Calendar** via the email-001 provider abstraction. Mail is the silence sensor; calendar is a detector in its own right: no next meeting booked after a pitch, a recurring client check-in that stopped, a skipped QBR. Calendar cadence is the retainer-fade detector for Stage 3.

## Tier 1 — proposal and money sensors

1. **One e-sign/proposal tool: PandaDoc or DocuSign — exactly one, chosen by design-partner tool-stack data** (interview Q5). Powers the highest-value non-mail detector: engagement-without-reply on the document that carries the deal's dollar value. Do not build the category; infer from inbox threads where the partner uses anything else.
2. **QuickBooks Online, then Xero** — behind the existing Stage-2 trigger (non-Stripe demand blocks >30% of otherwise-closed deals). Stripe reads are already shipped; QBO/Xero is where most services invoices live, unlocking _unbilled signed work_ and _unpaid invoice_ at scale.

## Tier 2 — where clients actually go quiet

3. **Slack client channels** (connector shipped; detection work only). Shared channels and Slack Connect are where fractional/agency client relationships live. A quiet client channel is the same silence signal as an unanswered thread, and promises made in Slack are commitments for the ledger. **Microsoft Teams** is the same sensor for the Outlook cohort, later.
4. **Scheduling: Calendly or Cal.com.** Cheap APIs, strong detectors: call happened and nothing was booked next; prospect no-showed and nobody rescheduled.

## Tier 3 — enrichment that sharpens every other signal

5. **CRM: HubSpot** (connector shipped), **then Pipedrive.** Supplies stage-state and authoritative dollar values. Rule: **enrich when present, never require** — much of the ICP leaks money precisely because they keep no CRM.
6. **Meeting transcripts: import from Fathom / Fireflies / Granola** (or the desktop's on-device capture, Stage 4). Import, do not record: the notetaker market is a distribution knife fight the validation said to avoid; the undone work is the commitment ledger behind the notes.
7. **Docs engagement: Google Drive / Notion** (both shipped). Deck viewed and commented, then silence — a weaker cousin of the e-sign signal, nearly free given the connectors exist.

## Constraints that apply to every sensor

- RFC 031's tiering governs storage for all sources, not only mail: metadata for everything the detector needs, content by reference, evidence snapshots for actions, nothing pooled across customers.
- Every send still passes the RFC 030 verification/suppression gate regardless of which sensor raised the action.
- Ordering **within** a tier is decided by design-partner tool-stack data, not by intuition.

## Decisions

| Fork             | Choice                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Ranking rule     | Detector value for the services-principal ICP; a connector must name its detector before it is built. |
| E-sign breadth   | Exactly one (PandaDoc or DocuSign), picked from partner data; others inferred from inbox threads.     |
| QBO/Xero timing  | Behind the Stage-2 demand trigger (unchanged from the validated plan; biggest fragmentation risk).    |
| CRM posture      | Enrich when present, never require.                                                                   |
| Meetings posture | Import transcripts users already have; never compete as a notetaker.                                  |
| Calendars        | Treated as a first-class detector (cadence/fade), not merely a data source.                           |

## Non-goals

- **LinkedIn DMs cloud-side.** A large share of consultant deals ghost there, but the API is closed and automation violates ToS — the same compliance posture that is a moat elsewhere. At most a desktop-local assist, much later, under its own RFC.
- WhatsApp/iMessage channels; an integration marketplace for breadth's sake; building proposal, e-sign, CRM, or notetaking products ourselves.

## Test plan

- Per-sensor detector fixtures: each integration lands with synthetic fixtures proving its named detector fires (and does not fire on healthy accounts).
- A signal-join test: a seeded entity with mail silence + e-sign views + an unpaid invoice produces one compound queue item, not three.
- RFC 031 schema-guard compliance for every new sensor's entities (no content columns outside the sealed cache).

## Open questions

- PandaDoc vs DocuSign (partner data decides); Calendly vs Cal.com first (same rule).
- Teams timing relative to Outlook GA.
- Whether calendar no-show detection needs the scheduling tool or can be inferred from calendar + mail alone in v1.
