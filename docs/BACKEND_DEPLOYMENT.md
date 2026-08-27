# Rowboat Backend Deployment and Operations

This guide covers the deployed RFC 012 connector authorization plane alongside the WorkOS-direct service-plane login defined by RFC 011. WorkOS remains the human identity provider. Ory Hydra issues audience-bound connector resource tokens, `oauth-consent` performs login/consent and MFA step-up, and rowboat-api brokers connections without proxying product MCP traffic.

## Repository artifacts

| Artifact | Path |
|---|---|
| rowboat-api chart | `charts/rowboat-api/` |
| Hydra environment values and client Jobs | `charts/hydra/` |
| consent chart and environment values | `charts/oauth-consent/` |
| connector incident runbooks | `docs/runbooks/connectors.md` |
| product resource-server example | `docs/deployment-examples/product-resource-server.env.example` |

## External prerequisites

Provision separate resources and credentials for staging and production:

1. Managed Postgres databases for rowboat-api and Hydra. Never share Hydra DSNs across environments.
2. Redis for rowboat-api.
3. WorkOS projects or explicitly isolated environments with AuthKit, MFA enabled, and callback URIs for `/callback` and `/step-up/callback` on the matching consent host.
4. DNS/TLS for the API, Hydra public endpoint, and consent app.
5. An external secret manager that writes `rowboat-api-secrets`, `hydra-secrets`, and `oauth-consent-secrets`.
6. Product MCP deployments with environment-specific issuer, audience, JWKS, and entitlement configuration.

## Required secrets

Generate independent values with `openssl rand -hex 32`. Never place live values in Helm values files.

- `rowboat-api-secrets`: existing backend keys plus `ORY_BROKER_CLIENT_SECRET`, `HOOK_HMAC_SECRET`, `DB_ENCRYPTION_KEY`, `BROKER_TOKEN_PRIVATE_KEY_PEM`, and `BROKER_TOKEN_KEYRING_JSON`.
- `oauth-consent-secrets`: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `HOOK_HMAC_SECRET`, and `COOKIE_SECRET`. `HOOK_HMAC_SECRET` must equal rowboat-api's value so consent context and append-audit hooks authenticate.
- `hydra-secrets`: `dsn`, `secretsSystem`, and `secretsCookie`. See `charts/hydra/secrets.example.yaml`.

The HMAC secret authenticates only consent context/audit bodies. Do not reuse it for cookies, database encryption, provider OAuth clients, or approval tokens. Rotate it by accepting old and new verification keys in the application release when supported, deploying verifiers first, switching the signer, waiting at least the 10-minute consent TTL, then removing the old key. If dual verification is unavailable, disable new consent during the coordinated restart.

Internal hook signatures use canonical version `v1` and bind the HTTP method,
escaped path, millisecond timestamp, base64url nonce, and SHA-256 body digest.
The API rejects timestamps outside a five-minute window and atomically reserves
each nonce in PostgreSQL. Run migrations before deploying this release. Every
API replica must use the same database so replay rejection is cluster-wide.

## Broker resource-token signing-key rotation

`BROKER_TOKEN_KEY_ID` selects the active signing key in
`BROKER_TOKEN_PRIVATE_KEY_PEM`. `BROKER_TOKEN_KEYRING_JSON` is a JSON object of
all public RSA verification keys to publish, keyed by stable `kid`. Startup
fails if the active `kid` is absent or its public key does not match the private
key. Keep the keyring identical across replicas during each rollout.

Rotate without invalidating in-flight tokens:

1. Add the new public key to `BROKER_TOKEN_KEYRING_JSON`, retaining the old key.
2. Deploy all API replicas and verify the broker JWKS contains both `kid` values.
3. Set `BROKER_TOKEN_KEY_ID` and `BROKER_TOKEN_PRIVATE_KEY_PEM` to the new key,
   while continuing to publish both public keys. Deploy all replicas again.
4. Wait longer than `BROKER_TOKEN_TTL` plus verifier clock skew and cache TTL.
5. Remove the old public key and deploy. Resource servers refetch JWKS once on
   an unknown `kid`, so publishing the overlap before switching signers is required.

## Environment isolation

Each environment must have unique:

- Hydra database, issuer, public hostname, client IDs, and client secrets
- consent hostname, cookie secret, WorkOS callbacks, and HMAC secret
- connector definitions, provider credentials, callback URLs, MCP URLs, and audiences
- product resource-server issuer/audience configuration

Production audiences use `mcp:<product>`. Staging uses a distinct audience such as `mcp:<product>-staging`. Promotion is rejected if any staging hostname, client id, callback, or audience appears in production rendered manifests.

`CONNECTOR_EMERGENCY_DISABLED` is a comma-separated kill switch in the rowboat-api environment overlays. Disabling a connector blocks new starts/mints. Existing grants are preserved as degraded until the incident decision calls for invalidation.

## Deploy order

```bash
helm repo add ory https://k8s.ory.sh/helm/charts
helm repo update

# 1. Sync external secrets and confirm keys exist without printing values.
kubectl -n ory get secret hydra-secrets
kubectl -n rowboat get secret rowboat-api-secrets oauth-consent-secrets

# 2. Apply rowboat-api migrations with the direct migration DSN.
DATABASE_URL="$MIGRATION_DATABASE_URL" go run ./apps/rowboat-api/cmd/migrate apply

# 3. Hydra and clients.
helm upgrade --install hydra ory/hydra -n ory --create-namespace \
  -f charts/hydra/values-production.yaml --wait
kubectl apply -n ory -f charts/hydra/clients/rowboat-desktop.yaml
kubectl -n ory wait --for=condition=complete job/rowboat-oauth-clients --timeout=180s

# 4. Consent app.
helm upgrade --install oauth-consent charts/oauth-consent -n rowboat --create-namespace \
  -f charts/oauth-consent/values-production.yaml --set image.tag=<git-sha> --wait

# 5. Broker API.
helm upgrade --install rowboat-api charts/rowboat-api -n rowboat \
  -f charts/rowboat-api/values-production.yaml --set image.tag=<git-sha> --wait
```

Use `ory-staging`, `rowboat-staging`, the staging values, and the staging client Job for staging. Client creation Jobs are intentionally fail-closed if a client already exists. Delete and recreate a client only during a planned change after assessing refresh-token impact.

## WorkOS MFA settings

In WorkOS, require MFA for the step-up policy referenced by:

- `WORKOS_STEP_UP_ACR=urn:rowboat:loa:money-moving`
- `WORKOS_STEP_UP_AMR=mfa`
- `WORKOS_STEP_UP_REDIRECT_URI=https://<consent-host>/step-up/callback`

Register exact callback URIs. Test that ordinary read consent does not require step-up and that money-moving scope consent does. A missing or unrecognized MFA assertion must fail closed.

## Entitlement failure behavior

Entitlements are checked before consent and before each resource-token mint. Treat timeout, malformed response, non-2xx, or unknown result as unavailable and fail closed for new consent and token mint. Return a distinct entitlement/service-unavailable error rather than an OAuth error. Existing connections remain recorded, but no new resource token is issued until the check recovers. Use `docs/runbooks/connectors.md#entitlement-outage`.

## Token key rotation

### Hydra signing/system/cookie keys

1. Add the new key before the previous key in the externally managed Hydra secret where the chart supports comma-separated rotation values.
2. Roll Hydra with zero unavailable replicas.
3. Confirm old and new sessions/tokens validate and JWKS is reachable.
4. Wait at least the longest applicable refresh/session TTL, or bulk-invalidate grants if an emergency requires immediate retirement.
5. Remove the old key and verify again.

### rowboat-api database encryption key

`DB_ENCRYPTION_KEY` protects stored refresh tokens. Do not replace it in place unless application-level re-encryption has completed. For compromise, disable affected connectors, revoke/invalidate grants, erase encrypted token material, rotate the key, and require reauthorization.

## Product resource-server configuration

Every product MCP must configure its RFC 012 middleware with the exact environment issuer and one audience. Use `docs/deployment-examples/product-resource-server.env.example`. Required behavior:

- allow RS256 only and refresh JWKS once on unknown `kid`
- validate issuer, audience, expiry, `nbf`, and `iat`
- return 401 for invalid/expired/wrong-audience tokens
- return 403 for missing scopes
- return 428 for money-moving calls lacking a valid action-bound approval
- check connection revocation and introspect money-moving calls when configured

## Verification and rollback

```bash
helm lint charts/oauth-consent
helm template oauth-consent charts/oauth-consent -f charts/oauth-consent/values-production.yaml >/dev/null
helm template rowboat-api charts/rowboat-api -f charts/rowboat-api/values-production.yaml >/dev/null
curl -fsS https://oauth.solomon-ai.co/.well-known/openid-configuration
curl -fsS https://oauth.solomon-ai.co/.well-known/jwks.json
curl -fsS https://consent.solomon-ai.co/healthz
curl -fsS https://api.oppulence.io/healthz
```

Run a staging consent flow for read and money-moving scopes, verify HMAC-authenticated context/audit delivery, entitlement denial copy, exact audience, and product 401/403/428 behavior before promotion. Rollback procedures are in `docs/runbooks/connectors.md#rollback`.
