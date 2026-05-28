# Rowboat — One Pager (Investor)

**Local-first memory and agent runtime for the post-chat era of AI.**

---

## The thesis

In 2023–2024, the bet was that AI assistants would beat search. In 2026, that bet has been won — and exposed a different problem.

Every frontier model now ships some form of "memory." But that memory is:

- **Opaque** — users can't see, edit, or audit what the system believes about them.
- **Hosted** — it lives inside the vendor, never leaves, and dies if the account does.
- **Per-product** — ChatGPT's memory doesn't help Claude, Granola's doesn't help Superhuman, and none of it talks to the user's actual work systems (email, calendar, docs).
- **Shallow** — it's tuned for chat continuity, not for grounding agents that take real actions on durable artifacts.

The category leader confessed the gap. Per Granola's own docs (raised $250M+, valued ~$1.5B in March 2026): *"Granola only has access to your meeting data… it doesn't know about your emails, offline tasks, or personal to-do lists. Granola can only understand one meeting at a time."*

The result: every AI surface is rebuilding the same private graph of "who this person is and what they're doing," and the user owns none of it. The work of organizing context — the most valuable byproduct of using AI all day — is being captured as vendor lock-in instead of personal capital.

---

## What Rowboat is

**Rowboat is a local-first knowledge graph that doubles as an agent runtime.** Memory is stored as plain Markdown files with backlinks — Obsidian-compatible, fully inspectable, owned by the user. Agents read from and write to that graph using MCP-native tools, models (BYO), and live signals (email, calendar, meetings).

The product ships in two coordinated forms:

| | **Rowboat Desktop** (`apps/x`) | **Rowboat Platform** (`apps/rowboat`) |
|---|---|---|
| **What** | Electron app — daily-driver AI coworker | Self-hosted Next.js runtime — visual agent builder, RAG, embeddable chat widget |
| **For** | Founders, EAs, sales operators, advisors | Developers and companies embedding agents grounded in their own corpus |
| **Memory** | Markdown vault on disk (Obsidian-compatible) | Self-hosted Mongo + Qdrant + S3 |
| **Defining primitive** | The `live:` frontmatter block — turns any note into a self-updating artifact (cron, time-window, or event-triggered) | Workflow + agent builder, MCP-native tools |
| **Ships as** | Signed installers, 16 OS/arch targets, auto-update | Docker Compose, source-distributed |

Both surfaces share Markdown as the data layer and MCP as the integration spine. A desktop vault and a platform tenant are the same shape — files and agents — at different scales.

---

## Who it's for (in priority order)

1. **Founders and EAs briefing execs** — *primary wedge today.* Walks into every meeting with cross-source context (last email thread, prior call's open questions, the redlined deck, the Slack thread). Pays $30–80/mo single-seat.
2. **Sales operators and AEs** — *12-month destination.* Quota-linked pain → highest willingness-to-pay ($100–300/seat). Product roadmap targets CRM write-back and deal-room view.
3. **Obsidian-fluent power users** — *beachhead and credibility wedge.* The ~150K AI-curious PKM operators where the loudest existing plugins (Smart Connections, 473 open issues; Copilot, under user privacy audit) are visibly failing. Funds the early company.
4. **Solo professionals with fiduciary duty** — *vertical expansion.* Independent lawyers, therapists, consultants handling client IP. Sovereignty stops being a preference and becomes a regulatory sale at $50–150/mo.

---

## Why now

Three shifts in 2025 made this category buildable:

- **MCP became a real standard.** Tools are now a portable layer, not per-vendor plumbing. Rowboat is MCP-native on both surfaces.
- **Local model quality crossed a threshold.** Llama-class and Qwen-class models on consumer hardware handle routine summarize / extract / draft work — making local-first economically viable, not just ideological.
- **The category leader confessed the gap.** Granola hitting $1.5B *while documenting* that it can't see email or reason across meetings is the strongest possible market signal: the buyer pattern exists, and the obvious next step is unclaimed.

---

## Why we win

We don't claim a structural moat — the category doesn't have one (neither does Cursor, Granola, or v0). We claim three compounding advantages:

1. **Integration breadth.** Twelve to eighteen months of Gmail / Calendar / Fireflies / MCP plumbing that actually works under load. Each integration is its own ongoing reliability tax — painful for late entrants to clone.
2. **Local-first as the trust closer.** Microsoft Copilot won enterprise sovereignty with contractual data controls; we win the *individual operator who refuses to paste client data into a hosted product* with a Markdown vault on their machine. Different segment, different sale, defensible because Granola is structurally cloud.
3. **Two-surface flywheel.** Desktop produces the personal knowledge primitive; Platform extends the same primitive into embeddable agents for products and teams. One engineering investment, two go-to-market motions — a position that compounds over 24 months.

---

## Where we are

Open-source under active development; desktop installers shipping on a ~6-minute release cycle across macOS / Windows / Linux; platform self-hostable with Mongo / Redis / Qdrant; integrations live for Gmail, Google Calendar, Fireflies, plus Composio and arbitrary MCP servers.

---

## One-line definition

**Rowboat is the AI coworker that reasons across your email, calendar, and meetings as one corpus you actually own.**
