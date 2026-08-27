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
OIDC_PORT=$(free_port)
API_PORT=$(free_port)
API2_PORT=$(free_port)
METRICS_PORT=$(free_port)
METRICS2_PORT=$(free_port)
PRODUCT_PORT=$(free_port)
CONSENT_PORT=$(free_port)
CONSENT2_PORT=$(free_port)
PG_NAME="rowboat-rfc012-${$}"
PIDS=()

cleanup() {
  set +e
  for pid in "${PIDS[@]:-}"; do kill "$pid" >/dev/null 2>&1 || true; done
  for pid in "${PIDS[@]:-}"; do wait "$pid" >/dev/null 2>&1 || true; done
  docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
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
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' -keyout "$SCRATCH/fixture-tls.key" -out "$SCRATCH/fixture-tls.crt" >/dev/null 2>&1
export CURL_CA_BUNDLE="$SCRATCH/fixture-tls.crt"

cat > "$SCRATCH/connectors.json" <<JSON
[
  {
    "name":"dev",
    "displayName":"RFC 012 Dev Product",
    "description":"Disposable product MCP used for public RFC 012 acceptance",
    "mcpUrl":"https://localhost:${PRODUCT_PORT}/v1/mcp",
    "authType":"oauth",
    "audience":"dev-product-api",
    "requiredPlan":"intelligence",
    "entitlementUrl":"http://127.0.0.1:${PRODUCT_PORT}/v1/entitlements",
    "status":"enabled",
    "health":"healthy",
    "environments":["development"],
    "scopes":[
      {"name":"dev:records.read","displayName":"Read records","description":"Read disposable product records.","grantTier":"required","risk":"low"},
      {"name":"dev:payments.execute","displayName":"Execute payments","description":"Execute an approved disposable payment.","grantTier":"optional","risk":"money-moving","implies":["dev:records.read"],"stepUpRequired":true,"perInvocationApproval":true,"requiredPlan":"intelligence"}
    ],
    "mcpTools":[
      {"name":"records.read","trustTier":"read"},
      {"name":"payments.execute","trustTier":"money-moving"}
    ]
  }
]
JSON
CONNECTORS_JSON=$(tr -d '\n' < "$SCRATCH/connectors.json")

echo 'JCODE_CHECKPOINT {"message":"Starting disposable PostgreSQL 16"}'
docker run -d --rm --name "$PG_NAME" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rowboat_rfc012 -p "127.0.0.1:${PG_PORT}:5432" postgres:16-alpine >/dev/null
for _ in $(seq 1 90); do docker exec "$PG_NAME" pg_isready -U postgres -d rowboat_rfc012 >/dev/null 2>&1 && break; sleep 1; done
docker exec "$PG_NAME" pg_isready -U postgres -d rowboat_rfc012 >/dev/null
docker exec "$PG_NAME" psql -U postgres -d rowboat_rfc012 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto' >/dev/null
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${PG_PORT}/rowboat_rfc012?sslmode=disable"
DATABASE_URL="$DATABASE_URL" AUTO_MIGRATE=false go run ./cmd/migrate apply >"$SCRATCH/migrate.log" 2>&1

OIDC_URL="https://localhost:${OIDC_PORT}"
API_URL="http://127.0.0.1:${API_PORT}"
API2_URL="http://127.0.0.1:${API2_PORT}"
PRODUCT_URL="http://127.0.0.1:${PRODUCT_PORT}"
CONSENT_URL="http://127.0.0.1:${CONSENT_PORT}"
CONSENT2_URL="http://127.0.0.1:${CONSENT2_PORT}"
BROKER_KEY=$(cat "$SCRATCH/broker.pem")
BROKER_KEYRING=$(python3 - "$SCRATCH/broker.pem" <<'PY'
import json,sys
print(json.dumps({"rfc012-broker-key": open(sys.argv[1]).read()}, separators=(",", ":")))
PY
)

ADDR="127.0.0.1:${OIDC_PORT}" ISSUER="$OIDC_URL" AUDIENCE=rowboat-api HYDRA_CONSENT_URL="$CONSENT_URL" \
  FIXTURE_SUBJECT=user_rfc012_a FIXTURE_EMAIL=a@example.test \
  TLS_CERT_FILE="$SCRATCH/fixture-tls.crt" TLS_KEY_FILE="$SCRATCH/fixture-tls.key" \
  "$SCRATCH/bin/devstack" >"$SCRATCH/devstack.log" 2>&1 & PIDS+=("$!")
wait_http "$OIDC_URL/.well-known/openid-configuration"

start_api() {
  local port=$1 metrics=$2 log=$3
  env \
  ENVIRONMENT=development \
  HTTP_ADDR="127.0.0.1:${port}" METRICS_ADDR="127.0.0.1:${metrics}" GRPC_ADDR= \
  DATABASE_URL="$DATABASE_URL" AUTO_MIGRATE=false \
  SSL_CERT_FILE="$SCRATCH/fixture-tls.crt" \
  DB_ENCRYPTION_KEY='rfc012-local-column-encryption-key' \
  OIDC_ISSUER_URL="$OIDC_URL" TOKEN_ISSUER="$OIDC_URL" TOKEN_AUDIENCE=rowboat-api JWKS_URL="$OIDC_URL/.well-known/jwks.json" \
  ORY_PUBLIC_URL="$OIDC_URL" ORY_BROKER_CLIENT_ID=rowboat-rfc012 ORY_BROKER_CLIENT_SECRET=rfc012-secret \
  PUBLIC_BASE_URL="$API2_URL" APP_URL="$API2_URL" \
  CONNECTORS_JSON="$CONNECTORS_JSON" \
  BROKER_TOKEN_ISSUER="$API_URL" BROKER_TOKEN_PRIVATE_KEY_PEM="$BROKER_KEY" BROKER_TOKEN_KEY_ID=rfc012-broker-key BROKER_TOKEN_TTL=5m \
  BROKER_TOKEN_KEYRING_JSON="$BROKER_KEYRING" \
  HOOK_HMAC_SECRET=rfc012-hook-secret-at-least-32-bytes INTERNAL_API_SECRET=rfc012-internal-secret \
  "$SCRATCH/bin/rowboat-api" >"$log" 2>&1 & PIDS+=("$!")
}
echo 'JCODE_CHECKPOINT {"message":"Starting two real rowboat-api instances with migrated shared PostgreSQL"}'
start_api "$API_PORT" "$METRICS_PORT" "$SCRATCH/api-1.log"
start_api "$API2_PORT" "$METRICS2_PORT" "$SCRATCH/api-2.log"
wait_http "$API_URL/healthz"
wait_http "$API2_URL/healthz"

DATABASE_URL="$DATABASE_URL" PRODUCT_MCP_ADDR="127.0.0.1:${PRODUCT_PORT}" \
  SSL_CERT_FILE="$SCRATCH/fixture-tls.crt" \
  PRODUCT_MCP_AUDIENCE=dev-product-api PRODUCT_MCP_ISSUER="$API_URL" PRODUCT_MCP_JWKS_URL="$API_URL/.well-known/connector-jwks.json" \
  PRODUCT_MCP_FIXTURE_SECRET=rfc012-fixture-secret \
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
  RFC012_TENANT_A_JWT="$TOKEN_A" RFC012_TENANT_B_JWT="$TOKEN_B" RFC012_UNENTITLED_JWT="$TOKEN_U" \
  RFC012_TENANT_A_ORG_ID=org_rfc012_a RFC012_CONNECTOR=dev \
  RFC012_BROKER_PRIVATE_KEY_PEM="$BROKER_KEY" RFC012_BROKER_TOKEN_ISSUER="$API_URL" RFC012_BROKER_TOKEN_KEY_ID=rfc012-broker-key \
  DATABASE_URL="$DATABASE_URL" \
  go test -tags=rfc012acceptance ./integration -run TestRFC012PublicContract -count=1 -v | tee "$SCRATCH/acceptance.log"

echo "RFC012_ACCEPTANCE_ARTIFACTS=$SCRATCH"
trap - EXIT INT TERM
cleanup
