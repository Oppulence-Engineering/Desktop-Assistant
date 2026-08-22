# @oppulence/eslint-plugin-web

Repository-specific architectural rules for the Oppulence Next.js product.

The rule IDs intentionally match the `WEB###` policy catalog documented in
`apps/rowboat-www/quality/README.md`. Rules `WEB015` through `WEB018` inspect
repository-wide artifacts and therefore run as Vitest policy tests instead of
per-file ESLint rules. `WEB019` reserves standardized ownership roots for all
new React components.
