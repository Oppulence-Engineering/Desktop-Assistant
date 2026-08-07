# RFC 039 — Research Mode: local by default, Parallel-backed when paid

> **Status: implemented.** See [Implementation](#implementation) for what shipped,
> where the code lives, and the three places the build departed from this draft.

## Context

The desktop builds relationship intelligence from **owned data only** — signatures, headers, transcripts, calendar. That was a deliberate choice, recorded in the enrichment plan as "no vendors", and it is why the product can say relationship content stays on the machine.

The cost of that choice is a ceiling. A `Person` has `title`, `org_name`, `org_domain`, `timezone` — all inferable only if someone happened to put them in an email signature. A `Relationship` has `account_domain` and a lifecycle, and nothing about the company behind it. The product knows who you talked to and can say nothing about who they are.

This proposes lifting that ceiling for users who pay, without moving it for users who do not.

**Two things make Parallel the right vendor here specifically**, and both are structural rather than preference:

1. **It returns evidence, not prose.** The Task API's `basis` is per-field: `{ field, citations[{title, url, excerpts[]}], reasoning, confidence }`. This codebase refuses facts without evidence — `EvidenceRefs` on assertions, a provenance ladder, retraction. An LLM summarising search results produces `ai_inference` with nothing to cite. Parallel produces something the ledger can actually hold.
2. **`PersonAttribute` already is the target table.** It has `dimension`, `source_type`, `source`, `extractor`, `extractor_version`, `confidence`, `observed_at`, `valid_from`/`valid_to`, `retracted_at`, `supersedes_attribute_id`. Parallel's basis maps onto it close to 1:1.

   An earlier draft of this document claimed that made it "an integration, not a schema redesign." That was wrong, and it mattered, because it made the work look cheaper than it is. The shape fits; the **enums do not**. `source_type` is a closed `oneOfRevenue` validator on *two* tables (`PersonAttribute` and `RelationshipAssertion`), `dimension` and `extractor` are closed on `PersonAttribute`, and citations have nowhere to live. Every one of those is an ent schema change plus codegen. That is a normal day's work in this codebase — the departure signal shipped exactly that way — but it should be planned, not discovered.

**Intended outcome:** a paid user can enrich every person and account they have, and every enriched field carries a URL you can click and a confidence you can argue with.

## Costs (published, 2026-08)

| Surface | Price | Unit |
| --- | --- | --- |
| Task `lite` | $5 / 1k | ~2 fields |
| Task `base` | $10 / 1k | ~5 fields |
| Task `core` | $25 / 1k | ~10 fields |
| Search `turbo` | $1 / 1k | request |
| Extract | $1 / 1k | URL |
| Monitor `lite` | $3 / 1k | execution |

Enriching 500 people at `base` ≈ **$5**. Monitoring 50 accounts daily at `lite` ≈ **$4.50/month**. Failed runs are not billed.

Note this *reduces* LLM spend where it replaces the web-search agent loop: one task instead of the ~16 gateway round trips an agent tool loop costs today.

## The mode

Modelled on transcription, which already ships "On-device (Whisper)" vs "Cloud (Deepgram)". Users have seen this control; it should look the same.

| Mode | Behaviour |
| --- | --- |
| **Local** — default, all plans | Today exactly. Owned signals only. Nothing about a counterparty leaves the device. |
| **Cloud** — `intelligence` plan | Adds Parallel enrichment, monitoring and research. Writes `external_research` assertions with citations. |

### Gating reuses what exists

- **Capability**: add `CapabilityCloudResearch` to `internal/revenue/release_controls.go`, beside `CapabilityGoogleSource`. `ErrCapabilityDisabled` and the workspace-entitlement plumbing already exist.
- **Plan**: the Stripe integration already distinguishes `starter` and `pro` (`internal/billing/stripe.go`). Cloud mode requires the new `intelligence` plan — see [Recommendation](#recommendation-a-new-tier-not-a-higher-chase), which supersedes the `pro` gate this section originally proposed.
- **Kill switch**: the same release-control path already supports disabling a capability fleet-wide, which matters for a vendor that can have an outage or a price change.

Gate on the **server**, not the client. The desktop asking politely is not a gate; the API key lives server-side and the capability check belongs next to it.

## Consent — the part that is not negotiable

Cloud mode sends a counterparty's name or domain to a third party. That person is **not your user** and did not agree to anything. This is categorically different from `emailMetadata`, where the data subject is the person who flipped the switch.

- New flag in `RelationshipEvidenceSettings`, default **false**, independent of the mode toggle. Turning on cloud mode must not turn on enrichment.
- Copy names the vendor and states exactly what is sent: *"Sends the person's name, email domain and employer to Parallel Web to look up public professional information. Never sends message content, transcripts or notes."*
- A workspace-level opt-out that a user can set once for every counterparty, not per person.

Given this session found a privacy switch that had done nothing for months, **the flag ships and is tested before the first API call exists.**

## Architecture

All Parallel traffic goes through `rowboat-api`. The desktop never holds the key, exactly as with the LLM gateway.

```
desktop ──IPC──▶ main ──bearer──▶ rowboat-api /v1/research/* ──▶ api.parallel.ai
                                        │
                                   capability + plan check
                                   credit reservation
                                   PersonAttribute / RelationshipAssertion writes
```

### New provenance tier

Add `external_research` to the source-type ladder:

```
user_correction > source_fact > deterministic > external_research > ai_inference
```

Above `ai_inference` because it carries citations. Below `deterministic` because a vendor's read of a web page is weaker than something computed from data you own. A user correction always wins.

(The tier is `deterministic`. An earlier draft called it `deterministic_rule`, which is not a value the validator accepts — worth stating because the ladder is also implemented as a `switch` in `assertionPriority`, whose `default` returns `1`. A tier name that does not match silently becomes the weakest thing in the system rather than failing loudly.)

### Storage

Enrichment writes `PersonAttribute` rows — no new table:

| Parallel `basis` | Column |
| --- | --- |
| `field` | `dimension` |
| `confidence` | `confidence` (map `high`/`medium`/`low` → 0.85/0.6/0.35) |
| — | `source_type` = `external_research` |
| — | `extractor` = `parallel`, `extractor_version` = processor + task-spec hash |
| `citations[].url` + `excerpts` | new `citations` JSON column, or `evidence_refs` if the shape fits |

The one schema change is somewhere to keep citations. Everything else exists.

## Surfaces, in the order I would build them

The framing that ranks these: **the product knows who you talked to and when, and nothing about what is happening to those people in the world.** Every signal it has is retrospective and internal. That is the ceiling, and each surface below is judged by how much of it it lifts — not by how interesting the data is.

A surface earns its place here only if it satisfies four tests. The product currently says nothing or says something weak. The missing input is genuinely external. Being wrong is checkable by clicking a citation. And it changes what the user **does**, not merely what they read.

### 1. Trigger-based outreach — turn the attention queue from a nag list into a "why now" list

The highest-value surface, and the cheapest to build, because the surface already exists and this is one more detector in it.

Today `quiet_account` says *"No recorded interaction for 47 days; the renewal lifecycle cooldown is 7 days."* That is a reminder, not a reason. Nobody replies to an email because it has been 47 days. They reply because something happened: the company raised, launched, got acquired, started hiring for the role the product serves; the person was promoted.

A `Monitor` per account at `lite`, feeding a new `external_trigger` reason code alongside the seven in `relationship_attention.go`:

```
external_trigger → "Acme announced a Series B on Tuesday.
                    Your last contact there was their VP Eng. [source]"
```

It slots into `attentionCandidate` exactly like the existing detectors — `TriggeringObjectRef`, `EvidenceRefs`, `RankScore`, `UrgencyBand` — and inherits the whole acknowledge/snooze/dismiss contract, the capability gate, and the projection/material-hash logic for free. ~50 accounts polled daily is about **$4.50/month**.

The user-visible change is a queue you act on rather than one you dismiss.

### 2. Departed-contact recovery

The natural sequel to the departure signal, which detects that a contact has left but can say nothing about what to do next.

*"Sarah left"* is not the user's problem. **"I now have nobody at Acme"** is. Owned data can never answer the follow-up, and there are two, both high-precision because there is a real anchor to resolve against — a name, a former employer, and a verified domain:

- **Where did she go?** She is at Globex now, which is a warm introduction into a *new* account — frequently worth more than the relationship that was lost.
- **Who replaced her?** Names the person to re-enter the existing account with.

Job changes are simultaneously the largest single cause of churn and the largest source of pipeline in any relationship business. The product currently treats one as a loss and cannot see the other at all. The `contact_departed` attention item is the obvious place to surface both.

Worth noting for scoping: this capability alone is the entirety of at least one venture-funded product category. It should not be buried as a sub-bullet of "enrichment".

### 3. Meeting prep that knows the outside world

`packages/core/src/pre_built/meeting-prep.md` declares its tools in frontmatter and they are, in full: `file-readText`, `file-writeText`, `file-list`, `file-mkdir`, `file-exists`, `executeCommand`. **There is no web access at all.** Briefs are assembled entirely from the user's own notes and calendar.

Everything that actually changes how a call goes is external: what their company announced this week, whether their title changed since you last spoke, what they have published, what makes the ask timely *today*. One Task `core` call per meeting on the calendar trigger that already fires.

The best value-per-dollar on this list, landing in a surface users already open.

### 4. Account context on a `Relationship`

One Task `core` call per account: industry, size, funding, recent material events. Renders in the Accounts view where there is currently nothing. Lower than the three above because it is reference material — it informs a user who is already looking, rather than telling them to look.

### 5. Externally verifiable commitments

Commitments are extracted from the user's own conversations and confirmed by the user. Some are checkable from outside: *"they said they would launch in Q3"*, *"they said the round closes this month"*. `Monitor` can report whether it actually happened.

This is the line between a task list and an intelligence product: the system knowing something the user did not tell it.

### 6. Health that distinguishes your fault from theirs

`rel.Health` and `rel.Risks` are computed from interaction patterns. An account that went quiet after layoffs or an acquisition is a completely different situation from one that went quiet because the user dropped the ball — and today the two are indistinguishable and receive identical advice.

### 7. Person enrichment in bulk

Title, employer, seniority, location. `base` processor, one per person. This is where "enrich everything" lives: a bulk action over every `Person` in the workspace via the Task **Group** API (`POST /v1/tasks/groups/{id}/runs` with an `inputs` array, results streamed back over SSE with `last_event_id` for resumption).

Deliberately *below* the trigger surfaces. Enriched fields are pleasant; triggers change behaviour. Build the thing that makes the user act before the thing that makes the profile look complete.

### 8. Inbound triage on first contact

When a new external person emails, the product knows only the domain. Buyer, vendor pitch, recruiter, or student? `sender-profiles.ts` already classifies newsletter and cold-email locally; this extends it — but **only** for first-time senders that clear the reply-worthy threshold, which bounds both the cost and the consent surface.

### 9. Replace the `web.search` agent loop

`internal/websearch/websearch.go` is a minimal Tavily-shaped client (`POST {api_key, query, max_results}`), operator-pointed via `WEB_SEARCH_API_URL`. Swapping to Parallel Search gives excerpts already optimised for a model and collapses the agent tool loop.

Real, but it is a **cost** story rather than a value story, which is why it ranks here and not higher.

### 10. FindAll / Entity Search — deliberately last, and possibly never

Prospecting a list of companies is a different product from understanding relationships you already have, and shipping it would change what this is.

There is a narrower version that does belong: **"who else at this account should I know?"** — org mapping around a relationship that already exists. That is still about the user's own graph, and it is the honest half of this capability.

### The failure mode to design against first

**Entity resolution attaching facts to the wrong person.** "Sarah Chen" is not unique. Anchor on verified domain plus name, and **reject** low-confidence matches rather than storing them at low confidence.

This is the same lesson the departure signal forced and it is worth restating because it will recur with every external source: a false positive that retires a live contact — or attributes a stranger's job history to a real one — is worse than never having run the query. Silence is an acceptable output. A confident wrong answer is not.

## Bulk enrichment: "everything"

The Group API is the right shape, but a bulk action over an entire workspace needs care that a single call does not:

- **A cost estimate before it runs.** "Enrich 412 people — about $4.12" with a confirm. Not a spinner and a bill.
- **Chunked submission and resumable streaming.** `last_event_id` exists precisely for a desktop that sleeps mid-run.
- **Credit reservation up front** through the existing `quota.Gate`, so a bulk run cannot exceed a spend cap mid-flight.
- **Idempotency per person + task-spec version**, so a re-run after a crash does not pay twice for the same field.
- **A published concurrency cap on our side.** Parallel documents no batch limit and 429s exist; the desktop already has `p-queue` pacing for exactly this class of problem and the same approach applies.

## Pricing

### What exists today

| Plan | Price | Promise |
| --- | --- | --- |
| **Watch** | Free | Weekly slip report — deals, invoices and clients going quiet |
| **Chase** | **$99/mo** | Drafted nudges in your voice, approve/edit/snooze/reject, verified sends, monthly recovery receipt |
| **Teams** | Talk to us | Shared queue, roles, audit trail |

Defined in `apps/rowboat-www/app/(marketing)/marketing-data.ts`; Stripe carries `starter` and `pro` price IDs. The marketing copy promises *"priced on executed chases, not seats or email volume"*, which the flat $99 does not currently deliver — a pre-existing tension, discussed under [On outcome-based pricing](#on-outcome-based-pricing-do-not-extend-it-here) below.

### What this actually costs to serve

Credits are `$0.0001` each (`internal/pricing`), the per-user monthly ceiling is 2,000,000 credits — **$200** — and `gpt-4.1-mini` is billed through at cost (4/16 credits per 1K). So LLM spend is already an unmarked pass-through, and Parallel lands on top of it.

A well-used single seat with cloud mode on:

| Surface | Volume | Cost |
| --- | --- | --- |
| Account triggers, 50 accounts daily @ Task `lite` | 1,500 runs | $7.50 |
| Meeting prep, 20 meetings @ `core` | 20 | $0.50 |
| Person enrichment, 300 people @ `base`, one-off | 300 | $3.00 |
| Departure recovery, ~5/mo @ `base` | 5 | $0.05 |
| Ad-hoc Search in copilot | 200 | $0.20 |
| | | **≈ $11/month** |

Against $99 that is ~11% of revenue: meaningful, not structural. (The trigger
line is Task `lite` rather than Monitor `lite` — $5/1k against $3/1k — which is
the price of the Monitor departure recorded under [Implementation](#implementation).) The tail is where it breaks — 5,000 people enriched at `base` is $50 in one action, and 500 monitored accounts is $45/month. Bulk needs the cost estimate, confirmation and credit reservation described above; that is a correctness requirement, not a nicety.

Note the offset: replacing the agent web-search loop *reduces* LLM spend, so net marginal cost is lower than the table suggests.

### Recommendation: a new tier, not a higher `Chase`

**Do not raise the price of `Chase`, and do not meter research to the user.**

The decisive argument is not margin, it is consent. Cloud research is gated behind a flag that is off by default and independent of the mode toggle, precisely because it sends a **counterparty's** details to a vendor. A meaningful fraction of users will deliberately never enable it. Charging those users more for a capability they have switched off on privacy grounds is indefensible, and it would poison the consent story that makes the feature shippable at all.

Metering is the other trap. Every high-value surface above is **background** — triggers fire while the user is asleep. A meter on background work means the user is absent at the moment of spend and present only for the bill, so they turn it off, and the feature dies with it. Usage pricing is worst exactly where the value is highest here.

So:

| Plan | Price | Change |
| --- | --- | --- |
| **Watch** | Free | Add job-change alerts on the top 10 contacts — see below |
| **Chase** | $99/mo | Unchanged. Local mode. Existing customers are not repriced. |
| **Intelligence** | **$249/mo** | Cloud research: triggers, departed-contact recovery, enriched meeting prep, external commitment verification |
| **Teams** | Talk to us | Unchanged |

**Why $249.** At ~$8–10 marginal cost it holds ~96% gross margin with room for heavy users. At 2.5× `Chase` it prices a change of category rather than a feature: `Chase` is a better follow-up reminder, `Intelligence` is an account intelligence system that tells you *why today*. And it sits well below the signal-selling and job-change-tracking tools it would compete with, several of which sell a strict subset of surfaces 1–2 for four figures a month — while none of them have the owned-data graph this sits on top of.

**Guard rails, expressed in product terms and never in credits.** "Up to 250 monitored accounts", "unlimited enrichment of people you already correspond with". Enforced server-side through the existing `quota.Gate` reservation, surfaced to the user as a plan limit rather than a balance.

**Give the free tier one taste: job-change alerts on the top 10 contacts.** A `Monitor` at `lite` on ten people is roughly $0.36/month, and "your champion just moved to a company you don't cover" is the most visceral *I did not know that* moment on this entire list. It is the conversion hook, and it costs approximately nothing.

### On outcome-based pricing: do not extend it here

The pricing page says *"priced on executed chases, not seats or email volume. One saved deal pays for years."* The plan underneath it is a flat $99/month. That gap predates this work, and the tempting move — since `Intelligence` is the moment the pricing gets revisited anyway — is to close it by pricing research on outcomes too.

**Do not.** Outcome pricing needs an outcome you can point at, and the two halves of this product are not alike in that respect.

A chase has one. There is a specific invoice, a specific amount, a send with a receipt, and a payment that either arrives or does not. Attribution is a straight line and the customer will agree with it, which is exactly why the existing promise is credible.

Research has no such line. A trigger says *"they announced a Series B on Tuesday"*; the user writes their own email, has their own conversation, and closes their own deal five weeks later. The value is real and probably larger than the chase — but it is **diffuse, delayed, and jointly produced**. Any attribution rule strong enough to bill on is one the customer can argue with, and *"we found the signal, therefore we are owed a share of the deal"* is a conversation that costs more in goodwill than the invoice is worth. It also reintroduces the metering problem through the back door: the user starts asking which triggers are billable, which is precisely the question that makes them switch the feature off.

So the recommendation stands as written — a flat subscription for research, with limits stated in product terms.

Two honest notes on the gap that leaves:

- **The marketing copy should be reconciled with reality regardless**, independently of this RFC. Either the flat fee is described as a flat fee, or `Chase` genuinely moves to per-executed-chase pricing. Shipping a third tier underneath a claim the first tier does not meet makes the inconsistency more visible, not less.
- **If outcome pricing is wanted anyway**, the defensible version prices the *action*, not the *insight*: a chase executed off a trigger is still an executed chase and can bill as one. That keeps the promise intact and leaves research as what it is — the thing that made the chase worth sending.

## Verification

- **Unit** — basis→attribute mapping, including confidence coercion and a basis entry with zero citations (which must be rejected, not stored at confidence 0).
- **Gate** — a `starter` plan gets `ErrCapabilityDisabled`; consent off blocks the call even on `pro`; both asserted server-side with the client lying about its state.
- **Provenance** — a `user_correction` beats an `external_research` assertion for the same dimension; re-running enrichment supersedes rather than duplicates.
- **Cost** — a bulk run against a mock reserves credits before submitting and refunds on failure.
- **End-to-end** — against a real key on a throwaway workspace: enrich one person, click the citation, confirm it supports the claim. A citation that does not support its field is the failure mode that matters and no unit test will catch it.

## Open questions

1. ~~**Is `pro` the right gate, or is this a separate add-on?**~~ **Answered above:** a new `Intelligence` tier at $249/mo, because cloud research is consent-gated and users who decline it on privacy grounds must not be repriced for it. Margin was never the deciding factor — at ~$8/seat/month it is comfortable either way. What remains open is whether `Teams` includes `Intelligence` by default or stacks on top of it.
2. **Do enriched fields sync to the cloud graph, or stay local?** They are about third parties; the answer differs from first-party evidence and the current consent copy does not cover it.
3. **Retention.** Public professional data still ages. A `valid_to` policy for `external_research` attributes — 90 days? — versus keeping them until contradicted.

## Implementation

Shipped on `feat/parallel-research-mode`. This section is the map from the
argument above to the code, and the honest record of where the build departed
from the draft.

### What exists

| Piece | Where |
| --- | --- |
| Vendor client (Task API, basis, citations) | `apps/rowboat-api/internal/parallel/` |
| Provenance tier + citations columns | `ent/schema/{person_attribute,relationship_assertion}.go` |
| Ladder | `internal/revenue/relationship_state.go` — `assertionPriority` |
| Consent + the three gates | `internal/revenue/research_consent.go` |
| Person enrichment, basis→attribute mapping, bulk estimate | `internal/revenue/research.go` |
| Trigger surface + daily sweep | `internal/revenue/research_triggers.go` |
| `external_trigger` detector | `internal/revenue/relationship_attention.go` |
| HTTP surface | `internal/revenue/handler_research.go` — `/v1/research/*` |
| Desktop consent switch and bulk run | `apps/x/apps/renderer/src/components/settings/transcription-settings.tsx` |
| Privacy receipt | `apps/x/apps/renderer/src/components/settings/privacy-settings.tsx` |
| `Intelligence` tier | `apps/rowboat-www/app/(marketing)/marketing-data.ts`, `internal/billing/stripe.go` |
| Schema record | `apps/rowboat-api/migrations/20260806220000_cloud_research.sql` |

The three gates are separate errors with separate remedies —
`ErrCapabilityDisabled` (an operator re-enables), `ErrResearchPlanRequired` (a
user upgrades), `ErrResearchConsentRequired` (only the user can grant). They are
checked in that order, so a vendor incident stops traffic regardless of what
anyone has bought or agreed to. Consent is checked last and is still the
strongest: it is the only one nobody can grant on the user's behalf.

Consent shipped first, with tests, before the client existed — as this document
demanded. `cloud_research_consent` lives on `RevenueWorkspace`, not only in
desktop config, because the data subject is not the user.

### Where this departs from the draft

1. **The trigger surface is a scheduled Task, not a vendor `Monitor`.** A Monitor
   subscription needs an inbound webhook, its signature verification and a replay
   story, all built against a contract nobody here has exercised against a real
   key. `ResearchTriggerRunner` asks the same question daily through the Task API
   at a comparable price, and shares the reserve/settle path everything else
   already uses. The Monitor product is the optimisation; moving to it changes
   nothing a user sees.
2. **Bulk enrichment is chunked by the client, not streamed over SSE.** The Group
   API with `last_event_id` is the right shape for a durable job runner, and there
   is no durable job runner to put it in. `POST /v1/research/people` takes at most
   25 ids; the desktop walks the pending list and re-sends a failed chunk.
   Idempotency per person + task-spec version makes a resumed run free for
   everyone it already covered, which is the property `last_event_id` was wanted
   for.
3. **The verification bullet "a `starter` plan gets `ErrCapabilityDisabled`" is
   implemented as a distinct `ErrResearchPlanRequired`** returning 402 rather than
   409. The intent — an under-plan caller is refused, and consent-off is refused
   independently — is tested; collapsing a plan problem into "capability disabled"
   would tell a user nothing they can act on.

### Two decisions the draft left implicit

**Silence still settles.** A run where the vendor honestly reports "I could not
identify this person" writes nothing and is still billed to the user, because the
vendor ran and billed us. Refunding silence would make the cheapest possible
answer the one the accounting rewards.

**An unmatched identity discards the whole result, not the weak fields.** Anything
short of a `high` identity match stores nothing at all. "Store it at low
confidence" is precisely how a stranger's job history ends up on a real contact:
a low confidence still wins a dimension nothing else asserts.

### Open questions, updated

1. ~~**Is `pro` the right gate?**~~ Answered: the `intelligence` plan at $249/mo,
   implemented in Stripe and in the marketing page. Whether `Teams` includes it or
   stacks on top is still open.
2. **Do enriched fields sync to the cloud graph, or stay local?** Still open —
   they are written server-side today, since that is where the vendor call
   happens. The consent copy covers what is *sent*; it does not yet say what is
   *retained*, and that gap is real.
3. ~~**Retention.**~~ Answered for triggers only: a trigger carries
   `valid_to = observed + 30 days`, because a funding round announced six weeks
   ago is no longer a reason to write today. Person attributes still have no
   expiry and are kept until contradicted — the question stands for those.

### What three adversarial review passes found

Recorded because the defects are more instructive than the design, and two of
them were the kind that ship silently.

- **Citations were written and read by nothing.** `citations_json` was populated,
  migrated, and enforced — and absent from `personAttributeDTO`, from every
  desktop type, and from every surface. The tier's entire promise ("a URL you can
  click") was unshipped while every test passed, which is exactly the
  fully-built-and-unreachable failure this repo already has a lint-style test
  for. Fixed on the API, and the trigger's source URL now goes into the queue
  item's own sentence, because nothing resolves an assertion evidence ref.
- **The trigger sweep was priced at `core`.** Daily, at the advertised 250-account
  limit, that is ~$187/month against a $249 plan — 75% of revenue, versus the
  ~$4.50 this document budgeted. The task asks two questions, which is what
  `lite` is priced for. A test now pins the per-run credit cost, because this is
  a one-constant mistake with a four-figure annual consequence.
- **The privacy receipt could lie.** Consent granted on one machine left another
  machine's routing receipt reporting "nothing is sent" while the server swept
  daily. The desktop mirror now reconciles to the server on every status read.
- **Two strict `z.enum`s were missing the new values** — the attention reason code
  and the contradiction source type — including one whose own comment claimed it
  was open-ended. It is not.
- **The pending-people query was N+1**, one round trip per contact on an endpoint
  the settings pane opens with.
- **Consent became unwithdrawable if the vendor key was removed**, because the UI
  gated the whole section on the provider being configured.

Two things were left alone deliberately. Revoking consent does not purge already
-stored research attributes, and no copy claims it does — that belongs with open
question 2 on retention. And the `intelligence` credit grant is $500 against a
$249 plan, which is loose, but it matches the existing `pro` convention ($200
against $99) and tightening one tier alone would be arbitrary.

### What three further adversarial passes found

A second round, run under different lenses — concurrency and hostile input,
tenant isolation, and behaviour over time.

- **Nothing bounded the size of a vendor value.** Everything the vendor returns is
  attacker-adjacent, because the task input carries a display name parsed from an
  email signature and whoever sent the mail controls that. The response is capped
  at 8MB by the outbound policy, and with no per-field bound that entire budget
  could land in one `location` cell and then in an attention sentence. Values over
  512 runes are now refused rather than truncated: a truncated value is a claim
  nobody made.
- **The live-trigger lookup grew without limit.** It loaded every research
  milestone a workspace had ever produced and discarded the expired ones in Go, on
  a path that runs on every attention refresh. Now filtered in SQL.
- **The migration repeated a claim this codebase does not support.** It said the
  projector-version bump makes every person reproject "on next read", copying the
  framing of the migration before it. There is no read-path or background
  reprojection here — only write paths call the projector. Corrected, and it turns
  out not to matter: research writes and projects in one call.

Three suspicions were checked and cleared, which is worth recording so the next
reader does not re-derive them. The daily sweep is **replica-safe** — a second
pod's reservation collides on the per-account, per-day idempotency key and skips,
so N replicas cost the same as one. Attention explanations render as **React
text**, so a vendor-supplied URL in the sentence is not an injection vector.
Person deletion already removes `PersonAttribute` rows, so research facts and
their citations leave with the person.

One gap is left open deliberately. Research shares `DAILY_CREDIT_LIMIT` /
`MONTHLY_CREDIT_LIMIT` with all other metered traffic, so heavy LLM use can
consume the cap and the nightly trigger sweep then stops with
`monthly_credit_limit_exceeded`. It logs, and it is alertable, but nothing tells
the *user* that the monitoring they pay for did not run — and "up to 250
monitored accounts" is a promise made in product terms against a budget shared
with something else. Fixing it properly means either a research-specific budget
or a user-facing degradation notice; both are larger than this change.

### Round three: seven passes, one defect

The find rate finally decayed. Six of seven lenses came back clean, which is
reported as such rather than padded.

**The defect.** `usableCitations` accepted a URL carrying userinfo. Two harms,
the second worse than the first: `https://user:secret@acme.example/x` persists a
credential and hands it back to a user to click, and
`https://acme.example@evil.example/x` *reads* as acme.example while resolving to
evil.example — in a string the trigger surface prints verbatim into the sentence
it tells the user to trust. Refused now. A citation to a public page never needs
credentials.

**Cleared, with the reasoning, so nobody re-derives it:**

- *Generated surfaces.* Regenerating ent published `citations_json` to the
  documented OpenAPI schema and `citationsJSON` plus predicate filters to the
  admin GraphQL. Not a leak: the already-`Sensitive()` `value` column sits in the
  same documented schema, no entoas handler is mounted (`api/openapi.json` is
  documentation, not a served surface), and `/graphql` is behind the internal
  secret. Critically, `cloudResearchConsent` is readable and filterable there but
  has **no mutation input** — consent cannot be set through the graph, only
  through the endpoint that enforces `manage_sources`.
- *The billing key.* `personTaskSpecVersion()` is half the idempotency key for
  every charge; if it varied by process or build, a restart would re-bill a whole
  workspace. It is stable because `encoding/json` sorts map keys — now pinned by
  a golden test whose failure message explains that changing it makes every
  enriched person billable again. The trigger key rolls exactly once per UTC day,
  including across a zone difference and a month boundary.
- *The admission table.* Four gates × five entry points, all 16 states now
  asserted, including which refusal wins when several are shut and the invariant
  that nothing reaches the vendor unless every gate is open.
- *Degenerate vendor responses.* Nil results, nil content, basis without content,
  wrong types, a non-string match confidence, duplicate basis entries, fields the
  task never requested, and `javascript:`/`file:`/`data:`/`ftp:` citations all
  produce silence rather than a wrong claim.
- *Ledger algebra.* The op budget counts what was spent, not what was reserved —
  an over-estimating caller does not burn budget on money it never spent.
- *Clocks.* The `time.Now()` fallbacks in the person projector are pre-existing
  and unreachable from research, which always passes the service clock.
- *The desktop contract.* All four research IPC channels and the client outcome
  type match their Go DTOs field for field.

### The manual check this cannot automate

The end-to-end bullet is not covered by any test and must be run by a person
against a real key on a throwaway workspace: enrich one person, click the
citation, confirm the page actually supports the claim. A citation that does not
support its field is the failure mode that matters, and no unit test will catch
it.

## Follow-up: what a second look found

Two research passes after the build — one on the vendor API against its live
docs, one on what any of this does for the person using the product. Every
code-side claim below was verified against the tree; vendor claims are sourced
to `docs.parallel.ai` as of 2026-08-07 and dated, because that surface moves.

### Three things in this document are wrong

1. **"Parallel documents no batch limit and 429s exist"** — it documents both.
   1,000 runs per `POST /v1/tasks/groups/{id}/runs`, and 2,000 Tasks/min with
   GETs excluded from the count.

2. **Departure 1 rests on a constraint that does not exist.** The build chose a
   scheduled Task over a vendor `Monitor` because a Monitor "needs an inbound
   webhook, its signature verification and a replay story." It does not:
   `GET /v1/monitors/{id}/events` is a cursor-paginated poll whose `event_id` is
   documented as safe for client-side dedup across retries. `ResearchTriggerRunner`
   could poll it with no new infrastructure.

   The cost of that mistaken premise is larger than the endpoint. A **snapshot
   monitor** binds to a completed run's `task_run_id`, inherits its processor and
   output schema, and returns `changed_output` — *only the fields that moved,
   each with its own basis* — plus `previous_output`. That is
   `supersedes_attribute_id` semantics arriving pre-computed, against today's
   approach of re-running the whole spec and relying on `dedupe_key` to make it a
   no-op. It is also $3/1k against $10/1k.

3. **The cost table reads `~2 fields` / `~5 fields` as a billing unit.** Billing
   is per run, not per field — the field counts are a capacity guide. `triggerSchema()`
   asks two questions at `lite` and could ask four for no additional cost.

Also, for whoever picks up surface 9: swapping `websearch.go` to Parallel Search
is not a signature-compatible change. `V1SearchRequest` has no `query` field; it
takes `search_queries[]` (3–6 words each) plus an `objective`.

### The defect class this feature keeps reproducing

The review that preceded this RFC found a privacy flag nothing wrote, seven IPC
handlers nothing called, and a delete route nothing mounted. The pattern
survived into the build:

- **`researchSweepErrorText()`** — its own comment calls it "the one sentence a
  user reads." It is written to `LastError` and no research DTO carries it;
  `GET /v1/research/status` does not return it. Nobody reads it.
- **`resultResponse`** decodes `run_id`, `status`, `content`, `basis` and stops.
  `run.warnings` is dropped — including the documented warning that fires when an
  output schema contains `citations`/`confidence`/`reasoning`/`source`, which is
  precisely the drift a contributor adds while chasing more provenance. So the one
  signal that would catch a bad spec is discarded. `error.ref_id` goes with it,
  and it is the only thing that makes a vendor bug reportable.
- **`privacyRoute: "cloud"`** exists in the `RelationshipLiveCue` enum and
  nothing writes it.

A grep for enum values and error strings with no writer or no reader belongs in
this feature's review checklist, permanently.

### Fix before anything else ships

Research reserves against the same `DAILY_CREDIT_LIMIT` / `MONTHLY_CREDIT_LIMIT`
as all other metered traffic. A heavy day of interactive LLM use can therefore
starve the nightly sweep, and "up to 250 monitored accounts" quietly becomes
zero — with the explanation written to a column nobody surfaces.

This product is sold on *you will not miss anything*. **A watchdog that stops
watching without saying so is worse than no watchdog**, because the user has
stopped checking manually on the strength of the promise. Research needs its own
reservation ceiling, and the sweep's last error needs to reach a human.

### A promise on the pricing page with nothing behind it

`marketing-data.ts:1430` sells, on the **free** tier: *"Job-change alerts on your
ten closest contacts."* There is no code that selects a top-N contact set and no
code that checks for a job change. This document proposed that hook and the
marketing shipped ahead of it.

It is also the cheapest thing here — ten people at `lite`, monthly, is about
**$0.05/user/month**. Build it or remove the line; a false claim on a pricing
page is a different category of problem from an unbuilt feature.

### Five surfaces worth more than the ones ranked above

Ordered by value per unit of work. All five reuse task specs that already exist;
together they add **under $0.50/user/month** to the ~$11 already budgeted.

**1. Put the research into the draft, not just the queue.**
`research_triggers.go` already writes a `milestone` assertion with a citation and
a 30-day `valid_to`, and `triggerExplanation()` renders it into the attention
item — and nowhere else. Meanwhile the message the user actually sends comes from
five hardcoded `fmt.Sprintf` templates in `scan.go:556-647` with no LLM and no
research in the path. The last one reads *"it's been a while since \"%s\". Is this
still something worth exploring?"* — a sentence that publicly admits you forgot
someone, which is why those drafts sit unapproved.

The queue knows Acme raised on Tuesday. The email does not. Joining the live
`milestone` assertion to `RevenueAction.proposed_message` is the whole change,
and it costs **zero additional calls**.

This is the strongest item in this document. It is also the one place where
evidence-shaped research earns its premium over a model with a search tool: this
text gets *sent*, over the user's name, to a customer. A model re-searching at
draft time can hallucinate a funding round into a real email. An assertion that
passed `usableCitations()` and carries a `valid_to` can be clicked before
approval. A wrong fact in a dashboard is embarrassing; a wrong fact in a sent
email loses the account.

**2. One line before the call, or nothing.** `home-view.tsx` renders an Up-next
hero with title, time, location, "Take notes", "Join" — and nothing about who you
are meeting or what happened to them. One `lite` Task at **T-2h** (not T-90s: a
run takes tens of seconds and by then you are in the room), anchored on the
external attendee's domain, asking for anything in the last 14 days a person
walking into this meeting should know — layoffs, acquisition, outage, funding,
leadership change — and answering exactly `none` otherwise. Lands as a
`RelationshipLiveCue` with `privacyRoute: "cloud"`, the enum value nothing
currently writes. **~$0.10/month.** The honest answer is `none` nine times in
ten, and cheap silence is the feature.

**3. Close the loop on what *they* promised, then say nothing.** The
`overdue_commitment` branch does not read `Commitment.direction`, so it nags
identically whether you owe them a deck or they owe you a signed contract. For
`promised_by_them` commitments naming a publicly checkable event, a `lite` Task
resolves it: if it happened, write a `fulfilled` `CommitmentEvent` at
`source_fact` and **the item disappears** — the user never learns the feature
exists. If it did not and the reason is public, the nag becomes context. If
unknowable, stay silent. **Resolve only, never create**: a false "fulfilled" is
the worst failure mode on this list and needs the `high`-or-discard rule
`research.go` already enforces. **~$0.15/month.** The only proposal whose success
metric is a *shorter* list.

**4. Stop nagging people who were never deals.** Every one of `lifecycle`'s
values is a sales stage and the default is `prospect`, so a former manager you
would like to stay close to gets *"Is this still something worth exploring?"*
every 30 days. That is not a missing feature; it is the product being socially
wrong on a schedule, and it teaches the user the queue is stupid. Add a `network`
lifecycle with cooldown `0` — never surface on elapsed time alone — and let the
only trigger be external and human: a promotion, a move, a public announcement.
Monthly `lite`, **~$0.05/month**. This is also the missing implementation behind
the pricing-page promise above.

**5. Learn your champion left before the bounce.** `employment_status` is written
only by the `mail_delivery_report` extractor, so the product learns of a
departure *only if you email someone after they left* — the email you most wish
you had not sent. Reuse `enrichPerson` verbatim on a deliberately narrow trigger:
a `champion`/`decision_maker`/`executive_sponsor` on an `active_customer` or
`renewal` relationship who has gone quiet past cooldown. An `org_domain` that
comes back different at `high` confidence is a departure with a citation, ahead
of the bounce. **~$0.10/month.**

### Where the creepy line is

**Research what a company published, or what a person published about
themselves. Never what a third party observed about them.**

"Acme announced a Series B" is on the right side. `location` — the shipped
schema's *"City and country the person currently works from"* — is on the wrong
side for anyone who is not an active commercial counterparty.

The test: **would the user be comfortable if the counterparty saw the brief?** A
funding announcement passes. A dossier on where someone lives and how senior they
are does not.

Consent has the right shape — `cloud_research_consent` on the workspace, checked
last, grantable by nobody but the user — but surface 4 above researches people
who are *not* commercial counterparties. A mentor is a materially different
bargain from an account you are selling to, and it needs its own opt-in rather
than riding the existing one.

### Rejected, with reasons

- **Verifying `promised_by_me` commitments.** No web page knows whether you sent
  the deck. The guilt case is the more painful one and research cannot touch it.
- **An account dossier tab** (surface 4 in the ranking above). Produces a page the
  user must remember to visit. One line in a card they already open beats it.
- **"Enrich everything" at signup.** $3 for 300 people, returning `seniority` and
  `location` on people the user already knows — the demo that sells the tier and
  the feature nobody opens twice. It is also the worst consent surface in the
  product: every counterparty you have ever emailed, shipped to a vendor in one
  click.
- **Mid-meeting research cues.** A `lite` run takes tens of seconds, the
  conversation has moved on, and a card appearing while someone is talking
  competes with the human for attention. T-2h or not at all.
- **FindAll "who else should I know here".** Naming three strangers creates three
  new obligations for someone already drowning. Coverage disguised as help.
- **Inbound triage on first contact** (surface 8 above). Someone emails once and
  their name goes to a vendor. `sender-profiles.ts` already answers the question
  that matters — machine, newsletter, or cold pitch — entirely on device.

### Questions only a real API key answers

- Is `confidence` non-null on `base`? Both it and `excerpts` are documented as
  "only certain processors provide". If `base` returns null, `researchConfidence`
  writes **every** research row at 0.35 via its silent `default` arm.
- Does a snapshot monitor diff at field granularity on a flat object, and is an
  unchanged execution distinguishable from a failed one?
- Is a no-change monitor execution billed? This decides whether "up to 250
  monitored accounts" costs $22.50/month or nearly nothing.
- Does an identical Group POST bill twice? No idempotency key exists anywhere in
  the API — `metadata` echoed on runs and webhooks is the available handle, and
  reconciling against `GET /v1/tasks/groups/{id}/runs` before resubmitting is the
  available fix.
- Default non-ZDR retention. The docs commit to US datacenters, TLS 1.2+ and no
  training on customer data, but never state a window. That is open question 3,
  and the answer is in the DPA rather than the docs.

One free improvement while those are open: `source_policy.include_domains` (≤200)
makes the verified company domain a **constraint on retrieval** rather than
something the model self-attests to afterwards through `match_confidence`. The
first-order failure mode this document names — attaching facts to the wrong
person — is better answered before the search than after it.
