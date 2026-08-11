# What Survives When Intelligence Is Free

**A defensibility plan for Oppulence, 2026–2036**

> Draft for discussion · 10 August 2026 · Grounded in the current codebase

A plan for staying differentiated through 2036, on the assumption that every
model-layer capability we have today becomes a commodity someone can rebuild in
a weekend.

---

## 1. The bet: stop selling intelligence, start selling accountability

Within five years, drafting a good reply, classifying a thread, summarizing a
meeting, and searching semantically will all be free, instant, and available in
every product a person already pays for. None of those are a moat now, and
pretending otherwise is the fastest way to lose the decade.

> **The thesis**
>
> In 2031 everyone will have an assistant that can draft the email. The one that
> wins is the one you would let _send_ it without reading first — and that is a
> question about evidence, calibration, and reversibility, not about
> intelligence.

Permission to act is the scarce thing. It is earned through four properties,
none of which is prompting, which is precisely why they resist
commoditization:

- **Provenance** — why did it say that
- **Calibrated refusal** — it declines rather than guesses
- **Reversibility** — a full audit trail and an undo
- **Accumulated correction** — it learned _your_ judgment, not a generic preference

We have unusual permission to make this bet because we already started. The
provenance ladder —
`user_correction > source_fact > deterministic > external_research > ai_inference`
— puts human correction structurally above model output. That single ordering is
the most valuable design decision in the codebase, and most of this plan is
about taking it seriously everywhere instead of in one subsystem.

| Assume zero moat by 2031 | Compounds instead |
| --- | --- |
| Summarization, drafting, extraction, classification | Signal nobody else can capture |
| Semantic search and RAG | State the user has corrected over years |
| Chat as an interface | Provenance strong enough to act on |
| Tool-use and agent loops | Earned rights to take real actions |
| Model quality itself | Cost structure that doesn't scale with data |

---

## 2. Evidence: what the codebase already tells us

The strategy below is not derived from a market thesis. It is derived from
specific things that are true about this system right now — several of which are
quietly load-bearing, and several of which are quietly rotting.

| What is true today | What it means for 2036 |
| --- | --- |
| Per-field citations were written to the database, migrated, and enforced — but never exposed through the API or desktop types. The feature existed and was worth nothing. | Provenance decays into decoration unless it has a surface. Make it a rule: **no provenance field ships without a place a user can see it.** |
| The provenance ladder is duplicated in Go and TypeScript. It has already drifted twice — once missing `external_research` in the TS authority map, caught by CI rather than review. | The trust primitive is our most valuable asset and it is maintained by hand in two languages. **Generate it from one source** before it drifts somewhere CI cannot see. |
| Adding one model required three files to agree: desktop defaults, the gateway pricing table, and the production allowlist. The allowlist contained no Gemini model at all, so the change would have 403'd every signed-in user. | Model portability is claimed but not structural. When model prices fall 10× again, the winner is whoever can switch in a day. **One registry, generated outward.** |
| Cost scales with mailbox size, not engagement. Email labelling runs per thread, note tagging per note, live notes on a schedule — none of it user-initiated. A dormant account with 800 threads costs real money. | The unit economics are inverted, and inverted economics do not survive scale. This is the **single most urgent structural problem** in the plan. |
| On-device embeddings already work — MiniLM, 384 dimensions, running locally with no network call. | The hard part of the on-device path is already built and proven. Extending it to classification is an increment, not a research project. |
| Meeting capture runs through a Swift sidecar doing dual-track mic and system-audio recording, locally. | This is the one thing here a competitor cannot prompt their way to. **Proprietary signal capture is the deepest moat we own.** |
| The gateway falls back to the Sonnet rate for any unpriced model, and performs no validation at all when the allowlist is unset. | Metering governance is one config flag away from silently mispricing every call. Trust infrastructure must include _our own_ books. |
| Cloud research gates on capability, then plan, then consent, and refuses with explicit codes (`plan_required`, `consent_required`) rather than failing vaguely. | Legible refusal is already a house style. Extend it from one feature to **every action the system can take.** |
| Oversized vendor input is refused rather than truncated; citation URLs carrying userinfo are rejected rather than displayed. | There is a real engineering culture of refusing to fabricate. That culture is an asset — write it down before it dilutes with headcount. |

---

## 3. The plan: three horizons

Ordered by time because the dependencies are real — nothing in the later
horizons works without the foundations in the first.

### Horizon 1 · 0–12 months — Make the moat real instead of latent

Everything here already half-exists. The work is finishing it so it becomes
something a competitor would have to rebuild rather than something we could lose
in a refactor.

1. **One source of truth for provenance.** The ladder becomes a generated
   artifact consumed by Go and TypeScript. It cannot drift because it cannot be
   edited twice.
   _Kills a whole class of silent trust bugs, one of which already shipped._

2. **Every claim answers "how do you know?" in one click.** Source, excerpt,
   confidence, and what would change the answer — on every surfaced fact, not
   just research output.
   _This is the product. It is currently an implementation detail._

3. **Move high-volume inference on-device.** Classification and tagging run
   locally by default; the cloud model becomes an escalation path for hard
   cases, not the default path.
   _Fixes the inverted economics permanently and turns privacy into a true
   statement rather than a policy._

4. **A single model registry.** Defaults, pricing, and allowlist generated from
   one declaration, with the vendor-list guard extended to catch missing entries
   rather than only underpriced ones.
   _Converts model-price collapse from a migration into a config change._

5. **Corrections become first-class events.** Every user correction is durable,
   visible, attributable, and demonstrably changes future behaviour.
   _This is the asset that compounds. Today it is a value in a ladder, not a
   system._

### Horizon 2 · 1–3 years — Compound what cannot be copied

With the foundations in place, widen the two gaps a competitor cannot close with
a better model: what we can see, and what we have earned the right to do.

6. **Widen proprietary capture.** Meetings today; ambient work context, local
   documents, and cross-application signal next. The bet is on signal that never
   transits a third-party API.
   _Everything reachable through a public API is available to every competitor
   at the same price._

7. **Ship a decision ledger.** Every action the system takes or proposes records
   what it did, why, on which evidence, who approved it, and how to reverse it.
   _The audit trail is the artifact that makes autonomy sellable to a company
   rather than an individual._

8. **Earned autonomy.** Permission is graduated and calibration-based: the
   system demonstrates accuracy in a category over time, and only then is
   offered the right to act unattended in it.
   _Turns accuracy into a visible, compounding privilege instead of an invisible
   quality bar._

9. **Break single-provider dependency.** Any mailbox, any calendar, any
   conferencing tool. No integration is allowed to be structurally
   irreplaceable.
   _Direct mitigation of the platform risk below. Gmail-only is a business
   someone else controls._

10. **Make export a feature we advertise.** Full, legible extraction of a user's
    graph, corrections, and ledger.
    _Counterintuitive but correct: the accumulated asset is only worth trusting
    if leaving is possible._

### Horizon 3 · 3–10 years — Be the system of record for AI-assisted decisions

The end state: when a person or a company needs to show how a decision was
reached, the answer lives here. That position is defensible in a way model
quality never is.

11. **Accountability as compliance.** When AI-assisted decisions require
    documented provenance — in some jurisdictions and industries this is a
    matter of when — we already produce the artifact as a by-product.
    _Regulation becomes a distribution channel rather than a cost._

12. **Personal ground truth as the durable asset.** Years of corrected, verified
    state about a person's relationships, commitments, and judgment. Not
    transferable, not scrapeable, not reconstructible from a model.
    _The only asset here that a frontier lab cannot buy its way past._

13. **On-device by default, cloud by escalation.** Near-zero marginal cost per
    user, with cloud reserved for genuinely hard work the user has consented to.
    _Decouples gross margin from data volume for good._

---

## 4. Discipline: what to stop doing

Each of these is cheap to start and expensive to unwind.

- **Do not compete on model quality.** That race is capital-intensive and we are
  not the ones with the capital. Be the best consumer of whatever is cheapest
  and best that quarter.
- **Do not let chat become the primary surface.** A chat box is the most
  commoditized interface in software. Our surfaces should be the queue, the
  ledger, the graph — places where accumulated state is visible.
- **Do not ship provenance that nothing surfaces.** We have done this once
  already. It is worse than not building it, because it creates the belief that
  the problem is handled.
- **Do not accept per-user cost that scales with data volume.** Treat it as a
  launch blocker, not a finance problem.
- **Do not take a dependency without a second source.** Any single provider that
  can revoke access is a decision someone outside the company gets to make about
  our product.

---

## 5. Honesty: what this plan does not solve

A plan that claims to close every risk is a plan that has not been examined.

### Platform bundling — the existential one

Google and Microsoft can bundle 80% of this into Workspace and 365 at no
marginal price. No amount of provenance engineering changes that arithmetic. The
only real mitigations are the ones already in the plan — signal they do not
capture, state they do not hold, and being the layer above providers rather than
inside one — and they are mitigations, not answers. **This should be revisited
explicitly every year rather than assumed away.**

### The rest

- **Compounding assets reset on churn.** Everything durable here assumes
  retention. A user who leaves at month four has accumulated nothing, so
  early-life value has to stand on its own merits before the moat exists.
- **On-device is a treadmill.** Local models must be re-evaluated continuously
  as capability moves. It is a permanent investment, not a one-off migration.
- **Regulation may cut the other way.** Mandated cloud-side auditability would
  penalise a local-first architecture. The decision ledger should be designed so
  it can be attested remotely without the underlying data leaving.
- **Provenance has a ceiling of usefulness.** Most users will never click
  through to a source. Its value is in what it enables — earned autonomy,
  enterprise sale, dispute resolution — not in daily engagement. Do not measure
  it by clicks.

---

## 6. Instrumentation: how we would know it is working

Leading indicators, chosen because each one degrades quietly if nobody watches
it.

| Indicator | Target | Where it stands |
| --- | --- | --- |
| Surfaced claims with a one-click source | 100% | Partial · Horizon 1 target |
| Inference running on-device | 90% | Embeddings only today |
| Cost per user as mailbox size grows | Flat | Rises linearly today |
| Time to switch the default model | < 1 day | Three files must agree today |
| Correction rate per user over tenure | Declining | Proves the system is learning |
| Autonomous actions with a reversible ledger entry | 100% | Precondition for enterprise |

---

## Notes on status

Every claim in the evidence table (§2) is drawn from the current codebase rather
than from market analysis. The horizons (§3) and risks (§5) are argument and
should be treated as such.

The most urgent item is the inverted unit economics — it is the one problem here
that gets structurally harder with every user we add.

A formatted version of this document is published at
`https://claude.ai/code/artifact/712628d0-d174-4fe2-97e0-353dcad92482`.
