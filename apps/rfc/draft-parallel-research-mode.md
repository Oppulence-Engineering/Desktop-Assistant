# Research Mode: local by default, Parallel-backed when paid

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
| **Cloud** — `pro` plan | Adds Parallel enrichment, monitoring and research. Writes `external_research` assertions with citations. |

### Gating reuses what exists

- **Capability**: add `CapabilityCloudResearch` to `internal/revenue/release_controls.go`, beside `CapabilityGoogleSource`. `ErrCapabilityDisabled` and the workspace-entitlement plumbing already exist.
- **Plan**: the Stripe integration already distinguishes `starter` and `pro` (`internal/billing/stripe.go`). Cloud mode requires `pro`.
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

Defined in `apps/rowboat-www/app/(marketing)/marketing-data.ts`; Stripe carries `starter` and `pro` price IDs. The marketing copy promises *"priced on executed chases, not seats or email volume"*, which the flat $99 does not currently deliver — a pre-existing tension, noted rather than solved here.

### What this actually costs to serve

Credits are `$0.0001` each (`internal/pricing`), the per-user monthly ceiling is 2,000,000 credits — **$200** — and `gpt-4.1-mini` is billed through at cost (4/16 credits per 1K). So LLM spend is already an unmarked pass-through, and Parallel lands on top of it.

A well-used single seat with cloud mode on:

| Surface | Volume | Cost |
| --- | --- | --- |
| Monitor, 50 accounts daily @ `lite` | 1,500 runs | $4.50 |
| Meeting prep, 20 meetings @ `core` | 20 | $0.50 |
| Person enrichment, 300 people @ `base`, one-off | 300 | $3.00 |
| Departure recovery, ~5/mo @ `base` | 5 | $0.05 |
| Ad-hoc Search in copilot | 200 | $0.20 |
| | | **≈ $8/month** |

Against $99 that is ~8% of revenue: meaningful, not structural. The tail is where it breaks — 5,000 people enriched at `base` is $50 in one action, and 500 monitored accounts is $45/month. Bulk needs the cost estimate, confirmation and credit reservation described above; that is a correctness requirement, not a nicety.

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
