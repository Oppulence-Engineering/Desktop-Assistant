# Research Mode: local by default, Parallel-backed when paid

## Context

The desktop builds relationship intelligence from **owned data only** — signatures, headers, transcripts, calendar. That was a deliberate choice, recorded in the enrichment plan as "no vendors", and it is why the product can say relationship content stays on the machine.

The cost of that choice is a ceiling. A `Person` has `title`, `org_name`, `org_domain`, `timezone` — all inferable only if someone happened to put them in an email signature. A `Relationship` has `account_domain` and a lifecycle, and nothing about the company behind it. The product knows who you talked to and can say nothing about who they are.

This proposes lifting that ceiling for users who pay, without moving it for users who do not.

**Two things make Parallel the right vendor here specifically**, and both are structural rather than preference:

1. **It returns evidence, not prose.** The Task API's `basis` is per-field: `{ field, citations[{title, url, excerpts[]}], reasoning, confidence }`. This codebase refuses facts without evidence — `EvidenceRefs` on assertions, a provenance ladder, retraction. An LLM summarising search results produces `ai_inference` with nothing to cite. Parallel produces something the ledger can actually hold.
2. **`PersonAttribute` already is the target table.** It has `dimension`, `source_type`, `source`, `extractor`, `extractor_version`, `confidence`, `observed_at`, `valid_from`/`valid_to`, `retracted_at`, `supersedes_attribute_id`. Parallel's basis maps onto it close to 1:1. This is an integration, not a schema redesign.

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
user_correction > source_fact > deterministic_rule > external_research > ai_inference
```

Above `ai_inference` because it carries citations. Below `deterministic_rule` because a vendor's read of a web page is weaker than something computed from data you own. A user correction always wins.

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

**1. Account context on a `Relationship`** — the highest value and the easiest to reason about. One Task `core` call per account: industry, size, funding, recent material events. Renders in the Accounts view where there is currently nothing.

**2. Person enrichment** — title, employer, seniority, location. `base` processor, one per person. This is where "enrich everything" lives: a bulk action over every `Person` in the workspace via the Task **Group** API (`POST /v1/tasks/groups/{id}/runs` with an `inputs` array, results streamed back over SSE with `last_event_id` for resumption).

**3. Monitor for accounts you care about** — `Monitor API` at `lite`, one per account with `next_action_at` set or lifecycle beyond a threshold. Feeds the existing attention queue rather than a new surface. This is the one that turns a static graph into something that tells you when to act.

**4. Replace the `web-search` agent loop** — the existing Exa tool becomes Parallel Search in cloud mode. Cheaper in LLM budget and returns excerpts already optimised for a model.

**5. FindAll / Entity Search** — deliberately last, and possibly never. Prospecting a list of companies is a different product from understanding relationships you already have, and shipping it would change what this is.

## Bulk enrichment: "everything"

The Group API is the right shape, but a bulk action over an entire workspace needs care that a single call does not:

- **A cost estimate before it runs.** "Enrich 412 people — about $4.12" with a confirm. Not a spinner and a bill.
- **Chunked submission and resumable streaming.** `last_event_id` exists precisely for a desktop that sleeps mid-run.
- **Credit reservation up front** through the existing `quota.Gate`, so a bulk run cannot exceed a spend cap mid-flight.
- **Idempotency per person + task-spec version**, so a re-run after a crash does not pay twice for the same field.
- **A published concurrency cap on our side.** Parallel documents no batch limit and 429s exist; the desktop already has `p-queue` pacing for exactly this class of problem and the same approach applies.

## Verification

- **Unit** — basis→attribute mapping, including confidence coercion and a basis entry with zero citations (which must be rejected, not stored at confidence 0).
- **Gate** — a `starter` plan gets `ErrCapabilityDisabled`; consent off blocks the call even on `pro`; both asserted server-side with the client lying about its state.
- **Provenance** — a `user_correction` beats an `external_research` assertion for the same dimension; re-running enrichment supersedes rather than duplicates.
- **Cost** — a bulk run against a mock reserves credits before submitting and refunds on failure.
- **End-to-end** — against a real key on a throwaway workspace: enrich one person, click the citation, confirm it supports the claim. A citation that does not support its field is the failure mode that matters and no unit test will catch it.

## Open questions

1. **Is `pro` the right gate, or is this a separate add-on?** Enrichment has real marginal cost per use, unlike most plan features. A seat price that includes unlimited enrichment is a margin problem.
2. **Do enriched fields sync to the cloud graph, or stay local?** They are about third parties; the answer differs from first-party evidence and the current consent copy does not cover it.
3. **Retention.** Public professional data still ages. A `valid_to` policy for `external_research` attributes — 90 days? — versus keeping them until contradicted.
