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
database_url="postgres://oauth_consent:oauth_consent_test@127.0.0.1:${host_port}/oauth_consent_test"
npm run build
DATABASE_URL="$database_url" npm run migrate
DATABASE_URL="$database_url" node --input-type=module <<'NODE'
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name='oauth_consent_sessions' AND column_name='hydra_requested_audience'
       ) AS has_binding,
       EXISTS (
         SELECT 1 FROM oauth_consent_schema_migrations
         WHERE name='20260828035100_authoritative_consent_outcomes.sql'
       ) AS migration_recorded`,
  );
  if (!result.rows[0]?.has_binding || !result.rows[0]?.migration_recorded) {
    throw new Error('authoritative consent outcome migration was not applied by npm run migrate');
  }
} finally {
  await pool.end();
}
NODE
REQUIRE_POSTGRES_STATE_TESTS=true \
TEST_DATABASE_URL="$database_url" \
  npm test -- --reporter=verbose
