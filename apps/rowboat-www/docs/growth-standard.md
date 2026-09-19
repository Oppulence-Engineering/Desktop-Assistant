# rowboat-www Growth Standard and Generator Plan

This is the engineering plan for how `apps/rowboat-www` grows. The product will keep
adding routes, dashboard surfaces, validated contracts, hooks, and stories. Without
one door for new code, each contributor invents a slightly different layout, a
slightly different type, and a slightly different test. That is how a Next.js app
becomes unmaintainable.

The rule is simple: **new product code is generated from a standard, then filled
in. It is never invented ad hoc.**

This document is the contract for that standard. It is grounded in the current
tree, not a greenfield fantasy. Phases 1–6 are implemented: `npm run gen` is
the public door, templates live in `config/generate/templates/`, and
`quality/generate-*.test.ts` plus `quality/generate-policies.test.ts` enforce
the contract. Do not start by rewriting existing features.

---

## 1. Why this exists

`rowboat-www` is already three applications in one Next.js 16 App Router tree:

1. A public marketing site.
2. An authenticated Oppulence dashboard under `/app`.
3. A Kubernetes-hosted BFF that proxies `/api/rowboat/v1/...` to `rowboat-api`.

The tree already encodes a growth direction in `AGENTS.md` and
`components/README.md`: route-owned pages, Server Components by default, Zod at
the network boundary, TanStack Query for remote data, nuqs for shareable view
state, and a hand-rolled `npm run component:new` generator.

That direction is incomplete. Today a contributor can generate a feature
component, but they cannot generate the rest of the unit that makes the component
real: the Zod contract, the page skeleton, the query hook, the lib helper, the
store, or the Storybook story. The component generator itself still emits a
naked `export type XProps = ComponentPropsWithoutRef<"section">` and no TS
documentation. Fetchers such as `hooks/queries/utils/fetch-report.ts` still
narrow Orval output with `as RevenueLeakScan`. Product pages are thin default
exports that bounce into the legacy dashboard island.

If we let the app grow that way, every new surface will reintroduce the same
seams. This plan closes those seams before the surface area doubles.

---

## 2. Current state (authoritative)

These are facts from the working tree. The generators must extend them, not
replace them.

| Capability                 | Today                                                                    | Gap                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared primitives          | `npm run ui:add` (shadcn CLI into `packages/ui`)                         | Keep. Do not generate primitives with the product CLI.                                                                                                                                                   |
| Product / route components | `npm run component:new` → `.tsx` + `.test.tsx`                           | No Zod props, no JSDoc, no story, no `.lit.ts`.                                                                                                                                                          |
| OpenAPI clients + Zod      | Orval via `npm run contracts:generate` into `lib/api/generated`          | Workspace, actions, impact, digest, commitments, and relationship-sources reads are `z.infer` of Orval schemas. Report, relationships, communication, and `lib/revenue/revenue.ts` mutations still cast. |
| Pages                      | Six product `page.tsx` files; each owns a route `_components/` island    | Route-local `loading.tsx` / `error.tsx` / `search-params.ts` now exist for the product leaves.                                                                                                           |
| Hooks                      | Manual `hooks/queries/use-*.ts` + `utils/fetch-*.ts` + `utils/*-keys.ts` | Correct split, no generator. Some fetchers still cast.                                                                                                                                                   |
| Stores                     | `stores/browser-session/store.ts` is a marketing stub                    | No Zustand product store yet; generator must encode the "ephemeral only" rule.                                                                                                                           |
| Storybook                  | `stories/*.stories.tsx` for `@oppulence/ui` only                         | No product-feature stories.                                                                                                                                                                              |
| Enforcement                | WEB019 location, WEB020 colocated tests, WEB022 API-route Zod            | No rules for pages, hooks, libs, stores, stories, or naked domain types.                                                                                                                                 |
| Template engine            | String templates inside `scripts/generate-component.ts`                  | Works and is tested. Not reusable across kinds. No open-source template library.                                                                                                                         |

Non-negotiable boundaries that generators must preserve:

- Browser code never receives WorkOS tokens. Same-origin BFF only.
- Server Components are the default. `"use client"` + `import "client-only"` only when required.
- Remote JSON is validated with Zod (prefer Orval schemas). No new `as T` after `response.json()`.
- Query keys, fetchers, and `staleTime` live in non-`'use client'` modules.
- Zustand is not for navigation or server data.
- No barrel `index.ts` files for product components.
- Generators refuse to overwrite and have no `--force`.
- Config lives under `config/`; scripts under `scripts/`; engineering records under `docs/`.

---

## 3. The standard: one door, nine artifacts, one type law

### 3.1 One door

All product scaffolding goes through a single CLI:

```bash
npm run gen -- <kind> --name <kebab-name> [kind flags] [--dry-run]
```

`npm run component:new` remains as a compatibility alias that calls
`npm run gen -- component`. `npm run ui:add` and `npm run contracts:generate`
stay specialized doors for shared primitives and OpenAPI. They are not replaced.

The CLI is non-interactive by default. Prompts are optional sugar. CI, agents,
and humans must be able to pass flags. Every flag object is parsed with Zod
before any file is planned.

### 3.2 Generated artifacts

A growing unit of product code is assembled from these kinds. Each kind has
exactly one responsibility.

| Kind        | Command         | Writes                                     | Does not write         |
| ----------- | --------------- | ------------------------------------------ | ---------------------- |
| `lit`       | `gen lit`       | The living interface template              | Implementation         |
| `schema`    | `gen schema`    | Zod validation module (`.ts`)              | UI, fetchers, pages    |
| `component` | `gen component` | Component + test + optional story          | Network, storage, auth |
| `page`      | `gen page`      | App Router skeleton                        | Feature implementation |
| `lib`       | `gen lib`       | Domain helper module + test                | React components       |
| `hook`      | `gen hook`      | Query hook + fetcher + keys + prefetch     | UI                     |
| `mutation`  | `gen mutation`  | Mutation hook + Orval write transport      | UI                     |
| `store`     | `gen store`     | Ephemeral Zustand store + Zod state schema | Server data, URL state |
| `story`     | `gen story`     | Storybook CSF for an existing component    | New components         |

`gen feature` is a composer, not another artifact kind. It asks for a domain + route +
name, writes a `.lit.ts`, then runs the relevant kinds from that lit. People
who want one file at a time keep using the atomic commands.

### 3.3 The type law

**No new naked domain types.** A domain type is any shape we invent: props
beyond native element attributes, loader results, search params, store state,
hook options, lib inputs, API-adjacent view models.

The only legal form is:

```ts
/**
 * Why this schema exists, what is in-bounds, and which generator owns it.
 */
export const ExampleSchema = z.object({
  id: z.string().min(1),
});

export type Example = z.infer<typeof ExampleSchema>;
```

Rules:

1. `export type Foo = { ... }` is forbidden for new product code.
2. `export interface Foo { ... }` is forbidden for new product code.
3. `as Foo` after JSON, storage, or form parsing is forbidden for new product code.
4. Types are inferred from schemas. Schemas are never inferred from types.
5. Prefer an existing Orval schema from `lib/api/generated/zod/**` over a
   hand-written duplicate. Hand-written schemas are for UI props, search
   params, store state, and view models that the Go contract does not own.
6. Native React host props are the one exception: a component may intersect
   `z.infer<typeof XPropsSchema>` with `ComponentPropsWithoutRef<"section">`.
   That intersection is not a parallel domain model. It is the host element's
   contract. Do not re-declare `className`, `children`, or `id` in Zod.
7. Generator CLI input is itself a Zod schema. Invalid names, routes, or kinds
   fail before `mkdir`.

This is the maintenance rule. If the schema is the type, refactors, docs,
runtime checks, Storybook args, and tests all share one source.

---

## 4. Living Interface Templates (`.lit.ts`)

The request called for a generator that produces `.lit` files. There is no
`.lit` convention in this repository today. This plan defines one.

A **Living Interface Template** is the human-readable, Zod-validated contract
for a generated unit. It is not implementation. It is the file a future
maintainer reads first, and the file later generators can re-read.

We use the suffix `*.lit.ts`, not a custom `.lit` extension. A custom extension
would sit outside TypeScript, ESLint, Vitest, and Knip. A `.lit.ts` module is
real code: it typechecks, it imports Zod, and CI can validate it.

### 4.1 What a lit owns

```ts
/**
 * Agent card — compact identity + health for one catalog agent.
 *
 * Owned by the agents product domain. Rendered from the agents route and the
 * command palette. This file is the contract; implementation lives in the
 * generated siblings listed in `files`.
 */
export const AgentCardLitSchema = z.object({
  kind: z.literal("component"),
  name: z.literal("agent-card"),
  domain: z.literal("agents"),
  owner: z.enum(["feature", "route", "lib", "hook", "store", "page"]),
  client: z.literal(false),
  summary: z.string().min(1),
  schemas: z.array(z.string()),
  files: z.array(z.string()),
});

export const AgentCardLit = AgentCardLitSchema.parse({
  kind: "component",
  name: "agent-card",
  domain: "agents",
  owner: "feature",
  client: false,
  summary:
    "Compact identity + health for one catalog agent. Presentation only; data arrives through props.",
  schemas: ["components/features/agents/agent-card/agent-card.schema.ts"],
  files: [
    "components/features/agents/agent-card/agent-card.tsx",
    "components/features/agents/agent-card/agent-card.test.tsx",
    "components/features/agents/agent-card/agent-card.stories.tsx",
  ],
});
```

Every generated unit writes its lit next to the implementation:

```text
components/features/agents/agent-card/agent-card.lit.ts
hooks/queries/use-report.lit.ts
lib/revenue/format-money.lit.ts
app/(product)/app/forecasts/forecasts.lit.ts
stores/canvas-viewport/canvas-viewport.lit.ts
```

### 4.2 Why lits exist

- They are the **standard made visible**. A reviewer can open one file and see
  ownership, client boundary, schemas, and generated siblings.
- They keep generators honest. `gen feature` writes the lit first; atomic
  generators append to `files` rather than inventing a second inventory.
- They are the documentation surface that does not rot independently of the
  tree. If a file is missing from `files`, a policy test fails.
- They are the answer to "how does this app grow?": declare a lit, generate
  from it, fill in the marked implementation regions.

### 4.3 What a lit is not

- Not a second runtime schema. Runtime validation lives in `*.schema.ts` or
  Orval output.
- Not MDX, not a blog post, not a Fumadocs page.
- Not a replacement for `AGENTS.md` or `components/README.md`. Those remain
  the human guides; lits are per-unit contracts.

If the intended artifact was colocated markdown literature instead of a
TypeScript contract, the same generator slot still applies: one file, one
owner, written by `gen lit`, validated, never hand-copied. The TypeScript
form is preferred because it can be parsed and tested.

---

## 5. Open-source library decision

The user asked for an open-source library for component generation. The
repository is not a Turborepo (`turbo.json` is absent) and already has a
tested TypeScript generator. The library choice has to respect both.

| Option                            | Verdict           | Why                                                                                                                                                                                                                     |
| --------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plop (`node-plop`)**            | **Adopt**         | The standard open-source template runner. File-based Handlebars templates, add-only actions, dry-run, in-process API, easy to wrap with Zod-parsed flags. Used by Turbo generators internally, without requiring Turbo. |
| `@turbo/gen`                      | Reject            | Turbo-specific discovery. We do not have a Turbo graph, and AGENTS.md already forbids adding root config when an owned `config/` path exists.                                                                           |
| Hygen                             | Reject            | Template-in-frontmatter model is pleasant, but Hygen is weakly maintained relative to Plop and harder to unit-test as an imported function.                                                                             |
| shadcn CLI                        | Keep, specialized | Already the primitive generator via `npm run ui:add`. Domain-neutral only.                                                                                                                                              |
| Orval                             | Keep, specialized | Already the OpenAPI → fetch + Zod + MSW generator. Do not hand-write those schemas.                                                                                                                                     |
| Kubb / hey-api                    | Reject for now    | Would compete with Orval. Revisit only if Orval cannot emit a needed artifact.                                                                                                                                          |
| Hand-rolled string templates only | Insufficient      | The current component generator works, but it cannot be the home for eight kinds without becoming a private framework.                                                                                                  |

### 5.1 How Plop is used here

Plop is the **template and action engine**, not the public CLI and not the
source of validation.

```text
scripts/generate.ts                  # public CLI; Zod-parses argv
config/generate/input-schemas.ts     # one Zod schema per kind
config/generate/plopfile.ts          # registers kinds; no business rules
config/generate/templates/<kind>/    # Handlebars templates (the standard made files)
quality/generate-<kind>.test.ts      # asserts paths, Zod usage, docs, no overwrite
```

`scripts/generate.ts` does the following, in order:

1. Parse `kind` + flags with the kind's Zod input schema.
2. Build a `GenerationPlan` (`path` + `template` + `data`).
3. Refuse any path that already exists.
4. If `--dry-run`, print the plan and exit.
5. Ask Plop to write the files with `flag: "wx"` semantics.
6. Print created relative paths.

This preserves the current generator contract that
`quality/component-generator.test.ts` already enforces: kebab-case names, safe
routes, dry-run, no `--force`, no overwrite.

Templates are the standard. If a reviewer wants to know how a page is born,
they open `config/generate/templates/page/`, not a 200-line string in a
script.

---

## 6. Per-kind contracts

Every template emits:

- A file-level JSDoc that states **why** the module exists and which lit owns it.
- Named exports only (pages keep Next's default page export, plus named helpers).
- Zod schemas for every invented shape.
- A colocated test unless the kind is `lit` or `story`.
- No barrels.

### 6.1 `gen schema` — validation modules

This is the generator for "`.ts` files, which is all validation."

```bash
npm run gen -- schema \
  --name agent-card-props \
  --owner component \
  --domain agents \
  --fields id:string,label:string,healthy:boolean
```

Writes:

```text
components/features/agents/agent-card/agent-card.schema.ts
components/features/agents/agent-card/agent-card.schema.test.ts
```

A schema module contains only:

- imported Orval schemas, if any
- exported Zod schemas
- `z.infer` types
- JSDoc on each schema

It does not import React, Next, TanStack Query, or Zustand. That is how we keep
validation reusable from server loaders, client hooks, and tests.

When the shape is owned by Go, the schema generator must refuse to duplicate it
and instead print the Orval import path. Hand-written schemas are for
application shapes the OpenAPI contract does not own.

### 6.2 `gen component` — product UI

Extends today's generator.

```bash
npm run gen -- component --kind feature --domain agents --name agent-card
npm run gen -- component --kind route --route revenue/relationships --name relationship-toolbar --client
```

Writes:

```text
components/features/agents/agent-card/
├── agent-card.lit.ts
├── agent-card.schema.ts
├── agent-card.tsx
├── agent-card.test.tsx
└── agent-card.stories.tsx
```

Component source rules (upgrade from the current template):

- Server-first; `--client` adds both `"use client"` and `import "client-only"`.
- Named component export. No default export.
- Props type is `z.infer<typeof XPropsSchema> & ComponentPropsWithoutRef<"section">`.
- Runtime `XPropsSchema.parse` is **not** run on every render. Zod here is the
  type source and the Storybook/test fixture validator. Running parse in render
  is a performance footgun.
- Semantic root, stable `data-slot`, `cn()`, forwarded host props.
- File-level and prop-level TS docs.
- Colocated Testing Library test through roles and names.
- Storybook CSF with `autodocs`, default + empty + one meaningful variant.
- Presentation only. No `requestJson`, no cookies, no stores, no query hooks.

`npm run ui:add` remains the only way to add `@oppulence/ui` primitives.

### 6.3 `gen page` — Next.js product skeleton

New product areas are real App Router routes under the server-authenticated
product layout. They are not new cases in `components/features/dashboard/product-dashboard-client/product-dashboard-client.tsx`.

```bash
npm run gen -- page --route forecasts --name forecasts --title "Forecasts"
```

Writes:

```text
app/(product)/app/forecasts/
├── forecasts.lit.ts
├── page.tsx
├── loading.tsx
├── error.tsx
├── search-params.ts
└── _components/
    └── forecasts-panel/
        ├── forecasts-panel.lit.ts
        ├── forecasts-panel.schema.ts
        ├── forecasts-panel.tsx
        ├── forecasts-panel.test.tsx
        └── forecasts-panel.stories.tsx
```

`page.tsx` is a Server Component. It may prefetch with the sealed session. It
does not HTTP-loopback to `/api/rowboat`. It does not mark itself `"use client"`.
It renders a route-private panel.

`search-params.ts` is a Zod + nuqs module. Shareable view state lives there.
React state is not the source of truth for the URL.

Marketing pages are out of scope for `gen page` in phase 1. They have a
different rendering model (`generateStaticParams`, MDX). A later
`--surface marketing` flag can be added without changing the product templates.

### 6.4 `gen lib` — non-UI modules

```bash
npm run gen -- lib --domain revenue --name format-money
```

Writes:

```text
lib/revenue/
├── format-money.lit.ts
├── format-money.ts
├── format-money.schema.ts
└── format-money.test.ts
```

Lib modules are server-safe by default. They import `server-only` only when
they touch cookies, the sealed session, or filesystem. They never import React.
Inputs and outputs are Zod. One exported function family per file.

`lib/api/generated/**` is owned by Orval. `gen lib` must refuse that directory.

### 6.5 `gen hook` — TanStack Query reads

```bash
npm run gen -- hook --operation listConnectors
npm run gen -- hook \
  --name report-preview \
  --orval-schema GetRevenueLeakScan200Response \
  --orval-import @/lib/api/generated/zod/revenue/revenue \
  --path /revenue-leak-scans/:id
```

`--operation` is the preferred door. It reads `operationId` from
`apps/rowboat-api/api/openapi.json`, maps `/v1/...` onto the BFF path, and
binds the Orval Zod export under `lib/api/generated/zod`. Local schema stubs
are not generated. tRPC is not used; the Go contract plus Orval is the compiler.

Writes:

```text
hooks/queries/use-list-connectors.ts
hooks/queries/use-list-connectors.lit.ts
hooks/queries/utils/fetch-list-connectors.ts
hooks/queries/utils/prefetch-list-connectors.ts
hooks/queries/utils/list-connectors-keys.ts
hooks/queries/utils/list-connectors-keys.test.ts
```

The split already used by `use-report.ts` is the standard:

| File                  | Boundary                       | Owns                                       |
| --------------------- | ------------------------------ | ------------------------------------------ |
| `use-*.ts`            | `"use client"` + `client-only` | `useQuery` / `useMutation` only            |
| `utils/fetch-*.ts`    | shared                         | `requestJson` + Orval Zod schema, no casts |
| `utils/prefetch-*.ts` | server                         | `seedQuery` + `requestUpstreamJson`        |
| `utils/*-keys.ts`     | shared                         | key factory + `staleTime` constants        |

The generated fetcher calls `requestJson({ path, schema, signal })` and returns
the parsed value. It does not `as` the result into `lib/revenue/types.ts`. If a view
model is required, it is a named Zod transform in a schema module, not a cast.

When the operation has query parameters, `--operation` also binds
`{Op}QueryParams` and serializes them with `withQueryString`. Path params come
from the OpenAPI path. WEB028 fails CI if a new `fetch-*` / `mutate-*` file
casts the parsed body or uses a path that is not in the Go OpenAPI document.

Generated `fetch-*.test.ts` files parse the Orval MSW fixture through the same
schema so `contracts:generate` drift shows up in unit tests.

RSC pages import the prefetch helper (or the route-local `prefetch.ts` re-export)
and wrap the panel in `HydrationBoundary`. Do not enable Orval `client: "react-query"`;
that would skip the BFF.

### 6.5b `gen mutation` — TanStack Query writes

```bash
npm run gen -- mutation --operation createRevenueAction --invalidate list-revenue-actions
```

Writes `use-*.ts`, `utils/mutate-*.ts`, and a key factory. The mutate module
posts through `requestJson` with the Orval body + success schemas. `--invalidate`
adds a second key factory to `onSuccess`. GET operations are rejected; use
`gen hook`.

### 6.6 `gen store` — ephemeral Zustand only

```bash
npm run gen -- store --name canvas-viewport --domain workflows
```

Writes:

```text
stores/canvas-viewport/
├── canvas-viewport.lit.ts
├── canvas-viewport.schema.ts
├── store.ts
└── store.test.ts
```

The lit and the template JSDoc must state the allowed home:

> Zustand owns high-frequency ephemeral client state only (canvas pan/zoom,
> drag, unsaved buffers). It does not own navigation, remote data, or
> shareable filters.

The generator should refuse names that look like navigation or server
resources (`*session`, `*route`, `*nav`, `*query`, `*user`). Those belong to
the BFF cookie, the URL, or TanStack Query.

Persist middleware is off by default. If a store later needs persistence, it
must go through `lib/storage/scoped-storage.ts` (identity-scoped, versioned,
Zod-validated, TTL). The store generator does not emit `localStorage` writes.

### 6.7 `gen story` — Storybook for an existing unit

```bash
npm run gen -- story --component components/features/agents/agent-card/agent-card.tsx
```

Writes a colocated `*.stories.tsx` if one does not exist. Product stories live
next to the component, not in the root `stories/` folder. Root `stories/`
remains the `@oppulence/ui` catalog.

Story args that represent domain props are built with
`XPropsSchema.parse(...)`. That keeps Storybook fixtures honest.

---

## 7. Composition: `gen feature`

This is how a new product area is born in one command, without inventing a
second architecture.

```bash
npm run gen -- feature \
  --domain forecasts \
  --route forecasts \
  --name forecasts \
  --title "Forecasts"
```

Order of writes:

1. `app/(product)/app/forecasts/forecasts.lit.ts`
2. `search-params` schema
3. page skeleton (`page`, `loading`, `error`)
4. route-private panel component (server) + schema + test + story
5. hook + prefetch **only if** `--operation` or `--orval-schema` + `--orval-import` + `--path` is provided
6. lib module **only if** `--lib` is provided
7. store **only if** `--store-name` is provided

The composer never writes a Zustand store or a client component by default.
Those are explicit flags. That is how we keep the client boundary narrow as
the app grows.

---

## 8. Template quality bar

Every Handlebars template must satisfy this checklist. Generator tests assert
it. Reviewers should reject template changes that weaken it.

1. **One responsibility.** A template writes one kind of module.
2. **Why-docs.** File JSDoc explains the boundary, not the syntax.
3. **Zod first.** Any invented shape has a schema export above its inferred type.
4. **Named exports.** Except Next.js `page.tsx` / `loading.tsx` / `error.tsx`.
5. **No barrels.**
6. **Safe paths.** kebab-case names, slash-separated kebab routes, no `..`.
7. **No overwrite.**
8. **No secrets, tokens, or `as T`.**
9. **Accessibility in UI templates.** Semantic root, role-testable, no
   `maximumScale` tricks, no `user-scalable` disabling.
10. **Implementation region.** A single clearly marked block where a human
    fills behavior. The rest of the file is standard and should stay
    recognizable across the app.

Example component body after generation:

```tsx
/**
 * AgentCard renders one catalog agent's identity and health.
 * Data and callbacks arrive through validated props. This module does not fetch.
 */
export function AgentCard({ className, ...props }: AgentCardProps) {
  return (
    <section data-slot="agent-card" className={cn(className)} {...props}>
      {/* implementation */}
    </section>
  );
}
```

---

## 9. Enforcement

Generators that are optional will be ignored. The standard has to fail CI when
someone bypasses it.

| Gate        | New rule                                                    | What it proves                                                                                                                          |
| ----------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint      | WEB023                                                      | New product `type` / `interface` object shapes must be `z.infer`. Allowlisted: generated Orval client models, React host intersections. |
| ESLint      | WEB024                                                      | New `app/(product)/app/**/page.tsx` files must live beside `loading.tsx`, `error.tsx`, and a `*.lit.ts`.                                |
| ESLint      | WEB025                                                      | New `hooks/queries/use-*.ts` files must import a non-client `fetch-*` or `mutate-*` module and a key factory.                           |
| Policy test | WEB026                                                      | Every `*.lit.ts` `files` entry exists on disk.                                                                                          |
| Policy test | WEB027                                                      | `gen * --dry-run` golden tests for each kind (paths, Zod, JSDoc, client markers).                                                       |
| Policy test | WEB028                                                      | New `fetch-*` / `mutate-*` files import an Orval 200/201 schema, do not `as T`, and use an OpenAPI BFF path.                            |
| Policy test | WEB029                                                      | New product units must contain `@oppulence-gen` and a sibling `*.lit.ts`. Hand-rolled trees fail CI and `npm run gen:check`.            |
| Baseline    | `config/architecture/generator-baseline.json`               | Exact list of pre-standard files. New files cannot be added to it.                                                                      |
| Knip        | already used                                                | Generated unused stubs must still be imported by their lit or test so Knip does not fight the scaffold.                                 |
| Storybook   | `storybook:build` in `verify:ci` once product stories exist | Stories compile.                                                                                                                        |

Docs alone do not stop agents. The same contract is wired into every surface
they read and every gate they cannot skip:

1. **Always-on Cursor rule** — `.cursor/rules/rowboat-www-growth-standard.mdc`
   (`alwaysApply: true`). Every agent session sees “run `npm run gen`; do not
   invent a parallel layout.”
2. **Agent playbooks** — root + `apps/rowboat-www` `AGENTS.md` / `CLAUDE.md`
   open with MUST / MUST NOT, not a suggestion.
3. **Machine stamp** — every template writes `@oppulence-gen`. WEB029 rejects
   new pages, feature/route components, query hooks, fetch/mutate/prefetch
   modules, and stores that lack it (and, where the kind has one, a sibling
   `*.lit.ts`). Existing files live in
   `config/architecture/generator-baseline.json` `ungeneratedUnits` and cannot
   grow that list.
4. **Hooks that run without asking** — `npm run gen:check` is in `verify:fast`,
   `verify`, and lefthook `rowboat-www-growth-standard` on product globs.

If `gen` cannot express the change, stop and say so. Do not hand-create the
tree and do not add the new file to the ungenerated baseline.

`config/architecture/component-baseline.json` stays the component location
baseline. Do not overload it. The generator baseline is a sibling file.

`npm run component:new` tests move to `quality/generate-component.test.ts` and
keep the same assertions, plus the new Zod / JSDoc / story / lit assertions.

---

## 10. Directory ownership after the standard

```text
apps/rowboat-www/
├── app/(product)/app/<route>/
│   ├── <route>.lit.ts
│   ├── page.tsx
│   ├── loading.tsx
│   ├── error.tsx
│   ├── search-params.ts
│   └── _components/<name>/          # route-private UI
├── components/features/<domain>/<name>/
├── hooks/queries/               # gen hook / gen mutation only
│   ├── use-<name>.ts
│   └── utils/{fetch-<name>,<name>-keys}.ts
├── hooks/dashboard/             # product composition; not generated
├── lib/<domain>/                    # hand-written, Zod-validated; no barrels
│   # import @/lib/revenue/revenue, never @/lib/revenue
├── lib/api/generated/               # Orval only
├── stores/<name>/                   # ephemeral Zustand only
├── stories/                         # @oppulence/ui catalog only
├── config/generate/                 # Plop + Zod input schemas + templates
├── scripts/generate.ts              # public CLI
└── docs/growth-standard.md          # this file
```

No new root-level generator config. Plop's file lives under `config/generate/`
and is wired from `package.json`, matching `config/README.md`.

---

## 11. What we will not generate

These look adjacent and are deliberately excluded so the standard stays sharp.

- Shared primitives (`packages/ui`) — `npm run ui:add` already owns this.
- Orval clients, Zod HTTP schemas, MSW handlers — `npm run contracts:generate`.
- Marketing MDX — Fumadocs already owns `content/`.
- Auth, cookie, or PKCE modules — too security-sensitive for a stub.
- API route handlers — WEB022 already requires Zod; a later phase can add
  `gen route-handler` once product pages are stable.
- Barrels, Zustand navigation stores, client pages, `as T` helpers.

---

## 12. Phased delivery

Do not implement this as one pull request. Each phase must leave `npm run verify`
green and must not rewrite unrelated user work.

### Phase 0 — Adopt the standard (this document)

- Land this file under `docs/`.
- Point `AGENTS.md` and `components/README.md` at it once Phase 1 exists.
- Do not change runtime code in this phase.

### Phase 1 — Generator runtime + migrate `component:new`

- Add `scripts/generate.ts`, `config/generate/input-schemas.ts`, Plop, templates.
- Move the existing component generator onto Plop templates.
- Keep the CLI flags and the no-overwrite contract.
- Upgrade the component template: JSDoc, Zod props schema, optional story, lit.
- Port `quality/component-generator.test.ts` and extend it.
- Keep `npm run component:new` as an alias.

**Exit:** generating a feature component today produces the new files, and
existing tests plus new golden tests pass.

### Phase 2 — `schema` and `lit`

- Ship `gen schema` and `gen lit` as atomic kinds.
- Schema generator refuses `lib/api/generated/**` and suggests the Orval import.
- Lit policy test (WEB026) starts in warn-only allowlist mode, then errors for
  newly generated units.

**Exit:** a contributor can create a validation module and a lit without a UI.

### Phase 3 — `page`

- Ship the product page skeleton: `page`, `loading`, `error`, `search-params`,
  route-private panel.
- Add WEB024 for new pages only (baseline the six current product pages).

**Exit:** `gen page --route forecasts` writes a route that typechecks, lint-cleans,
and does not touch `components/features/dashboard/product-dashboard-client/product-dashboard-client.tsx`.

### Phase 4 — `lib`, `hook`, `store`, `story`

- Templates follow the existing report-hook split and the Zustand home rule.
- Hook fetcher template uses `requestJson` + an Orval schema name flag.
- Story generator colocates CSF and validates args with the component schema.

**Exit:** each kind has a dry-run golden test and a write test.

### Phase 5 — `gen feature` composer

- One command writes lit → schema → page → panel → optional hook.
- Composer is a function over the atomic generators. No second template set.

**Exit:** a new product area can be scaffolded without copying an old route.

### Phase 6 — Enforcement + reference migration

- Turn WEB023–WEB027 on for new files.
- Commit `generator-baseline.json` for pre-standard files.
- Migrate **one** recent, clean unit (the report query hook is the best
  candidate) off `as T` and onto the generated hook/schema shape.
- Update `AGENTS.md`, `components/README.md`, `app/(product)/app/README.md`,
  and `config/README.md`.

**Exit:** the next feature is generated; the last feature is the example.

### Phase 7 — Only after the door is real

- Remove remaining `as T` fetchers one baseline entry at a time.
- Add marketing `--surface` only if the marketing tree starts to grow the same
  way.
- Consider `gen route-handler` for new BFF endpoints.

---

## 13. Verification for this plan

This plan is complete when, and only when, all of the following are true in
the working tree:

1. This document exists at `apps/rowboat-www/docs/growth-standard.md`.
2. It names every requested generator: component, lit, Zod `.ts`, page, lib,
   hook, store, Storybook.
3. It forbids naked domain types and requires Zod + `z.infer`.
4. It picks an open-source component-generation library and says why.
5. It is grounded in the current generators, Orval pipeline, hook split,
   Storybook layout, and WEB0xx rules.
6. It defines enforcement so the standard cannot be bypassed.
7. It sequences work so the existing `component:new` contract is preserved
   while the door expands.

Implementation of the generators is intentionally **not** required for the
plan to be accepted. Building Phase 1 is the next goal, not this one.

---

## 14. Decisions that should not be reopened casually

These are the load-bearing choices. Changing one of them is a new plan.

1. One public CLI (`npm run gen`), many kinds, one composer.
2. Plop for templates; Zod for inputs; Orval for HTTP schemas; shadcn for
   primitives.
3. `*.lit.ts` as the per-unit contract, stored beside the code it describes.
4. Zod is the type. `z.infer` is the only domain type form.
5. Server Components and non-client fetchers remain the default.
6. Generators never overwrite.
7. Zustand stays ephemeral. URL state stays in nuqs. Remote data stays in
   TanStack Query.
   )
