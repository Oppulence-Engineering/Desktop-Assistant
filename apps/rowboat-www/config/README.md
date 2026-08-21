# Repository Configuration

Repository-owned configuration is grouped by the boundary it protects. Keep framework-discovered
configuration at the application root; put manually invoked policy and generation configuration
here.

| Directory       | Ownership                                           | Invoked by                                    |
| --------------- | --------------------------------------------------- | --------------------------------------------- |
| `architecture/` | Dependency boundaries and exact migration baselines | ESLint and `npm run arch`                     |
| `contracts/`    | OpenAPI client and runtime-schema generation        | `npm run contracts:generate`                  |
| `quality/`      | Dead-code and security scanning policy              | `npm run knip` and `npm run security:semgrep` |

Configuration moves must update `package.json`, repository-policy tests, contributor documentation,
and any scripts that invoke the tool directly. Do not add a new root-level policy file when the tool
supports an explicit configuration path.
