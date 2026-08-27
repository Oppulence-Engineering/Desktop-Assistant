# @oppulence/oauth-resource-server

TypeScript resource-server toolkit implementing the RFC 012 connector token
contract. It verifies audience-bound JWTs against a cached JWKS, immediately
refetches on an unknown `kid`, defaults to **RS256 only**, validates `iss`, `aud`,
`exp`, `nbf`, and `iat` with 60 seconds of clock skew, and normalizes connector
actor claims. It is the API-equivalent sibling of
`packages/oauth-resource-server-go`.

## Install

```bash
npm install @oppulence/oauth-resource-server
```

## Verify tokens

```ts
import { Verifier } from "@oppulence/oauth-resource-server";

const verifier = new Verifier({
  issuerUrl: "https://oauth.example.com",
  audience: "mcp:canvas",
  jwksUrl: "https://oauth.example.com/.well-known/jwks.json",
});

const actor = await verifier.verify(rawToken);
// actor.userId, organizationId, connectionId, connectorId,
// tokenId, trustTier, scopes
```

The default clock tolerance is 60 seconds. `algorithms` can explicitly override
the RS256-only default when an issuer contract requires another algorithm.

## Express/connect middleware

```ts
import { requireMCPToken } from "@oppulence/oauth-resource-server";

app.post("/payments", requireMCPToken(verifier, {
  audience: "mcp:cadence",
  requiredScopes: ["cadence.payment_run.execute"], // all-of
  anyScopes: ["cadence.admin", "cadence.operator"], // any-of
  connectionValidator: async (actor) => connections.isActive(actor.connectionId),
  approvalValidator: async (token, actor, req) => {
    // Introspect token and match it to request action/resource details.
    return approvals.validate(token, actor.connectionId, req.url);
  },
}), paymentHandler);
```

When `approvalValidator` is configured, `X-Approval-Token` is mandatory. Missing
or invalid approval returns HTTP 428 with `approval_required`.

Standalone middleware is also exported:

- `requireAuth(verifier)`
- `requireAllScopes(...)`, with `requireScopes(...)` retained as an alias
- `requireAnyScope(...)`
- `verifyAuthorizationHeader(verifier, header)` for framework-neutral use

## Claims

`Claims` contains:

- `userId`, `organizationId`
- `connectionId`, `connectorId`
- `scopes`
- `tokenId` from `jti` or `token_id`
- `trustTier`
- standard `subject`, `issuer`, `audience`, `expiresAt`, `notBefore`, `issuedAt`
- compatibility fields `workosUserId`, `workosOrgId`, `email`, and `raw`

Runtime schemas and helpers are exported as `ClaimsSchema`, `hasScope`,
`hasAllScopes`, and `hasAnyScope`.

## Errors

Middleware denies by default and responds with:

```json
{"error":"required scope missing","code":"scope_missing"}
```

Stable RFC 012 codes are:

- `token_missing`
- `token_expired`
- `token_invalid_signature`
- `audience_mismatch`
- `scope_missing`
- `connection_revoked`
- `approval_required`

`Verifier.verify` throws `AuthorizationError` with `code`, `status`, and a
server-side `cause`. `TokenError` remains a compatibility subclass. Issuer,
malformed-claim, `nbf`, `iat`, algorithm, unknown key, and other invalid-token
failures intentionally collapse to `token_invalid_signature`.

## Develop

```bash
npm ci
npm run typecheck
npm test
npm run build
```
