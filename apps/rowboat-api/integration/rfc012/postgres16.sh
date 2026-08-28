#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
API_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
SCRATCH_ROOT="${JCODE_SCRATCH_DIR:-${TMPDIR:-/tmp}}"
SCRATCH="$SCRATCH_ROOT/rfc012-acceptance-$(date +%s)"
mkdir -p "$SCRATCH/bin"

free_port() {
  python3 - <<'PY'
import socket
s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()
PY
}
PG_PORT=$(free_port)
REDIS_PORT=$(free_port)
OIDC_PORT=$(free_port)
API_PORT=$(free_port)
API2_PORT=$(free_port)
METRICS_PORT=$(free_port)
METRICS2_PORT=$(free_port)
PRODUCT_PORT=$(free_port)
CONSENT_PORT=$(free_port)
CONSENT2_PORT=$(free_port)
PG_NAME="rowboat-rfc012-${$}"
REDIS_NAME="rowboat-rfc012-redis-${$}"
PIDS=()

cleanup() {
  set +e
  for pid in "${PIDS[@]:-}"; do kill "$pid" >/dev/null 2>&1 || true; done
  for pid in "${PIDS[@]:-}"; do wait "$pid" >/dev/null 2>&1 || true; done
  docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
  docker rm -f "$REDIS_NAME" >/dev/null 2>&1 || true
}
show_failure() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "RFC 012 acceptance failed. Logs: $SCRATCH" >&2
    for f in "$SCRATCH"/*.log; do [ -f "$f" ] && { echo "===== $f =====" >&2; tail -n 120 "$f" >&2; }; done
  fi
  cleanup
  exit "$code"
}
trap show_failure EXIT INT TERM

wait_http() {
  local url=$1
  for _ in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

cd "$API_DIR"
echo 'JCODE_CHECKPOINT {"message":"Building real RFC 012 services"}'
go build -o "$SCRATCH/bin/devstack" ./cmd/devstack
go build -o "$SCRATCH/bin/rowboat-api" ./cmd/server
go build -o "$SCRATCH/bin/dev-product-mcp" ./cmd/dev-product-mcp
(cd ../oauth-consent && npm ci --no-audit --no-fund && npm run build) >"$SCRATCH/consent-build.log" 2>&1
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$SCRATCH/broker.pem" >/dev/null 2>&1
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$SCRATCH/broker-next.pem" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' -keyout "$SCRATCH/fixture-tls.key" -out "$SCRATCH/fixture-tls.crt" >/dev/null 2>&1
export CURL_CA_BUNDLE="$SCRATCH/fixture-tls.crt"

cat > "$SCRATCH/connectors.json" <<JSON
[
  {
    "name":"dev",
    "displayName":"RFC 012 Dev Product",
    "description":"Disposable product MCP used for public RFC 012 acceptance",
    "mcpUrl":"https://127.0.0.1:${PRODUCT_PORT}/v1/mcp",
    "authType":"oauth",
    "audience":"dev-product-api",
    "requiredPlan":"intelligence",
    "entitlementUrl":"https://127.0.0.1:${PRODUCT_PORT}/v1/entitlements",
    "status":"enabled",
    "health":"healthy",
    "environments":["development"],
    "scopes":[
      {"name":"dev:records.read","displayName":"Read records","description":"Read disposable product records.","grantTier":"required","risk":"low"},
      {"name":"dev:payments.execute","displayName":"Execute payments","description":"Execute an approved disposable payment.","grantTier":"optional","risk":"money-moving","implies":["dev:records.read"],"stepUpRequired":true,"perInvocationApproval":true,"requiredPlan":"intelligence"}
    ],
    "mcpTools":[
      {"name":"records.read","trustTier":"read","requiredScopes":["dev:records.read"]},
      {"name":"payments.execute","trustTier":"money-moving","requiredScopes":["dev:payments.execute"]}
    ]
  }
]
JSON
CONNECTORS_JSON=$(tr -d '\n' < "$SCRATCH/connectors.json")
ENTITLEMENT_HMAC_KEY=rfc012-product-entitlement-key-at-least-32-bytes
PRODUCT_STATUS_HMAC_KEY=rfc012-product-status-key-at-least-32-bytes
PRODUCT_PRINCIPALS_JSON="[{\"principal\":\"dev-product-service\",\"connectors\":[\"dev\"],\"selector_classes\":[\"connection\",\"user\",\"organization\"],\"hmac_secret\":\"${PRODUCT_STATUS_HMAC_KEY}\"}]"

echo 'JCODE_CHECKPOINT {"message":"Starting disposable PostgreSQL 16"}'
docker run -d --rm --name "$PG_NAME" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rowboat_rfc012 -p "127.0.0.1:${PG_PORT}:5432" postgres:16-alpine >/dev/null
for _ in $(seq 1 90); do docker exec "$PG_NAME" pg_isready -U postgres -d rowboat_rfc012 >/dev/null 2>&1 && break; sleep 1; done
docker exec "$PG_NAME" pg_isready -U postgres -d rowboat_rfc012 >/dev/null
docker exec "$PG_NAME" psql -U postgres -d rowboat_rfc012 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto' >/dev/null
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${PG_PORT}/rowboat_rfc012?sslmode=disable"
DATABASE_URL="$DATABASE_URL" AUTO_MIGRATE=false go run ./cmd/migrate apply >"$SCRATCH/migrate.log" 2>&1
(cd ../oauth-consent && DATABASE_URL="$DATABASE_URL" npm run migrate) >>"$SCRATCH/migrate.log" 2>&1

echo 'JCODE_CHECKPOINT {"message":"Starting shared Redis for cross-replica refresh serialization"}'
docker run -d --rm --name "$REDIS_NAME" -p "127.0.0.1:${REDIS_PORT}:6379" redis:7-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$REDIS_NAME" redis-cli ping 2>/dev/null | grep -q PONG && break; sleep 1; done
docker exec "$REDIS_NAME" redis-cli ping | grep -q PONG
REDIS_URL="redis://127.0.0.1:${REDIS_PORT}/0"

OIDC_URL="http://127.0.0.1:${OIDC_PORT}"
API_URL="http://127.0.0.1:${API_PORT}"
API2_URL="http://127.0.0.1:${API2_PORT}"
PRODUCT_URL="https://127.0.0.1:${PRODUCT_PORT}"
CONSENT_URL="http://127.0.0.1:${CONSENT_PORT}"
CONSENT2_URL="http://127.0.0.1:${CONSENT2_PORT}"
BROKER_KEY=$(cat "$SCRATCH/broker.pem")
BROKER_NEXT_KEY=$(cat "$SCRATCH/broker-next.pem")
BROKER_KEYRING=$(python3 - "$SCRATCH/broker.pem" "$SCRATCH/broker-next.pem" <<'PY'
import json,sys
print(json.dumps({"rfc012-broker-key": open(sys.argv[1]).read(), "rfc012-broker-next": open(sys.argv[2]).read()}, separators=(",", ":")))
PY
)

ADDR="127.0.0.1:${OIDC_PORT}" ISSUER="$OIDC_URL" AUDIENCE=rowboat-api HYDRA_CONSENT_URL="$CONSENT_URL" \
  FIXTURE_SUBJECT=user_rfc012_a FIXTURE_EMAIL=a@example.test \
  "$SCRATCH/bin/devstack" >"$SCRATCH/devstack.log" 2>&1 & PIDS+=("$!")
wait_http "$OIDC_URL/.well-known/openid-configuration"

start_api() {
  local port=$1 metrics=$2 log=$3 signing_key=$4 key_id=$5
  env \
  ENVIRONMENT=development \
  HTTP_ADDR="127.0.0.1:${port}" METRICS_ADDR="127.0.0.1:${metrics}" GRPC_ADDR= \
  DATABASE_URL="$DATABASE_URL" AUTO_MIGRATE=false \
  REDIS_URL="$REDIS_URL" \
  SSL_CERT_FILE="$SCRATCH/fixture-tls.crt" \
  DB_ENCRYPTION_KEY='rfc012-local-column-encryption-key' \
  OIDC_ISSUER_URL="$OIDC_URL" TOKEN_ISSUER="$OIDC_URL" TOKEN_AUDIENCE=rowboat-api JWKS_URL="$OIDC_URL/.well-known/jwks.json" \
  ORY_PUBLIC_URL="$OIDC_URL" ORY_BROKER_CLIENT_ID=rowboat-rfc012 ORY_BROKER_CLIENT_SECRET=rfc012-secret \
  PUBLIC_BASE_URL="$API2_URL" APP_URL="$API2_URL" \
  CONNECTORS_JSON="$CONNECTORS_JSON" \
  CONNECTOR_ENTITLEMENT_URLS_JSON="{\"dev\":\"${PRODUCT_URL}/v1/entitlements\"}" \
  CONNECTOR_ENTITLEMENT_HMAC_KEYS_JSON="{\"dev\":\"${ENTITLEMENT_HMAC_KEY}\"}" \
  BROKER_TOKEN_ISSUER="$API_URL" BROKER_TOKEN_PRIVATE_KEY_PEM="$signing_key" BROKER_TOKEN_KEY_ID="$key_id" BROKER_TOKEN_TTL=5m \
  BROKER_TOKEN_KEYRING_JSON="$BROKER_KEYRING" \
	  HOOK_HMAC_SECRET=rfc012-hook-secret-at-least-32-bytes INTERNAL_API_SECRET=rfc012-internal-secret \
	  CONNECTOR_INVALIDATION_PRINCIPALS_JSON="$PRODUCT_PRINCIPALS_JSON" \
  "$SCRATCH/bin/rowboat-api" >"$log" 2>&1 & PIDS+=("$!")
}
echo 'JCODE_CHECKPOINT {"message":"Starting two real rowboat-api instances with migrated shared PostgreSQL"}'
start_api "$API_PORT" "$METRICS_PORT" "$SCRATCH/api-1.log" "$BROKER_KEY" rfc012-broker-key
start_api "$API2_PORT" "$METRICS2_PORT" "$SCRATCH/api-2.log" "$BROKER_NEXT_KEY" rfc012-broker-next
wait_http "$API_URL/healthz"
wait_http "$API2_URL/healthz"

DATABASE_URL="$DATABASE_URL" PRODUCT_MCP_ADDR="127.0.0.1:${PRODUCT_PORT}" \
  SSL_CERT_FILE="$SCRATCH/fixture-tls.crt" \
  PRODUCT_MCP_AUDIENCE=dev-product-api PRODUCT_MCP_ISSUER="$API_URL" PRODUCT_MCP_JWKS_URL="$API_URL/.well-known/connector-jwks.json" \
  PRODUCT_MCP_FIXTURE_SECRET=rfc012-fixture-secret \
  PRODUCT_MCP_TLS_CERT="$SCRATCH/fixture-tls.crt" PRODUCT_MCP_TLS_KEY="$SCRATCH/fixture-tls.key" \
	  PRODUCT_ENTITLEMENT_HMAC_KEY="$ENTITLEMENT_HMAC_KEY" \
	  PRODUCT_CONNECTION_STATUS_URL="$API_URL/v1/internal/connections/status" \
	  PRODUCT_CONNECTION_STATUS_PRINCIPAL=dev-product-service PRODUCT_CONNECTION_STATUS_HMAC_SECRET="$PRODUCT_STATUS_HMAC_KEY" \
  "$SCRATCH/bin/dev-product-mcp" >"$SCRATCH/product.log" 2>&1 & PIDS+=("$!")
wait_http "$PRODUCT_URL/healthz"

start_consent() {
  local port=$1 log=$2
  env PORT="$port" DATABASE_URL="$DATABASE_URL" COOKIE_SECRET=rfc012-cookie-secret-at-least-32-bytes COOKIE_SECURE=false \
    NODE_EXTRA_CA_CERTS="$SCRATCH/fixture-tls.crt" \
    ORY_ADMIN_URL="$OIDC_URL" WORKOS_CLIENT_ID=rowboat-rfc012 WORKOS_API_KEY=rfc012-workos-secret WORKOS_ISSUER="$OIDC_URL" \
    WORKOS_REDIRECT_URI="$CONSENT_URL/callback" WORKOS_STEP_UP_REDIRECT_URI="$CONSENT2_URL/step-up/callback" \
    ROWBOAT_API_URL="$API2_URL" HOOK_HMAC_SECRET=rfc012-hook-secret-at-least-32-bytes \
    node ../oauth-consent/dist/index.js >"$log" 2>&1 & PIDS+=("$!")
}
echo 'JCODE_CHECKPOINT {"message":"Starting two oauth-consent instances over shared PostgreSQL state"}'
start_consent "$CONSENT_PORT" "$SCRATCH/consent-1.log"
start_consent "$CONSENT2_PORT" "$SCRATCH/consent-2.log"
wait_http "$CONSENT_URL/healthz"
wait_http "$CONSENT2_URL/healthz"

mint() {
  curl -fsS --get "$OIDC_URL/mint" \
    --data-urlencode "workos_user_id=$1" --data-urlencode "workos_org_id=$2" --data-urlencode "email=$3" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])'
}
TOKEN_A=$(mint user_rfc012_a org_rfc012_a a@example.test)
TOKEN_B=$(mint user_rfc012_b org_rfc012_b b@example.test)
TOKEN_U=$(mint user_rfc012_unentitled org_rfc012_unentitled u@example.test)

echo 'JCODE_CHECKPOINT {"message":"Running authenticated public RFC 012 acceptance"}'
env \
  RFC012_API_URL="$API_URL" RFC012_PRODUCT_MCP_URL="$PRODUCT_URL" \
  RFC012_API2_URL="$API2_URL" RFC012_CONSENT_URL="$CONSENT_URL" RFC012_CONSENT2_URL="$CONSENT2_URL" \
	  RFC012_FIXTURE_SECRET=rfc012-fixture-secret RFC012_HOOK_SECRET=rfc012-hook-secret-at-least-32-bytes \
	  RFC012_PRODUCT_SERVICE_PRINCIPAL=dev-product-service RFC012_PRODUCT_SERVICE_HMAC_SECRET="$PRODUCT_STATUS_HMAC_KEY" \
  RFC012_TENANT_A_JWT="$TOKEN_A" RFC012_TENANT_B_JWT="$TOKEN_B" RFC012_UNENTITLED_JWT="$TOKEN_U" \
  RFC012_TENANT_A_ORG_ID=org_rfc012_a RFC012_CONNECTOR=dev \
  RFC012_BROKER_PRIVATE_KEY_PEM="$BROKER_KEY" RFC012_BROKER_TOKEN_ISSUER="$API_URL" RFC012_BROKER_TOKEN_KEY_ID=rfc012-broker-key \
  SSL_CERT_FILE="$SCRATCH/fixture-tls.crt" \
  RFC012_TLS_CA="$SCRATCH/fixture-tls.crt" \
  DATABASE_URL="$DATABASE_URL" \
  go test -tags=rfc012acceptance ./integration -run TestRFC012PublicContract -count=1 -v | tee "$SCRATCH/acceptance.log"

echo "RFC012_ACCEPTANCE_ARTIFACTS=$SCRATCH"
trap - EXIT INT TERM
cleanup
