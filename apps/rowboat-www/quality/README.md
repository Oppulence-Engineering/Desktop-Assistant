# Rowboat Web Quality Gauntlet

`npm run verify` is the local merge-readiness command. It combines framework,
typed, architectural, contract, security, dead-code, test, and production-build checks. CI uses
`verify:ci` to add browser accessibility, Lighthouse, and bundle budgets.

The `legacy` object in `eslint.config.mjs` and the exact files in
`config/architecture/component-baseline.json` are migration debt, not general allowlists. New files
must satisfy the architecture rules. Remove a filename whenever that slice moves behind the
approved server/API/storage/component boundary.

Measured regression baselines (2026-08-21):

- `/app`: 3,152.9 KiB JavaScript, 320.4 KiB CSS, 2,181.9 KiB largest chunk. The enforced budgets
  are 3,400 KiB, 350 KiB, and 2,350 KiB respectively.
- `/`: Lighthouse performance 0.79, accessibility 0.96, LCP 4,937 ms, CLS 0, TBT 0 ms. The
  enforced floors/ceilings are 0.75, 0.95, 5,500 ms, 0.1, and 300 ms.

These are regression limits, not performance targets. Lower both the observed baseline and its
budget when route extraction, dependency removal, or image/font work improves the product. Do not
raise a budget merely to land a change.

Rule ownership:

- `WEB001`–`WEB014`, `WEB019`: `@oppulence/eslint-plugin-web`
- `WEB015`–`WEB018`: `quality/repository-policies.test.ts` and contract drift scripts
- `WEB020`: `quality/component-contracts.test.ts` plus colocated Testing Library tests
- Cross-package imports: `config/architecture/dependency-cruiser.config.mjs`
- Security/data-flow sinks: `config/quality/semgrep.yml`
- Account-scoped preferences: `lib/storage/scoped-storage.ts`
- Sensitive conversations: scoped in-memory storage in `lib/chat-sessions.ts`
