# Oppulence — Relationship Intelligence for Customer-Facing Teams

**Oppulence maintains an accurate, living model of every customer relationship and tells the team what needs action.**

_A Playbook Media product · July 2026_

## The problem

Relationship state is fragmented.

Email knows what was said. Calendar knows what was scheduled. Slack knows what
changed informally. The CRM knows the declared stage. Meeting notes know what
was promised. Individual teammates know the rest.

Every tool owns a slice, but no system owns the relationship. The result is not
merely missed follow-up. Teams act from stale state: a champion changed roles,
an objection was never resolved, an onboarding promise is late, or a healthy
customer has quietly become a renewal risk.

## The product

Oppulence models customer relationships directly.

Integrations are evidence streams. They append observations to a durable
account history. Oppulence reconciles those observations into an explainable
state: lifecycle, engagement, sentiment, health, participants, commitments,
risks, milestones, and the next recommended action.

The first experience is **Account Mission Control**:

- what the relationship is now;
- what changed since the last review;
- the evidence supporting every material claim;
- which commitments and risks remain open;
- who matters and what role they play;
- what action should happen next;
- whether each source is connected and current.

There is no opaque relationship score. Health is qualitative, evidence-backed,
and correctable.

## Two equal clients

| Web                                                                                           | Desktop                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portfolio review, team coordination, account mission control, approvals, and broad questions. | The same account state and workflows, plus ambient context, local knowledge, meeting capture, voice notes, browser context, and native execution. |

Web and desktop are at capability parity for relationship work. Platform-native
affordances differ, but state, evidence, corrections, recommendations, and
approvals synchronize through the same backend.

The desktop is not a secondary viewer. It is a high-value observation and
action node: the account being viewed can become assistant context, a recorded
meeting can become evidence, and an approved action can execute through the
native workspace.

## The operating loop

**Observe → Assert → Project → Explain → Recommend → Approve → Act → Learn**

1. **Observe** — Gmail, Calendar, Slack, HubSpot, meetings, notes, voice, and
   desktop context emit immutable observations.
2. **Assert** — explicit source facts, deterministic rules, AI inferences, and
   user corrections become provenance-bearing claims.
3. **Project** — deterministic code produces the current relationship state.
4. **Explain** — every state and change links to supporting evidence.
5. **Recommend** — Oppulence proposes the safest valuable next action.
6. **Approve** — external actions wait for a human decision.
7. **Act** — approved email, Slack, and CRM actions execute idempotently.
8. **Learn** — replies, meetings, edits, corrections, and outcomes update the
   same relationship history.

## Initial customer and boundary

The first buyer is a customer-facing team that manages valuable relationships
across fragmented systems: founder-led sales, account management, customer
success, partnerships, and high-touch services.

V1 models customer accounts from prospect through former customer. It is not a
general social graph and it does not replace the CRM. The CRM remains
authoritative for its records; Oppulence owns the longitudinal relationship
state and the evidence explaining what should happen next.

## Defensibility

Summaries and drafts are commodities. The compounding asset is the permissioned
history connecting:

> evidence → assertion → state change → commitment → recommendation → human
> decision → execution → outcome

Each correction improves the relationship model. Each approved or rejected
recommendation teaches the system how the team operates. Each outcome makes the
next recommendation more useful. A competitor can copy a feature; it cannot
reconstruct that longitudinal, governed history.

## Product discipline

- AI proposes assertions; deterministic code owns canonical state.
- User corrections outrank source facts, derivations, and AI inference.
- Ambiguous identities require review and never auto-merge.
- Raw evidence is encrypted and tenant-isolated.
- Every external action is approval-gated and audited.
- Revenue recovery is a detector over relationship state, not the category.
- Neither web nor desktop ships a core relationship workflow alone.

## Success

The first proof is not the number of summaries generated. It is whether a team
can open an account and trust the answer to four questions:

1. What is the state of this relationship?
2. What changed?
3. What evidence supports that?
4. What needs action now?

If Oppulence can maintain those answers more accurately over time, it becomes
the relationship intelligence layer that customer-facing work currently lacks.
