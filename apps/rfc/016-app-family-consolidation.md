# RFC 016: App Family Consolidation

|                  |                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**          | 016                                                                                                                                                                                                                               |
| **Status**       | Draft                                                                                                                                                                                                                             |
| **Track**        | Repository and app architecture                                                                                                                                                                                                   |
| **Owners**       | `repo/apps`                                                                                                                                                                                                                       |
| **Created**      | 2026-06-06                                                                                                                                                                                                                        |
| **Last updated** | 2026-06-06                                                                                                                                                                                                                        |
| **Depends on**   | [RFC 010](./010-rowboat-api-service-plane.md), [RFC 015](./015-rowboat-platform-workos-fga-and-widget-auth.md)                                                                                                                    |
| **Related**      | [RFC 009](./complete-009-local-on-device-transcription.md), [RFC 012](./012-connector-suite-and-consent-broker.md), [RFC 013](./013-oppulence-product-connector-fabric.md), [RFC 018](./018-a2a-delegation-and-agent-identity.md) |
| **Refs**         | Supersedes the former app architecture map and app-boundary portions of the former backend implementation plan; operational reference: [`docs/LOCAL_KIND_ROWBOAT_API.md`](../../docs/LOCAL_KIND_ROWBOAT_API.md).                  |

## Summary

The repository contains multiple app surfaces that evolved at different speeds:
the desktop app, hosted platform, Go service plane, SDK, CLI, static frontends,
widget experiments, webhook experiments, simulation runners, and docs site. Some
are product surfaces. Some are client libraries. Some are useful experiments.
Some imply APIs that do not exist.

This RFC makes the app family explicit. It defines which apps are canonical,
which are supported clients, which are quarantined until repaired, and which
shared contracts prevent another round of drift.

## Current state

| App                                   | Current role               | Issue                                                                                                                 |
| ------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/x`                              | Desktop product            | Canonical desktop surface, but it now spans local capture, cloud control plane, product connectors, and local models. |
| `apps/rowboat-api`                    | Go service plane           | Becoming the canonical backend for desktop cloud features, but docs were ahead of the implementation.                 |
| `apps/rowboat`                        | Hosted platform            | Separate Next.js platform with its own auth, project, widget, and chat model.                                         |
| `apps/python-sdk`                     | SDK                        | Should map to the hosted API contract, but contract ownership is unclear.                                             |
| `apps/cli`                            | CLI/TUI experiment         | Contains incomplete server/TUI paths and should not be treated as a production local API.                             |
| `apps/rowboatx`                       | Static frontend experiment | Expects `/api/rowboat/*` and local API endpoints that are not a committed contract.                                   |
| `apps/experimental/chat_widget`       | Widget experiment          | Useful UI work, but depends on hosted widget APIs that need completion under RFC 015.                                 |
| `apps/experimental/tools_webhook`     | Webhook experiment         | Useful as a reference integration, not a product surface.                                                             |
| `apps/experimental/simulation_runner` | Simulation harness         | Depends on the published `rowboat==2.1.0` package instead of the local SDK.                                           |
| `apps/docs`                           | Documentation site         | Docs source exists, but app packaging should be made explicit before treating it as deployable.                       |

## Problem

Without an app-family contract, implementation work lands in the wrong place:

- A prototype frontend can imply backend endpoints that are not real.
- A CLI can accidentally grow a parallel local server contract.
- Widget work can split between hosted platform routes and experimental code.
- The SDK can drift from both hosted and desktop APIs.
- Desktop cloud features can mix local-only implementation detail with service
  plane contracts.
- Product connector work can duplicate auth, tenant, and resource semantics.

The cost is not just code organization. It affects docs, developer onboarding,
API compatibility, product positioning, and test coverage.

## Goals

- Name the canonical app surfaces.
- Define supported client and experimental tiers.
- Assign each API contract to one owner.
- Establish promotion and deprecation rules for apps under `apps/`.
- Align SDK, CLI, widget, and static frontend work with actual service
  contracts.
- Keep desktop, hosted platform, and Go service plane distinct without
  duplicating shared schemas.

## Non-Goals

- Merging desktop and hosted platform into one app.
- Replacing the Go service plane with the hosted Next.js app.
- Rewriting existing product UI.
- Choosing a monorepo build system.
- Solving WorkOS migration details; see RFC 015.
- Solving desktop cloud execution; see RFCs 001-007 and RFC 010.

## App tiers

### Tier 1: Canonical product surfaces

| App                | Decision                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/x`           | Canonical desktop app. Owns local capture, local models, live notes, desktop control plane, and desktop presentation of Oppulence product connectors.                                       |
| `apps/rowboat`     | Canonical hosted Rowboat platform. Owns hosted builder, hosted chat, projects, hosted widget APIs, and hosted WorkOS/FGA integration.                                                       |
| `apps/rowboat-api` | Canonical Go service plane for desktop cloud capabilities. Owns background cloud runs, connector consent broker, desktop cloud API, billing/credit checks, and service-plane observability. |

Tier 1 apps must have owner docs, environment docs, health checks where
server-side, and CI gates that exercise their primary workflow.

### Tier 2: Supported clients

| App                             | Decision                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/python-sdk`               | Supported hosted-platform SDK. It must be generated from or tested against the hosted API contract owned by `apps/rowboat`.                      |
| `apps/cli`                      | Supported only as a thin client after its partial local server/TUI contract is removed, hidden, or completed behind explicit experimental flags. |
| `apps/experimental/chat_widget` | Can graduate only by consuming the widget session APIs from RFC 015 or being folded into `apps/rowboat`.                                         |

Tier 2 apps cannot define independent backend semantics. They consume Tier 1
contracts.

### Tier 3: Experiments and references

| App                                   | Decision                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/rowboatx`                       | Quarantine until its expected `/api/rowboat/*` and local API dependencies are either implemented by a Tier 1 owner or removed. |
| `apps/experimental/tools_webhook`     | Keep as a reference integration if it is documented against RFC 012/RFC 003 contracts.                                         |
| `apps/experimental/simulation_runner` | Keep only if it can run against the local SDK or is clearly pinned as an external compatibility fixture.                       |
| `apps/docs`                           | Treat as docs source until Docker/build/deploy ownership is explicit.                                                          |

Tier 3 apps may remain in-repo, but their READMEs must state that they are not
production surfaces.

## Contract ownership

| Contract                                 | Owner                         | Consumers                                                |
| ---------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| Desktop cloud API                        | `apps/rowboat-api`            | `apps/x`, future CLI                                     |
| Hosted project/chat/widget API           | `apps/rowboat`                | `apps/python-sdk`, widget, customer integrations         |
| Connector OAuth and consent API          | `apps/rowboat-api`            | `apps/x`, product connectors, future CLI                 |
| Local capture and transcription contract | `apps/x`                      | Desktop UI only, optional local helpers                  |
| Oppulence product connector manifest     | `apps/x` + `apps/rowboat-api` | Canvas, Cadence, Corinthian, Conduit, Eigen integrations |
| Hosted public SDK contract               | `apps/rowboat`                | `apps/python-sdk`, external developers                   |
| Desktop cloud SDK contract               | `apps/rowboat-api`            | `packages/rowboat-api-client-ts`, desktop integrations   |

Contract owners publish schemas, examples, and compatibility tests. Consumers do
not add endpoints by assumption.

## Shared schema policy

The repo needs a small shared-contract layer for generated or hand-maintained
types. The policy:

- Backend-owned contracts expose OpenAPI or typed route manifests.
- SDKs are generated from the owning contract where practical.
- Desktop IPC contracts stay close to `apps/x`, but service-plane request and
  response types must map cleanly to `apps/rowboat-api`.
- Widget session types are owned by `apps/rowboat`.
- Product connector manifests are versioned and validated in CI.

This RFC does not require one large shared package. It requires a clear owner
for every cross-app type.

## Promotion rules

An app can move from Tier 3 to Tier 2 only when:

1. It has a README that states its owner, purpose, setup, and supported API
   dependencies.
2. It consumes a Tier 1 contract instead of inventing an implicit backend.
3. It has at least one automated smoke test.
4. It has a documented deprecation path for any old endpoint assumptions.

An app can move from Tier 2 to Tier 1 only when:

1. It owns a user-facing workflow.
2. It has production or release packaging.
3. It has CI coverage for the primary workflow.
4. It has observability and support ownership appropriate to its runtime.

## Deprecation rules

Deprecated app paths are allowed, but they must be obvious:

- Add a README status banner.
- Block production docs from linking to them as supported surfaces.
- Remove stale env examples from root docs.
- Add a replacement path or explicit archive date.
- Avoid publishing packages from deprecated paths.

## Implementation plan

### Phase 0: Inventory

- Add a one-page `apps/README.md` app-family map.
- Add README status headers to Tier 2 and Tier 3 apps.
- Link each app to its owning RFC or parent docs.

### Phase 1: Stop implicit contracts

- Mark `apps/rowboatx` as quarantined until its endpoints are backed by Tier 1
  owners.
- Mark incomplete `apps/cli` server/TUI paths as experimental, or remove them
  from default commands.
- Mark simulation runner dependency on published `rowboat==2.1.0` as intentional
  compatibility testing or switch it to the local SDK.

### Phase 2: Align supported clients

- Point `apps/python-sdk` at the hosted API contract.
- Point widget work at RFC 015 widget session auth.
- Point CLI work at `apps/rowboat-api` and hosted APIs as a thin client only.

### Phase 3: Enforce contracts

- Add CI checks for contract generation or drift.
- Add app-family smoke tests for Tier 1 apps.
- Add a docs check that prevents quarantined apps from being advertised as
  supported product surfaces.

## Detailed implementation design

### `apps/README.md` shape

The app-family map should be a durable routing document:

```md
# Rowboat Apps

| App         | Tier   | Owner        | Status              | Primary contract          | RFC             |
| ----------- | ------ | ------------ | ------------------- | ------------------------- | --------------- |
| x           | Tier 1 | Desktop      | Supported           | Desktop product           | RFC 009/014/017 |
| rowboat-api | Tier 1 | Backend      | Supported           | Desktop cloud API         | RFC 010         |
| rowboat     | Tier 1 | Hosted       | Supported           | Hosted project/widget API | RFC 015         |
| python-sdk  | Tier 2 | SDK          | Supported client    | Hosted API                | RFC 016         |
| cli         | Tier 2 | CLI          | Experimental client | Hosted/API client         | RFC 016         |
| rowboatx    | Tier 3 | Experimental | Quarantined         | None                      | RFC 016         |
```

Each row must state whether the app is a product surface, supported client,
experiment, reference, or docs source. This avoids ambiguity for new engineers.

### README status banners

Every Tier 2 and Tier 3 app should start with one of these banners:

```md
> Status: Supported client. This app consumes Tier 1 APIs and does not define
> backend contracts.
```

```md
> Status: Experimental. This app is not a supported production surface and may
> reference incomplete APIs.
```

```md
> Status: Quarantined. Do not use this as product documentation or integration
> guidance until RFC 016 promotion criteria are met.
```

Banners should be plain text in the app README, not hidden in root docs.

### App contract file

Each app can include an optional `app.contract.json`:

```json
{
  "name": "rowboat-api",
  "tier": 1,
  "status": "supported",
  "owner": "backend",
  "owns_contracts": ["desktop-cloud-api", "connector-broker-api"],
  "consumes_contracts": ["workos-auth"],
  "rfc": ["010", "011", "012"],
  "entrypoints": {
    "dev": "make run",
    "test": "make test",
    "build": "make build"
  }
}
```

This can later drive docs generation and CI checks, but it can start as a
convention.

### Canonical app responsibilities

#### `apps/x`

Owns:

- desktop shell and UI
- local note vault
- desktop IPC
- audio capture
- local transcription and diarization
- live-note UI and trust surface
- connector settings UI
- desktop cloud control-plane views
- local performance gates

Does not own:

- hosted project API
- rowboat-api cloud backend behavior
- product MCP server business logic
- external SDK contract

#### `apps/rowboat-api`

Owns:

- Go service-plane APIs consumed by desktop
- cloud background task backend
- connector consent broker
- service-plane WorkOS auth integration
- billing/credits for desktop cloud features
- deployment chart for service plane
- kind validation path

Does not own:

- hosted platform project builder
- hosted widget runtime
- product MCP implementation
- desktop local model execution

#### `apps/rowboat`

Owns:

- hosted Rowboat product
- hosted project model
- hosted chat/runtime APIs
- WorkOS hosted AuthKit/FGA migration
- widget session JWTs
- hosted platform API keys
- hosted public SDK contract

Does not own:

- desktop cloud API
- local note vault semantics
- product MCP resource servers unless explicitly integrated later

### Tier 2 client rules

Tier 2 clients must:

- import generated types or validated client code where possible
- fail tests when the owning API contract changes incompatibly
- not expose server commands as defaults unless they are fully supported
- document which environments they can target
- have a smoke test against local or mocked Tier 1 service

The CLI may include experimental commands, but they must be hidden behind an
`experimental` namespace or flag:

```text
rowboat api me
rowboat hosted projects list
rowboat experimental tui
```

### Tier 3 quarantine rules

A quarantined app:

- cannot be linked from product docs as a supported path
- cannot define required root-level env vars
- cannot publish packages automatically
- cannot be the only consumer of a claimed API
- should be excluded from default release workflows unless explicitly needed

Quarantine is not deletion. It preserves useful code while preventing accidental
architecture commitments.

### Contract ownership registry

Create a small registry in `docs` or `apps/README.md`:

| Contract           | Owner                         | Contract artifact                                                      | Stability |
| ------------------ | ----------------------------- | ---------------------------------------------------------------------- | --------- |
| desktop-cloud-api  | `apps/rowboat-api`            | `apps/rowboat-api/api/openapi.json` + `packages/rowboat-api-client-ts` | beta      |
| hosted-project-api | `apps/rowboat`                | OpenAPI or typed route manifest                                        | stable    |
| widget-api         | `apps/rowboat`                | OpenAPI or route tests                                                 | beta      |
| desktop-ipc        | `apps/x`                      | TypeScript types                                                       | internal  |
| connector-manifest | `apps/rowboat-api` + `apps/x` | JSON schema                                                            | beta      |
| product-mcp        | product apps                  | MCP schemas                                                            | beta      |

Every cross-app dependency should reference one registry row.

### CI enforcement

Minimum CI checks:

| Check                      | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| app registry lint          | Every `apps/*` path has tier/status/owner.                 |
| forbidden docs links       | Product docs do not link to quarantined apps as supported. |
| contract drift             | Generated SDK/types match owning API contract.             |
| Tier 1 smoke               | Each Tier 1 app has a build/test smoke.                    |
| experimental publish guard | Tier 3 apps cannot publish by default.                     |

The first implementation can be a script that scans README banners and the app
registry. It does not need a new build system.

### Docs routing

Docs should route readers by intent:

| Reader intent             | Send them to                          |
| ------------------------- | ------------------------------------- |
| Use desktop               | `apps/x` docs                         |
| Run local backend         | `apps/rowboat-api` docs and kind docs |
| Use hosted platform       | `apps/rowboat` docs                   |
| Integrate with hosted API | SDK docs                              |
| Build product connector   | RFC 012/013 and product MCP docs      |
| Try an experiment         | experimental README with warning      |

Avoid root docs that say "run Rowboat" without specifying which app family.

### Migration checklist by app

#### `apps/cli`

- Identify default command behavior.
- Remove or hide incomplete server start paths.
- Decide first supported target: hosted platform or rowboat-api.
- Add config profile for environments.
- Add one smoke command, for example `rowboat api me`.
- Add tests that fail if required API route is missing.

#### `apps/rowboatx`

- Document current endpoint assumptions.
- Mark quarantined.
- Choose disposition:
  - archive
  - fold into desktop
  - repair against real rowboat-api routes
  - keep as visual prototype only
- Remove unsupported endpoint references from product docs.

#### `apps/python-sdk`

- Align package versioning with hosted API compatibility.
- Generate or validate client methods from hosted API contract.
- Add tests against mocked hosted routes.
- Clarify that it is not the desktop cloud API SDK unless expanded later.

#### `apps/experimental/chat_widget`

- Point to RFC 015 widget session auth.
- Remove direct dependence on stubbed `501` helpers.
- Decide whether it becomes package code inside `apps/rowboat` or remains a demo.

#### `apps/experimental/simulation_runner`

- Decide whether published `rowboat==2.1.0` dependency is intentional
  compatibility coverage.
- If not intentional, switch to local SDK path in development.
- Mark as reference harness, not product surface.

#### `apps/docs`

- Add build/package ownership if it is deployable.
- If not deployable, label as docs source.
- Ensure docs do not promote quarantined app paths.

### Ownership model

Each Tier 1 app needs:

- code owner
- release owner
- incident owner for runtime apps
- docs owner
- primary test command
- primary local dev command
- environment variable contract

Ownership should be written in the app README. Tribal knowledge is not enough.

### Compatibility policy

Tier 1 APIs follow compatibility rules:

- add fields freely
- do not remove fields without version or minimum-client gate
- document breaking changes
- keep old clients through one supported release window where practical
- use structured error codes
- keep contract tests alongside client tests

Tier 2 clients must handle unknown fields and unknown feature flags.

### Disposition decision record

For each app, add:

```md
## Disposition

- Current tier:
- Desired tier:
- Owner:
- Required repairs:
- Deadline/review date:
- Archive path if not repaired:
```

This lets the repo keep experiments without letting them become permanent
ambiguity.

## Decisions

- Keep three Tier 1 surfaces: desktop (`apps/x`), hosted platform
  (`apps/rowboat`), and Go service plane (`apps/rowboat-api`).
- Treat SDK, CLI, and widget as clients unless and until they own complete
  product workflows.
- Quarantine static and experimental apps that imply unsupported endpoints.
- Assign every cross-app API contract to exactly one owner.
- Prefer generated or owner-tested contracts over copied request/response types.

## Acceptance criteria

- `apps/README.md` lists every app with tier, owner, and supported status.
- `apps/rowboatx`, `apps/cli`, and experimental apps have accurate status
  banners.
- SDK/widget/CLI docs point to their Tier 1 API owners.
- No supported doc tells users to depend on endpoints owned only by a prototype.
- CI has at least one smoke or contract check per Tier 1 app.

## Open questions

- Should `apps/rowboatx` be archived, repaired as a local desktop companion UI,
  or folded into `apps/x`?
- Should `apps/cli` target both hosted and desktop cloud APIs, or start with one?
- Should the shared contract layer live under `packages/`, `apps/shared`, or be
  generated into each consumer?
