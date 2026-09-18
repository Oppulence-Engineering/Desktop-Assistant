#!/usr/bin/env bash
# Regenerate Orval clients/mocks from rowboat-api OpenAPI and verify the tree is clean.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"
OPENAPI="$ROOT/apps/rowboat-api/api/openapi.json"

echo "==> contracts:generate"
npm run contracts:generate

echo "==> contracts:check"
npm run contracts:check

if command -v git >/dev/null 2>&1; then
  if git diff --quiet -- lib/api/generated 2>/dev/null; then
    echo "==> generated clients match OpenAPI"
  else
    echo "==> OpenAPI drift detected in lib/api/generated (review diff)"
    git diff --stat -- lib/api/generated || true
  fi
fi

echo "==> source: $OPENAPI"
