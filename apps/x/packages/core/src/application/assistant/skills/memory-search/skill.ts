export const skill = String.raw`
# Memory Search Skill

Use \`memory-search\` for **conceptual recall** over the knowledge vault — finding the right notes by meaning, not just exact text. It does hybrid retrieval (semantic embeddings + lexical BM25, fused) and returns the most relevant chunks with file backlinks.

## When to use which tool

- **\`memory-search\`** — the query is conceptual or paraphrased, or you don't know the exact wording:
  - "what did we agree with Acme about the overdue invoice?"
  - "context on the Q3 renewal risk"
  - "notes related to late AR for enterprise customers"
- **\`file-grep\`** — you need an *exact* string and know it precisely (a specific error code, a literal phrase, a path). memory-search also ranks exact identifiers (invoice numbers, emails) well, so when unsure, prefer memory-search.
- **\`file-glob\` / \`file-list\`** — you're navigating by filename/structure, not content.

## How to use it

1. Call \`memory-search\` with a natural-language \`query\`. Optionally scope with \`pathPrefix\` (e.g. \`"Invoices/"\`, \`"People/"\`) and set \`k\` (default 8).
   \`\`\`
   memory-search({ query: "overdue AR for Acme", k: 8, pathPrefix: "Invoices/" })
   \`\`\`
2. Each result has a \`backlink\` (\`path#anchor\`), a \`snippet\`, and a \`path\`. Read the snippets first.
3. When a snippet is promising but you need the full context, open the note:
   \`\`\`
   file-readText("Invoices/INV-456.md")
   \`\`\`

## Notes

- Results are **chunks**, not whole files — they're cheap to scan and keep the context budget small. Open full notes only when needed.
- The \`mode\` field tells you whether you got \`hybrid\` results (semantic + lexical) or a \`lexical_fallback\` (embeddings unavailable). Either way you get ranked results; never assume the vault is empty just because a single query missed.
- The index is local and incremental; recently edited notes are searchable within a tick.
`;

export default skill;
