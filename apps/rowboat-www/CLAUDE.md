# CLAUDE.md — rowboat-www

MUST scaffold product work with `npm run gen`. MUST NOT invent pages,
components, schemas, hooks, fetchers, stores, or stories by hand. WEB029
rejects new units that lack `@oppulence-gen`. If `gen` cannot do it, stop.

The step-by-step playbook is in `AGENTS.md` under **How to add a new product
feature**. The contract is `docs/growth-standard.md`.

```bash
cd apps/rowboat-www

# New authenticated product area (preferred)
npm run gen -- feature --domain forecasts --route forecasts --name forecasts --title "Forecasts"

# Atomic kinds
npm run gen -- page --route forecasts --title "Forecasts"
npm run gen -- component --kind feature --domain agents --name agent-card
npm run gen -- component --kind route --route revenue/relationships --name relationship-toolbar --client
npm run gen -- schema --owner feature --domain agents --name agent-card --fields label:string
npm run gen -- hook --operation listConnectors
npm run gen -- hook --operation listRevenueActions
npm run gen -- page --route queue --title "Queue" --fields tab:string
npm run gen -- mutation --operation createRevenueAction --invalidate list-revenue-actions
npm run gen -- lib --domain revenue --name format-money
npm run gen -- store --name canvas-viewport --domain workflows
npm run gen -- story --name agent-card --kind feature --domain agents

npm run gen -- page --route forecasts --title "Forecasts" --dry-run
```

Rules that must survive implementation:

- Zod schema + `z.infer` for every invented shape. No naked `type` / `interface`
  object shapes. No `as T` after JSON.
- Server Components by default. `--client` only when hooks, events, or browser
  APIs require it.
- Do not add surfaces to `product-dashboard-client.tsx`.
- Shared primitives: `npm run ui:add`, not `gen`. OpenAPI types: Orval, not a
  hand-written duplicate.

@AGENTS.md
