# Growth-standard generators

This directory is the template and input-schema home for `npm run gen`.

| Path               | Ownership                                                 |
| ------------------ | --------------------------------------------------------- |
| `input-schemas.ts` | Zod contracts for every CLI kind                          |
| `templates/`       | Handlebars sources (the standard made files)              |
| `plopfile.ts`      | Plop registration; the public door is still `npm run gen` |

`gen hook` and `gen mutation` bind Orval Zod contracts. Prefer
`--operation <operationId>` so path, method, and schema names are resolved
from `apps/rowboat-api/api/openapi.json`. Do not generate local API stubs.

Do not add a root-level `plopfile.js`. Wire new kinds here and in
`scripts/generate/plan.ts` in the same change.

See `docs/growth-standard.md`.
