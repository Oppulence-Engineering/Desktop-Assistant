# Rowboat Backend Deployment and Operations

This guide covers the deployed RFC 012 connector authorization plane alongside the WorkOS-direct service-plane login defined by RFC 011. WorkOS remains the human identity provider. Ory Hydra runs the authorization-code, consent, refresh, and revocation flow; `oauth-consent` performs login/consent and MFA step-up. Those Hydra consent-plane credentials are exchanged and retained by rowboat-api and are never product MCP bearer tokens. After checking the connection, scopes, and entitlement, rowboat-api mints its own short-lived, audience-bound connector resource token for direct product MCP traffic.

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

1. Managed Postgres databases for rowboat-api, Hydra, and oauth-consent. Never share database credentials or DSNs across environments.
2. Redis for rowboat-api.
3. WorkOS projects or explicitly isolated environments with AuthKit, MFA enabled, and callback URIs for `/callback` and `/step-up/callback` on the matching consent host.
4. DNS/TLS for the rowboat-api origin, Hydra public endpoint, and consent app. These are distinct token issuers.
5. An external secret manager that writes `rowboat-api-secrets`, `hydra-secrets`, and `oauth-consent-secrets`.
6. Product MCP deployments with environment-specific issuer, audience, JWKS, and entitlement configuration.

## Required secrets

Generate independent values with `openssl rand -hex 32`. Never place live values in Helm values files.

- `rowboat-api-secrets`: existing backend keys plus `ORY_BROKER_CLIENT_SECRET`, `HOOK_HMAC_SECRET`, `DB_ENCRYPTION_KEY`, `BROKER_TOKEN_PRIVATE_KEY_PEM`, and `BROKER_TOKEN_KEYRING_JSON`.
- `oauth-consent-secrets`: `DATABASE_URL`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `HOOK_HMAC_SECRET`, and `COOKIE_SECRET`. `HOOK_HMAC_SECRET` must equal rowboat-api's value so consent context and append-audit hooks authenticate.
- `hydra-secrets`: `dsn`, `secretsSystem`, and `secretsCookie`. See `charts/hydra/secrets.example.yaml`.

The HMAC secret authenticates only consent context/audit bodies. Do not reuse it for cookies, database encryption, provider OAuth clients, or approval tokens. Rotate it by accepting old and new verification keys in the application release when supported, deploying verifiers first, switching the signer, waiting at least the 10-minute consent TTL, then removing the old key. If dual verification is unavailable, disable new consent during the coordinated restart.

## oauth-consent PostgreSQL contract

`DATABASE_URL` is mandatory. The chart references that exact key explicitly for
both the migration init container and the application container, so a missing
key prevents the Pod from starting. Use an environment-local direct PostgreSQL
DSN with TLS enabled in staging and production. Do not use a PgBouncer
transaction-pool endpoint because the init container applies DDL migrations.

The preferred topology is a dedicated logical database and role for
oauth-consent. A shared PostgreSQL server or cluster is supported. Sharing a
logical database with rowboat-api is also technically supported when planned,
but the oauth-consent role must be able to create and alter its
`oauth_consent_*` tables in the target schema, backup/restore and maintenance
become coupled, and the failure blast radius is shared. Never share a logical
database or credentials between staging and production.

Before Helm deployment, confirm the externally managed Secret contains the key
without printing the value:

```bash
test -n "$(kubectl -n rowboat get secret oauth-consent-secrets \
  -o jsonpath='{.data.DATABASE_URL}')"
```

The Helm environment overlays intentionally leave PostgreSQL CIDRs empty. Each
deployment must provide private endpoint CIDRs through an environment-owned,
uncommitted values file. Empty lists, `0.0.0.0/0`, and the former example
`10.0.0.10/32` fail schema/template validation.

Production NetworkPolicies are destination-based rather than port-only:

- oauth-consent ingress selects the ingress controller, DNS selects CoreDNS,
  Hydra Admin selects both its namespace and pods, and managed PostgreSQL uses
  deployment-owned private CIDRs.
- WorkOS token/JWKS calls and rowboat-api hooks leave oauth-consent only through
  the selected `rowboat-egress-gateway` pods on TCP 443.
- rowboat-api ingress selects the ingress controller. Its direct in-cluster
  Hydra Admin rule is namespace-and-pod scoped. Provider HTTPS, PostgreSQL, and
  Redis are allowed only through the selected transparent egress gateway on
  TCP 443, 5432, and 6379.

The `egress-system` namespace and gateway workload labels in checked-in values
are a release contract. Install a transparent, fail-closed gateway with those
labels, or override both selectors in an environment-owned values file. The
gateway must preserve WorkOS, Hydra public, PostgreSQL, Redis, model/provider,
connector entitlement, OAuth provider, telemetry, and other configured upstream
communication. Do not deploy these policies before transparent routing is
enforced and connectivity probes pass.

```yaml
# $OAUTH_CONSENT_NETWORK_VALUES
networkPolicy:
  postgresql:
    cidrs:
      - 10.42.18.7/32

# $HYDRA_NETWORK_VALUES
egress:
  postgresql:
    cidrs:
      - 10.42.18.8/32
```

Before a release, run the mandatory state-machine gate. Unlike ordinary unit
test collection, it fails if the PostgreSQL suite would be skipped:

```bash
cd apps/oauth-consent
npm run test:release
```

The connector deployment contract also renders the upstream Hydra chart at
version `0.55.0`, asserts the production runtime image is `oryd/hydra:v2.3.0`,
and boots that exact real-Hydra image for client reconciliation and authorization
acceptance.

Use the actual environment-specific managed PostgreSQL private endpoint CIDRs.
Do not copy the documentation addresses above into a deployment.

## Hydra Admin network isolation

`charts/hydra/network-policy/` is a companion Helm chart for the upstream Ory
Hydra release. It default-denies ingress and egress for Hydra Pods, permits
public port 4444 only from the configured ingress-controller namespace/pod
selectors, allows DNS and the explicit PostgreSQL CIDRs, and permits Admin port
4445 only from both of these labeled peer classes:

- oauth-consent Pods in the matching `rowboat` environment namespace
- Hydra client reconciliation/operator Jobs in the matching `ory` namespace

The oauth-consent chart applies the inverse restriction: port 4445 egress has
both Hydra namespace and Hydra Pod selectors. A different Pod listening on 4445
is not reachable. Keep namespace names and ingress-controller selectors aligned
with the cluster before deployment. Hydra `ServiceMonitor` is disabled because
the Admin port is intentionally not open to monitoring Pods.

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

## Connector token issuer contract

The canonical connector resource-token issuer is the externally reachable
rowboat-api origin:

| Environment | `BROKER_TOKEN_ISSUER` / verifier issuer | Verifier JWKS URL |
|---|---|---|
| Production | `https://api.oppulence.io` | `https://api.oppulence.io/.well-known/connector-jwks.json` |
| Staging | `https://api.x.staging.oppulence.io` | `https://api.x.staging.oppulence.io/.well-known/connector-jwks.json` |

This contract is separate from Hydra. `ORY_PUBLIC_URL` points rowboat-api at
Hydra's consent-plane OAuth endpoints. Hydra-issued access and refresh tokens
must not be sent to product MCPs, and product verifiers must not use Hydra's
issuer or `/.well-known/jwks.json` for connector resource tokens.

Production Helm renders fail when `config.BROKER_TOKEN_ISSUER` differs from
`config.PUBLIC_BASE_URL`, or when that public base differs from the TLS ingress
origin. A reviewed deployment may set
`connectorBroker.allowSeparateIssuer=true` and configure a distinct exact
`BROKER_TOKEN_ISSUER`. In that exceptional topology, every product verifier must
pin the distinct issuer while its `OAUTH_JWKS_URL` still points to the externally
reachable rowboat-api `/.well-known/connector-jwks.json` endpoint. Record the
reason, verifier rollout order, and rollback plan in the deployment change.

## Environment isolation

Each environment must have unique:

- Hydra database, consent-plane issuer, public hostname, client IDs, and client secrets
- consent hostname, cookie secret, WorkOS callbacks, and HMAC secret
- connector definitions, provider credentials, callback URLs, MCP URLs, and audiences
- rowboat-api connector resource-token signing keys and product resource-server issuer/audience/JWKS configuration

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

# 3. Hydra, default-deny policies, and clients. Both network values files are
# required environment-owned inputs and must contain real private endpoint CIDRs.
helm upgrade --install hydra ory/hydra -n ory --create-namespace \
  -f charts/hydra/values-production.yaml --wait
helm upgrade --install hydra-policy charts/hydra/network-policy -n ory \
  -f charts/hydra/network-policy/values-production.yaml \
  -f "$HYDRA_NETWORK_VALUES" --wait
kubectl apply -n ory -f charts/hydra/clients/rowboat-desktop.yaml
kubectl -n ory wait --for=condition=complete job/rowboat-oauth-clients --timeout=180s

# 4. Consent app.
helm upgrade --install oauth-consent charts/oauth-consent -n rowboat --create-namespace \
  -f charts/oauth-consent/values-production.yaml \
  -f "$OAUTH_CONSENT_NETWORK_VALUES" --set image.tag=<git-sha> --wait

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

Connection history is not credential storage. Migration
`20260828014500_connection_history_secret_purge.sql` backfills safe
credential-presence metadata, purges every existing MCP/OAuth history credential,
and installs fail-closed PostgreSQL triggers plus `IS NULL` constraints so mixed
version replicas cannot repopulate history ciphertext. The legacy history
credential columns remain temporarily as write-only compatibility sinks and are
absent from the Ent schema and reseal inventory. After all pre-migration binaries
and rollback windows are retired, schedule a maintenance migration to physically
drop those always-NULL columns. Verify the invariant after rollout:

```sql
SELECT count(*) AS retained_history_credentials
FROM (
  SELECT 1 FROM mcp_connection_histories
  WHERE refresh_token_encrypted IS NOT NULL OR api_key_encrypted IS NOT NULL
  UNION ALL
  SELECT 1 FROM oauth_connection_histories
  WHERE refresh_token_encrypted IS NOT NULL
) AS retained;
```

The result must be zero before retiring an encryption key. Do not include history
columns in ad hoc reseal jobs, exports, diagnostics, or logs.

## Product resource-server configuration

Every product MCP must configure its RFC 012 middleware with the exact rowboat-api connector issuer, the rowboat-api connector JWKS URL, and one audience. Use `docs/deployment-examples/product-resource-server.env.example`. Do not configure the Hydra issuer or Hydra JWKS here. Required behavior:

- allow RS256 only and refresh JWKS once on unknown `kid`
- validate issuer, audience, expiry, `nbf`, and `iat`
- return 401 for invalid/expired/wrong-audience tokens
- return 403 for missing scopes
- return 428 for money-moving calls lacking a valid action-bound approval
- check connection revocation and introspect money-moving calls when configured

## Verification and rollback

```bash
helm lint charts/oauth-consent
helm lint charts/oauth-consent -f charts/oauth-consent/values-production.yaml \
  -f "$OAUTH_CONSENT_NETWORK_VALUES"
helm lint charts/hydra/network-policy \
  -f charts/hydra/network-policy/values-production.yaml \
  -f "$HYDRA_NETWORK_VALUES"
helm lint charts/rowboat-api -f charts/rowboat-api/values-production.yaml
helm template oauth-consent charts/oauth-consent \
  -f charts/oauth-consent/values-production.yaml \
  -f "$OAUTH_CONSENT_NETWORK_VALUES" >/dev/null
helm template hydra-policy charts/hydra/network-policy \
  -f charts/hydra/network-policy/values-production.yaml \
  -f "$HYDRA_NETWORK_VALUES" >/dev/null
helm template rowboat-api charts/rowboat-api -f charts/rowboat-api/values-production.yaml >/dev/null
helm template rowboat-api charts/rowboat-api -f charts/rowboat-api/values-staging.yaml >/dev/null
curl -fsS https://oauth.solomon-ai.co/.well-known/openid-configuration
curl -fsS https://oauth.solomon-ai.co/.well-known/jwks.json
curl -fsS https://consent.solomon-ai.co/healthz
curl -fsS https://api.oppulence.io/healthz
curl -fsS https://api.oppulence.io/.well-known/connector-jwks.json

# Render-contract and product-verifier configuration probe.
charts/rowboat-api/tests/deployment-contract.sh

# Docker + kind + Calico: applies real consent migrations, observes /readyz=200,
# and proves the rendered allow/deny paths while NetworkPolicy is enforced.
charts/hydra/tests/network-policy-kind.sh
```

Run a staging consent flow for read and money-moving scopes, verify HMAC-authenticated context/audit delivery and entitlement denial copy, then mint a rowboat-api resource token. Confirm its `iss` is the staging API origin, its `kid` exists in the staging connector JWKS, its `aud` is exact, and the product returns the expected 401/403/428 responses. Rollback procedures are in `docs/runbooks/connectors.md#rollback`.
