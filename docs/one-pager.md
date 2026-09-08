# Oppulence — The Commitment Ledger

**Oppulence is the independent record of what your business promised and what
was promised to you, proven by evidence, across the systems where promises are
actually made.**

_A Playbook Media product · Rewritten September 2026_

## The problem

Businesses run on promises that no system records.

A delivery date agreed on a call. A scope change conceded in a thread. An
integration promised to close the deal. A vendor SLA nobody tracks. A
migration date given to a customer in Slack at 6pm on a Friday.

These are the obligations the business is actually judged on, and they live in
email, meetings, chat, and documents — never in the CRM, the ticket queue, or
the project tracker. Those systems record the *deal*. They do not record the
*obligation*.

The consequence is not disorganization. It is:

- promises made by one person that nobody else knows exist;
- delivery teams discovering commitments after the deadline;
- renewals lost to an unmet promise nobody logged;
- vendor obligations quietly unenforced because no one is tracking them;
- disputes argued from memory because the record was never assembled.

Every company has a system of record for what it *sold*. None has a system of
record for what it *owes*.

## The product

Oppulence maintains a live, two-sided register of commitments.

Integrations are evidence streams. They append immutable observations to a
durable history. Oppulence extracts the commitments contained in that
evidence, tracks each one to an outcome, and links every claim back to the
message, meeting, or document that created it.

The first experience is the **Commitment Register**:

- **What we owe them** — every obligation this company has made, to whom, by
  when, and its current state;
- **What they owe us** — every obligation made to this company by customers,
  vendors, and partners;
- **The evidence** — the exact source text that created each commitment;
- **The owner** — who made the promise and who is accountable for it;
- **What changed** — new commitments, silent slippage, quiet renegotiation;
- **What needs action now** — obligations at risk, in priority order.

Every commitment is citable. A record can be exported and survive being
forwarded to a customer, an executive, or counsel.

There is no opaque score. A commitment is either open, met, at risk, missed,
renegotiated, or waived — and each state is backed by evidence and correctable
by a human.

## Why an independent ledger

The value of this record depends on neutrality.

A commitment ledger must span both sides of a relationship and all the systems
where obligations are created. A CRM vendor cannot credibly attest to whether
obligations recorded in its own CRM were met, and cannot observe a
counterparty's systems at all. A productivity suite owns one evidence stream
and avoids products that manufacture discoverable, liability-bearing records.

Independence is not a market position we chose. It is a requirement of the
product, and it disqualifies the platforms that would otherwise be the obvious
builders.

## The operating loop

**Observe → Extract → Track → Explain → Recommend → Approve → Act → Learn**

1. **Observe** — Gmail, Calendar, Slack, HubSpot, meetings, notes, voice,
   documents, and desktop context emit immutable, provenance-bearing
   observations.
2. **Extract** — explicit source facts, deterministic rules, AI inference, and
   user corrections produce candidate commitments with an owner, a
   counterparty, and a due condition.
3. **Track** — deterministic code owns each commitment's canonical state
   through to an outcome.
4. **Explain** — every commitment and state change links to the evidence that
   created it.
5. **Recommend** — Oppulence surfaces the obligation most at risk and the
   safest valuable next action.
6. **Approve** — external actions wait for a human decision.
7. **Act** — approved email, Slack, and CRM actions execute idempotently and
   are audited.
8. **Learn** — replies, meetings, corrections, and outcomes update the same
   commitment history.

## Two clients

| Web                                                                                  | Desktop                                                                                                                          |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Portfolio review, register across accounts, ownership, approvals, and export.        | The same register and workflows, plus ambient context, meeting capture, voice notes, local documents, and native execution.       |

The desktop is not a secondary viewer. Commitments are frequently created in
conversation, so a high-fidelity observation node close to the work captures
obligations the cloud never sees.

## Initial customer and boundary

The first buyer is a **founder-led B2B team, 5–30 people, selling something
with a delivery obligation**: implementation, onboarding, integration, or
ongoing service. Their promises have consequences, and the person who made
them is not the person who has to keep them.

The qualifying question is not "how big are your deals." It is: *"What did you
promise a customer last quarter that your team found out about late?"*

Oppulence does not replace the CRM, the ticket queue, or the contract
repository. Those remain authoritative for their records. Oppulence owns the
longitudinal commitment history and the evidence explaining what is owed, by
whom, and what should happen next.

Formal contractual obligations are in scope as evidence, but Oppulence is not
a CLM and does not provide legal advice. Its subject is the far larger body of
operational promises made outside the contract.

## Defensibility

Extraction and summarization are commodities. The compounding asset is the
permissioned history connecting:

> evidence → commitment → owner → state change → recommendation → human
> decision → execution → outcome

Each correction improves extraction. Each approved or rejected recommendation
teaches the system how this company operates. Each closed obligation makes the
next assessment more accurate.

A competitor can copy the feature. It cannot reconstruct a customer's
governed, two-sided, evidence-linked obligation history — and if it is a
system of record vendor, it cannot credibly hold that history at all.

## Product discipline

- AI proposes commitments; deterministic code owns canonical state.
- No commitment is asserted without a citation to its source evidence.
- User corrections outrank source facts, derivations, and AI inference.
- Ambiguous identities require review and never auto-merge.
- Raw evidence is encrypted and tenant-isolated.
- Every external action is approval-gated and audited.
- Relationship health is a projection over commitment history, not the
  category.
- Neither web nor desktop ships a core commitment workflow alone.

## The platform it becomes

Commitments are universal, and the same engine points at different entities:

| Ledger        | Obligation tracked                                    | Buyer      |
| ------------- | ----------------------------------------------------- | ---------- |
| **Customer**  | What we promised in the deal, onboarding, and QBR      | Founder/CRO |
| **Vendor**    | What our suppliers promised us, and what we can recover | COO/Finance |
| **Internal**  | Cross-team dependencies and handoffs                   | COO         |
| **Regulatory** | Attestations, controls, and retention commitments     | GC/Compliance |

Customer commitments ship first. The others are the same loop pointed
elsewhere, and each one requires the neutrality that platform vendors cannot
offer.

## Success

The first proof is not the number of commitments extracted. It is whether a
team can open the register and trust the answer to four questions:

1. What did we promise, and to whom?
2. What was promised to us?
3. What evidence proves it?
4. What is at risk right now?

If Oppulence can maintain those answers accurately over time, it becomes the
commitment ledger that every business operates without and none can currently
produce.
