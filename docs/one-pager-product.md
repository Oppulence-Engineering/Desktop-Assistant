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

## The platform it becomes — a federated financial brain

Rowboat's vault is one of several **systems of record** in the Oppulence portfolio — each owns a slice of financial truth and is structurally blind to the others. The desktop already federates them over MCP. Two new faculties complete the picture:

- **Eigen = foresight.** Stress-testing a business's finances — a forward-simulation engine (runway under shock, liquidity, covenant risk, AR/AP sensitivity). A *compute* faculty, not a record.
- **Conduit = evidence.** The system of record that binds invoice emails, replies, disputes, and follow-ups to the financial record they explain — the *"why behind every number."* A *correspondence↔record* faculty.

With those on the fabric, the platform spans **six planes across three faculties**:

```
PERCEPTION  (what is true)
  Relationship   Rowboat vault   Gmail · Calendar · Fireflies
  Revenue/AR     Canvas          invoices · aging · transactions
  AP/Spend       Cadence         vendor master · 3-way recon
  AR memory      Corinthian      outcome-labeled collections behavior
  Evidence       CONDUIT         every email/reply/dispute bound to its invoice   ← new
FORESIGHT   (what could happen)
  Simulation     EIGEN           stress tests over the *federated* graph          ← new
AGENCY      (do something about it, durably)
  Execution      rowboat-api     scheduler · Temporal · event bus · cloud runtime ← the always-on plane
```

The cockpit thesis was *"no single product can produce this, because each is blind to the others."* Eigen and Conduit extend it from *see the whole picture* to **explain it, simulate it, and act on it.**

### Conduit — the evidence layer (a full four-seam plane)

- **Read / Mirror** — every invoice note in the vault gains its correspondence thread: the dispute, the replies, the follow-ups. The number stops being a bare figure and carries its paper trail.
- **Watch** — a new dispute or reply becomes an event → routes to the agent that owns that customer/invoice → the agent wakes grounded in *why* the number is contested, not just that it's overdue.
- **Act + audit loop** — when the agent sends a follow-up (under dual review), that outbound message is itself correspondence Conduit binds *back* to the record. The platform's own autonomous actions become part of the system of record — a closed evidence chain, end-to-end provenance for every action. That's the regulatory moat for the sovereignty buyer.

Without the always-on execution plane, Conduit is an archive. With it, Conduit is the **live trigger source + grounding context + audit sink** for autonomous response.

### Eigen — foresight made continuous

A compute faculty that plugs in as an agent tool *and* a scheduled/triggered job, consuming the whole federated graph:

- **Federation is the precondition for a real stress test.** No single record can stress-test the business because each is blind to the others. The cockpit already federates AR + AP + behavior + disputes into one place — so Eigen is the first engine that simulates the *whole* business off live data, not a stale spreadsheet.
- **The execution plane makes it continuous.** Scheduled full runs (nightly/weekly, desktop-closed) + event-triggered incremental re-runs: a new overdue invoice, a vendor payment due, a new dispute → automatically re-run the liquidity/runway test → on a threshold breach, wake an agent or alert. Eigen stops being a calculator you remember to use and becomes an **always-on risk sensor.**
- **Scenario-aware action at the point of decision.** The cloud runtime can call Eigen mid-run: an agent about to escalate dunning asks *"if Acme's $48k slips 30 days and we owe their subcontractor $12k Friday, what's the runway hit — and does pushing harder risk the renewal?"* — quantified, before it acts.

**The value chain only this assembles: Conduit → Eigen → Agent → Conduit.** Disputes (Conduit) are a probabilistic haircut on AR; payment behavior (Corinthian) is the collection probability. Eigen produces a **risk-adjusted, dispute-weighted cash forecast** impossible without both. The agent acts; the action becomes Conduit-bound evidence; the next event re-runs the loop — a self-maintaining, self-explaining, forward-looking financial brain.

The signature artifact, now with foresight and evidence:

```markdown
## Money
- They owe us $48k — 54-day DSO, 2 broken promises          ← Corinthian
- $18k of it disputed (invoice #4821, unresolved 3d)        ← Conduit  (haircut input)
- We owe their subcontractor $12k — NET-30, clears Friday   ← Cadence
## Foresight
- If #4821 dispute holds + Acme slips 30d: runway −2.1 wks,
  breaches the 8-wk liquidity floor on 2026-07-18           ← Eigen   (off the federated graph)
- Recommended: resolve dispute before escalating dunning    ← agent, grounded in all of the above
```

Canvas can't write the runway line. Granola can't write the AR line. Only the platform — federating evidence (Conduit) and foresight (Eigen) over a durable execution plane — writes all of them, continuously, and acts on them under review.

### What this gives us

1. **Continuous whole-business stress-testing** — every material financial event auto-triggers Eigen over the live federated graph; breaches alert; results land in the corpus.
2. **Evidence-grounded autonomous AR/AP** — agents respond to disputes/follow-ups grounded in the full correspondence + outcome memory, under dual review, and their actions become record.
3. **Scenario-aware autonomous decisions** — the runtime quantifies the financial consequence of an action *before* taking it.
4. **A self-explaining audit chain** — every autonomous action is bound back to the financial record it touched, with full run provenance.
5. **A sellable autonomous tier** — because the execution plane meters, bounds, and SLOs the work, "continuous stress-testing + evidence-grounded collections" is a product priced in agent-hours/credits, on our sovereign substrate — not a rented agent cloud.
6. **A near-zero-marginal-cost path to product N+1** — any future plane inherits scheduling, event-reactivity, cloud execution, metering, and audit the moment it mounts one MCP interface.

> **In one line:** once the execution plane (specified in `apps/rfc/`) lands, Rowboat stops being "a coworker that runs when you click" and becomes a **sovereign, always-on financial digital twin** — it *perceives* the whole business (the federated records + Conduit's evidence), *simulates its future* (Eigen), and *acts durably on schedule and on events* — metered, audited, and owned. Where tool-execution vendors rent you the runtime, this owns the entire perceive→foresee→act loop over data the customer keeps. Eigen and Conduit aren't two more integrations; they're the two faculties — foresight and evidence — that turn the federated graph from a *report* into a *brain.*

---

## One line

**Rowboat is the AI coworker that turns your email, calendar, and meetings into one corpus you own — and lets agents act on it.**

---

## About Oppulence Engineering

Rowboat is built by Oppulence Engineering. The same internal runtime that powers Rowboat — the workflow, agent, MCP, and sovereign-data substrate inside `apps/rowboat` — also powers the Oppulence portfolio of financial systems-of-record, sold separately to their own buyers: **Canvas** (B2B revenue operations), **Cadence** (AI-native accounts-payable automation), and **Corinthian** (accounts-receivable collections) — plus the two intelligence faculties above, **Conduit** (the correspondence-to-record evidence layer) and **Eigen** (financial stress-testing). All share the runtime; each is positioned and bought independently.
