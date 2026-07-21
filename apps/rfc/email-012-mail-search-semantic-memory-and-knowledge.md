# RFC email-012: Mail Search, Semantic Memory, and Knowledge

| Field      | Value                                               |
| ---------- | --------------------------------------------------- |
| RFC        | email-012                                           |
| Status     | Draft                                               |
| Track      | Desktop email                                       |
| Owner      | TBD                                                 |
| Created    | 2026-06-12                                          |
| Depends on | email-001                                           |
| Related    | RFC 021, email-002, email-010, email-013, email-015 |

## Summary

Add a mailbox-specific search and memory layer for exact search, semantic retrieval, thread summaries, sender context, and reusable knowledge. Inbox Zero stores knowledge entries, reply memories, chat memories, email metadata, and message history to support assistant chat and drafting. Rowboat already has an RFC for semantic memory indexing across the vault; email needs a privacy-conscious specialization because raw mail is sensitive, high-volume, and action-bearing.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `apps/web/prisma/schema.prisma` models `Knowledge`, `ReplyMemory`, `ReplyMemorySource`, `ChatMemory`, `EmailMessage`
- `apps/web/utils/ai/knowledge/extract.ts`
- `apps/web/utils/ai/knowledge/extract-from-email-history.ts`
- `apps/web/utils/ai/knowledge/persona.ts`
- `apps/web/utils/ai/knowledge/writing-style.ts`
- `apps/web/utils/actions/knowledge.ts`
- `apps/web/utils/ai/snippets/find-snippets.ts`
- `apps/web/utils/ai/assistant/get-recent-chat-memories.ts`
- `apps/web/utils/ai/assistant/get-inbox-stats-for-chat-context.ts`
- `apps/web/app/api/knowledge/route.ts`
- `apps/web/app/api/user/debug/memories/route.ts`

Use these for knowledge extraction, reply/chat memory, and prompt context retrieval. Rowboat should route indexing through RFC 021-style local memory primitives and apply email-015 retention policy.

## Goals

- Provide fast local search over email metadata, snippets, thread summaries, and selected bodies.
- Support semantic retrieval for assistant chat, drafting, meeting briefs, and rule authoring.
- Keep full body indexing opt-in or local-only by default.
- Store durable summaries that reduce repeated LLM calls.
- Separate user-authored knowledge from learned memory.
- Support deletion, retention windows, and reindexing.

## Non-Goals

- Cloud-wide full mailbox indexing by default.
- Replacing provider search entirely.
- Indexing every attachment content type in the first version.
- Exposing semantic search results to external APIs without explicit scope.

## Search Layers

| Layer           | Data                                                | Backend                            |
| --------------- | --------------------------------------------------- | ---------------------------------- |
| Provider search | Provider-native query                               | Gmail/Outlook API                  |
| Local lexical   | Metadata, subject, sender, snippet, selected bodies | SQLite FTS or existing local index |
| Local semantic  | Summaries, snippets, selected bodies, knowledge     | Vector index from RFC 021          |
| Cloud metadata  | Optional account-synced metadata                    | Oppulence API                      |

The command center should combine provider and local results where useful, but must display source/freshness.

## Indexed Objects

```ts
type MailSearchDocument =
  | MailThreadSearchDoc
  | MailMessageSearchDoc
  | MailSenderSearchDoc
  | MailRuleSearchDoc
  | MailDraftSearchDoc
  | MailKnowledgeSearchDoc;
```

Thread search doc:

```ts
type MailThreadSearchDoc = {
  id: string;
  accountId: string;
  providerThreadId: string;
  subject: string;
  participants: string[];
  latestMessageAt: string;
  categories: string[];
  labels: string[];
  snippet?: string;
  summary?: string;
  bodyIndexState: "none" | "summary" | "selected" | "full_local";
};
```

## Semantic Summaries

Generate and cache:

- Thread summary.
- Sender relationship summary.
- Action item summary.
- Reply-needed reasoning.
- Meeting attendee context.
- Rule match explanation.

Summaries should carry provenance:

```ts
type MailSummary = {
  id: string;
  accountId: string;
  targetType: "thread" | "sender" | "meeting" | "rule" | "digest";
  targetId: string;
  summary: string;
  sourceMessageIds: string[];
  modelProvider?: string;
  modelName?: string;
  promptVersion: string;
  createdAt: string;
  expiresAt?: string;
};
```

## Knowledge Types

User-authored:

- Style guide.
- Company/project notes.
- VIP contacts.
- Do-not-automate rules.
- Filing instructions.
- Calendar preferences.

Learned:

- Reply memory.
- Sender category memory.
- Rule correction memory.
- Cleanup decision memory.
- Chat memory.

Learned memories must be inspectable, source-linked, and deletable.

## Retrieval Policy

For any assistant or automation run:

1. Start with exact target context.
2. Retrieve local summaries and metadata.
3. Retrieve user-authored knowledge.
4. Retrieve learned memory relevant to sender/domain/category.
5. Retrieve semantic matches only within scope and retention policy.
6. Hydrate full bodies only if the feature needs them and policy permits it.

Email body prompt injection should be treated as untrusted content. Retrieved mail text is evidence, not instructions.

## Retention and Redaction

Settings:

- Index metadata only.
- Index summaries only.
- Index selected full bodies locally.
- Index all full bodies locally.
- Sync metadata aggregates to cloud.

Redact or avoid:

- OAuth tokens.
- Authentication codes.
- Payment details.
- Attachments unless explicitly indexed.
- External secrets.

Support delete/rebuild:

- Delete all semantic mail index.
- Delete account index.
- Delete sender memory.
- Rebuild from provider/local cache.

## APIs

Desktop:

- `mailSearch.query`
- `mailSearch.semantic`
- `mailSearch.getIndexStatus`
- `mailSearch.rebuild`
- `mailKnowledge.list`
- `mailKnowledge.upsert`
- `mailKnowledge.delete`

Assistant tools:

- `mailbox.search`
- `mailbox.semantic_search`
- `mailbox.get_knowledge`
- `mailbox.explain_memory`

## Test Plan

- Lexical query tests.
- Semantic retrieval relevance evals.
- Prompt-injection tests proving email bodies cannot override system/tool policy.
- Retention tests for delete/rebuild.
- Privacy tests proving full bodies are not sent to cloud index by default.
- Freshness tests after provider sync and thread deletion.
- Performance tests for large local mailboxes.

## Open Questions

- Should semantic indexing run continuously, on idle, or only on demand?
- Which embedding model should be default for local mail index?
- Should summaries expire when a thread changes or be versioned by message set?
- Should users be able to mark specific threads as never indexed?
