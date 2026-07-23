# Oppulence — Product Direction One-Pager

**The governed revenue-recovery agent for law firms — it remembers every promise in your practice and chases the money, with your approval.**

_July 2026 · Synthesis of validated strategy, current build state, and analysis of 1,749 dead-startup autopsies (loot-drop.io dataset)_

---

## The product: one loop, sold as an outcome

**Scan → Queue → Approve → Receipt.**

1. **Scan** — watch email, calendar, and billing; find the money going quiet (ghosted proposals, unpaid invoices, dormant clients), each finding with a dollar amount and source evidence.
2. **Queue** — 3–5 drafted chases per week, in the owner's voice, ranked by value and urgency.
3. **Approve** — one click, policy-gated. Nothing sends without it; money actions need step-up confirmation.
4. **Receipt** — a monthly statement of what came back.

Demand is proven: of 218 dead startups in this problem space, only ~11% died of "no market need." The battle is differentiation — and the differentiator is the **relationship ledger** (every promise, chase, objection, and outcome), the one asset a competitor cannot rebuild.

## The wedge: law firms first

Triple-confirmed strongest entry point:

- Highest positive demand signal in B2B ops ideas (legal workflow/doc/coordination tools lead the vote clusters).
- Near-zero incumbent density in revenue-chasing — Clio/MyCase own practice management; we **integrate**, never compete.
- ICP fit: high-value relationships, chronic unbilled/unchased work, owner-operators who feel every lost $40k.

The "law firm preset" is not a new product: chase templates (unbilled hours, stale engagement letters, dormant referral sources), a Clio/QuickBooks connector, and a compliance posture — we never touch trust accounts. **No money movement is a feature here.** Agencies and trades follow on the same engine.

## The architecture: two surfaces, one product

| Surface                     | Role                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard (web-primary)** | The buying surface: queue, approvals, receipts. This is what the $99 buys.                                                                                                       |
| **Desktop app**             | The context engine: mailbox, meetings, knowledge graph, Live Notes — feeding the ledger richer evidence than any web-only competitor. Bundled depth moat; never sold standalone. |

The graveyard is unambiguous on form factor: standalone email/calendar/notes apps get absorbed by platforms (Mailbox, Sunrise, Xobni), and plugin-on-platform architectures get obsolesced (Xobni, Niles, Threadable). **Own surface + own ledger is the survivable shape.**

## Pricing

**Watch free · Chase $99/mo + metered on executed chases.** Failed-startup rebuild data runs 187 subscription vs 27 usage-metered — the hybrid is aligned with what works and differentiated where it counts: we charge on recovered-revenue actions, the one meter a services principal never resents.

## Build sequence

Connect + Execute rails exist; Scan, Queue, and billing wiring don't.

1. **Scan** on existing Connect rails — a batch weekly slip report unlocks the free tier and the demo motion ("Book a Revenue Leak Scan" is already the CTA).
2. **Queue + approvals** — the paid loop.
3. **Billing wiring** — metered execution.
4. **Law-firm preset** — templates + Clio connector; first GTM push.
5. Defer Teams/ROI dashboards — expansion, not wedge.

## Explicitly rejected

- Horizontal "AI assistant" positioning — the competition kill zone ($5M-median graveyard, 56% of lane deaths).
- Full back-office/accounting scope — killed NetBooks ($33M), Kyte.
- Money movement or regulated collections — killed Plastiq ($226M), GetBack ($600M).
- Any Gmail-add-on form factor.

## Competitive note: Littlebird (littlebird.ai)

Littlebird ("Remember everything: the AI search engine for your life") overlaps only with the **context-engine half** — screen observation, meeting notes, chat-with-context, briefings — sold horizontally to seven personas at $17–100/mo usage credits. It has **none of the wedge**: no leak detection with dollar amounts, no proactive queue, no approval-gated execution (their pages confirm no autonomous sends), no recovery receipts, no commercial ledger, no vertical, no outcome pricing. It _validates_ the decision to never sell the desktop standalone — that layer is contested by Littlebird, Rewind-style recorders, OS-level recall, and big-lab memory features. Their screen-recording posture is a liability in our vertical (privilege/confidentiality review blocks it at law firms); our consented, evidence-snapshot model is the sellable posture. **Watch trigger:** they already integrate Stripe/Mercury/Ramp/Close — if Littlebird ships a proactive queue + governed sending + money outcomes, reassess. Until then: validator of the layer, not a competitor to the wedge.

---

_Evidence base: loot-drop.io dataset — 1,749 dead-startup autopsies (~8,700 extracted insights), 1,000 rebuild ideas, 944 community votes. Top convergent lesson across the corpus: verticalize (62% of autopsies), focus, distribute through partners, lead with trust. Access + full findings: memory notes `loot-drop-dataset` / `loot-drop-graveyard-findings`._
