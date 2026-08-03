#!/usr/bin/env bash

# Authenticated release smoke for the API-native workflow control plane.
# It proves more than liveness: a temporary task is created, synchronized to
# Temporal, executed by the cloud worker, inspected through run history, and
# deleted again. The caller supplies a real design-partner token so production
# releases cannot pass using an unauthenticated health endpoint alone.

set -euo pipefail

base_url="${1:-}"
token="${2:-}"
timeout_seconds="${ROWBOAT_SMOKE_TIMEOUT_SECONDS:-300}"

if [[ -z "$base_url" || -z "$token" ]]; then
  echo "usage: $0 <api-base-url> <bearer-token>" >&2
  exit 2
fi

for command in curl jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required" >&2
    exit 2
  fi
done

base_url="${base_url%/}"
slug="release-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$(date +%s)"
task_revision=""

api() {
  curl --fail-with-body --silent --show-error \
    --connect-timeout 10 \
    --max-time 30 \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    "$@"
}

cleanup() {
  if [[ -n "$task_revision" ]]; then
    api -X DELETE "${base_url}/v1/background-tasks/${slug}?revision=${task_revision}" >/dev/null 2>&1 || \
      echo "warning: could not remove smoke task ${slug}" >&2
  fi
}
trap cleanup EXIT

echo "creating authenticated cloud workflow smoke task ${slug}"
task_json="$(api -X POST \
  --data "{\"slug\":\"${slug}\",\"name\":\"Release workflow smoke\",\"instructions\":\"Write a concise release-smoke artifact confirming that the API worker executed this task. Do not call external connectors.\",\"executionTarget\":\"api\"}" \
  "${base_url}/v1/background-tasks")"
task_revision="$(jq -er '.revision' <<<"$task_json")"

run_json="$(api -X POST \
  --data '{"trigger":"manual","context":"Deployment candidate authenticated smoke."}' \
  "${base_url}/v1/background-tasks/${slug}/trigger")"
run_id="$(jq -er '.runId' <<<"$run_json")"
echo "queued ${run_id}; waiting for the Temporal worker"

deadline=$((SECONDS + timeout_seconds))
status=""
status_json=""
while (( SECONDS < deadline )); do
  status_json="$(api "${base_url}/v1/background-tasks/${slug}/runs/${run_id}/status")"
  status="$(jq -er '.status' <<<"$status_json")"
  case "$status" in
    succeeded)
      break
      ;;
    failed|cancelled|stopped)
      echo "cloud workflow smoke reached terminal status ${status}: ${status_json}" >&2
      exit 1
      ;;
  esac
  sleep 3
done

if [[ "$status" != "succeeded" ]]; then
  echo "cloud workflow smoke timed out after ${timeout_seconds}s: ${status_json}" >&2
  exit 1
fi

runs_json="$(api "${base_url}/v1/background-tasks/${slug}/runs?limit=10")"
if ! jq -e --arg run_id "$run_id" '.runs[] | select(.runId == $run_id and .executor == "api" and .status == "succeeded")' <<<"$runs_json" >/dev/null; then
  echo "completed run is missing from user-visible Cloud Runs history" >&2
  exit 1
fi

events_json="$(api "${base_url}/v1/background-tasks/${slug}/runs/${run_id}/events")"
if ! jq -e '.events | length > 0' <<<"$events_json" >/dev/null; then
  echo "completed run has no user-visible transcript events" >&2
  exit 1
fi

echo "authenticated API task ${run_id} succeeded and is visible in Cloud Runs"
