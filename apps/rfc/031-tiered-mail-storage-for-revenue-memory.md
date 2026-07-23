# RFC 031: Tiered Mail Storage for Revenue Memory

|                  |                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**          | 031                                                                                                                                                                                                                                                                    |
| **Status**       | Draft                                                                                                                                                                                                                                                                  |
| **Track**        | Platform architecture - cloud mail ingestion, retention, and evidence for the warm-revenue loop                                                                                                                                                                        |
| **Owners**       | `rowboat/apps/rowboat-api` (ingestion, index, ledger, retention)                                                                                                                                                                                                       |
| **Created**      | 2026-07-22                                                                                                                                                                                                                                                             |
| **Last updated** | 2026-07-22                                                                                                                                                                                                                                                             |
| **Depends on**   | [RFC 003](./complete-003-cloud-event-ingestion.md), [RFC 019](./019-google-push-infrastructure.md), [RFC 022](./022-unified-entity-graph.md), [RFC 023](./023-closed-loop-actions.md), [RFC 030](./complete-030-revenue-memory-outbound-governance.md)                 |
| **Related**      | [email-001](./email-001-mailbox-provider-foundation.md), [email-012](./email-012-mail-search-semantic-memory-and-knowledge.md), [email-014](./email-014-sync-reliability-rate-limits-and-repair.md), [email-015](./email-015-email-privacy-security-and-governance.md) |
| **Supersedes**   | none; constrains how RFC 030's detection layer may hold Gmail data in the cloud                                                                                                                                                                                        |

## Main point

The cloud must never hold a copy of the customer's mailbox. It holds four smaller things instead, each at a different depth and lifetime:

> metadata for every thread → derived signals for relevant threads → bodies by reference with a short-lived cache → permanent evidence snapshots for the ledger

Detection needs breadth. Drafting needs depth for a handful of threads a week. The audit trail needs a few quoted sentences forever. Nothing in the warm-revenue loop needs fifty thousand bodies at rest.

One sentence: **index everything, understand the relevant, copy almost nothing, and keep only the quotes that prove the money.**

## Why this RFC exists

RFC 030's detection layer scans 60-90 days of Gmail and Calendar for slipping revenue. The obvious implementations are both wrong:

- **Store everything.** Copying full mailboxes into our database maximizes legal and trust liability (Google Limited Use, CASA review scope, breach blast radius) for content the loop rarely reads. It also contradicts the shipped product promise: "your mail stays yours" and "you can disconnect at any time."
- **Store only deal email.** Relevance is an _output_ of detection, not an input. A thread only becomes a deal thread when the reply-state machine notices its shape. Silence detection is a breadth problem over the whole mailbox timeline; filtering first blinds it.

The desktop app (email-001, local store under `WorkDir`) keeps a full local mailbox because that machine belongs to the user. This RFC is about the **cloud**, where the trust posture must be thinner. Without an explicit tiering rule, every new detector will quietly widen what the cloud retains.

## The four layers

### Layer 1 — Thread and message metadata, for every thread

Message id, thread id, timestamps, direction, participants, subject, labels, and the derived reply-state (`needs_reply` / `awaiting_reply` / `quiet_for_n_days`). Roughly 1-2 KB per message; a busy mailbox year is **~50-100 MB per user** in Postgres. This layer is what the reply-state machine runs on: who, when, which direction, how long since. It contains no bodies.

### Layer 2 — Derived signals, for relevant threads only

Classification (deal / invoice / client / other), extracted commitments with deadlines, dollar amounts, a short summary, and an embedding. Produced only for threads that detection flags. Embeddings are computed here, never over the full mailbox.

### Layer 3 — Bodies by reference, with a short-lived cache

Gmail is the system of record for content. The index stores the Gmail message id; the body is fetched on demand when an agent drafts a chase or the operator opens evidence. Bodies for items active in the approval queue may be cached, sealed with `crypto.Sealer`, with a TTL measured in days. Expired cache entries are deleted, not archived.

### Layer 4 — Evidence snapshots, kept with the ledger

When a thread becomes a queue action or a receipt, the minimal quote is persisted: the sentence containing the promise, the proposal amount, the invoice line. A few hundred bytes each. This survives the customer deleting the original email and is the audit trail RFC 023/030 require. **This layer, joined to the RFC 022 entity graph, is the Revenue Memory. The moat lives here, not in raw mail.**

Attachments are never stored in any layer. At most their metadata (filename, size, mime type) lands in Layer 1.

## Sync and ingestion

- Incremental sync uses the **Gmail History API** from a stored `historyId` cursor; there is no periodic re-crawl.
- Near-real-time wake-ups come from the existing push pipeline (RFC 003 webhook ingestion + RFC 019 Pub/Sub provisioning). Push messages carry history pointers only, never content — consistent with RFC 019's existing guarantee.
- Backfill at connect time walks 60-90 days of headers (RFC 030's scan window) into Layer 1 and runs detection to seed Layers 2 and 4.

## Retention and deletion

| Layer                  | Retention                                                                |
| ---------------------- | ------------------------------------------------------------------------ |
| 1 — metadata           | Rolling window, default 18 months (config `MAIL_INDEX_RETENTION_MONTHS`) |
| 2 — derived signals    | Follows the thread's Layer-1 row                                         |
| 3 — body cache         | TTL days, default 3 (config `MAIL_BODY_CACHE_TTL_HOURS`)                 |
| 4 — evidence snapshots | Life of the account; deleted with the account                            |

Disconnecting Gmail drops Layers 1-3 immediately and revokes the OAuth grant. Layer 4 survives disconnect (it is the customer's own action history) and is deleted on account deletion. This makes the public claims mechanically true: no mailbox copy exists to "give back."

## Compliance mapping

- **Google Limited Use:** cross-customer pooling of mail data is already barred; this RFC additionally minimizes per-customer content at rest, which narrows the CASA assessment surface to the index, the sealed short-TTL cache, and the snapshots.
- **Product claims:** the marketing site states "your mail stays yours," "we do not pool it," "we do not train shared models on it," and "you can disconnect at any time." Each maps to a mechanism above and must keep doing so; a change that breaks the mapping requires revisiting this RFC first.
- **Breach posture:** worst case at rest is thread metadata, sealed queue bodies from the last few days, and evidence quotes — not mail archives.

## Schema sketch (ent)

New entities, all per-user scoped through the standard tenant interceptors, org-ready per RFC 022:

- `MailThread` — provider thread id, participants hash, reply_state, last_direction, last_activity_at, entity edge (RFC 022 contact/account).
- `MailMessageMeta` — provider message id, thread edge, ts, direction, subject, labels; **no body column exists**.
- `MailBodyCache` — provider message id, sealed body, expires_at; swept by a scheduled job.
- `EvidenceSnippet` — quote, source message id, byte offsets, action/commitment edge (RFC 023 `ActionProposal`, RFC 030 RevenueAction).

The guard test mirrors RFC 027's sandbox guard: a schema test asserts no entity outside `MailBodyCache` stores mail content, so the constraint survives future contributors.

## Decisions

| Fork                                       | Choice                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Store all bodies vs deal-only vs tiered    | **Tiered** (this RFC). Breadth in metadata, depth on demand.                                        |
| Bodies in Postgres vs object store vs none | **None at rest**; reference Gmail + sealed TTL cache for active queue items only.                   |
| Embeddings over full mailbox vs relevant   | **Relevant threads only** (Layer 2); full-mailbox embedding is a cost and Limited Use liability.    |
| Evidence as pointer vs snapshot            | **Snapshot** (Layer 4); pointers break when customers delete mail, and the audit trail must not.    |
| Attachment storage                         | **Never**; metadata only.                                                                           |
| Retention defaults                         | 18-month metadata window, 72-hour body cache; both config-backed, revisit with design-partner data. |

## Non-goals

- No change to the desktop's local-first mailbox (email-001); its full local store remains the desktop's privacy feature.
- No cross-customer aggregation of any layer (legally barred; also architecturally excluded here).
- No generic cloud email archive, search product, or Outlook support in v1 (Outlook follows email-001's provider roadmap).

## Test plan

- Detection-recall fixtures proving the reply-state machine reaches its decisions from Layer 1 alone (no body access) on synthetic mailboxes.
- Disconnect purge test: Layers 1-3 rows are gone and the grant is revoked; Layer 4 rows remain until account deletion.
- Cache sweep test: expired `MailBodyCache` rows are deleted by the scheduled job; a read after expiry re-fetches from Gmail.
- History-cursor resume test: ingestion recovers from a stale `historyId` (RFC email-014's repair pattern) without re-crawling content.
- Schema guard test: any new entity carrying mail content outside `MailBodyCache` fails CI.

## Open questions

- Final retention window (12 vs 18 months) — decide from design-partner usage, not intuition.
- Whether Layer-1 participants should store normalized addresses or salted hashes plus a per-user lookup table (tighter CASA story vs simpler joins).
- Where Layer 4 evidence rendering happens when the source message is gone (snapshot-only view is acceptable for v1).
