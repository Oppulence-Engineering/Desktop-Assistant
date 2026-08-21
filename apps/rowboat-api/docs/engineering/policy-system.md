# Executable policy system

`make verify` is the normal agent gate. `make verify-ci` adds the full race
suite, reachable-vulnerability analysis, and repository-history secret scan.
Tools are pinned in the Makefile and CI rather than floating at `latest`.

## Layers

| Target | Enforcement |
| --- | --- |
| `make lint` | golangci-lint correctness/security checks plus depguard import policy |
| `make architecture` | tenant-owned Ent registry completeness and Arch-Go topology |
| `make rowboatlint` | type-aware Rowboat analyzers built on `go/analysis` |
| `make ruleguard` | low-cost Go syntax patterns |
| `make structural` | ast-grep structural rules |
| `make policy` | Conftest policy and Rego tests protecting required CI gates |
| `make security` | `govulncheck` and Gitleaks |

Lefthook runs formatting and staged secret scanning at commit time, then
`make verify` before push. CI repeats the authoritative checks because hooks
can be bypassed.

## RowboatLint

| Rule | Detects | Remediation |
| --- | --- | --- |
| `RB003_TEMPORAL_SIDE_EFFECT` | nondeterministic clocks, randomness, network/OS calls, or goroutines in a function accepting `workflow.Context` | use Temporal APIs or move the effect into an activity |
| `RB004_DIRECT_HTTP` | package-level HTTP helpers or `http.DefaultClient` | use `NewRequestWithContext` and an explicit bounded client |
| `RB011_FORBIDDEN_LOG_DATA` | credential-bearing Zap field keys | remove the value or log a bounded classification/identifier |

Analyzer fixtures live beside each analyzer under `testdata`. Good examples
must pass and bad examples carry `// want` diagnostics, so weakening or
accidentally broadening a rule breaks tests.

## Choosing an enforcement mechanism

Use ast-grep or ruleguard for a straightforward syntax pattern. Use
`go/analysis` when aliases, resolved types, receivers, or function boundaries
matter. Use a repository guard when an invariant compares several files or a
generated registry. Establish a clean whole-repository baseline before making
a new rule blocking; suppressions must be narrow and documented.
