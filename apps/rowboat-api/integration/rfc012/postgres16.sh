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
METRICS_PORT=$(free_port)
PRODUCT_PORT=$(free_port)
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
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$SCRATCH/broker.pem" >/dev/null 2>&1

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

OIDC_URL="http://127.0.0.1:${OIDC_PORT}"
API_URL="http://127.0.0.1:${API_PORT}"
PRODUCT_URL="http://127.0.0.1:${PRODUCT_PORT}"
BROKER_KEY=$(cat "$SCRATCH/broker.pem")

ADDR="127.0.0.1:${OIDC_PORT}" ISSUER="$OIDC_URL" AUDIENCE=rowboat-api \
  "$SCRATCH/bin/devstack" >"$SCRATCH/devstack.log" 2>&1 & PIDS+=("$!")
wait_http "$OIDC_URL/.well-known/openid-configuration"

echo 'JCODE_CHECKPOINT {"message":"Starting real rowboat-api with migrated PostgreSQL"}'
env \
  ENVIRONMENT=development \
  HTTP_ADDR="127.0.0.1:${API_PORT}" METRICS_ADDR="127.0.0.1:${METRICS_PORT}" GRPC_ADDR= \
  DATABASE_URL="$DATABASE_URL" AUTO_MIGRATE=false \
  DB_ENCRYPTION_KEY='rfc012-local-column-encryption-key' \
  OIDC_ISSUER_URL="$OIDC_URL" TOKEN_ISSUER="$OIDC_URL" TOKEN_AUDIENCE=rowboat-api JWKS_URL="$OIDC_URL/.well-known/jwks.json" \
  ORY_PUBLIC_URL="$OIDC_URL" ORY_BROKER_CLIENT_ID=rowboat-rfc012 ORY_BROKER_CLIENT_SECRET=rfc012-secret \
  PUBLIC_BASE_URL="$API_URL" APP_URL="$API_URL" \
  CONNECTORS_JSON="$CONNECTORS_JSON" \
  BROKER_TOKEN_ISSUER="$API_URL" BROKER_TOKEN_PRIVATE_KEY_PEM="$BROKER_KEY" BROKER_TOKEN_KEY_ID=rfc012-broker-key BROKER_TOKEN_TTL=5m \
  HOOK_HMAC_SECRET=rfc012-hook-secret INTERNAL_API_SECRET=rfc012-internal-secret \
  "$SCRATCH/bin/rowboat-api" >"$SCRATCH/api.log" 2>&1 & PIDS+=("$!")
wait_http "$API_URL/healthz"

DATABASE_URL="$DATABASE_URL" PRODUCT_MCP_ADDR="127.0.0.1:${PRODUCT_PORT}" \
  PRODUCT_MCP_AUDIENCE=dev-product-api PRODUCT_MCP_ISSUER="$API_URL" PRODUCT_MCP_JWKS_URL="$API_URL/.well-known/connector-jwks.json" \
  "$SCRATCH/bin/dev-product-mcp" >"$SCRATCH/product.log" 2>&1 & PIDS+=("$!")
wait_http "$PRODUCT_URL/healthz"

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
  RFC012_TENANT_A_JWT="$TOKEN_A" RFC012_TENANT_B_JWT="$TOKEN_B" RFC012_UNENTITLED_JWT="$TOKEN_U" \
  RFC012_TENANT_A_ORG_ID=org_rfc012_a RFC012_CONNECTOR=dev \
  RFC012_BROKER_PRIVATE_KEY_PEM="$BROKER_KEY" RFC012_BROKER_TOKEN_ISSUER="$API_URL" RFC012_BROKER_TOKEN_KEY_ID=rfc012-broker-key \
  DATABASE_URL="$DATABASE_URL" \
  go test -tags=rfc012acceptance ./integration -run TestRFC012PublicContract -count=1 -v | tee "$SCRATCH/acceptance.log"

echo "RFC012_ACCEPTANCE_ARTIFACTS=$SCRATCH"
trap - EXIT INT TERM
cleanup
