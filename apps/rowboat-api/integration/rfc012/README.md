# RFC 012 public acceptance

This is an opt-in, non-weakened acceptance suite. It uses real public HTTP,
PostgreSQL 16, `cmd/devstack`, the real `cmd/server`, and
`cmd/dev-product-mcp`. It is build-tagged so normal unit tests do not silently
substitute mocks for missing broker behavior.

## One-command run

From `apps/rowboat-api`:

```sh
./integration/rfc012/postgres16.sh
```

The runner:

1. Builds all three real services.
2. Creates an ephemeral RSA broker signing key.
3. Starts a disposable PostgreSQL 16 container and enables `pgcrypto`.
4. Applies the checked-in Atlas migrations with `AUTO_MIGRATE=false`.
5. Starts the dev identity/Hydra fixture, rowboat-api, and the product MCP
   resource server on dynamically allocated loopback ports.
6. Mints three signed tenant JWTs through devstack.
7. Runs the build-tagged public HTTP acceptance test.
8. Stops every process and removes the disposable PostgreSQL container.

Service logs and the test transcript are written below `JCODE_SCRATCH_DIR`
when it is set, otherwise below the operating-system temporary directory. The
runner prints the artifact path on success and on failure.

The lower-level test can also be run directly after providing every environment
variable enforced by its `mustEnv` calls:

```sh
go test -tags=rfc012acceptance ./integration \
  -run TestRFC012PublicContract -count=1 -v
```

## Assertions covered

- JWT-authenticated list, start, callback, claim, resource-token mint, and disconnect
- SHA-256-only state storage, callback scope-escalation denial, and callback/claim replay denial
- entitlement denial before consent and before token mint
- audience-bound, scoped resource tokens with a maximum 15-minute lifetime
- product MCP rejection for wrong audience, expiration, and missing scope
- product-owned HTTP 428 approval challenge, successful retry, and denial of approval reuse
- cross-tenant connection isolation
- upstream revocation result, local tombstone, broker audit, and product audit
- no provider API key, access-token, or refresh-token fields in public output or audit metadata

## Production boundary

The acceptance fixture deliberately replaces only external identity, Hydra, and
product systems. It does not mock rowboat-api, PostgreSQL transaction behavior,
connector persistence, JWT verification, scope enforcement, entitlement checks,
or product MCP authorization. Production deployments still use the RFC 012
Hydra, consent, WorkOS, KMS, secret-management, and incident-runbook artifacts.
