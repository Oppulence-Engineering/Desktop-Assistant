# React Component Standard

New components have one of three owners. Choose the narrowest owner that fits.

| Owner            | Location                                       | Creation command                                                          | May contain                                           |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| Shared primitive | `packages/ui/src/components`                   | `npm run ui:add -- <name>`                                                | Reusable presentation and interaction primitives only |
| Product feature  | `components/features/<domain>/<name>`          | `npm run gen -- component --kind feature --domain <domain> --name <name>` | One domain's reusable product UI                      |
| Route-private    | `app/(product)/app/<route>/_components/<name>` | `npm run gen -- component --kind route --route <route> --name <name>`     | UI used only by one route subtree                     |

Use kebab-case for paths and PascalCase named exports. Import the concrete file directly; do not add
barrel `index.ts` files. Product components receive a colocated Testing Library test, Zod props
schema, living interface template, and Storybook story. Add `--client` only when the component
requires state, effects, event handlers, context, or browser APIs. Domain props are Zod schemas;
native host props may intersect `ComponentPropsWithoutRef`. See `docs/growth-standard.md`.

## Component contract

- Server Components are the default. Client Components contain both `"use client"` and
  `import "client-only"`.
- Export a named `<ComponentName>Props` type and named component. Product components do not use
  default exports.
- Forward native element props, `className`, and accessibility attributes to the semantic root.
- Put a stable `data-slot` on the root and compose classes with `cn()`.
- Use `@sim/emcn` for `/app` and marketing product chrome when the primitive
  exists. Use `@oppulence/ui` only when emcn has no equivalent. Do not mix
  both kits on one surface.
- Use design tokens (`background`, `foreground`, `muted`, `border`, `ring`, etc.) instead of
  feature-specific hex colors.
- Keep network access, persistence, authentication, and domain orchestration outside presentation
  components. Pass data and callbacks through typed props.
- Test behavior through accessible roles, names, labels, and user interaction. Do not assert
  implementation state or large snapshots.

Product UI lives under `components/features/<domain>/<name>`. Auth, legal,
providers, Sim chrome, and AI elements are managed owners in
`config/architecture/component-baseline.json`. New files cannot be added to
legacy locations; that list is empty after the dashboard migration.

## Examples

```bash
npm run gen -- component --kind feature --domain agents --name agent-card
npm run gen -- component --kind feature --domain workflows --name schedule-form --client
npm run gen -- component --kind route --route agents --name agent-empty-state
npm run gen -- component --kind route --route revenue/relationships --name relationship-toolbar --client
npm run gen -- component --kind feature --domain agents --name agent-card --dry-run
npm run component:new -- --kind feature --domain agents --name agent-card
```

Shared primitives use the repository's Radix-based shadcn CLI (`shadcn@4` in
`apps/rowboat-www`). Primitives install into `packages/ui`; the app imports them
from `@oppulence/ui/components/*`.

```bash
npm run ui:init          # validate shadcn wiring for rowboat-www + packages/ui
npm run ui:info          # print shadcn project info for both workspaces
npm run ui:add -- <new-primitive>
npm run ui:add -- button --diff
npm run shadcn -- add card --cwd ../../packages/ui --dry-run
```

Existing shared primitives cannot be overwritten through the wrapper. Inspect an upstream change with
`--diff` or `--view`, then apply the reviewed changes deliberately.
