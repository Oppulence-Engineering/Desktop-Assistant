#!/usr/bin/env bash
#
# Self-contained local rowboat-api stack — NO Infisical, NO kind required.
#
# Use this when you want to run/verify the rowboat-api backend (HTTP API +
# Temporal worker) against a real durable execution path without provisioning
# kind or linking Infisical. It is the fast path for AI agents and humans
# verifying API-native background-task behavior end to end.
#
# It brings up, all locally:
#   - Postgres (docker)                       -> :55432
#   - Temporal auto-setup (docker)            -> :57233   (real durable workflows)
#   - devstack  (repo cmd/devstack)           -> :18190   (mocks WorkOS OIDC, mints JWTs)
#   - rowboat-api server (repo cmd/server)    -> :18180   (http) :19190 (metrics)
#   - rowboat-api worker (repo cmd/worker)    -> :19191   (metrics; runs the Temporal worker)
#
# The devstack mints RS256 tokens (aud=rowboat-api) the server validates via its
# published JWKS, so no real WorkOS/Infisical secrets are needed. DB_ENCRYPTION_KEY
# falls back to a dev default; Redis is optional (in-memory rate limiter fallback).
#
# For the production-like path (kind + real secrets) use scripts/rowboat-api-kind.sh
# instead — that one DOES require Infisical (`infisical init` in the repo root, or
# INFISICAL_PROJECT_ID) so the rowboat repo is linked to the correct Infisical project.
#
# Usage:
#   scripts/rowboat-api-local-verify.sh up       # bring the stack up (idempotent)
#   scripts/rowboat-api-local-verify.sh smoke     # mint a token + exercise the API
#   scripts/rowboat-api-local-verify.sh all       # up + smoke (default)
#   scripts/rowboat-api-local-verify.sh down      # tear everything down
#
# Requires: docker (running), go, jq, curl.
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/rowboat-api"
WORK="${RBV_WORK:-/tmp/rbv}"; BIN="$WORK/bin"; LOGS="$WORK/logs"
NET=rbv-net; PG=rbv-pg; TMP=rbv-temporal
PGPORT=55432; TMPPORT=57233; DEVPORT=18190; APIPORT=18180; SRVMET=19190; WRKMET=19191; GRPCPORT=18181

up() {
  mkdir -p "$BIN" "$LOGS"
  echo "### cleanup prior run"
  pkill -f "$BIN/server" 2>/dev/null || true
  pkill -f "$BIN/worker" 2>/dev/null || true
  pkill -f "$BIN/devstack" 2>/dev/null || true
  docker rm -f "$PG" "$TMP" >/dev/null 2>&1 || true
  docker network create "$NET" >/dev/null 2>&1 || true

  echo "### postgres"
  docker run -d --name "$PG" --network "$NET" \
    -e POSTGRES_USER=rowboat -e POSTGRES_PASSWORD=rowboat -e POSTGRES_DB=rowboat \
    -p ${PGPORT}:5432 postgres:16-alpine >/dev/null
  for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U rowboat >/dev/null 2>&1 && break; sleep 2; done

  echo "### temporal (auto-setup, backed by the same postgres)"
  docker run -d --name "$TMP" --network "$NET" \
    -e DB=postgres12 -e DB_PORT=5432 -e POSTGRES_SEEDS="$PG" \
    -e POSTGRES_USER=rowboat -e POSTGRES_PWD=rowboat -e ENABLE_ES=false \
    -p ${TMPPORT}:7233 temporalio/auto-setup:1.27.2 >/dev/null
  # Readiness is confirmed below by /readyz (server probes Temporal) + worker connect.

  echo "### build binaries"
  ( cd "$API_DIR" && go build -o "$BIN/devstack" ./cmd/devstack \
      && go build -o "$BIN/server" ./cmd/server \
      && go build -o "$BIN/worker" ./cmd/worker ) || { echo "BUILD FAILED"; return 1; }

  export DATABASE_URL="postgres://rowboat:rowboat@localhost:${PGPORT}/rowboat?sslmode=disable"
  export APP_URL="http://localhost:${APIPORT}"
  export OIDC_ISSUER_URL="http://localhost:${DEVPORT}" TOKEN_ISSUER="http://localhost:${DEVPORT}"
  export TOKEN_AUDIENCE="rowboat-api" JWKS_URL="http://localhost:${DEVPORT}/.well-known/jwks.json"
  export ORY_PUBLIC_URL="http://localhost:${DEVPORT}" PUBLIC_BASE_URL="http://localhost:${APIPORT}"
  export INFISICAL_ENABLED=false ENVIRONMENT=development LOG_LEVEL=info
  export OPENROUTER_API_KEY="dev-openrouter-key" OPENROUTER_BASE_URL="http://localhost:${DEVPORT}/v1"
  export TEMPORAL_ENABLED=true TEMPORAL_ADDRESS="localhost:${TMPPORT}" \
         TEMPORAL_NAMESPACE=default TEMPORAL_TASK_QUEUE=rowboat-api-background-tasks

  echo "### devstack"
  ADDR=":${DEVPORT}" ISSUER="http://localhost:${DEVPORT}" AUDIENCE="rowboat-api" \
    nohup "$BIN/devstack" >"$LOGS/devstack.log" 2>&1 & sleep 2

  echo "### server (AUTO_MIGRATE=true; /readyz probes Temporal too)"
  HTTP_ADDR=":${APIPORT}" GRPC_ADDR=":${GRPCPORT}" METRICS_ADDR=":${SRVMET}" AUTO_MIGRATE=true \
    nohup "$BIN/server" >"$LOGS/server.log" 2>&1 &
  local ready=0 code=000
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${APIPORT}/readyz" 2>/dev/null)
    [ "$code" = "200" ] && { ready=1; break; }; sleep 2
  done
  echo "server /readyz ready=$ready (last=$code)"

  echo "### worker (AUTO_MIGRATE=false)"
  AUTO_MIGRATE=false METRICS_ADDR=":${WRKMET}" \
    nohup "$BIN/worker" >"$LOGS/worker.log" 2>&1 & sleep 5
  echo "=== STACK UP — API http://localhost:${APIPORT} · devstack http://localhost:${DEVPORT} ==="
}

smoke() {
  local API="http://localhost:${APIPORT}" DEV="http://localhost:${DEVPORT}"
  local TOK; TOK=$(curl -s "$DEV/mint?workos_user_id=user_verify&email=verify%40x.co" | jq -r .token)
  local A=(-H "Authorization: Bearer $TOK") J=(-H "Content-Type: application/json") SLUG=verify-task
  echo "# create api task";   curl -s "${A[@]}" "${J[@]}" -X POST "$API/v1/background-tasks" -d "{\"slug\":\"$SLUG\",\"name\":\"Verify\",\"instructions\":\"Summarize.\",\"executionTarget\":\"api\"}" | jq -c '{slug,executionTarget}'
  echo "# trigger";           local RID; RID=$(curl -s "${A[@]}" "${J[@]}" -X POST "$API/v1/background-tasks/$SLUG/trigger" -d '{"trigger":"manual","context":"verify"}' | tee /dev/stderr | jq -r .runId)
  echo "# poll to terminal";  for _ in $(seq 1 40); do S=$(curl -s "${A[@]}" "$API/v1/background-tasks/$SLUG/runs/$RID/status" | jq -r .status); case "$S" in succeeded|failed|stopped) break;; esac; sleep 1; done; echo "status=$S"
  echo "# events";            curl -s "${A[@]}" "$API/v1/background-tasks/$SLUG/runs/$RID/events" | jq -c '[.events[].type]'
  echo "# artifact provenance"; curl -s "${A[@]}" "$API/v1/background-tasks/$SLUG/artifact" | jq -c '{revision,updatedByRunId,contentType}'
  echo "# filters trigger=retry / status=succeeded"; curl -s "${A[@]}" "$API/v1/background-task-runs?status=succeeded" | jq -c '{n:(.runs|length)}'
  echo "# server cloud_run metrics"; curl -s "http://localhost:${SRVMET}/metrics" | grep -E "^cloud_runs?_(triggered|completed|stopped|retry)" | sort
  echo "# worker cloud_run metrics"; curl -s "http://localhost:${WRKMET}/metrics" | grep -E "^cloud_run_(duration|queue_latency)_seconds_count|^cloud_runs_completed_total" | sort
}

down() {
  pkill -f "$BIN/server" 2>/dev/null || true
  pkill -f "$BIN/worker" 2>/dev/null || true
  pkill -f "$BIN/devstack" 2>/dev/null || true
  docker rm -f "$PG" "$TMP" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  echo "stack down"
}

case "${1:-all}" in
  up) up ;;
  smoke) smoke ;;
  down) down ;;
  all|"") up && smoke ;;
  *) echo "usage: $0 {up|smoke|all|down}"; exit 2 ;;
esac
