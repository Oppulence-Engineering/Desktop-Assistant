# CLAUDE.md - AI Coding Agent Context

This file provides context for AI coding agents working on the Rowboat monorepo.

## Quick Reference Commands

```bash
# Electron App (apps/x)
cd apps/x && pnpm install          # Install dependencies
cd apps/x && npm run deps          # Build workspace packages (shared → core → preload)
cd apps/x && npm run dev           # Development mode (builds deps, runs app)
cd apps/x && npm run lint          # Lint check
cd apps/x/apps/main && npm run package   # Production build (.app)
cd apps/x/apps/main && npm run make      # Create DMG distributable
```

## Monorepo Structure

```
rowboat/
├── apps/
│   ├── x/                 # Electron desktop app (focus of this doc)
│   ├── rowboat/           # Next.js web dashboard
│   ├── rowboat-www/       # Oppulence marketing and desktop companion web app
│   ├── rowboat-api/       # Go desktop backend (billing, LLM gateway, OAuth broker)
│   ├── oauth-consent/     # Ory Hydra login + consent UI (TS/Express) — DEFERRED (see rowboat-api/AUTH.md)
│   ├── cli/               # CLI tool
│   ├── python-sdk/        # Python SDK
│   └── docs/              # Documentation site
├── packages/
│   ├── oauth-resource-server-go/   # JWT/JWKS verification lib (Go)
│   └── oauth-resource-server-ts/   # JWT/JWKS verification lib (TS, @oppulence/oauth-resource-server)
├── charts/                # Helm: rowboat-api, oauth-consent, hydra values
├── docs/                  # Operational/product docs; architecture RFCs live in apps/rfc
├── CLAUDE.md              # This file
└── README.md              # User-facing readme
```

The Go backend (`apps/rowboat-api`) replaces the closed hosted backend the
desktop used. Architecture lives in [apps/rfc/README.md](apps/rfc/README.md),
especially RFCs 010-012; deployment operations live in
[docs/BACKEND_DEPLOYMENT.md](docs/BACKEND_DEPLOYMENT.md).

## Electron App Architecture (`apps/x`)

The Electron app is a **nested pnpm workspace** with its own package management.

```
apps/x/
├── package.json           # Workspace root, dev scripts
├── pnpm-workspace.yaml    # Defines workspace packages
├── pnpm-lock.yaml         # Lockfile
├── apps/
│   ├── main/              # Electron main process
│   │   ├── src/           # Main process source
│   │   ├── forge.config.cjs   # Electron Forge config
│   │   └── bundle.mjs     # esbuild bundler
│   ├── renderer/          # React UI (Vite)
│   │   ├── src/           # React components
│   │   └── vite.config.ts
│   └── preload/           # Electron preload scripts
│       └── src/
└── packages/
    ├── shared/            # @x/shared - Types, utilities, validators
    └── core/              # @x/core - Business logic, AI, OAuth, MCP
```

### Build Order (Dependencies)

```
shared (no deps)
   ↓
core (depends on shared)
   ↓
preload (depends on shared)
   ↓
renderer (depends on shared)
main (depends on shared, core)
```

**The `npm run deps` command builds:** shared → core → preload

### Key Entry Points

| Component | Entry                         | Output                         |
| --------- | ----------------------------- | ------------------------------ |
| main      | `apps/main/src/main.ts`       | `.package/dist/main.cjs`       |
| renderer  | `apps/renderer/src/main.tsx`  | `apps/renderer/dist/`          |
| preload   | `apps/preload/src/preload.ts` | `apps/preload/dist/preload.js` |

## Build System

- **Package manager:** pnpm (required for `workspace:*` protocol)
- **Main bundler:** esbuild (bundles to single CommonJS file)
- **Renderer bundler:** Vite
- **Packaging:** Electron Forge
- **TypeScript:** ES2022 target

### Why esbuild bundling?

pnpm uses symlinks for workspace packages. Electron Forge's dependency walker can't follow these symlinks. esbuild bundles everything into a single file, eliminating the need for node_modules in the packaged app.

## Key Files Reference

| Purpose                  | File                                  |
| ------------------------ | ------------------------------------- |
| Electron main entry      | `apps/x/apps/main/src/main.ts`        |
| React app entry          | `apps/x/apps/renderer/src/main.tsx`   |
| Forge config (packaging) | `apps/x/apps/main/forge.config.cjs`   |
| Main process bundler     | `apps/x/apps/main/bundle.mjs`         |
| Vite config              | `apps/x/apps/renderer/vite.config.ts` |
| Shared types             | `apps/x/packages/shared/src/`         |
| Core business logic      | `apps/x/packages/core/src/`           |
| Workspace config         | `apps/x/pnpm-workspace.yaml`          |
| Root scripts             | `apps/x/package.json`                 |

## Feature Deep-Dives

Long-form docs for specific features. Read the relevant file before making changes in that area — it has the full product flow, technical flows, and (where applicable) a catalog of the LLM prompts involved with exact file:line pointers.

| Feature                                                                                                                                                                                                                 | Doc                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Live Notes — single `live:` frontmatter block (one objective + optional cron / windows / eventMatchCriteria) that turns a note into a self-updating artifact, panel UI, Copilot skill, prompts catalog                  | `apps/x/LIVE_NOTE.md`       |
| Analytics — PostHog event catalog, person properties, use-case taxonomy, how to add a new event                                                                                                                         | `apps/x/ANALYTICS.md`       |
| Meeting Capture — local dual-track recording (mic + system audio) through the `oppulence-audiocap` Swift sidecar, the filesystem-as-queue transcription pipeline, retention, and the manual signal-verification runbook | `apps/x/MEETING_CAPTURE.md` |

## Common Tasks

### LLM configuration (single provider)

- Config file: `~/.rowboat/config/models.json`
- Schema: `{ provider: { flavor, apiKey?, baseURL?, headers? }, model: string }`
- Models catalog cache: `~/.rowboat/config/models.dev.json` (OpenAI/Anthropic/Google only)

### Add a new shared type

1. Edit `apps/x/packages/shared/src/`
2. Run `cd apps/x && npm run deps` to rebuild

### Modify main process

1. Edit `apps/x/apps/main/src/`
2. Restart dev server (main doesn't hot-reload)

### Modify renderer (React UI)

1. Edit `apps/x/apps/renderer/src/`
2. Changes hot-reload automatically in dev mode

### Add a new dependency to main

1. `cd apps/x/apps/main && pnpm add <package>`
2. Import in source - esbuild will bundle it

### Verify compilation

```bash
cd apps/x && npm run deps && npm run lint
```

## Tech Stack

| Layer   | Technology                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| Desktop | Electron 39.x                                                                                              |
| UI      | React 19, Vite 7                                                                                           |
| Styling | TailwindCSS, Radix UI                                                                                      |
| State   | React hooks                                                                                                |
| AI      | Vercel AI SDK, OpenAI/Anthropic/Google/OpenRouter providers, Vercel AI Gateway, Ollama, models.dev catalog |
| IPC     | Electron contextBridge                                                                                     |
| Build   | TypeScript 5.9, esbuild, Electron Forge                                                                    |

## Environment Variables (for packaging)

For production builds with code signing:

- `APPLE_ID` - Apple Developer ID
- `APPLE_PASSWORD` - App-specific password
- `APPLE_TEAM_ID` - Team ID

Not required for local development.

<!-- code-review-graph MCP tools -->

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool                             | Use when                                               |
| -------------------------------- | ------------------------------------------------------ |
| `detect_changes_tool`            | Reviewing code changes — gives risk-scored analysis    |
| `get_review_context_tool`        | Need source snippets for review — token-efficient      |
| `get_impact_radius_tool`         | Understanding blast radius of a change                 |
| `get_affected_flows_tool`        | Finding which execution paths are impacted             |
| `query_graph_tool`               | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool`     | Finding functions/classes by name or keyword           |
| `get_architecture_overview_tool` | Understanding high-level codebase structure            |
| `refactor_tool`                  | Planning renames, finding dead code                    |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
