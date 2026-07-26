# Oppulence

**Relationship intelligence for customer-facing teams**

Oppulence maintains an accurate, living model of every customer relationship
and tells the team what needs action.

Email, calendar, Slack, meetings, notes, and CRM each hold part of the truth.
Oppulence treats those systems as evidence streams, reconciles what they know,
and presents one explainable relationship state across the web and desktop
apps.

The product direction is captured in the
[Oppulence one-pager](./docs/one-pager.md) and
[RFC 036: Relationship State Engine](./apps/rfc/036-relationship-state-engine.md):

> Model the relationship directly. Treat every integration as an observer, link
> every material claim to evidence, and recommend the next action without
> hiding how the system reached its conclusion.

Use Oppulence to:

- Open Account Mission Control and understand the current relationship state,
  what changed, and why.
- See lifecycle, engagement, sentiment, health, participants, commitments,
  risks, milestones, and next actions in one place.
- Trace important claims back to email, calendar, Slack, CRM, meetings, notes,
  and desktop context.
- Catch accounts that need attention before a renewal, deal, onboarding, or
  commitment silently slips.
- Correct the model when the evidence is incomplete or wrong.
- Review and approve external actions before Oppulence sends or writes
  anything.

Download the latest builds for Mac, Windows, and Linux:
[Oppulence releases](https://github.com/Oppulence-Engineering/rowboat/releases/latest).

⭐ If you find Oppulence useful, please star the repo. It helps more people find it.

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

To enable external tools (optional), add MCP servers or connect
Oppulence-managed integrations from the app.

All API key files use the same format:

```
{
  "apiKey": "<key>"
}
```

## What it does

Oppulence turns fragmented activity into a durable relationship model and a
small set of concrete workflows:

- **Account Mission Control** — the current state, recent changes, supporting
  evidence, participants, commitments, risks, and recommended next action.
- **Portfolio Attention Queue** — the relationships that need review now,
  ordered by explainable signals rather than an opaque score.
- **Relationship Timeline** — source-linked observations and state changes
  across email, meetings, Slack, calendar, notes, and CRM.
- **Commitment and Risk Tracking** — open promises, unresolved objections,
  missing next steps, stalled onboarding, and renewal risk.
- **Meeting Lifecycle** — pre-briefs, live or imported notes, action
  extraction, follow-up drafts, and relationship-state updates.
- **Approval-Gated Actions** — Oppulence proposes; a person approves before an
  external send or write.
- **Source Health** — visibility into which integrations are connected,
  current, stale, or failing.

The desktop app also maintains an **Obsidian-compatible Markdown vault** for
local notes and working memory that users can inspect, edit, back up, and
delete.

## Integrations

Oppulence builds relationship state from the work the team already does:
email, calendar, Slack, meetings, notes, CRM, browser context, and connected
tools. Managed integrations and MCP servers extend that evidence and action
layer without changing the relationship model.

## How it’s different

Most AI tools search a collection of messages and generate a fresh summary.
Oppulence maintains **long-lived relationship state** instead:

- observations remain immutable and source-linked;
- assertions record whether a fact came from a source, a rule, AI inference, or
  a user correction;
- deterministic projection owns canonical state;
- user corrections outrank source facts and model inference;
- ambiguous identities wait for review rather than auto-merging;
- recommendations include their evidence and confidence;
- approvals and outcomes become part of the same history.

The result is a model that becomes more useful as evidence, corrections,
decisions, and outcomes accumulate.

## How the relationship model works

**Observe → Assert → Project → Explain → Recommend → Approve → Act → Learn**

1. **Observe** — integrations and native clients emit immutable observations.
2. **Assert** — facts, rules, inferences, and corrections become
   provenance-bearing claims.
3. **Project** — deterministic code produces the current relationship state.
4. **Explain** — every material state and change links to supporting evidence.
5. **Recommend** — Oppulence proposes the safest valuable next action.
6. **Approve** — external actions wait for a human decision.
7. **Act** — approved email, Slack, calendar, and CRM actions execute
   idempotently.
8. **Learn** — replies, meetings, edits, decisions, and outcomes update the
   relationship history.

## Web and desktop parity

Web and desktop are equal clients of the same relationship-intelligence
backend.

| Web                                                                                                                  | Desktop                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Portfolio review, team coordination, Account Mission Control, evidence, corrections, recommendations, and approvals. | The same relationship state and workflows, plus local knowledge, meeting capture, voice notes, browser context, and native execution. |

Platform-native affordances differ, but relationship state, evidence,
corrections, recommendations, and approvals stay synchronized. Neither client
ships a core relationship workflow alone.

## Core workflows

- **Account review** — understand the state of a relationship, what changed,
  what evidence supports it, and what needs action now.
- **Portfolio triage** — find quiet accounts, unresolved risks, overdue
  commitments, and missing next steps across the book of business.
- **Meeting prep and closeout** — walk in with prior context, leave with
  commitments, and project the new evidence into relationship state.
- **Follow-up recovery** — identify relationships going cold and draft the next
  touch from the full history.
- **Human approval** — review a proposed email, task, CRM update, calendar
  action, or Slack message before it lands externally.

## Background jobs

Oppulence is designed around always-on observation and projection, not only
one-off chat:

| Job                         | What it does                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Relationship Refresh        | Ingests new evidence and projects the latest account state.                                       |
| Attention Monitor           | Finds quiet accounts, unresolved risks, overdue commitments, and missing next steps.              |
| Meeting Pre-Brief           | Prepares the current state, prior evidence, participants, and open loops.                         |
| Post-Meeting Processor      | Extracts observations and commitments, drafts a recap, and updates relationship state.            |
| Recommendation Review       | Produces evidence-backed next actions and routes them for approval.                               |
| Connector Health and Repair | Surfaces stale sources, failed syncs, and token problems before the team trusts incomplete state. |

## Live notes

Live notes are desktop artifacts that stay updated from the same relationship
evidence:

- Track a customer, prospect, company, person, deal, project, partner, vendor,
  competitor, or market topic.
- Refresh on a schedule, inside a time window, on an event, or manually.
- Keep a running summary with a source trail, recent changes, open loops, and a
  suggested next action.

The local Markdown vault remains user-controlled, while shared relationship
state stays synchronized with the web app.

## Finance operating loop

Finance workflows consume the same relationship state rather than defining the
category:

- **Conduitt / Conduit** gives evidence: invoice emails, replies, disputes, and follow-ups bound to the financial record they explain.
- **Cadence** gives AP obligations: vendor bills, payment runs, due dates, approvals, and cash outflows.
- **Eigen** gives foresight: runway, liquidity, covenant, and AR/AP stress simulation before an agent recommends an action.

Together they let Oppulence detect revenue and cash-flow risk from the state of
the underlying customer and vendor relationships.

## Bring your own model

Oppulence works with the model setup you prefer:

- **Local models** via Ollama or LM Studio
- **Hosted models** (bring your own API key/provider)
- Swap models without resetting the underlying evidence or relationship
  history

## Extend Oppulence with tools (MCP)

Oppulence can connect to external tools and services through the
**Model Context Protocol (MCP)**. Add search, databases, CRMs, support tools,
automations, or internal systems as additional evidence and action providers.

Examples: Exa (web search), Twitter/X, ElevenLabs (voice), Slack, Linear/Jira, GitHub, and more.

## Evidence, control, and ownership

- Every material relationship claim links to source evidence.
- User corrections are explicit, durable, and higher priority than inferred
  state.
- Raw evidence and canonical relationship state are tenant-isolated.
- Desktop notes and working memory remain inspectable as plain Markdown.
- External actions are approval-gated and audited.
- Cloud jobs are scoped to observation, projection, recommendation, and
  approved execution.

---

## Architecture & Deployment

The product is organized around three primary surfaces backed by one
relationship model:

1. **Oppulence Web (`apps/rowboat-www`)** — portfolio review, team
   coordination, Account Mission Control, evidence, corrections,
   recommendations, and approvals.
2. **Oppulence Desktop (`apps/x`)** — the same relationship workflows plus
   ambient context, local knowledge, meeting capture, voice notes, and native
   execution.
3. **Oppulence API (`apps/rowboat-api`)** — the relationship state engine,
   evidence and assertion history, connector broker, and always-on execution
   plane shared by both clients.

`apps/rowboatx` remains a UI exploration and `apps/rowboat` remains the older
hosted agent-builder platform. They are supporting codebases, not the center of
the relationship-intelligence product direction.

### Primary surfaces

**1. Oppulence Web (`apps/rowboat-www`)** — the browser client for the same
relationship state and workflows available on desktop. It also contains the
public product site.

**2. Oppulence Desktop (`apps/x`)** — the Electron client and local observation
node. It adds native context and execution while retaining parity for core
relationship work.

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

Build chain: `shared -> core -> preload -> renderer/main`. `npm run deps` builds
the workspaces; esbuild bundles the main process to a single CommonJS file
because Electron Forge's dependency walker cannot follow pnpm symlinks. See
[`apps/x/LIVE_NOTE.md`](./apps/x/LIVE_NOTE.md) for the live-note runtime.

**3. Oppulence API (`apps/rowboat-api`)** — the Go service for canonical
relationship state, observations, assertions, projections, source health, and
always-on work. It also provides WorkOS authentication, billing and credits,
the LLM gateway, provider proxies, OAuth, background tasks, event ingestion,
Temporal workflows, durable agent sessions, and OpenAPI.

```
apps/rowboat-api/
├── cmd/
│   ├── server/       # HTTP API, auth, connectors, LLM, events, background task routes
│   ├── worker/       # Temporal worker for API-native jobs and durable agents
│   └── scheduler/    # API-owned scheduler and Google watch manager
├── ent/              # Postgres schema and generated client
└── internal/         # auth, billing, connectors, jobs, runtime, agents, telemetry
```

This shared plane keeps web and desktop at parity and makes event-triggered
relationship refreshes, attention monitoring, recommendation review, approved
actions, and connector repair reliable while either client is closed. See
[apps/rowboat-api/README.md](./apps/rowboat-api/README.md),
[apps/rfc/README.md](./apps/rfc/README.md), and
[RFC 036](./apps/rfc/036-relationship-state-engine.md).

**4. RowboatX (`apps/rowboatx`)** — Next.js frontend exploration for artifacts,
task queues, tool traces, conversations, JSON/Markdown editors, and app
navigation.

**5. Rowboat Platform (`apps/rowboat`)** — older Next.js app that hosts
projects, workflows, the visual agent builder, RAG, and the chat widget API.
Its layering is:

```
apps/rowboat/src/
├── application/        # use-cases (agents-runtime, copilot, …)
├── entities/           # models (copilot, workflow, …)
├── infrastructure/     # adapters (Mongo, Qdrant, Redis, providers)
└── interface-adapters/
```

Plus Next.js routes under `app/api/` — `app/api/widget/v1/*` is what the chat widget calls; `app/api/v1/*` is the public Oppulence API.

### Surrounding apps

| Path                                  | What it is                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli`                            | CLI tool.                                                                                                                           |
| `apps/python-sdk`                     | The `rowboat` PyPI client (used by `simulation_runner`).                                                                            |
| `apps/docs`                           | Docs site, shipped on port 8000 via the `docs` profile.                                                                             |
| `apps/experimental/chat_widget`       | Iframe-embedded end-user chat. Talks to platform at `/api/widget/v1`.                                                               |
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
4. Installed clients use `update-electron-app` with the project's GitHub
   Releases feed; they download updates in the background and apply them on
   the next launch.

End-to-end: ~6 minutes from merging the release PR to installers on the
Releases page. See [Distribution and operations](#distribution-and-operations)
below.

**Oppulence API (`apps/rowboat-api`)** has its own quality and deploy workflows:
[`.github/workflows/rowboat-api-quality.yml`](./.github/workflows/rowboat-api-quality.yml)
and
[`.github/workflows/rowboat-api-deploy.yml`](./.github/workflows/rowboat-api-deploy.yml).
Local API development uses
[`docker-compose.rowboat-api.yml`](./docker-compose.rowboat-api.yml). This is
the relationship-state and execution plane shared by the web and desktop
clients.

**Platform (`apps/rowboat`)** is source-distributed rather than pushed to a
registry. Users run `./start.sh` locally or in their own infrastructure, which
builds the images from source and brings up the Compose stack. Feature flags
toggle behavior:

| Flag                                                  | Effect                                            |
| ----------------------------------------------------- | ------------------------------------------------- |
| `USE_RAG`, `USE_RAG_UPLOADS`, `USE_RAG_S3_UPLOADS`    | Enables vector store, file uploads, S3 ingestion. |
| `USE_RAG_SCRAPING` + `FIRECRAWL_API_KEY`              | Web ingestion.                                    |
| `USE_CHAT_WIDGET` + `CHAT_WIDGET_HOST`                | Mounts the widget endpoints.                      |
| `USE_KLAVIS_TOOLS`                                    | Tool integrations.                                |
| `USE_BILLING` + `BILLING_API_URL` / `BILLING_API_KEY` | Talks to an external billing service.             |
| `USE_AUTH`                                            | Auth0-gated SSR.                                  |

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

- Oppulence Web (`apps/rowboat-www`) is the **team and portfolio client** for
  Account Mission Control, evidence, corrections, recommendations, and
  approvals.
- Oppulence Desktop (`apps/x`) is the **native relationship client and
  observation node** — release-please + electron-forge + GitHub Releases +
  auto-update.
- Oppulence API (`apps/rowboat-api`) is the **relationship-state and always-on
  execution plane** — observations, assertions, projections, source health,
  scheduled jobs, event routing, connectors, LLM gateway, Temporal, durable
  agents, and observability.
- RowboatX (`apps/rowboatx`) is a **supporting UI exploration** for artifacts,
  queues, tools, tasks, and conversations.
- Web platform (`apps/rowboat`) is the **older self-hosted agent-builder platform** — one Next.js image runs as three roles (server, jobs-worker, rag-worker), plus Mongo/Redis/Qdrant, with `rowboat_agents` + `copilot` as separate LLM services and the experimental apps as optional satellites.
- These surfaces share repo-level contracts and clients where useful, but have independent release and deployment paths.

---

## Distribution and operations

### Installation

Download installers from the project's releases page:

**Latest release:** https://github.com/Oppulence-Engineering/rowboat/releases/latest

Each release ships 16 installer assets covering the full Mac/Windows/Linux matrix (macOS `.dmg` and `.zip` for both arm64 and x64; Linux `.deb`, `.rpm`, and `.zip` for arm64 and x86_64; Windows Squirrel `.exe` installer plus a portable `.zip`), plus two supply-chain SBOMs (SPDX 2.3 and CycloneDX 1.5) so consumers can scan dependencies for known CVEs without rebuilding from source.

### Auto-update

The desktop app uses
[`update-electron-app`](https://github.com/electron/update-electron-app) with
the `Oppulence-Engineering/rowboat` release feed. Installed clients check for
new versions on startup and download them in the background; the next launch
uses the new version. To opt out, quit and remove the app.

### Telemetry and crash reporting

Oppulence uses [PostHog](https://posthog.com/) for product analytics and
exception capture. The main process registers `uncaughtException` and
`unhandledRejection` handlers through `posthog-node`; the renderer uses
`posthog-js` with exception capture enabled. See
[ANALYTICS.md](./ANALYTICS.md) for the event taxonomy and opt-out
instructions.

### Release process

Releases follow [Conventional Commits](https://www.conventionalcommits.org/). When a PR with a `feat:`, `fix:`, or `feat!:`/`fix!:` commit (squash-merged into `main`) touches `apps/x/`, [release-please](https://github.com/googleapis/release-please) automatically opens a release PR with the version bump and changelog entry. Merging that PR cuts a tag, triggers parallel macOS/Linux/Windows builds via electron-forge, attaches all 16 installer assets to the GitHub Release, and uploads SBOMs. Total wall-clock time is around 6 minutes.

### Security

To report a vulnerability, see [SECURITY.md](./SECURITY.md) or email
admin@solomon-ai.co.
