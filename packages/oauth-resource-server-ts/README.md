# @oppulence/oauth-resource-server

TypeScript resource-server toolkit for RFC 012 connector tokens. `Verifier` is
fail closed: exact `issuerUrl` and `audience` are mandatory, exactly RS256 is required,
`exp` is required, and verified tokens must contain subject/user,
`connection_id`, `connector_id`, and `jti` actor claims.

## RFC 012 verifier

```ts
import { Verifier } from "@oppulence/oauth-resource-server";

const verifier = new Verifier({
  issuerUrl: "https://oauth.example.com",
  audience: "mcp:canvas",
  jwksUrl: "https://oauth.example.com/.well-known/jwks.json",
  requiredOrganizationId: "org_123", // optional tenant pin
});

const actor = await verifier.verify(rawToken);
```

Issuer and audience are compared exactly. For non-connector JWTs without RFC 012
actor claims, use the explicitly named `GenericVerifier`. It still requires and
validates exact issuer and audience values. Algorithm configurability is available
only through that explicitly separate generic verifier. `Verifier` rejects mixed
lists, case variants, and every algorithm other than exactly `RS256`.

## Verify authoritative entitlement requests

Product entitlement endpoints must verify the signed timestamp, connector,
request ID, and exact body bytes, then atomically consume the request ID in a
shared bounded replay store:

```ts
import { EntitlementRequestVerifier } from "@oppulence/oauth-resource-server";

const entitlements = new EntitlementRequestVerifier({
  signingKey: process.env.PRODUCT_ENTITLEMENT_HMAC_KEY!,
  connector: "canvas",
  replayStore: distributedReplayStore,
});

await entitlements.verify(request.headers, exactBodyBytes);
```

`MemoryEntitlementReplayStore` is bounded and suitable for tests or one-process
development only. Multi-replica products must implement `EntitlementReplayStore`
with one distributed atomic claim store, such as PostgreSQL or Redis. Verification
fails closed if that store is unavailable or full.

## Remote JWKS security

Production URLs must use HTTPS and may not contain userinfo or fragments. The
issuer origin is allowlisted automatically. A cross-origin JWKS endpoint must be
listed as an exact origin in `allowedJwksOrigins`.

The client validates every DNS answer, rejects private, loopback, link-local,
multicast, and unspecified addresses, and pins the validated address into the
actual HTTP/TLS request to prevent DNS rebinding. Redirects are blocked. Requests
and responses are bounded. Defaults are:

- `requestTimeoutMs`: 10 seconds
- `maxJwksResponseBytes`: 1 MiB
- `unknownKidCacheTtlMs`: 30 seconds
- `unknownKidRefreshCooldownMs`: 30 seconds

Concurrent unknown-`kid` misses share one refresh. An issuer-wide cooldown also
prevents sequential distinct key IDs from forcing repeated refreshes. A
still-unknown key is negative-cached for the configured TTL.

Local HTTP is available only with `allowLocalhostDevelopment: true`, and only for
localhost/loopback. The option does not permit arbitrary private-network hosts.

## Middleware

```ts
app.post("/payments", requireMCPToken(verifier, {
  audience: "mcp:cadence",
  requiredScopes: ["cadence.payment_run.execute"],
  anyScopes: ["cadence.admin", "cadence.operator"],
  connectionValidator: async (actor) => connections.isActive(actor.connectionId),
  approvalValidator: async (token, actor, req) =>
    approvals.validate(token, actor.connectionId, req.url),
}), paymentHandler);
```

Exports include `requireAuth`, `requireAllScopes`, `requireAnyScope`,
`requireMCPToken`, and `verifyAuthorizationHeader`.

JWT bearer tokens remain replayable by a holder until `exp`. Signature and `jti`
validation do not make a bearer token single-use. `requireMCPToken` therefore
defaults to `connectionValidationMode: "live"` and fails closed when a
`connectionValidator` is absent, rejects, or reports the connection inactive.
Production product MCPs must perform that live check on every protected request so
disconnect takes effect immediately.

One-process offline development may opt in explicitly with
`connectionValidationMode: "offline-development"` and a positive
`offlineMaxTokenTtlSeconds`. The token must contain `iat`, its issued lifetime
(`exp - iat`) must not exceed that configured bound, and the bound itself may not
exceed `MAX_OFFLINE_DEVELOPMENT_TOKEN_TTL_SECONDS` (five minutes). This mode is not
a production revocation mechanism.

Approval tokens should remain operation-bound and single-use where the product
contract requires them.

## Errors

`verify` throws `AuthorizationError` (`TokenError` remains a compatibility
subclass). Detailed issuer, malformed-claim, algorithm, key, and network failures
collapse to `token_invalid_signature` to avoid an authorization oracle. Stable
middleware codes also include `token_missing`, `token_expired`,
`audience_mismatch`, `scope_missing`, `connection_revoked`, and
`approval_required`.

## Develop

```bash
npm ci
npm run typecheck
npm test
npm run build
```
