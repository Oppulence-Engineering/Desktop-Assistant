<a href="https://www.youtube.com/watch?v=5AWoGo-L16I" target="_blank" rel="noopener noreferrer">
  <img width="1339" height="607" alt="rowboat-github-2" src="https://github.com/user-attachments/assets/fc463b99-01b3-401c-b4a4-044dad480901" />
</a>

<h5 align="center">

<p align="center" style="display: flex; justify-content: center; gap: 20px; align-items: center;">
  <a href="https://trendshift.io/repositories/13609" target="blank">
    <img src="https://trendshift.io/api/badge/repositories/13609" alt="rowboatlabs/rowboat | Trendshift" width="250" height="55"/>
  </a>
</p>

<p align="center">
    <a href="https://www.rowboatlabs.com/" target="_blank" rel="noopener">
    <img alt="Website" src="https://img.shields.io/badge/Website-10b981?labelColor=10b981&logo=window&logoColor=white">
  </a>
  <a href="https://discord.gg/wajrgmJQ6b" target="_blank" rel="noopener">
    <img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white&labelColor=5865F2">
  </a>
  <a href="https://x.com/intent/user?screen_name=rowboatlabshq" target="_blank" rel="noopener">
    <img alt="Twitter" src="https://img.shields.io/twitter/follow/rowboatlabshq?style=social">
  </a>
  <a href="https://www.ycombinator.com" target="_blank" rel="noopener">
    <img alt="Y Combinator" src="https://img.shields.io/badge/Y%20Combinator-S24-orange">
  </a>
</p>

# Rowboat

**Founder/operator control tower that keeps follow-ups, meeting context, relationship memory, and commitments from slipping**

</h5>

> **Fork notice** — This is the [Oppulence-Engineering](https://github.com/Oppulence-Engineering) fork of [rowboatlabs/rowboat](https://github.com/rowboatlabs/rowboat). It ships independent builds with its own release cadence, telemetry pipeline, and update channel. See [Fork details](#fork-details) below.

Rowboat connects to the work sources founders and operators already live in - email, calendar, meetings, Slack, notes, and eventually CRM/task systems - and turns them into an operating memory with daily briefs, follow-up queues, relationship pages, and approval-ready actions.

The main product direction is captured in [RFC 029: Founder Operating Memory and Control Tower](./apps/rfc/029-founder-operating-memory.md):

> Connect the work sources. Rowboat tells you what changed, what matters today, who needs a response, what was promised, and what action is ready for approval.

The knowledge graph, MCP layer, model gateway, and Temporal runtime are infrastructure. The product promise is simpler: **nothing important slips.**

Use Rowboat to:

- Start the day with a source-linked founder brief across calendar, email, meetings, Slack, and active notes.
- Catch stale follow-ups, unanswered asks, waiting-on-them threads, and dropped commitments before they cost a deal or relationship.
- Walk into meetings with prior context, open loops, and the latest relationship history.
- Keep person, company, deal, project, investor, vendor, and customer pages current through live notes.
- Draft follow-ups, recaps, task updates, and CRM/calendar actions for human approval.
- Keep the underlying memory inspectable and editable as plain Markdown on your machine.

Download latest fork builds for Mac/Windows/Linux: [Oppulence releases](https://github.com/Oppulence-Engineering/rowboat/releases/latest)

⭐ If you find Rowboat useful, please star the repo. It helps more people find it.

## Demo

[![Demo](https://github.com/user-attachments/assets/8b9a859b-d4f1-47ca-9d1d-9d26d982e15d)](https://www.youtube.com/watch?v=7xTpciZCfpw)

[Watch the full video](https://www.youtube.com/watch?v=7xTpciZCfpw)

---

## Installation

**Download latest for Mac/Windows/Linux:** [Oppulence releases](https://github.com/Oppulence-Engineering/rowboat/releases/latest)

**All release files:** https://github.com/Oppulence-Engineering/rowboat/releases/latest

### Google setup

To connect Google services (Gmail, Calendar, and Drive), follow [Google setup](./google-setup.md).

### Voice input

To enable voice input and voice notes (optional), add a Deepgram API key in `~/.rowboat/config/deepgram.json`

### Voice output

To enable voice output (optional), add an ElevenLabs API key in `~/.rowboat/config/elevenlabs.json`

### Web search

To use Exa research search (optional), add the Exa API key in `~/.rowboat/config/exa-search.json`

### External tools

To enable external tools (optional), add MCP servers or connect Rowboat managed integrations from the app.

All API key files use the same format:

```
{
  "apiKey": "<key>"
}
```

## What it does

Rowboat is a **local-first operating memory** for founder-led work. It watches the work stream, keeps durable context, and turns that context into a few concrete surfaces:

- **Daily Founder Brief** - what matters today, who you are meeting, what changed, and which open loops need attention.
- **Follow-Up Queue** - unanswered asks, stale deals, waiting-on-them threads, missed commitments, and draftable next actions.
- **Relationship and Deal Memory** - living pages for people, companies, deals, projects, customers, investors, and vendors.
- **Meeting Lifecycle** - pre-briefs, live or imported notes, action extraction, follow-up drafts, and memory updates.
- **Approval-Gated Actions** - the model proposes; the user approves before external sends or writes.

Under the hood, Rowboat maintains an **Obsidian-compatible vault** of plain Markdown notes with backlinks - a transparent working memory you can inspect, edit, back up, and delete.

## Integrations

Rowboat builds memory from the work you already do:

It also contains a library of product integrations through Rowboat managed integrations and MCP servers.

## How it’s different

Most AI tools reconstruct context on demand by searching transcripts, documents, or chat history.

Rowboat maintains **long-lived operating memory** instead:

- context accumulates over time
- relationships and open loops are explicit
- every important claim should link back to source evidence
- generated artifacts are editable by you, not hidden inside a model
- everything important can live on your machine as plain Markdown
- cloud execution exists to run scheduled/event jobs, not to take ownership of your memory

The result is memory that compounds, rather than retrieval that starts cold every time.

## Core workflows

- **Start-of-day briefing**: today's meetings, important messages, stale commitments, and risks in one source-linked artifact.
- **Follow-up recovery**: find the threads and relationships that are going cold, then draft the next touch.
- **Meeting prep and closeout**: walk in with context, leave with actions, and roll the new information back into the graph.
- **Relationship tracking**: keep a live page for an investor, customer, vendor, candidate, deal, or strategic account.
- **Operator approvals**: review a proposed email, task, CRM note, calendar hold, or Slack summary before it lands externally.

## Background jobs

The product is designed around always-on jobs, not only one-off chat:

| Job                         | What it does                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| Daily Founder Brief         | Builds the morning control-tower artifact from calendar, email, meetings, Slack, and active notes. |
| Follow-Up Sweeper           | Finds unanswered asks, stale deals, waiting-on-them threads, and dropped commitments.              |
| Meeting Pre-Brief           | Prepares context from prior emails, notes, attendees, and relationship history.                    |
| Post-Meeting Processor      | Extracts actions, drafts recaps, and updates relationship/deal pages.                              |
| Relationship Refresh        | Keeps person, company, deal, project, investor, vendor, and customer pages current.                |
| Connector Health and Repair | Surfaces sync failures, stale watches, and token problems before the user trusts bad data.         |

## Live notes

Live notes are notes that stay updated automatically. They are the core primitive behind relationship and deal memory.

- Track a person, company, project, deal, investor, vendor, customer, competitor, or market topic.
- Refresh on a schedule, inside a time window, on an event, or manually.
- Keep a running summary with source trail, recent changes, open loops, and suggested next action.

Everything is written back into your local Markdown vault. You control what runs, when it runs, and which actions require review.

## Finance operating loop

The same control-tower architecture extends into the Oppulence finance portfolio:

- **Conduitt / Conduit** gives evidence: invoice emails, replies, disputes, and follow-ups bound to the financial record they explain.
- **Cadence** gives AP obligations: vendor bills, payment runs, due dates, approvals, and cash outflows.
- **Eigen** gives foresight: runway, liquidity, covenant, and AR/AP stress simulation before an agent recommends an action.

Together they let Rowboat answer: who owes us, why have they not paid, who do we owe, what happens if this slips, and what action should a human approve next.

## Bring your own model

Rowboat works with the model setup you prefer:

- **Local models** via Ollama or LM Studio
- **Hosted models** (bring your own API key/provider)
- Swap models anytime — your data stays in your local Markdown vault

## Extend Rowboat with tools (MCP)

Rowboat can connect to external tools and services via **Model Context Protocol (MCP)**.
That means you can plug in (for example) search, databases, CRMs, support tools, and automations - or your own internal tools.

Examples: Exa (web search), Twitter/X, ElevenLabs (voice), Slack, Linear/Jira, GitHub, and more.

## Local-first by design

- All data is stored locally as plain Markdown
- No proprietary formats or hosted lock-in
- You can inspect, edit, back up, or delete everything at any time
- Cloud jobs are scoped, auditable, and designed to support the local memory rather than replace it

---

## Architecture & Deployment

There are several surfaces in this repo, but the RFC 029 product center is:

1. **Desktop control tower (`apps/x`)** - the local-first daily-driver experience and Markdown vault.
2. **Always-on execution plane (`apps/rowboat-api`)** - the Go service that runs cloud jobs, brokers connectors, meters LLM use, and keeps work moving while the desktop is closed.
3. **Control-tower UI exploration (`apps/rowboatx`)** - a newer Next.js shell for artifacts, queues, tools, tasks, and conversations.

`apps/rowboat` remains the older hosted platform/agent-builder surface. It is useful infrastructure and reference code, but RFC 029 keeps the buyer-facing wedge focused on briefs, follow-ups, relationship memory, and approval queues.

### Primary surfaces

**1. Rowboat Desktop (`apps/x`)** - the shipped user-facing product. Electron, local-first, builds the Markdown operating memory on the user's machine.

```
apps/x/
├── apps/
│   ├── main/        # Electron main process (Node) — main.ts
│   ├── renderer/    # React 19 + Vite UI
│   └── preload/     # contextBridge between main and renderer
└── packages/
    ├── shared/      # @x/shared — types, validators
    └── core/        # @x/core — AI, OAuth, MCP, business logic
```

Build chain: `shared -> core -> preload -> renderer/main`. `npm run deps` builds the workspaces; esbuild bundles the main process to a single CommonJS file because Electron Forge's dep walker can't follow pnpm symlinks. See [`apps/x/LIVE_NOTE.md`](./apps/x/LIVE_NOTE.md) for the live-note runtime.

**2. Rowboat API (`apps/rowboat-api`)** - Go service plane for desktop cloud features and always-on jobs: WorkOS auth, billing/credits, LLM gateway, provider proxies, Google/Slack OAuth, connector OAuth, background tasks, event ingestion, Temporal workflows, durable agent sessions, and OpenAPI.

```
apps/rowboat-api/
├── cmd/
│   ├── server/       # HTTP API, auth, connectors, LLM, events, background task routes
│   ├── worker/       # Temporal worker for API-native jobs and durable agents
│   └── scheduler/    # API-owned scheduler and Google watch manager
├── ent/              # Postgres schema and generated client
└── internal/         # auth, billing, connectors, jobs, runtime, agents, telemetry
```

This is the plane that makes Daily Founder Briefs, Follow-Up Sweepers, event-triggered relationship refreshes, and connector repair jobs run reliably beyond the desktop process. See [apps/rowboat-api/README.md](./apps/rowboat-api/README.md) and [apps/rfc/README.md](./apps/rfc/README.md).

**3. RowboatX (`apps/rowboatx`)** - Next.js frontend exploration for the next control-tower UI: artifacts, task queues, tool traces, conversations, JSON/Markdown editors, and app navigation.

**4. Rowboat Platform (`apps/rowboat`)** - older Next.js app that hosts projects, workflows, the visual agent builder, RAG, and the chat widget API. Hexagonal-ish layering:

```
apps/rowboat/src/
├── application/        # use-cases (agents-runtime, copilot, …)
├── entities/           # models (copilot, workflow, …)
├── infrastructure/     # adapters (Mongo, Qdrant, Redis, providers)
└── interface-adapters/
```

Plus Next.js routes under `app/api/` — `app/api/widget/v1/*` is what the chat widget calls; `app/api/v1/*` is the public Rowboat API.

### Surrounding apps

| Path | What it is |
|------|-----------|
| `apps/rowboat-www` | Oppulence marketing site and desktop companion web app. |
| `apps/cli` | CLI tool. |
| `apps/python-sdk` | The `rowboat` PyPI client (used by `simulation_runner`). |
| `apps/docs` | Docs site, shipped on port 8000 via the `docs` profile. |
| `apps/experimental/chat_widget` | Iframe-embedded end-user chat. Talks to platform at `/api/widget/v1`. |
| `apps/experimental/simulation_runner` | Async Python worker — polls `test_runs` in Mongo, role-plays scenarios via OpenAI against a Rowboat workflow, writes verdicts back. |
| `apps/experimental/tools_webhook`     | Reference Flask service that Rowboat tool-calls can POST to.                                                                        |

### Runtime composition (platform side)

`docker-compose.yml` is the orchestration spine. Active services:

```
rowboat        :3000   Next.js app (Dockerfile)
jobs-worker             scripts.Dockerfile, runs `npm run jobs-worker`
rag-worker              scripts.Dockerfile, runs `npm run rag-worker` (profile: rag-worker)
mongo          :27017   official image, data → ./data/mongo
redis          :6379    official image
qdrant         :6333    Dockerfile.qdrant (profile: qdrant), data → ./data/qdrant
setup_qdrant            one-shot init via `npm run setupQdrant` (profile: setup_qdrant)
docs           :8000    (profile: docs)
```

Commented-out but pre-wired: `rowboat_agents:3001`, `copilot:3002`, `tools_webhook:3005`, `simulation_runner`, `chat_widget:3006`, `twilio_handler:4010`. The agents service and copilot run **outside** the compose stack in the current setup — `rowboat` reaches them at `AGENTS_API_URL` / `COPILOT_API_URL`.

Three roles share one image: the `Dockerfile` runs the long-running Next server; `scripts.Dockerfile` runs the same bundle with `npm run jobs-worker` / `rag-worker` / `setupQdrant` / `deleteQdrant`. **The worker containers are the same Node bundle running a different `package.json` script**, not separate codebases.

`start.sh` is the dev entry point: sets `USE_RAG=true`, `USE_KLAVIS_TOOLS=true`, then runs `docker compose --profile setup_qdrant --profile qdrant --profile rag-worker up --build`.

### Request flow

```
End-user site
  └─ <script src=".../bootstrap.js">  →  chat_widget  (apps/experimental/chat_widget)
                                          │ /api/bootstrap.js substitutes CHAT_WIDGET_HOST / ROWBOAT_HOST
                                          ▼
                                   iframe (chat UI) ──fetch──> rowboat  (Next.js)
                                                                 │  /api/widget/v1/{session,chats,messages,turn}
                                                                 ▼
                                                 ┌──────────────────────────────┐
                                                 │ rowboat platform             │
                                                 │  ├─ Mongo (state)            │
                                                 │  ├─ Redis (queues/cache)     │
                                                 │  ├─ Qdrant (vectors)         │
                                                 │  ├─ jobs-worker  (async)     │
                                                 │  ├─ rag-worker   (ingest)    │
                                                 │  ├─ rowboat_agents (LLM)     │
                                                 │  └─ copilot      (LLM)       │
                                                 └──────────────────────────────┘
                                                                 │
                                            ┌────────────────────┴──────────────────┐
                                            ▼                                       ▼
                                     tool webhooks                      simulation_runner (poll loop)
                                     (e.g. tools_webhook)               picks up test_runs, role-plays,
                                                                        writes results
```

Two persistent workers handle async work outside the request lifecycle:

- **`jobs-worker`** — generic background queue (Redis-backed), needs Mongo + provider keys.
- **`rag-worker`** — document ingestion: pulls from S3 or `./data/uploads`, embeds, writes to Qdrant. Optional Gemini parsing, Firecrawl scraping.

### Deployment paths

The primary surfaces ship through **separate pipelines**.

**Desktop (`apps/x`)** is the only thing released from this repo's tags. Triggered on push to `main` via [`.github/workflows/release.yml`](./.github/workflows/release.yml):

1. `release-please` scans commits under `apps/x/` (per `.release-please-config.json`). On a `feat:`/`fix:`/`feat!:`, it opens (or updates) a Release PR with a `CHANGELOG.md` bump + version. Merging that PR causes the next push to produce `release_created: true` and a tag `apps/x@vX.Y.Z`.
2. Three parallel builders fan out from the tag: `build-macos` (imports Apple cert into a temp keychain, makes `.dmg` + `.zip` for arm64 + x64), `build-linux` (`.deb` / `.rpm` / `.zip` per arch), `build-windows` (Squirrel `.exe` + portable `.zip`).
3. Publish job attaches 16 installer assets + SPDX/CycloneDX SBOMs to the GitHub Release.
4. Installed clients use `update-electron-app` pointed at this fork's releases; they download in the background and apply on next launch.

End-to-end: ~6 minutes from merging the release PR to installers on the Releases page. Details in [Fork details](#fork-details) below.

**Rowboat API (`apps/rowboat-api`)** has its own quality and deploy workflows: [`.github/workflows/rowboat-api-quality.yml`](./.github/workflows/rowboat-api-quality.yml) and [`.github/workflows/rowboat-api-deploy.yml`](./.github/workflows/rowboat-api-deploy.yml). Local API development uses [`docker-compose.rowboat-api.yml`](./docker-compose.rowboat-api.yml). This is the service plane for RFC 029 jobs that need scheduled/event execution while the desktop is offline.

**Platform (`apps/rowboat`)** is source-distributed — no registry push in this fork. Users run `./start.sh` locally (or in their own infra), which builds the images from source and brings up the compose stack. Feature flags toggle behavior:

| Flag | Effect |
|------|--------|
| `USE_RAG`, `USE_RAG_UPLOADS`, `USE_RAG_S3_UPLOADS` | Enables vector store, file uploads, S3 ingestion. |
| `USE_RAG_SCRAPING` + `FIRECRAWL_API_KEY` | Web ingestion. |
| `USE_CHAT_WIDGET` + `CHAT_WIDGET_HOST` | Mounts the widget endpoints. |
| `USE_KLAVIS_TOOLS` | Tool integrations. |
| `USE_BILLING` + `BILLING_API_URL` / `BILLING_API_KEY` | Talks to an external billing service. |
| `USE_AUTH` | Auth0-gated SSR. |

### CI side-jobs

- [`rowboat-build.yml`](./.github/workflows/rowboat-build.yml) — typecheck/build for `apps/rowboat`.
- [`rowboat-api-quality.yml`](./.github/workflows/rowboat-api-quality.yml) / [`rowboat-api-deploy.yml`](./.github/workflows/rowboat-api-deploy.yml) — Go API quality and deploy gates.
- [`electron-build.yml`](./.github/workflows/electron-build.yml) / [`x-publish.yml`](./.github/workflows/x-publish.yml) / [`x-smoke-test.yml`](./.github/workflows/x-smoke-test.yml) — desktop CI gates (lint, packaging dry-run, smoke test).
- [`pr-title-lint.yml`](./.github/workflows/pr-title-lint.yml) — enforces Conventional Commits on PR titles, so release-please works.

### Where the experimental apps fit

- **`chat_widget`** is part of the **platform** stack (currently commented out in compose; would run on `:3006`). Depends on `rowboat` for `/api/widget/v1/*` and uses `CHAT_WIDGET_SESSION_JWT_SECRET`. Not part of the desktop release.
- **`simulation_runner`** is a backend test harness. It reads `test_runs` from the platform's Mongo and runs the workflow at `ROWBOAT_API_HOST`. Platform-side, currently off in compose.
- **`tools_webhook`** is a **reference implementation** for customer tool webhooks (signed-request handling, function dispatch) — not deployed by Rowboat itself.

### Summary

- Desktop app (`apps/x`) is the **local-first control tower** — release-please + electron-forge + GitHub Releases + auto-update.
- Rowboat API (`apps/rowboat-api`) is the **always-on execution plane** — scheduled jobs, event routing, connector broker, LLM gateway, Temporal worker, durable agent sessions, and observability.
- RowboatX (`apps/rowboatx`) is the **next control-tower UI exploration** for artifacts, queues, tools, tasks, and conversations.
- Web platform (`apps/rowboat`) is the **older self-hosted agent-builder platform** — one Next.js image runs as three roles (server, jobs-worker, rag-worker), plus Mongo/Redis/Qdrant, with `rowboat_agents` + `copilot` as separate LLM services and the experimental apps as optional satellites.
- These surfaces share repo-level contracts and clients where useful, but have independent release and deployment paths.

---

<div align="center">

[Discord](https://discord.gg/wajrgmJQ6b) · [Twitter](https://x.com/intent/user?screen_name=rowboatlabshq)

</div>

---

## Fork details

This fork is maintained independently of upstream. The substantive differences are confined to the desktop app under `apps/x/` plus the CI/release pipeline under `.github/workflows/`.

### Installation (this fork)

Download installers from this fork's releases page:

**Latest release:** https://github.com/Oppulence-Engineering/rowboat/releases/latest

Each release ships 16 installer assets covering the full Mac/Windows/Linux matrix (macOS `.dmg` and `.zip` for both arm64 and x64; Linux `.deb`, `.rpm`, and `.zip` for arm64 and x86_64; Windows Squirrel `.exe` installer plus a portable `.zip`), plus two supply-chain SBOMs (SPDX 2.3 and CycloneDX 1.5) so consumers can scan dependencies for known CVEs without rebuilding from source.

### Auto-update

The desktop app uses [`update-electron-app`](https://github.com/electron/update-electron-app) and is pointed at this fork's release feed (`Oppulence-Engineering/rowboat`). Installed clients check for new versions on startup and silently download in the background; the next launch boots into the new version. To opt out, quit and remove the app — no telemetry is sent past that point.

### Telemetry and crash reporting

This fork uses [PostHog](https://posthog.com/) for both product analytics and exception capture. The main process registers `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers that ship to `posthog-node`; the renderer enables `capture_exceptions: true` on the React provider so browser-side errors flow to `posthog-js` automatically. No third-party crash-reporting SDK is wired in. See [ANALYTICS.md](./ANALYTICS.md) for the full event taxonomy and opt-out instructions.

### Release process

Releases follow [Conventional Commits](https://www.conventionalcommits.org/). When a PR with a `feat:`, `fix:`, or `feat!:`/`fix!:` commit (squash-merged into `main`) touches `apps/x/`, [release-please](https://github.com/googleapis/release-please) automatically opens a release PR with the version bump and changelog entry. Merging that PR cuts a tag, triggers parallel macOS/Linux/Windows builds via electron-forge, attaches all 16 installer assets to the GitHub Release, and uploads SBOMs. Total wall-clock time is around 6 minutes.

### Upstream sync

Upstream changes are periodically merged in via `Sync fork` on the GitHub UI. Fork-specific files (anything under `.github/workflows/release.yml`, `apps/x/apps/main/forge.config.js`, `apps/x/packages/core/src/posthog.ts`, and this section of `README.md`) take precedence on conflict.

### Security

To report a vulnerability in this fork, see [SECURITY.md](./SECURITY.md) (email: admin@solomon-ai.co). Vulnerabilities in upstream code should be reported to [rowboatlabs/rowboat](https://github.com/rowboatlabs/rowboat) directly.
