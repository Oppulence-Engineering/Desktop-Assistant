#!/bin/sh
set -eu

name="rowboat-rfc012-pg-$$"
port="${RFC012_POSTGRES_PORT:-55432}"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rowboat_rfc012 -p "127.0.0.1:${port}:5432" postgres:16-alpine >/dev/null
i=0
until docker exec "$name" pg_isready -U postgres -d rowboat_rfc012 >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -lt 60 ] || { echo "PostgreSQL did not become ready" >&2; exit 1; }; sleep 1
done
docker exec "$name" psql -U postgres -d rowboat_rfc012 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto' >/dev/null
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${port}/rowboat_rfc012?sslmode=disable"
echo "PostgreSQL 16 ready at $DATABASE_URL"
echo "Start cmd/devstack, rowboat-api, and cmd/dev-product-mcp with this DATABASE_URL, export the RFC012_* fixtures, then run:"
echo "go test -tags=rfc012acceptance ./integration -run TestRFC012PublicContract -v"
echo "Press Ctrl-C when finished."
while :; do sleep 3600; done
