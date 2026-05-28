# Rowboat — One Pager (Product)

**The AI coworker that reasons across your email, calendar, and meetings as one corpus — locally, on your machine.**

---

## The problem

In 2026, the average operator pays for a stack of AI tools that refuse to talk to each other:

- **Granola ($14/mo)** writes the meeting note. Per their own docs: *"Granola only has access to your meeting data… it doesn't know about your emails, offline tasks, or personal to-do lists. Granola can only understand one meeting at a time."*
- **Superhuman AI ($30/mo)** drafts the email — reviewers complain it sounds *"generic because it doesn't learn personal voice."*
- **Fireflies ($18/mo)** owns the transcript but not the relationship.
- **ChatGPT ($20/mo)** has memory now, but it lives in OpenAI's servers and can't see any of the above.

The user pastes between them all day. Nobody owns the corpus. The pain isn't "AI has no memory" — every frontier model shipped memory in 2025. The pain is that **every tool's memory is partial, siloed, and rented.**

Walking into the next meeting blind, drafting the next email generic, forgetting what was promised last quarter — these are the daily costs.

---

## How Rowboat solves it

Rowboat builds one corpus from the work the user is already doing, keeps it alive automatically, lets agents act on it, and stores it as plain files the user owns.

### 1. It builds the corpus

Rowboat continuously ingests Gmail, Google Calendar, and Fireflies / meeting notes into a single Markdown vault with backlinks. Every person, project, and decision becomes a file. Every claim has a source the user can open and edit. The vault is Obsidian-compatible — it sits in a folder, not a database.

### 2. It keeps the corpus alive

Any note can become a *live note* by adding one block of YAML frontmatter:

```yaml
live:
  objective: Track Acme's renewal — pull from the deal thread, last call, and any new Gmail mentions.
  triggers:
    cronExpr: "0 8 * * *"           # refresh every morning at 8am
    eventMatchCriteria: "Emails from anyone @acme.com"
```

The note rewrites itself: on a schedule, inside a time-of-day window, or when a matching event arrives. Used to track a deal, a person, a competitor, a project, or a market topic. The user delegates *awareness*, not just tasks. Nothing in the Obsidian plugin ecosystem ships this primitive today.

### 3. Agents act on the corpus

Rowboat is MCP-native. Agents read the vault and act through any MCP server — draft an email in Gmail, create a Linear ticket, search the web with Exa, generate a PDF brief, post in Slack. Every action is reviewable before it lands. The same agent runtime powers the desktop coworker and the embeddable platform.

### 4. The user owns the corpus

All data is plain Markdown on disk. Models are BYO — local via Ollama or LM Studio, or hosted via OpenAI / Anthropic / Google / OpenRouter with the user's own key. Nothing leaves the machine unless the user wires a tool to send it out. The vault is portable: copy the folder, you have your memory.

---

## Two surfaces, one solution

The same Markdown + MCP stack ships in two forms:

- **Rowboat Desktop** — Electron app. The daily-driver AI coworker. The user's vault, on their machine, with the integrations and live-note runtime above. Ships as signed installers across macOS / Windows / Linux with auto-update.
- **Rowboat Platform** — Self-hosted Next.js runtime with a visual agent builder, RAG, and an embeddable chat widget. The same Markdown-and-MCP primitives, exposed as an API and an SDK, so a developer can drop an agent grounded in their own corpus into a product or internal tool. Self-hosted via Docker Compose with Mongo / Redis / Qdrant.

---

## Who feels this pain most acutely

- **Founders and EAs briefing execs** — every meeting needs cross-source context the existing tools can't assemble.
- **AEs and sales operators** — quota-linked context loss; the deal lives across Gmail + Granola + CRM + Slack and nothing connects them.
- **Operators handling client IP** (solo lawyers, therapists, consultants) — sovereignty is not a preference; it's a regulatory requirement.
- **Obsidian-fluent power users** — already chose Markdown-and-files; current AI plugins on top of it are fragile and leak data.

---

## One line

**Rowboat is the AI coworker that turns your email, calendar, and meetings into one corpus you own — and lets agents act on it.**

---

## About Oppulence Engineering

Rowboat is built by Oppulence Engineering. The same internal runtime that powers Rowboat — the workflow, agent, MCP, and sovereign-data substrate inside `apps/rowboat` — also powers two other Oppulence products, sold separately to their own buyers: **Cadence** (AI-native accounts payable automation) and **Canvas** (B2B revenue operations). The three share infrastructure; each is positioned and bought independently.
