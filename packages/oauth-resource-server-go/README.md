# oauth-resource-server-go

Go `net/http` resource-server toolkit implementing the RFC 012 connector token
contract. It verifies audience-bound JWTs against a cached JWKS, refetches on an
unknown `kid`, defaults to **RS256 only**, validates `iss`, `aud`, `exp`, `nbf`,
and `iat` with 60 seconds of clock skew, and normalizes connector actor claims.

## Verify tokens

```go
verifier, err := oauthrs.New(ctx, oauthrs.Config{
    IssuerURL: "https://oauth.example.com",
    Audience:  "mcp:canvas",
    JWKSURL:   "https://oauth.example.com/.well-known/jwks.json",
})
if err != nil {
    return err
}

claims, err := verifier.Verify(rawToken)
// claims.UserID, OrganizationID, ConnectionID, ConnectorID,
// TokenID, TrustTier, Scopes
```

`JWKSURL` may be omitted when `IssuerURL` exposes OIDC discovery. The default
clock skew is 60 seconds. `ValidMethods` can explicitly override the RS256-only
default when an issuer contract requires another algorithm.

## Protect an MCP route

```go
mux.Handle("POST /payments", verifier.RequireMCPToken(oauthrs.MCPTokenOptions{
    Audience:       "mcp:cadence",
    RequiredScopes: []string{"cadence.payment_run.execute"}, // all-of
    AnyScopes:      []string{"cadence.admin", "cadence.operator"}, // any-of
    ConnectionValidator: func(ctx context.Context, actor *oauthrs.Claims) (bool, error) {
        return connections.IsActive(ctx, actor.ConnectionID)
    },
    ApprovalValidator: func(r *http.Request, token string, actor *oauthrs.Claims) (bool, error) {
        // Introspect token and match it to request action/resource details.
        return approvals.Validate(r.Context(), token, actor.ConnectionID, r.URL.Path)
    },
})(paymentHandler))
```

When `ApprovalValidator` is configured, `X-Approval-Token` is mandatory. Missing
or invalid approval returns HTTP 428 with `approval_required`.

Standalone scope middleware is also available:

- `RequireAllScopes(...)`, with `RequireScopes(...)` retained as an alias.
- `RequireAnyScope(...)`.

## Errors

HTTP middleware denies by default and responds with:

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

`Verify` returns `*AuthorizationError`, exposing `Code`, `Status`, and a
server-side `Cause`. Issuer, malformed-claim, `nbf`, `iat`, algorithm, unknown
key, and other invalid-token failures intentionally collapse to
`token_invalid_signature` rather than exposing an authorization oracle.

## Develop

```bash
gofmt -w *.go
go test ./...
```
