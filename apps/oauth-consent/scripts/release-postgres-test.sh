#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
app_dir="$repo_root/apps/oauth-consent"
container="oauth-consent-release-postgres-${RANDOM}"
host_port=""

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  printf 'oauth-consent release PostgreSQL gate failed: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null || fail "docker is required"
docker info >/dev/null 2>&1 || fail "docker daemon is unavailable"

docker run -d --rm --name "$container" \
  -e POSTGRES_USER=oauth_consent \
  -e POSTGRES_PASSWORD=oauth_consent_test \
  -e POSTGRES_DB=oauth_consent_test \
  -p 127.0.0.1::5432 \
  postgres:16.10-alpine >/dev/null

host_port="$(docker port "$container" 5432/tcp | awk -F: 'NR == 1 { print $NF }')"
[[ "$host_port" =~ ^[0-9]+$ ]] || fail "could not determine PostgreSQL host port"

for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U oauth_consent -d oauth_consent_test >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -U oauth_consent -d oauth_consent_test >/dev/null 2>&1 || \
  fail "PostgreSQL did not become ready"

cd "$app_dir"
npm ci --ignore-scripts
REQUIRE_POSTGRES_STATE_TESTS=true \
TEST_DATABASE_URL="postgres://oauth_consent:oauth_consent_test@127.0.0.1:${host_port}/oauth_consent_test" \
  npm test -- --reporter=verbose
