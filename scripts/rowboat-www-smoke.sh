#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${ROWBOAT_WWW_SMOKE_URL:-https://oppulence.io}}"
BASE_URL="${BASE_URL%/}"
EXPECTED_API_BASE="${ROWBOAT_WWW_EXPECTED_API_BASE_URL:-}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

fetch() {
  local path="$1"
  curl --fail --silent --show-error --retry 3 --retry-delay 2 "${BASE_URL}${path}"
}

assert_contains() {
  local value="$1"
  local needle="$2"
  local label="$3"
  if [[ "$value" != *"$needle"* ]]; then
    echo "${label} did not contain expected text: ${needle}" >&2
    exit 1
  fi
}

need curl

health="$(fetch /healthz)"
if [[ "$health" != "ok" && "$health" != '{"status":"ok"}' ]]; then
  echo "/healthz returned unexpected body: ${health}" >&2
  exit 1
fi

ready="$(fetch /readyz)"
if [[ "$ready" != "ok" && "$ready" != '{"status":"ready"}' && "$ready" != '{"status":"ok"}' ]]; then
  echo "/readyz returned unexpected body: ${ready}" >&2
  exit 1
fi

config="$(fetch /config.js)"
assert_contains "$config" "window.config" "/config.js"
assert_contains "$config" "apiBase" "/config.js"
if [[ -n "$EXPECTED_API_BASE" ]]; then
  assert_contains "$config" "$EXPECTED_API_BASE" "/config.js"
fi

home="$(fetch /)"
assert_contains "$home" "Oppulence" "/"

for route in /ai-help-center /ai-documentation-agent /integrations; do
  page="$(fetch "$route")"
  assert_contains "$page" "Oppulence" "$route"
done

echo "rowboat-www smoke: ok (${BASE_URL})"
