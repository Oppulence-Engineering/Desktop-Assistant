#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAMESPACE="${ROWBOAT_API_NAMESPACE:-rowboat-api}"
API_PORT="${ROWBOAT_API_PORT:-18080}"
DEVSTACK_PORT="${ROWBOAT_DEVSTACK_PORT:-18090}"
CDP_PORT="${ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT:-9222}"
VITE_PORT="${ROWBOAT_DESKTOP_VITE_PORT:-5173}"
ARTIFACT_DIR="${ROWBOAT_DESKTOP_SMOKE_ARTIFACT_DIR:-${ROOT_DIR}/.rowboat-kind/desktop-smoke}"
WORKDIR="${ROWBOAT_DESKTOP_SMOKE_WORKDIR:-}"
KEEP_WORKDIR="${ROWBOAT_DESKTOP_SMOKE_KEEP_WORKDIR:-0}"
PROMPT="${ROWBOAT_DESKTOP_SMOKE_PROMPT:-Please respond with exactly: local rowboat api smoke passed}"

mkdir -p "$ARTIFACT_DIR"
LOG_FILE="${ARTIFACT_DIR}/desktop.log"
SNAPSHOT_FILE="${ARTIFACT_DIR}/snapshot.txt"
SCREENSHOT_FILE="${ARTIFACT_DIR}/desktop.png"
API_LOG_FILE="${ARTIFACT_DIR}/rowboat-api.log"

DESKTOP_PID=""
CREATED_WORKDIR=0

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

wait_for_port() {
  local port="$1"
  local name="$2"
  for _ in $(seq 1 90); do
    if port_in_use "$port"; then
      return 0
    fi
    sleep 1
  done
  echo "timed out waiting for ${name} on localhost:${port}" >&2
  return 1
}

cleanup() {
  local status=$?
  if [[ -n "$DESKTOP_PID" ]] && kill -0 "$DESKTOP_PID" >/dev/null 2>&1; then
    kill -TERM "$DESKTOP_PID" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if ! kill -0 "$DESKTOP_PID" >/dev/null 2>&1; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$DESKTOP_PID" >/dev/null 2>&1; then
      pkill -KILL -P "$DESKTOP_PID" >/dev/null 2>&1 || true
      kill -KILL "$DESKTOP_PID" >/dev/null 2>&1 || true
    fi
    wait "$DESKTOP_PID" 2>/dev/null || true
    DESKTOP_PID=""
  fi
  agent-browser close >/dev/null 2>&1 || true
  if [[ "$CREATED_WORKDIR" == 1 && "$KEEP_WORKDIR" != 1 ]]; then
    rm -rf "$WORKDIR"
  fi
  if [[ "$status" != 0 ]]; then
    echo "desktop smoke failed; artifacts:" >&2
    echo "  log:        $LOG_FILE" >&2
    echo "  snapshot:   $SNAPSHOT_FILE" >&2
    echo "  screenshot: $SCREENSHOT_FILE" >&2
    echo "  api log:    $API_LOG_FILE" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

need curl
need npm
need agent-browser
need kubectl

if port_in_use "$VITE_PORT"; then
  echo "localhost:${VITE_PORT} is already in use; stop the existing Vite server before desktop smoke" >&2
  exit 1
fi
if port_in_use "$CDP_PORT"; then
  echo "localhost:${CDP_PORT} is already in use; stop the existing Electron CDP process or set ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT" >&2
  exit 1
fi

curl --fail --silent --show-error "http://localhost:${API_PORT}/healthz" >/dev/null
curl --fail --silent --show-error "http://localhost:${DEVSTACK_PORT}/.well-known/jwks.json" >/dev/null

if [[ -z "$WORKDIR" ]]; then
  WORKDIR="$(mktemp -d -t rowboat-desktop-smoke.XXXXXX)"
  CREATED_WORKDIR=1
fi
mkdir -p "$WORKDIR/config"

token="$(
  curl --fail --silent --show-error \
    "http://localhost:${DEVSTACK_PORT}/mint?workos_user_id=user_desktop_smoke&email=desktop-smoke%40solomon-ai.co" |
    sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
)"
if [[ -z "$token" ]]; then
  echo "could not mint devstack token for desktop smoke" >&2
  exit 1
fi

expires_at="$(($(date +%s) + 3300))"
printf '%s\n' \
  '{' \
  '  "version": 2,' \
  '  "providers": {' \
  '    "rowboat": {' \
  '      "mode": "rowboat",' \
  '      "tokens": {' \
  "        \"access_token\": \"${token}\"," \
  '        "refresh_token": null,' \
  "        \"expires_at\": ${expires_at}," \
  '        "token_type": "Bearer"' \
  '      }' \
  '    }' \
  '  }' \
  '}' >"${WORKDIR}/config/oauth.json"

printf '%s\n' \
  '{' \
  '  "strictness": "medium",' \
  '  "configured": false,' \
  '  "onboardingComplete": false' \
  '}' >"${WORKDIR}/config/note_creation.json"

rm -f "$LOG_FILE" "$SNAPSHOT_FILE" "$SCREENSHOT_FILE" "$API_LOG_FILE"
SMOKE_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

(
  cd "${ROOT_DIR}/apps/x"
  API_URL="http://localhost:${API_PORT}" \
    ROWBOAT_WORKDIR="$WORKDIR" \
    ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT="$CDP_PORT" \
    npm run dev &
  dev_pid=$!
  trap 'pkill -TERM -P "$dev_pid" >/dev/null 2>&1 || true; kill -TERM "$dev_pid" >/dev/null 2>&1 || true; wait "$dev_pid" 2>/dev/null || true; exit 0' TERM INT
  wait "$dev_pid"
) >"$LOG_FILE" 2>&1 &
DESKTOP_PID=$!

wait_for_port "$CDP_PORT" "Electron CDP"
agent-browser connect "$CDP_PORT" >/dev/null
agent-browser wait --text "Welcome to Rowboat" >/dev/null

if agent-browser snapshot -i -c | grep -q "Welcome to Rowboat"; then
  agent-browser find role button click --name "Continue" >/dev/null
  agent-browser wait --text "Connect Your Accounts" >/dev/null
  agent-browser find role button click --name "Skip for now" >/dev/null
  agent-browser wait --text "You're All Set!" >/dev/null
  agent-browser find role button click --name "Start Using Rowboat" >/dev/null
fi

agent-browser wait --text "Free Plan" >/dev/null
model_snapshot="$(agent-browser snapshot -i -c)"
if ! grep -Eq 'claude-haiku-4-5|claude-opus-4-1|claude-sonnet-4-5|gemini-2\.5-flash|gemini-2\.5-pro|gpt-4\.1|gpt-4\.1-mini|o4-mini' <<<"$model_snapshot"; then
  echo "desktop UI did not show a rowboat-api gateway model" >&2
  printf "%s\n" "$model_snapshot" >"$SNAPSHOT_FILE"
  exit 1
fi

agent-browser fill 'textarea[name="message"]' "$PROMPT" >/dev/null
agent-browser press Enter >/dev/null
agent-browser wait --text "Hello from the mock LLM." >/dev/null

agent-browser snapshot >"$SNAPSHOT_FILE"
agent-browser screenshot "$SCREENSHOT_FILE" >/dev/null

kubectl logs -n "$NAMESPACE" deployment/rowboat-api -c rowboat-api --since-time="$SMOKE_STARTED_AT" >"$API_LOG_FILE" || true
if ! grep -q 'POST.*/v1/llm/chat/completions' "$API_LOG_FILE"; then
  echo "rowboat-api logs did not show POST /v1/llm/chat/completions" >&2
  exit 1
fi
if ! grep -q '"status":200' "$API_LOG_FILE"; then
  echo "rowboat-api logs did not show a successful status in recent API traffic" >&2
  exit 1
fi
if grep -q 'unknown stream event' "$LOG_FILE"; then
  echo "desktop log contains unknown stream event warnings" >&2
  exit 1
fi

echo "desktop smoke: ok"
echo "  screenshot: $SCREENSHOT_FILE"
echo "  desktop log: $LOG_FILE"
echo "  api log: $API_LOG_FILE"
