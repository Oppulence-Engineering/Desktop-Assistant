# Rowboat Apps Architecture Map

**Goal:** Explain every current source app under `apps/`, what each one does, how it works internally, and how the apps fit together.

**Scope:** This map is based on the current worktree on 2026-05-20. Generated build output such as `.next/` and `out/` is intentionally ignored except where it reveals packaging behavior.

**Important shape:** This repository is not a single root JS workspace. Most apps manage their own dependency files independently. The exception is `apps/x`, which is a nested pnpm workspace with its own `pnpm-workspace.yaml`.

---

## App Inventory

| Path | Kind | Primary role | Current entrypoints |
|---|---|---|---|
| `apps/rowboat` | Next.js app plus workers | Hosted web dashboard/API for building, testing, publishing, and running multi-agent workflows | `app/page.tsx`, `app/projects/**`, `app/api/v1/[projectId]/chat/route.ts`, worker scripts in `app/scripts/` |
| `apps/x` | Electron desktop workspace | Local-first Rowboat desktop product that builds a Markdown knowledge graph and runs local agents | `apps/main/src/main.ts`, `apps/renderer/src/main.tsx`, `apps/preload/src/preload.ts` |
| `apps/cli` | npm CLI/server package | Experimental `rowboatx` CLI runtime, workflow importer/exporter, and partial Hono backend | `bin/app.js`, `src/app.ts`, `src/server.ts`, `src/tui/index.tsx` |
| `apps/rowboatx` | static-export Next.js frontend | Browser UI prototype for the CLI-style RowboatX agent dashboard | `app/page.tsx`; static export via `next.config.ts` |
| `apps/python-sdk` | Python package | SDK client for the hosted `apps/rowboat` project chat API | `src/rowboat/client.py` |
| `apps/docs` | Mintlify docs source | Public docs content and docs navigation | `docs.json`, MDX under `docs/` |
| `apps/experimental/chat_widget` | Next.js widget | Embeddable chat iframe/client for `apps/rowboat` widget APIs | `app/page.tsx`, `app/app.tsx`, `app/api/bootstrap.js/route.ts` |
| `apps/experimental/tools_webhook` | Flask service | Signed webhook that maps LLM tool calls to Python functions | `app.py`, `tool_caller.py`, `function_map.py` |
| `apps/experimental/simulation_runner` | Python async worker | Polls simulation runs from MongoDB, talks to Rowboat, evaluates results with OpenAI | `service.py`, `simulation.py`, `db.py` |

---

## Big Picture

There are three mostly separate product families in `apps/`:

1. **Hosted workflow builder and API:** `apps/rowboat` is the central hosted app. It owns projects, workflows, API keys, conversations, jobs, RAG data sources, Composio integrations, billing checks, and the public `/api/v1/[projectId]/chat` API. `apps/python-sdk`, `apps/experimental/chat_widget`, and `apps/experimental/simulation_runner` are intended consumers of this hosted API.

2. **Local-first desktop app:** `apps/x` is the active desktop product described by the root `README.md` fork notes and `CLAUDE.md`. It stores data in `~/.rowboat`, builds a local Markdown knowledge graph, runs agents against local files and integrations, and calls a remote `https://api.x.rowboatlabs.com` backend for account/config/model gateway/search/voice surfaces.

3. **RowboatX CLI/frontend prototype:** `apps/cli` and `apps/rowboatx` model a local agent server plus a browser UI. They overlap conceptually with `apps/x` because both use `~/.rowboat` agents/runs/config, but they are not wired into the `apps/x` workspace and are currently incomplete.

`docker-compose.yml` primarily runs the hosted `apps/rowboat` stack with MongoDB, Redis, Qdrant, RAG worker, and jobs worker. The experimental services and chat widget are present but commented out. `start.sh` enables RAG/Qdrant/RAG worker profiles and starts that hosted stack.

---

## `apps/rowboat`: Hosted Dashboard And Agent Runtime

### What It Does

`apps/rowboat` is a Next.js 16 App Router application named `demo.rowboatlabs.com`. It is the hosted multi-agent workflow builder and runtime. Users create projects, configure workflows with agents/tools/prompts/pipelines/data sources, test the workflow in a playground, publish a live workflow, run jobs/triggers, and expose a project-scoped API key for external callers.

### Main User Surfaces

- `/` redirects to `/projects` when auth is disabled; otherwise it renders the landing/auth shell.
- `/projects` lists projects after `requireActiveBillingSubscription()`.
- `/projects/[projectId]` redirects to `/workflow`.
- `/projects/[projectId]/workflow` is the main workflow builder. It fetches project data, data sources, scheduled/recurring triggers, Composio trigger deployments, billing model eligibility, and feature flags before rendering the editor app.
- `/projects/[projectId]/playground` is a chat panel embedded into the workflow experience.
- `/projects/[projectId]/sources`, `/jobs`, `/conversations`, `/manage-triggers`, `/config`, and `/tools` expose the supporting management screens.

### Runtime Architecture

The app uses a clean-ish layering:

- `app/**`: Next.js routes, server actions, UI, API handlers, scripts, and low-level app libs.
- `src/entities`: Zod models for projects, users, conversations, turns, jobs, data sources, API keys, trigger rules, and templates.
- `src/application`: use cases, policies, workers, and agent runtime code.
- `src/interface-adapters`: controller classes used by server actions and API routes.
- `src/infrastructure`: MongoDB repositories, Redis services/policies, S3/local upload storage, and index setup.
- `di/container.ts`: Awilix registration for repositories, policies, controllers, workers, and services.

Most browser actions call `app/actions/*.actions.ts`, which:

1. Runs `authCheck()` / `requireAuth()` when `USE_AUTH=true`.
2. Resolves a controller from `di/container.ts`.
3. Passes caller context (`user`, `api`, or `job_worker`) into a use case.
4. Lets use cases authorize, consume quota, read/write repositories, and invoke the agent runtime.

### Chat API Flow

The production external API is:

```text
POST /api/v1/[projectId]/chat
Authorization: Bearer <project API key>
```

`app/api/v1/[projectId]/chat/route.ts` parses `ApiRequest`, resolves `runTurnController`, and passes `caller: "api"` plus the bearer token. `RunTurnController` creates a conversation if needed and then delegates to `RunConversationTurnUseCase`.

`RunConversationTurnUseCase`:

1. Fetches the conversation from MongoDB.
2. Authorizes the caller through `ProjectActionAuthorizationPolicy`.
3. Consumes Redis-backed usage quota.
4. Performs billing authorization when `USE_BILLING=true`.
5. Adds timestamps and appends previous turn history.
6. Calls `streamResponse(projectId, workflow, messages, usageTracker)`.
7. Saves the output as a conversation turn.
8. Logs billing usage in `finally`.

The workflow runtime in `src/application/lib/agents-runtime/` uses the OpenAI Agents SDK plus AI SDK model adapters. It builds agents from workflow config, attaches tools, supports RAG tools, pipeline/handoff behavior, mock tools, MCP/Composio/custom tools, and emits assistant/tool messages.

### Data And Services

`apps/rowboat` uses:

- MongoDB via `app/lib/mongodb.ts` for `projects`, `project_members`, `api_keys`, `conversations`, `jobs`, `sources`, `source_docs`, trigger rules, users, and templates.
- Redis via `app/lib/redis.ts` for cache, pub/sub, and quota counters.
- Qdrant via `app/lib/qdrant.ts` for embeddings in the RAG tool.
- S3 or local uploads for RAG files and generated images.
- Auth0 via `app/lib/auth0.ts` and `middleware.ts` when `USE_AUTH=true`.
- Billing API via `app/lib/billing.ts` when `USE_BILLING=true`.
- Composio via `src/application/lib/composio/` for connected accounts, tool execution, and webhook triggers.
- Optional Firecrawl/Gemini/OpenAI provider environment for scraping, embeddings, image generation, and model calls.

### Workers

`docker-compose.yml` starts:

- `jobs-worker`: `npm run jobs-worker`, which polls/locks jobs and also subscribes to Redis `new_jobs`.
- `rag-worker`: `npm run rag-worker`, which ingests/crawls/parses data sources into MongoDB/Qdrant.
- `setup_qdrant` and `delete_qdrant` one-off profiles.

`JobRulesWorker` polls scheduled and recurring rules at minute boundaries, creates jobs, and publishes `new_jobs`. `JobsWorker` creates a conversation for the job, runs a turn against the live workflow, and marks the job completed or failed.

### Current Gaps In This App

Several integration surfaces are present but currently stubbed:

- Chat widget session/auth wrappers return `501 Not implemented` in `app/api/widget/v1/utils.ts`.
- Widget turn route returns `501 Not implemented`.
- Twilio inbound/turn routes return `501 Not implemented`.
- The synchronous `getResponse()` helper in `agents-runtime/agents.ts` throws `Not implemented`; the main production API uses `streamResponse()` instead.

---

## `apps/x`: Electron Desktop Product

### What It Does

`apps/x` is the active local-first desktop app. It connects to Gmail, Calendar, Fireflies, Granola, Chrome extension data, local notes, MCP tools, Composio, browser control, and scheduled/background agents. Its core product model is a transparent `~/.rowboat` workspace containing Markdown knowledge files, agent definitions, config JSON, run logs, events, and local state.

### Workspace Layout

`apps/x` is a nested pnpm workspace:

```text
apps/x/
  apps/main      Electron main process and packaging
  apps/renderer  React/Vite UI
  apps/preload   contextBridge IPC adapter
  packages/core  business logic, agents, file storage, OAuth, sync, MCP
  packages/shared Zod schemas, IPC schemas, shared data contracts
```

Build order is `shared -> core -> preload`, then renderer/main. `apps/x/package.json` exposes `npm run deps` for the dependency build and `npm run dev` for renderer plus Electron main.

### Main Process

`apps/main/src/main.ts` is the Electron entrypoint. It:

- Registers JS and native crash reporting through PostHog.
- Registers `rowboat://` deep links.
- Fixes PATH for packaged macOS/Linux GUI launches by loading the user's login shell environment.
- Registers the `app://` protocol for renderer files and safe workspace media serving.
- Creates the BrowserWindow with `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, and the preload script.
- Initializes configs, analytics identity, browser control, notification services, IPC handlers, and browser event forwarding.
- Starts long-running services: workspace watcher, runs watcher, service watcher, live note/background task event forwarding, live-note scheduler, background-task scheduler, event processor, Gmail/Calendar/Fireflies/Granola sync, graph builder, email labeling, note tagging, inline `@rowboat` tasks, scheduled agents, agent-notes learning, meeting notifications, Chrome extension sync server, and local-sites server.
- Initializes auto-updates in packaged builds from the `Oppulence-Engineering/rowboat` GitHub release feed.

### Renderer

`apps/renderer/src/main.tsx` bootstraps React, PostHog, and theming. `App.tsx` is the large shell that renders:

- Workspace file tree/editor/viewers.
- Chat sidebar and agent conversation UI.
- Markdown editor with custom blocks.
- Graph view, bases view, meetings view, email view, suggested topics, live notes, background tasks.
- Browser pane, version history, settings, onboarding, Composio migration and connection cards.

Renderer code never receives Node directly. It talks to main through `window.ipc`, exposed by preload.

### Preload And IPC

`apps/preload/src/preload.ts` exposes a typed IPC facade:

- `invoke(channel, args)` for request/response channels.
- `send(channel, args)` for fire-and-forget channels.
- `on(channel, handler)` for pushed events.

The source of truth for channel schemas is `packages/shared/src/ipc.ts`. Main registers handlers in `apps/main/src/ipc.ts`, validates request/response payloads at runtime, and delegates to `@x/core`.

Major IPC groups include:

- Workspace filesystem: read/write/stat/readdir/mkdir/rename/copy/remove plus change events.
- Runs: create/list/fetch/delete, append user messages, authorize tool calls, reply to human input, stop.
- MCP: list and execute tools.
- Gmail, meetings, OAuth, model config, Composio, live notes, background tasks, browser control, voice, search, billing/account.

### Core Package

`packages/core` owns the local business logic:

- `config/`: creates `~/.rowboat/config`, default model/MCP/security configs, remote API config.
- `workspace/`: safe path handling, atomic writes, workspace watcher, wiki-link rewrite, Git-backed version history.
- `agents/` and `runs/`: file-backed agents and JSONL run logs under `~/.rowboat/agents` and `~/.rowboat/runs`.
- `application/lib/builtin-tools.ts`: workspace tools, command execution with allow-listing, MCP config/tools, Composio meta-tools, search, file parsing, browser control, live-note/background-task helpers.
- `knowledge/`: Gmail/Calendar/Fireflies/Granola sync, meeting summarization, graph building, email labeling, note tagging, inline tasks, Chrome extension server, live notes.
- `background-tasks/` and `agent-schedule/`: scheduled and event-triggered agent execution.
- `analytics/`: PostHog identity, usage capture, JS/native exception capture.
- `models/`: OpenAI, Anthropic, Google, OpenRouter, Ollama, AI Gateway, and openai-compatible provider creation.

### External Coupling

The desktop app is local-first for workspace data, but it still uses `API_URL`, defaulting to `https://api.x.rowboatlabs.com`, for:

- `/v1/config` remote app/websocket/config discovery.
- `/v1/me` billing/account identity.
- `/v1/llm` and `/v1/llm/models` gateway model access.
- `/v1/search/exa` search fallback.
- `/v1/voice/text-to-speech/...` voice output.
- `/v1/composio` proxy endpoints.
- Backend-assisted OAuth/token claim flows.

---

## `apps/cli`: RowboatX CLI And Partial Server

### What It Does

`apps/cli` packages an npm binary named `rowboatx`. It appears to be an earlier or experimental local agent runtime for `~/.rowboat`. It has:

- File-backed agents in `~/.rowboat/agents`.
- File-backed runs in `~/.rowboat/runs/*.jsonl`.
- File-backed model/MCP config in `~/.rowboat/config`.
- AI SDK provider support.
- Built-in tools for reading/writing files, executing commands, MCP, and skills.
- Import/export commands for example workflows.
- A Hono server and an Ink TUI.

### Current CLI Commands

`bin/app.js` defines:

- default `rowboatx`: calls `app(...)`, but `src/app.ts` currently throws `Not implemented`.
- `rowboatx ui`: starts the Ink TUI against a server URL.
- `rowboatx import`: imports a packaged example or custom workflow into `~/.rowboat`.
- `rowboatx list-examples`.
- `rowboatx export`.
- `rowboatx model-config`.

### Current Server Reality

`src/server.ts` starts Hono on `PORT` or `3000`, but the implemented routes are only:

- `POST /runs/:runId/messages/new`
- `POST /runs/:runId/permissions/authorize`
- `POST /runs/:runId/human-input-requests/:requestId/reply`
- `POST /runs/:runId/stop`
- `GET /stream`
- `GET /openapi.json`

The TUI client in `src/tui/api.ts` expects more routes (`/health`, `/models`, `/agents`, `/runs`, `/runs/new`, `/runs/:id`), but those are not currently present in `src/server.ts`. `stop()` in `src/runs/runs.ts` is also not implemented. So the server/TUI shape is aspirational unless those routes exist elsewhere at runtime.

---

## `apps/rowboatx`: Browser UI Prototype For RowboatX

### What It Does

`apps/rowboatx` is a static-export Next.js frontend named `rowboatx-frontend`. The UI uses shadcn/Radix-style components and many AI Elements components to render:

- Sidebar of agents/config/runs.
- Chat input and model/agent picker.
- SSE run event stream.
- Tool calls, reasoning blocks, artifacts, JSON editor, Markdown editor, and resource viewer.

### How It Talks To Backends

The page defaults `apiBase` to `http://localhost:3000`, then reads `window.config.apiBase`. It sends CLI-runtime requests to that base URL, for example:

- `/runs/new`
- `/runs/:runId/messages/new`
- `/agents/:id`
- `/mcp`
- `/models`

It also fetches same-origin helper routes:

- `/api/rowboat/summary`
- `/api/rowboat/agent`
- `/api/rowboat/config`
- `/api/rowboat/run`

There are no `app/api/**` files in `apps/rowboatx`, and `next.config.ts` sets `output: "export"`, so those same-origin API routes are not implemented inside this Next app. This frontend currently requires an external/static-host companion to provide `window.config` and the `/api/rowboat/*` helpers.

---

## `apps/python-sdk`: Hosted API Client

### What It Does

`apps/python-sdk` is a Python package named `rowboat` at version `5.0.1`. It is a thin client for `apps/rowboat`'s project chat API.

`Client(host, projectId, apiKey)` builds:

```text
{host}/api/v1/{projectId}/chat
Authorization: Bearer {apiKey}
```

`run_turn(messages, conversationId=None, mockTools=None)` posts `ApiRequest` and parses `ApiResponse`. Conversation state is server-side; callers continue by passing the returned `conversationId`.

### Relationship

This is the cleanest external integration with `apps/rowboat`: it maps directly to `app/api/v1/[projectId]/chat/route.ts` and uses the same conversation/turn shape conceptually.

---

## `apps/docs`: Mintlify Docs Source

### What It Does

`apps/docs` is a Mintlify docs tree. `docs.json` defines the docs theme, navigation, colors, navbar CTA, footer links, and contextual copy/view/chat options. MDX content lives under `docs/getting-started` and `docs/development`, with images/videos under `docs/img` and `docs/videos`.

### Relationship

This is documentation content, not a runtime package. `docker-compose.yml` contains a `docs` service that points at `apps/docs/Dockerfile`, but that Dockerfile is not present in the current tree.

---

## `apps/experimental/chat_widget`: Embeddable Hosted Chat UI

### What It Does

This is a small Next.js widget UI. It expects to be embedded as an iframe/client around `apps/rowboat` widget APIs.

`app/page.tsx` passes:

```text
apiUrl = ${ROWBOAT_HOST}/api/widget/v1
```

The client reads `session_id` and `minimized` query params, loads the last chat, lists messages, creates chats, sends turns, closes chats, and posts state events to the parent window:

- `sessionExpired`
- `chatStateChange`
- `chatLoaded`

`app/api/bootstrap.js/route.ts` serves a JS bootstrap file by fetching `${CHAT_WIDGET_HOST}/bootstrap.template.js` and replacing `__CHAT_WIDGET_HOST__` and `__ROWBOAT_HOST__`.

### Current State

The frontend is mostly wired, but the matching backend in `apps/rowboat/app/api/widget/v1` is not complete. `clientIdCheck()` and `authCheck()` return `501 Not implemented`, and the widget turn route also returns `501`. In the current tree, the widget is therefore a UI shell around incomplete hosted widget APIs.

---

## `apps/experimental/tools_webhook`: Signed Python Tool Webhook

### What It Does

This Flask service exposes:

```text
POST /tool_call
```

Request shape:

- Outer JSON has `content`, which itself is a JSON string.
- Inner JSON has `toolCall.function.name` and `toolCall.function.arguments`.
- `arguments` is another JSON string.

If `SIGNING_SECRET` is set, the service requires an `X-Signature-Jwt` header signed with HS256. The JWT must contain `bodyHash`, and that hash must match `sha256(content)`.

Then `tool_caller.call_tool()`:

1. Looks up the function name in `FUNCTIONS_MAP`.
2. Validates required/unexpected arguments from the Python function signature.
3. Converts annotated argument types.
4. Calls the function and returns the result.

Current built-in mock functions are `greet`, `add`, and `get_account_balance`.

### Relationship

This service is optional and currently commented out in `docker-compose.yml`. It can act as an external webhook/tool endpoint for a Rowboat workflow, but no active compose profile starts it by default.

---

## `apps/experimental/simulation_runner`: Test Simulation Worker

### What It Does

This is an async Python polling worker for simulation runs stored in MongoDB. It is designed to test a Rowboat workflow by role-playing a user against the chatbot, then asking OpenAI to judge whether the result passes criteria.

### Runtime Flow

`JobService` in `service.py`:

1. Polls MongoDB every five seconds for `test_runs` with `status: "pending"`.
2. Marks the run `running`.
3. Starts a heartbeat loop that updates `lastHeartbeat`.
4. Loads simulations from `test_simulations`.
5. Reads a project API key from `api_keys`.
6. Calls `simulate_simulations(...)`.
7. Writes per-simulation `test_results`.
8. Updates the run to `completed` with aggregate pass/fail counts.
9. Separately marks stale running jobs as failed after the heartbeat threshold.

`simulation.py` creates an OpenAI-simulated user, sends user messages through a Rowboat client, records the transcript, then asks OpenAI for a JSON pass/fail verdict.

### Relationship And Caveat

The worker is meant to call the hosted `apps/rowboat` API through `ROWBOAT_API_HOST`. However, `requirements.txt` pins `rowboat==2.1.0`, and `simulation.py` imports `StatefulChat`, which is not present in the local `apps/python-sdk` source. In current form, this worker depends on a published SDK version rather than the local SDK in this repository.

---

## How The Apps Work Together

```text
                                  ROWBOAT APPS

  Hosted workflow platform
  ------------------------

  apps/python-sdk --------------------------+
                                            |
  apps/experimental/simulation_runner ------+--> apps/rowboat
                                                 Next.js dashboard + API
                                                 /api/v1/[projectId]/chat
                                                 |
                                                 +--> MongoDB
                                                 +--> Redis
                                                 +--> Qdrant
                                                 +--> S3/local uploads
                                                 +--> Billing API
                                                 +--> Composio
                                                 +--> OpenAI/provider APIs
                                                 +--> RAG worker
                                                 +--> jobs worker

  apps/experimental/chat_widget --intended--> apps/rowboat /api/widget/v1
                                               Current state: partly stubbed

  apps/rowboat --optional external tool call--> apps/experimental/tools_webhook


  Local-first desktop product
  ---------------------------

  apps/x/apps/renderer
  React/Vite UI
        |
        v
  apps/x/apps/preload
  typed IPC bridge
        |
        v
  apps/x/apps/main
  Electron main process
        |
        v
  apps/x/packages/core  <------>  apps/x/packages/shared
  local agents, sync, MCP,       Zod schemas and IPC contracts
  workspace, OAuth, browser
        |
        +--> ~/.rowboat
        |    agents, runs, config, knowledge
        |
        +--> api.x.rowboatlabs.com
             account, model gateway, search, voice, Composio proxy


  RowboatX CLI/browser prototype
  ------------------------------

  apps/rowboatx
  static Next.js frontend
        |
        | expects /runs, /agents, /models, /mcp
        | expects same-origin /api/rowboat/* helpers
        v
  apps/cli
  rowboatx CLI + partial Hono server
        |
        v
  ~/.rowboat
  agents, runs, config

  Note: this uses the same filesystem convention as apps/x, but it is not
  wired into the apps/x pnpm workspace.


  Documentation
  -------------

  apps/docs
  Mintlify docs source
        |
        +--> documents hosted workflow platform
        +--> documents desktop product
```

Arrows marked `intended`, `optional`, or `expects` mean the integration is partial, optional, or depends on missing companion routes in the current tree.

### Hosted API Family

```text
apps/python-sdk
        |
        v
apps/rowboat /api/v1/[projectId]/chat
        |
        +--> MongoDB conversations/projects/api_keys
        +--> Redis quota/cache/pubsub
        +--> Qdrant RAG vectors
        +--> OpenAI/AI SDK/Agents runtime
        +--> Billing API, Composio, S3/local uploads
```

`apps/experimental/simulation_runner` is another consumer of the same hosted API, but through the published Python SDK. `apps/experimental/chat_widget` is intended to consume `apps/rowboat`'s `/api/widget/v1` routes, but those routes are stubbed today.

### Desktop Family

```text
apps/x/apps/renderer
        |
        v
apps/x/apps/preload typed IPC
        |
        v
apps/x/apps/main
        |
        v
apps/x/packages/core + apps/x/packages/shared
        |
        +--> ~/.rowboat workspace files
        +--> remote https://api.x.rowboatlabs.com for account/model/search/voice/composio
        +--> local OAuth/sync/MCP/browser/agent services
```

The desktop app does not depend on `apps/rowboat` code. It has its own local schemas under `@x/shared`, its own local runtime under `@x/core`, and its own remote backend URL.

### CLI/Prototype Family

```text
apps/rowboatx static frontend
        |
        +--> expects same-origin /api/rowboat/* helpers
        +--> expects a RowboatX API base for /runs, /agents, /models, /mcp

apps/cli Hono server
        |
        +--> currently implements only a subset of those routes
        +--> stores agents/runs/config under ~/.rowboat
```

The intent appears to be a browser or terminal UI over a local agent server. The current implementation is incomplete compared with the frontend/TUI expectations.

---

## Current Integration Risks And Stale Edges

- `apps/cli` default command cannot run an agent because `app()` throws `Not implemented`.
- `apps/cli` TUI and `apps/rowboatx` expect server endpoints not currently implemented in `apps/cli/src/server.ts`.
- `apps/rowboatx` static export references same-origin API helpers that do not exist in the app source.
- `apps/rowboat` widget routes and Twilio routes are mostly present but currently return `501`.
- `apps/experimental/chat_widget` depends on those incomplete widget routes.
- `apps/experimental/simulation_runner` depends on a published `rowboat==2.1.0` SDK API, not the local `apps/python-sdk` API.
- `docker-compose.yml` has commented services for the experiments, and its active `docs` service references a missing `apps/docs/Dockerfile`.
- `apps/rowboat` and `apps/experimental/chat_widget` both consume `rowboat-shared` from `github:rowboatlabs/shared`; `apps/x` uses local `@x/shared`; `apps/cli` has its own schemas. There is no single shared schema package across all app families.

---

## Useful Commands By Area

Hosted app:

```bash
cd apps/rowboat
npm install
npm run dev
npm run build
npm run mongodb-ensure-indexes
```

Hosted local stack:

```bash
./start.sh
```

Desktop app:

```bash
cd apps/x
pnpm install
npm run deps
npm run dev
npm run lint
cd apps/main && npm run make
```

CLI prototype:

```bash
cd apps/cli
npm install
npm run build
npm run server
node bin/app.js model-config
```

RowboatX frontend prototype:

```bash
cd apps/rowboatx
npm install
npm run build
```

Python SDK:

```bash
cd apps/python-sdk
pip install -e .
```

Experimental services:

```bash
cd apps/experimental/tools_webhook
pip install -r requirements.txt
flask run --host=0.0.0.0 --port=3005

cd apps/experimental/simulation_runner
pip install -r requirements.txt
python service.py
```
