# Code review and quality gates

## Before implementation and review

Answer:

- Which package owns this behavior and what invariant changes?
- Which trust/security and tenant context applies?
- Can it run twice, retry, or crash halfway?
- Does it need a transaction, immutable history, or an outbox?
- Is it synchronous work or durable Temporal orchestration?
- What happens on partial failure and concurrent updates?
- Which tests demonstrate success, denial, invalid state, and replay behavior?

No-drive-by-refactor is a MUST. Record unrelated issues as follow-ups. Review
large files by cohesion, not arbitrary line limits. New dependencies require a
clear capability/complexity benefit, maintenance/security consideration, and
`go mod tidy`/`go mod verify`.

## Exceptions and suppressions

Fix the cause first. If a linter is wrong or the safer pattern is intentionally
inapplicable, use the narrowest line-level form:

```go
value := legacyCall() //nolint:gosec // Provider requires this non-cryptographic identifier.
```

Name the linter and explain why the code is safe. Never use bare `//nolint`,
package-wide suppression, or vague “false positive” text. Configuration-level
exclusions require a stable generated/test/path class and rationale.

Adding a tool/rule requires: defect class caught, why existing checks miss it,
expected runtime/noise, execution tier, pinned version/config owner, and a
clean baseline. Remove tools whose findings are routinely ignored.

## Completion

Agents and humans run `make verify` before handoff. CI independently checks
format/imports, lint/security analysis, architecture invariants, tests/race,
module integrity, generation drift, vulnerabilities, secrets, migrations via
generation, and container security. Failures are repaired or reported; they
are never relabeled as passes.
