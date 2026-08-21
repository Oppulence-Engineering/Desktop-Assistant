# React Component Standard

New components have one of three owners. Choose the narrowest owner that fits.

| Owner            | Location                                       | Creation command                                                          | May contain                                           |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| Shared primitive | `packages/ui/src/components`                   | `npm run ui:add -- <name>`                                                | Reusable presentation and interaction primitives only |
| Product feature  | `components/features/<domain>/<name>`          | `npm run component:new -- --kind feature --domain <domain> --name <name>` | One domain's reusable product UI                      |
| Route-private    | `app/(product)/app/<route>/_components/<name>` | `npm run component:new -- --kind route --route <route> --name <name>`     | UI used only by one route subtree                     |

Use kebab-case for paths and PascalCase named exports. Import the concrete file directly; do not add
barrel `index.ts` files. Product components receive a colocated Testing Library test. Add `--client`
only when the component requires state, effects, event handlers, context, or browser APIs.

## Component contract

- Server Components are the default. Client Components contain both `"use client"` and
  `import "client-only"`.
- Export a named `<ComponentName>Props` type and named component. Product components do not use
  default exports.
- Forward native element props, `className`, and accessibility attributes to the semantic root.
- Put a stable `data-slot` on the root and compose classes with `cn()`.
- Use `@oppulence/ui` primitives before introducing raw interactive elements or another UI library.
- Use design tokens (`background`, `foreground`, `muted`, `border`, `ring`, etc.) instead of
  feature-specific hex colors.
- Keep network access, persistence, authentication, and domain orchestration outside presentation
  components. Pass data and callbacks through typed props.
- Test behavior through accessible roles, names, labels, and user interaction. Do not assert
  implementation state or large snapshots.

The exact pre-standardization files are recorded in
`config/architecture/component-baseline.json`. They may be migrated, but new files cannot be added
to those legacy locations.

## Examples

```bash
npm run component:new -- --kind feature --domain agents --name agent-card
npm run component:new -- --kind feature --domain workflows --name schedule-form --client
npm run component:new -- --kind route --route agents --name agent-empty-state
npm run component:new -- --kind route --route revenue/relationships --name relationship-toolbar --client
npm run component:new -- --kind feature --domain agents --name agent-card --dry-run
```

Shared primitives continue to use the repository's Radix-based shadcn configuration:

```bash
npm run ui:add -- <new-primitive>
npm run ui:add -- button --diff
```

Existing shared primitives cannot be overwritten through the wrapper. Inspect an upstream change with
`--diff` or `--view`, then apply the reviewed changes deliberately.
