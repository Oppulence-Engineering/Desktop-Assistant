# RFC 012 public acceptance

This is an opt-in, non-weakened acceptance suite. It uses real public HTTP,
PostgreSQL 16, `cmd/devstack`, and `cmd/dev-product-mcp`. It is build-tagged so
normal unit tests do not silently substitute mocks for missing broker behavior.

Run it with:

```sh
go test -tags=rfc012acceptance ./integration -run TestRFC012PublicContract -v
```

Required environment is declared by the test's `mustEnv` calls. In particular,
provide tenant A, tenant B, and unentitled service JWTs plus deliberately wrong
audience, expired, and missing-scope resource JWTs. Point both services at the
same disposable PostgreSQL 16 database with `pgcrypto` enabled. Drop that
database after the run.

## Assertions covered

- JWT-authenticated list, start, callback, claim, resource-token mint, disconnect
- SHA-256-only state storage, callback scope escalation denial, callback/claim replay denial
- entitlement denial before start and before mint
- audience-bound, scoped resource token with a maximum 15 minute lifetime
- product MCP 401 wrong audience/expired, 403 missing scope, 428 approval challenge
- successful approval retry and denial of approval reuse
- cross-tenant connection isolation
- upstream revoke result, local tombstone, broker and product audit
- no provider/API credential fields in public connector output or audit metadata

## Current contract blockers

The suite deliberately reports these as failures rather than relaxing checks:

1. A devstack authorization-code fixture must support `success` (exact requested
   scopes) and `scope-escalation` (requested scopes plus an extra scope).
2. The public mint response must expose `expires_in` and `scope`, and its JWT must
   carry RFC 012 actor claims including connection and organization IDs.
3. The runner must discover the claimed connection ID from a supported public
   response and export `RFC012_CONNECTION_ID`. Until that public identifier is
   returned, the harness cannot safely infer it across tenants.
4. Product approval issuance/introspection is product-owned. The harness seeds a
   hashed, five-minute fixture directly in the disposable product database, then
   exercises the approval exclusively through public MCP HTTP.
5. Entitlement-before-mint requires fixture-only public transitions. Export
   `RFC012_ENTITLEMENT_DOWNGRADE_URL` and `RFC012_ENTITLEMENT_RESTORE_URL`; the
   test requires both endpoints, performs the downgrade, asserts mint returns
   403, and restores the disposable fixture. Their absence is a hard failure.
