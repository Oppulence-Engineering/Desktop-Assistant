#!/usr/bin/env bash
# Run rowboat-www in hot-reloading dev mode on the same port the local Docker
# container uses (18082), so edits show up immediately instead of requiring a
# `docker build && docker run` cycle.
#
# The container (rowboat-www-local) serves a prebuilt production image, so it
# never picks up source edits. This script stops it to free the port; restart it
# with `docker start rowboat-www-local` when you want the packaged build back.
#
# Note: this app is npm-managed (package-lock.json). Do not run `pnpm install`
# here — it writes a pnpm-lock.yaml that fails quality/repository-policies.
set -euo pipefail

cd "$(dirname "$0")/.."

docker stop rowboat-www-local >/dev/null 2>&1 || true

if [ ! -d node_modules ]; then
  echo "installing dependencies (npm)…"
  npm install
fi

export ROWBOAT_WWW_PORT="${ROWBOAT_WWW_PORT:-18082}"
export ROWBOAT_WWW_API_PROXY_URL="${ROWBOAT_WWW_API_PROXY_URL:-http://localhost:18080}"
export ROWBOAT_WWW_PUBLIC_API_BASE_URL="${ROWBOAT_WWW_PUBLIC_API_BASE_URL:-http://localhost:18080}"
export ROWBOAT_WWW_SESSION_SECRET="${ROWBOAT_WWW_SESSION_SECRET:-dev-only-rowboat-www-session-secret-change-me}"

echo "rowboat-www dev → http://localhost:${ROWBOAT_WWW_PORT}"
exec npx next dev --port "${ROWBOAT_WWW_PORT}"
