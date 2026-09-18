#!/usr/bin/env bash
# Full-stack local dev: validate env, check rowboat-api health, start hot-reload www.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"

export ROWBOAT_WWW_PORT="${ROWBOAT_WWW_PORT:-18082}"
export ROWBOAT_WWW_API_PROXY_URL="${ROWBOAT_WWW_API_PROXY_URL:-http://localhost:18080}"
export ROWBOAT_WWW_PUBLIC_API_BASE_URL="${ROWBOAT_WWW_PUBLIC_API_BASE_URL:-$ROWBOAT_WWW_API_PROXY_URL}"
export ROWBOAT_WWW_PUBLIC_APP_URL="${ROWBOAT_WWW_PUBLIC_APP_URL:-http://localhost:${ROWBOAT_WWW_PORT}}"
export ROWBOAT_WWW_SESSION_SECRET="${ROWBOAT_WWW_SESSION_SECRET:-dev-only-rowboat-www-session-secret-change-me}"

echo "==> rowboat-www dev stack"
echo "    API:  $ROWBOAT_WWW_API_PROXY_URL"
echo "    WWW:  $ROWBOAT_WWW_PUBLIC_APP_URL"
echo ""
echo "    Start API if missing:"
echo "      cd $ROOT && docker compose -f docker-compose.rowboat-api.yml up -d"
echo "      — or — make api-up"
echo ""

node scripts/validate-dev-env.mjs || true

exec bash scripts/dev-local.sh
