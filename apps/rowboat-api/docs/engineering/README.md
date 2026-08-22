# Engineering standards

These documents turn Rowboat API's existing architecture into reviewable and
automated rules. Normative words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD
NOT**, and **MAY** are interpreted as requirement levels. `AGENTS.md` is the
concise agent contract; these files provide rationale and examples.

- [Architecture](architecture.md): package ownership, composition, dependency direction, configuration.
- [Coding standards](coding-standards.md): idiomatic Go, errors, concurrency, observability, outbound calls.
- [Security](security.md): trust boundaries, authorization, tenancy, secrets.
- [Database](database.md): Ent, transactions, immutable records, migrations, generation.
- [Temporal](temporal.md): deterministic workflows and retry-safe activities.
- [API design](api-design.md): routing, validation, DTOs, RFC 9457, compatibility.
- [Testing](testing.md): risk-based test expectations and race coverage.
- [Code review](code-review.md): review questions, exceptions, suppression policy, quality gates.
- [Executable policy](policy-system.md): tool layers, RowboatLint rules, and extension guidance.
- [Audit baseline](audit-2026-08-21.md): findings and actions from the standards audit.

## Enforcement tiers

| Tier | Purpose | Enforcement |
|---|---|---|
| Edit/save | IDE `gopls`, `goimports` | contributor setup |
| Pre-commit | changed-file imports/format and secret scan | Lefthook |
| Pre-push | `make verify` | Lefthook |
| CI | format, lint, tests/race, architecture, generation, vulnerabilities, secrets | GitHub Actions |

Hooks are feedback, not authority. CI repeats authoritative checks because
hooks can be bypassed and local machines vary.
