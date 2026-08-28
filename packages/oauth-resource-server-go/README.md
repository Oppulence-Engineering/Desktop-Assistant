# oauth-resource-server-go

Go `net/http` resource-server toolkit for the RFC 012 connector-token contract.
The primary constructor is intentionally fail closed. It requires exact issuer and
audience values, exactly RS256, expiration, and the connector actor claims
`sub`/user, `connection_id`, `connector_id`, and `jti`.

## RFC 012 verifier

```go
verifier, err := oauthrs.New(ctx, oauthrs.Config{
    IssuerURL: "https://oauth.example.com",
    Audience:  "mcp:canvas",
    JWKSURL:   "https://oauth.example.com/.well-known/jwks.json",
    // Optional tenant pin. When set, the token must carry this organization.
    RequiredOrganizationID: "org_123",
})
```

`IssuerURL` and `Audience` are mandatory and compared exactly. `JWKSURL` may be
omitted for same-origin OIDC discovery. Every accepted connector token must
normalize to a non-empty subject/user, connection ID, connector ID, and token ID.
Use `NewGeneric(ctx, GenericConfig{...})` explicitly for non-connector JWTs that
do not carry those actor claims. The generic verifier still requires and checks
an exact issuer and audience. Algorithm configurability is available only through
the explicitly separate generic verifier. `New` defaults an omitted method list
to RS256 and rejects mixed lists, case variants, and every configured algorithm
other than exactly `RS256`.

## Verify authoritative entitlement requests

Product entitlement endpoints must verify the signed timestamp, connector,
request ID, exact body bytes, and atomically consume the request ID in a shared
bounded replay store:

```go
store := &oauthrs.PostgresEntitlementReplayStore{DB: db}
if err := store.EnsureSchema(ctx); err != nil { return err }

entitlements, err := oauthrs.NewEntitlementRequestVerifier(
    oauthrs.EntitlementRequestVerifierConfig{
        SigningKey:  []byte(os.Getenv("PRODUCT_ENTITLEMENT_HMAC_KEY")),
        Connector:   "canvas",
        ReplayStore: store,
    },
)
if err != nil { return err }

body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
if err != nil { return err }
if err := entitlements.Verify(r.Context(), r.Header, body); err != nil {
    http.Error(w, "unauthorized", http.StatusUnauthorized)
    return
}
```

`MemoryEntitlementReplayStore` is bounded and suitable for tests or one-process
development only. Multi-replica products must use one distributed atomic store,
such as the included PostgreSQL implementation. Verification fails closed if the
store is unavailable or full.

## Remote JWKS security

Production remote URLs must use HTTPS and contain no userinfo or fragment. The
issuer origin is allowlisted automatically. Cross-origin discovery or a direct
cross-origin `JWKSURL` requires an exact origin in `AllowedJWKSOrigins`.

The built-in client:

- rejects private, loopback, link-local, multicast, and unspecified addresses
- validates every DNS answer and pins the selected address for the connection,
  preventing DNS rebinding between policy evaluation and dialing
- disables proxy-side resolution and blocks redirects outside the allowlist
- limits redirects, request duration, and response bytes
- coalesces concurrent unknown-`kid` refreshes, applies an issuer-wide refresh
  cooldown across distinct misses, and negative-caches individual misses

Defaults are a 10-second request timeout, 1 MiB response limit, and 30-second
unknown-`kid` negative-cache TTL and refresh cooldown. Configure them with
`HTTPTimeout`, `MaxJWKSResponseBytes`, `UnknownKIDCacheTTL`, and
`UnknownKIDRefreshCooldown`.

Plain HTTP and loopback/private access are never enabled by URL alone. Local test
servers require `AllowLocalhostDevelopment: true`; this option permits only HTTP
localhost/loopback, not arbitrary private networks.

## Protect an MCP route

```go
mux.Handle("POST /payments", verifier.RequireMCPToken(oauthrs.MCPTokenOptions{
    Audience:       "mcp:cadence",
    RequiredScopes: []string{"cadence.payment_run.execute"},
    AnyScopes:      []string{"cadence.admin", "cadence.operator"},
    ConnectionValidator: func(ctx context.Context, actor *oauthrs.Claims) (bool, error) {
        return connections.IsActive(ctx, actor.ConnectionID)
    },
    ApprovalValidator: func(r *http.Request, token string, actor *oauthrs.Claims) (bool, error) {
        return approvals.Validate(r.Context(), token, actor.ConnectionID, r.URL.Path)
    },
})(paymentHandler))
```

`RequireAllScopes` and `RequireAnyScope` are also available.

JWT bearer tokens remain replayable by a holder until `exp`. Signature and `jti`
validation do not make a bearer token single-use. `RequireMCPToken` therefore
defaults to `ConnectionValidationLive` and fails closed when a
`ConnectionValidator` is absent, returns an error, or reports the connection
inactive. Production product MCPs must perform that live check on every protected
request so disconnect takes effect immediately.

One-process offline development may opt in explicitly with
`ConnectionValidationMode: ConnectionValidationOfflineDevelopment` and a positive
`OfflineMaxTokenTTL`. The token must contain `iat`, its issued lifetime
(`exp - iat`) must not exceed that configured bound, and the bound itself may not
exceed `MaxOfflineDevelopmentTokenTTL` (five minutes). This mode is not a
production revocation mechanism.

Approval tokens should remain operation-bound and single-use where the product
contract requires them.

## Errors

Validation failures are returned as `*AuthorizationError`. Detailed issuer,
claim, algorithm, key, and network failures intentionally collapse to
`token_invalid_signature` to avoid exposing an authorization oracle. Stable
middleware codes also include `token_missing`, `token_expired`,
`audience_mismatch`, `scope_missing`, `connection_revoked`, and
`approval_required`.

## Develop

```bash
gofmt -w *.go
go test -race ./...
```
