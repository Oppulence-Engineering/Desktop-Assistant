#!/usr/bin/env bash
# End-to-end tests for account deletion (DELETE /v1/me) on a local stack,
# without Docker and without real WorkOS or Stripe accounts:
#
#   PostgreSQL   the local server; a fresh database with every migration applied
#   devstack     WorkOS sign-in, tokens, identity delete, and Stripe subscriptions
#   rowboat-api  trusts devstack tokens; calls devstack for Stripe and WorkOS
#   rowboat-www  production build, started by Playwright against rowboat-api
#
# Suites:
#   1. Go:         apps/rowboat-api/integration (tag accountdeletione2e)
#   2. Playwright: apps/rowboat-www/e2e-stack (the real Settings → Account UI)
#
# Usage: scripts/account-deletion-e2e.sh [--skip-browser] [--skip-www-build] [--keep-db]
# Needs: go, node/npm, psql/createdb/dropdb, and a PostgreSQL server on 127.0.0.1:5432.
set -euo pipefail

SKIP_BROWSER=0 SKIP_WWW_BUILD=0 KEEP_DB=0
for arg in "$@"; do
  case "$arg" in
    --skip-browser) SKIP_BROWSER=1 ;;
    --skip-www-build) SKIP_WWW_BUILD=1 ;;
    --keep-db) KEEP_DB=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/apps/rowboat-api"
WWW_DIR="$ROOT/apps/rowboat-www"
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_USER="${PG_USER:-$(whoami)}"
DB_NAME="rowboat_account_deletion_e2e_$(date +%s)"
DATABASE_URL="postgres://${PG_USER}@${PG_HOST}:5432/${DB_NAME}?sslmode=disable"
DEVSTACK_ADDR=127.0.0.1:8090
API_ADDR=127.0.0.1:18080
DEVSTACK_URL="http://${DEVSTACK_ADDR}"
API_URL="http://${API_ADDR}"
FIXTURE_SECRET="account-deletion-e2e-fixture-secret"
BROWSER_SUBJECT="user_web_account_deletion"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/account-deletion-e2e.XXXXXX")"
PIDS=()

log() { printf '\n[account-deletion-e2e] %s\n' "$*"; }

cleanup() {
  local status=$?
  for pid in "${PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  if [[ "$KEEP_DB" == 1 ]]; then
    log "kept database $DB_NAME"
  else
    dropdb -h "$PG_HOST" -U "$PG_USER" --if-exists "$DB_NAME" 2>/dev/null || true
  fi
  if [[ $status -ne 0 ]]; then
    log "FAILED (exit $status). Service logs: $WORK_DIR"
  else
    rm -rf "$WORK_DIR"
  fi
  exit $status
}
trap cleanup EXIT

require_free_port() {
  if lsof -nP -iTCP:"${1##*:}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port ${1##*:} is already in use; stop that process first" >&2
    exit 1
  fi
}

wait_for() {
  local url=$1 name=$2
  for _ in $(seq 1 120); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo "$name did not become ready at $url; last log lines:" >&2
  tail -40 "$WORK_DIR/$name.log" >&2 || true
  exit 1
}

require_free_port "$DEVSTACK_ADDR"
require_free_port "$API_ADDR"

log "database $DB_NAME"
createdb -h "$PG_HOST" -U "$PG_USER" "$DB_NAME"
(cd "$API_DIR" && DATABASE_URL="$DATABASE_URL" go run ./cmd/migrate apply)

log "building devstack and rowboat-api"
(cd "$API_DIR" && go build -o "$WORK_DIR/devstack" ./cmd/devstack && go build -o "$WORK_DIR/rowboat-api" ./cmd/server)

log "starting devstack on $DEVSTACK_URL"
ADDR="$DEVSTACK_ADDR" ISSUER="$DEVSTACK_URL" AUDIENCE=rowboat-api \
  FIXTURE_SUBJECT="$BROWSER_SUBJECT" FIXTURE_EMAIL="account-deletion-e2e@example.test" \
  DEVSTACK_FIXTURE_SECRET="$FIXTURE_SECRET" \
  "$WORK_DIR/devstack" >"$WORK_DIR/devstack.log" 2>&1 &
PIDS+=($!)
wait_for "$DEVSTACK_URL/.well-known/jwks.json" devstack

log "starting rowboat-api on $API_URL"
(
  cd "$API_DIR"
  export ENVIRONMENT=development LOG_LEVEL=info HTTP_ADDR="$API_ADDR" APP_URL="$API_URL" PUBLIC_BASE_URL="$API_URL"
  export DATABASE_URL AUTO_MIGRATE=false DB_ENCRYPTION_KEY="dev-encryption-key-32-bytes-min!!"
  # Tokens: devstack signs them; the API verifies them against its JWKS.
  export OIDC_ISSUER_URL="$DEVSTACK_URL" TOKEN_ISSUER="$DEVSTACK_URL" TOKEN_AUDIENCE=rowboat-api
  export JWKS_URL="$DEVSTACK_URL/.well-known/jwks.json"
  # WorkOS broker (browser sign-in) and identity delete both go to devstack.
  export WORKOS_API_KEY=sk_devstack_account_deletion WORKOS_CLIENT_ID=client_devstack
  export WORKOS_BASE_URL="$DEVSTACK_URL" WORKOS_AUTHORIZE_BASE_URL="$DEVSTACK_URL"
  # Stripe subscriptions go to devstack.
  export STRIPE_SECRET_KEY=sk_test_devstack_account_deletion STRIPE_API_BASE_URL="$DEVSTACK_URL"
  # Placeholders for vendors this suite never calls.
  export OPENROUTER_BASE_URL="$DEVSTACK_URL" OPENROUTER_API_KEY=dev-dummy ELEVENLABS_API_KEY=dev-dummy EXA_API_KEY=dev-dummy
  export GOOGLE_OAUTH_CLIENT_ID=dev-dummy GOOGLE_OAUTH_CLIENT_SECRET=dev-dummy
  export HOOK_HMAC_SECRET=dev-hook-secret INTERNAL_API_SECRET=dev-internal-secret SLACK_SIGNING_SECRET=dev-slack-signing-secret
  export GOOGLE_WEBHOOK_TOKEN=dev-google-webhook-token WEBHOOK_SIGNING_SECRET=dev-webhook-secret
  export CONNECTOR_ALLOW_LOCAL_ENTITLEMENT_DEVELOPMENT=true FREE_TIER_CREDITS=10000
  exec "$WORK_DIR/rowboat-api"
) >"$WORK_DIR/rowboat-api.log" 2>&1 &
PIDS+=($!)
wait_for "$API_URL/healthz" rowboat-api

log "Go end-to-end suite"
(
  cd "$API_DIR"
  DATABASE_URL="$DATABASE_URL" DEVSTACK_FIXTURE_SECRET="$FIXTURE_SECRET" \
    ACCOUNT_DELETION_API_URL="$API_URL" ACCOUNT_DELETION_DEVSTACK_URL="$DEVSTACK_URL" \
    go test -tags accountdeletione2e ./integration/ -run TestAccountDeletion -count=1 -v
)

if [[ "$SKIP_BROWSER" == 1 ]]; then
  log "browser suite skipped"
  exit 0
fi

log "Playwright browser suite"
(
  cd "$WWW_DIR"
  if [[ "$SKIP_WWW_BUILD" != 1 ]]; then npm run build; fi
  npx playwright install chromium
  STACK_API_URL="$API_URL" STACK_DEVSTACK_URL="$DEVSTACK_URL" DEVSTACK_FIXTURE_SECRET="$FIXTURE_SECRET" \
    DATABASE_URL="$DATABASE_URL" STACK_FIXTURE_SUBJECT="$BROWSER_SUBJECT" \
    npx playwright test --config config/e2e/playwright.stack.config.ts
)

log "all account deletion end-to-end suites passed"
