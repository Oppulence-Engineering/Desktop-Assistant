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
KEEP_DESKTOP="${ROWBOAT_DESKTOP_SMOKE_KEEP_DESKTOP:-0}"
DESKTOP_SESSION="${ROWBOAT_DESKTOP_SMOKE_KEEP_SESSION:-rowboat-desktop-smoke}"
PROMPT="${ROWBOAT_DESKTOP_SMOKE_PROMPT:-Please respond with exactly: local rowboat api smoke passed}"

mkdir -p "$ARTIFACT_DIR"
LOG_FILE="${ARTIFACT_DIR}/desktop.log"
SNAPSHOT_FILE="${ARTIFACT_DIR}/snapshot.txt"
SCREENSHOT_FILE="${ARTIFACT_DIR}/desktop.png"
RESULT_SNAPSHOT_FILE="${ARTIFACT_DIR}/desktop-result.txt"
RESULT_SCREENSHOT_FILE="${ARTIFACT_DIR}/desktop-result.png"
API_LOG_FILE="${ARTIFACT_DIR}/rowboat-api.log"
CLOUD_WORKFLOW_FILE="${ARTIFACT_DIR}/cloud-workflow.json"

DESKTOP_PID=""
DESKTOP_SESSION_STARTED=0
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

desktop_session_running() {
  command -v screen >/dev/null 2>&1 || return 1
  screen -ls 2>/dev/null | grep -F ".${DESKTOP_SESSION}" >/dev/null 2>&1
}

cleanup() {
  local status=$?
  if [[ "$KEEP_DESKTOP" == 1 && "$status" == 0 ]]; then
    if [[ "$DESKTOP_SESSION_STARTED" == 1 ]] && desktop_session_running; then
      echo "desktop left running: screen=$DESKTOP_SESSION cdp=http://localhost:${CDP_PORT} workdir=$WORKDIR"
    elif [[ -n "$DESKTOP_PID" ]] && kill -0 "$DESKTOP_PID" >/dev/null 2>&1; then
      echo "desktop left running: pid=$DESKTOP_PID cdp=http://localhost:${CDP_PORT} workdir=$WORKDIR"
    fi
  elif [[ "$DESKTOP_SESSION_STARTED" == 1 ]] && desktop_session_running; then
    screen -S "$DESKTOP_SESSION" -X quit >/dev/null 2>&1 || true
  elif [[ -n "$DESKTOP_PID" ]] && kill -0 "$DESKTOP_PID" >/dev/null 2>&1; then
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
  if [[ "$KEEP_DESKTOP" != 1 || "$status" != 0 ]]; then
    agent-browser close >/dev/null 2>&1 || true
  fi
  if [[ "$CREATED_WORKDIR" == 1 && "$KEEP_WORKDIR" != 1 ]]; then
    if [[ "$KEEP_DESKTOP" != 1 || "$status" != 0 ]]; then
      rm -rf "$WORKDIR"
    fi
  fi
  if [[ "$status" != 0 ]]; then
    echo "desktop smoke failed; artifacts:" >&2
    echo "  log:        $LOG_FILE" >&2
    echo "  snapshot:   $SNAPSHOT_FILE" >&2
    echo "  screenshot: $SCREENSHOT_FILE" >&2
    echo "  result:     $RESULT_SCREENSHOT_FILE" >&2
    echo "  api log:    $API_LOG_FILE" >&2
    echo "  cloud run:  $CLOUD_WORKFLOW_FILE" >&2
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
if [[ "$KEEP_DESKTOP" == 1 ]] && desktop_session_running; then
  echo "screen session ${DESKTOP_SESSION} is already running; stop it or set ROWBOAT_DESKTOP_SMOKE_KEEP_SESSION" >&2
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

rm -f "$LOG_FILE" "$SNAPSHOT_FILE" "$SCREENSHOT_FILE" "$RESULT_SNAPSHOT_FILE" "$RESULT_SCREENSHOT_FILE" "$API_LOG_FILE" "$CLOUD_WORKFLOW_FILE"
SMOKE_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [[ "$KEEP_DESKTOP" == 1 ]]; then
  if command -v screen >/dev/null 2>&1; then
    screen -dmS "$DESKTOP_SESSION" /bin/bash -lc \
      'cd "$1" && exec env API_URL="$2" ROWBOAT_WORKDIR="$3" ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT="$4" npm run dev >"$5" 2>&1' \
      _ "${ROOT_DIR}/apps/x" "http://localhost:${API_PORT}" "$WORKDIR" "$CDP_PORT" "$LOG_FILE"
    DESKTOP_SESSION_STARTED=1
  else
    nohup env \
      API_URL="http://localhost:${API_PORT}" \
      ROWBOAT_WORKDIR="$WORKDIR" \
      ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT="$CDP_PORT" \
      npm --prefix "${ROOT_DIR}/apps/x" run dev \
      >"$LOG_FILE" 2>&1 < /dev/null &
    DESKTOP_PID=$!
  fi
else
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
fi

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

cloud_workflow_result="$(agent-browser eval --stdin <<'EOF'
(async () => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const slugHint = String(Date.now());
  const name = `Cloud workflow smoke ${slugHint}`;
  const create = await window.ipc.invoke('bg-task:create', {
    name,
    instructions: 'Build a short markdown artifact proving this task executed in the Rowboat API Temporal worker.',
    executionTarget: 'api',
  });
  if (!create?.success || !create.slug) {
    throw new Error(`create API background task failed: ${create?.error ?? 'missing slug'}`);
  }

  const runResult = await window.ipc.invoke('bg-task:run', {
    slug: create.slug,
    context: 'desktop smoke requested this cloud workflow through Electron IPC',
  });
  const runId = runResult?.runId ?? runResult?.run?.runId;
  if (!runResult?.success || !runId) {
    throw new Error(`trigger API background task failed: ${runResult?.error ?? 'missing run id'}`);
  }

  let status;
  const polls = [];
  for (let i = 0; i < 120; i += 1) {
    const statusResult = await window.ipc.invoke('bg-task:getCloudRunStatus', { slug: create.slug, runId });
    if (!statusResult?.success || !statusResult.status) {
      throw new Error(`poll API background task failed: ${statusResult?.error ?? 'missing status'}`);
    }
    status = statusResult.status;
    polls.push({
      attempt: i + 1,
      at: new Date().toISOString(),
      status: status.status,
      temporalStatus: status.temporalStatus,
      progressPercent: status.progressPercent,
      progressMessage: status.progressMessage,
    });
    if (['succeeded', 'failed', 'stopped'].includes(status.status)) break;
    await sleep(1000);
  }
  if (!status || status.status !== 'succeeded') {
    throw new Error(`API background task did not succeed: ${status?.status ?? 'missing status'} ${status?.error ?? ''}`);
  }
  if (status.executor !== 'api' || !status.temporalWorkflowId || !status.temporalRunId) {
    throw new Error(`API background task did not expose Temporal metadata: ${JSON.stringify(status)}`);
  }

  const eventsResult = await window.ipc.invoke('bg-task:listCloudRunEvents', { slug: create.slug, runId });
  if (!eventsResult?.success || !eventsResult.events?.length) {
    throw new Error(`API background task events missing: ${eventsResult?.error ?? 'empty events'}`);
  }
  if (!eventsResult.events.some(event => ['temporal.running', 'temporal.progress', 'temporal.completed'].includes(event.type))) {
    throw new Error(`API background task did not expose Temporal lifecycle events: ${JSON.stringify(eventsResult.events)}`);
  }

  const runsResult = await window.ipc.invoke('bg-task:listCloudRuns', { slug: create.slug, executor: 'api', limit: 20 });
  const historyRun = runsResult?.runs?.find(run => run.runId === runId);
  if (!runsResult?.success || !historyRun) {
    throw new Error(`API background task did not appear in cloud run history: ${runsResult?.error ?? 'missing run'}`);
  }
  if (historyRun.status !== 'succeeded') {
    throw new Error(`cloud run history did not show success: ${JSON.stringify(historyRun)}`);
  }

  const pull = await window.ipc.invoke('bg-task:pullCloudArtifact', { slug: create.slug });
  if (!pull?.success) {
    throw new Error(`pull API background task artifact failed: ${pull?.error ?? 'unknown error'}`);
  }
  const artifact = await window.ipc.invoke('workspace:readFile', { path: `bg-tasks/${create.slug}/index.md` });
  if (!artifact?.data?.includes('- Executor: api') || !artifact?.data?.includes('Temporal worker')) {
    throw new Error(`pulled artifact did not look API-generated: ${artifact?.data ?? ''}`);
  }

  return {
    name,
    slug: create.slug,
    runId,
    status: status.status,
    executor: status.executor,
    temporalWorkflowId: status.temporalWorkflowId,
    temporalRunId: status.temporalRunId,
    historyStatus: historyRun.status,
    eventCount: eventsResult.events.length,
    eventTypes: eventsResult.events.map(event => event.type),
    polls,
    artifactPreview: artifact.data.slice(0, 240),
  };
})()
EOF
)"
printf "%s\n" "$cloud_workflow_result" >"$CLOUD_WORKFLOW_FILE"

cloud_task_name="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CLOUD_WORKFLOW_FILE" | head -1)"
cloud_run_id="$(sed -n 's/.*"runId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CLOUD_WORKFLOW_FILE" | head -1)"
if [[ -z "$cloud_task_name" || -z "$cloud_run_id" ]]; then
  echo "could not parse cloud workflow name or run id from $CLOUD_WORKFLOW_FILE" >&2
  exit 1
fi

for _ in $(seq 1 30); do
  if agent-browser snapshot -i -c | grep -Fq "$cloud_task_name"; then
    break
  fi
  sleep 1
done
if ! agent-browser snapshot -i -c | grep -Fq "$cloud_task_name"; then
  echo "desktop UI did not show the completed cloud task: $cloud_task_name" >&2
  agent-browser snapshot >"$RESULT_SNAPSHOT_FILE" || true
  exit 1
fi

agent-browser find role button click --name "$cloud_task_name" >/dev/null
agent-browser wait --text "API worker completed ${cloud_task_name}" >/dev/null
agent-browser wait --text "Executor: api" >/dev/null
agent-browser find role button click --name "Runs history" >/dev/null
agent-browser wait --text "$cloud_run_id" >/dev/null
agent-browser wait --text "succeeded" >/dev/null
agent-browser eval --stdin >/dev/null <<EOF
(() => {
  const needle = "$cloud_run_id";
  const button = [...document.querySelectorAll('button')]
    .find((candidate) => (candidate.innerText || candidate.textContent || '').includes(needle));
  if (!button) throw new Error('cloud run row not found in desktop UI: ' + needle);
  button.click();
  return true;
})()
EOF
agent-browser wait --text "temporal.completed" >/dev/null
agent-browser wait --text "workflow:" >/dev/null
agent-browser snapshot >"$RESULT_SNAPSHOT_FILE"
agent-browser screenshot "$RESULT_SCREENSHOT_FILE" >/dev/null

agent-browser snapshot >"$SNAPSHOT_FILE"
agent-browser screenshot "$SCREENSHOT_FILE" >/dev/null

kubectl logs -n "$NAMESPACE" deployment/rowboat-api -c rowboat-api --since-time="$SMOKE_STARTED_AT" >"$API_LOG_FILE" || true
if ! grep -q 'POST.*/v1/llm/chat/completions' "$API_LOG_FILE"; then
  echo "rowboat-api logs did not show POST /v1/llm/chat/completions" >&2
  exit 1
fi
if ! grep -q 'POST.*/v1/background-tasks.*/trigger' "$API_LOG_FILE"; then
  echo "rowboat-api logs did not show POST /v1/background-tasks/{slug}/trigger" >&2
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
echo "  result screenshot: $RESULT_SCREENSHOT_FILE"
echo "  desktop log: $LOG_FILE"
echo "  api log: $API_LOG_FILE"
echo "  cloud run: $CLOUD_WORKFLOW_FILE"
