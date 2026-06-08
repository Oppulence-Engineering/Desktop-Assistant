#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER_NAME="${KIND_CLUSTER_NAME:-rowboat-api}"
NAMESPACE="${ROWBOAT_API_NAMESPACE:-rowboat-api}"
RELEASE_NAME="${ROWBOAT_API_RELEASE:-rowboat-api}"
IMAGE="${ROWBOAT_API_IMAGE:-rowboat-api:kind}"
API_PORT="${ROWBOAT_API_PORT:-18080}"
DEVSTACK_PORT="${ROWBOAT_DEVSTACK_PORT:-18090}"
STATE_DIR="${ROWBOAT_KIND_STATE_DIR:-${ROOT_DIR}/.rowboat-kind}"
DEPS_FILE="${ROOT_DIR}/deploy/kind/rowboat-api/dependencies.yaml"
KIND_CONFIG_FILE="${ROOT_DIR}/deploy/kind/rowboat-api/kind-config.yaml"
VALUES_FILE="${ROOT_DIR}/charts/rowboat-api/values-kind.yaml"
CHART_DIR="${ROOT_DIR}/charts/rowboat-api"
INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-}"
INFISICAL_TOKEN="${INFISICAL_TOKEN:-}"
INFISICAL_ENVIRONMENT="${INFISICAL_ENVIRONMENT:-dev}"
INFISICAL_SECRET_PATH="${INFISICAL_SECRET_PATH:-/}"
INFISICAL_RECURSIVE="${INFISICAL_RECURSIVE:-false}"
INFISICAL_SYNC_SECRET="${INFISICAL_SYNC_SECRET:-rowboat-api-secrets}"
REQUIRED_KIND_SECRET_KEYS=(
  DATABASE_URL
  REDIS_URL
  DB_ENCRYPTION_KEY
  WORKOS_CLIENT_ID
  WORKOS_API_KEY
  OPENAI_API_KEY
  OPENROUTER_API_KEY
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
  HOOK_HMAC_SECRET
  INTERNAL_API_SECRET
)

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  up              Create/update kind, build/load the image, deploy deps + chart, smoke test.
  deploy          Apply deps and helm upgrade using the already-loaded image.
  port-forward    Foreground fallback port-forwards for API and devstack.
  helm-validate   Run Helm lint/template checks for kind/stage/prod values.
  infisical-validate
                  Validate Infisical CLI-created kind secret and required keys.
  validate        Run API, auth, and LLM smoke checks through host port-forwards.
  validate-full   Run Helm, Kubernetes, API, and desktop smoke checks.
  desktop         Run the Electron desktop against the kind API.
  desktop-smoke   Drive the Electron desktop against the kind API with agent-browser.
  desktop-perf    Package, drive, profile, and tiered budget-check the Electron desktop.
  status          Show local Kubernetes resources and port-forward state.
  logs            Tail rowboat-api deployment logs.
  down            Uninstall the chart, delete local deps, and stop port-forwards.
  delete-cluster  Delete the kind cluster.

Environment overrides:
  KIND_CLUSTER_NAME       default: rowboat-api
  ROWBOAT_API_NAMESPACE   default: rowboat-api
  ROWBOAT_API_RELEASE     default: rowboat-api
  ROWBOAT_API_IMAGE       default: rowboat-api:kind
  ROWBOAT_API_PORT        default: 18080
  ROWBOAT_DEVSTACK_PORT   default: 18090
  INFISICAL_PROJECT_ID                    required unless .infisical.json exists
  INFISICAL_TOKEN                         optional service/machine token for CI
  INFISICAL_ENVIRONMENT                   default: dev
  INFISICAL_SECRET_PATH                   default: /
  INFISICAL_RECURSIVE                     default: false
EOF
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

ensure_tools() {
  need kind
  need kubectl
  need helm
  need docker
  need curl
  if ! docker info >/dev/null 2>&1; then
    echo "docker is installed, but the daemon is not reachable" >&2
    exit 1
  fi
}

ensure_cluster() {
  ensure_tools
  if ! kind get clusters | grep -Fxq "$CLUSTER_NAME"; then
    kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CONFIG_FILE"
  fi
  kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null
}

image_repository() {
  echo "${IMAGE%:*}"
}

image_tag() {
  if [[ "$IMAGE" == *:* ]]; then
    echo "${IMAGE##*:}"
  else
    echo latest
  fi
}

build_and_load_image() {
  ensure_cluster
  docker build -f "${ROOT_DIR}/apps/rowboat-api/Dockerfile" -t "$IMAGE" "$ROOT_DIR"
  kind load docker-image --name "$CLUSTER_NAME" "$IMAGE"
}

ensure_namespace() {
  kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE"
}

has_infisical_project_config() {
  [[ -f "${ROOT_DIR}/.infisical.json" || -f "${ROOT_DIR}/infisical.json" ]]
}

require_infisical_project() {
  need infisical
  if [[ -z "$INFISICAL_PROJECT_ID" ]] && ! has_infisical_project_config; then
    echo "missing INFISICAL_PROJECT_ID and no .infisical.json found in ${ROOT_DIR}" >&2
    echo "set INFISICAL_PROJECT_ID or run infisical init in the repo root" >&2
    exit 1
  fi
}

sync_infisical_cli_secret() {
  require_infisical_project
  ensure_cluster
  ensure_namespace

  local env_file
  env_file="$(mktemp)"
  chmod 600 "$env_file"
  local secret_manifest
  secret_manifest="$(mktemp)"
  chmod 600 "$secret_manifest"
  trap 'rm -f "$env_file" "$secret_manifest"' RETURN

  local export_args=(
    secrets
    --silent
    --output=dotenv
    --env="$INFISICAL_ENVIRONMENT"
    --path="$INFISICAL_SECRET_PATH"
  )
  if [[ -n "$INFISICAL_PROJECT_ID" ]]; then
    export_args+=(--projectId="$INFISICAL_PROJECT_ID")
  fi
  if [[ -n "$INFISICAL_TOKEN" ]]; then
    export_args+=(--token="$INFISICAL_TOKEN")
  fi
  if [[ "$INFISICAL_RECURSIVE" == "true" ]]; then
    export_args+=(--recursive)
  fi

  INFISICAL_DISABLE_UPDATE_CHECK=true infisical "${export_args[@]}" >"$env_file"
  validate_infisical_env_file "$env_file"

  kubectl create secret generic "$INFISICAL_SYNC_SECRET" \
    -n "$NAMESPACE" \
    --from-env-file="$env_file" \
    --dry-run=client \
    -o yaml >"$secret_manifest"
  if kubectl get secret -n "$NAMESPACE" "$INFISICAL_SYNC_SECRET" >/dev/null 2>&1; then
    kubectl replace -f "$secret_manifest" >/dev/null
  else
    kubectl create -f "$secret_manifest" >/dev/null
  fi
  validate_infisical_secret_keys
  rm -f "$env_file" "$secret_manifest"
  trap - RETURN
}

validate_infisical_env_file() {
  local env_file="$1"
  local missing=()
  for key in "${REQUIRED_KIND_SECRET_KEYS[@]}"; do
    if ! grep -Eq "^${key}=" "$env_file"; then
      missing+=("$key")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    echo "Infisical secrets output is missing required key(s): ${missing[*]}" >&2
    exit 1
  fi
}

validate_infisical_secret_keys() {
  local missing=()
  for key in "${REQUIRED_KIND_SECRET_KEYS[@]}"; do
    if [[ -z "$(kubectl get secret -n "$NAMESPACE" "$INFISICAL_SYNC_SECRET" -o "jsonpath={.data.${key}}" 2>/dev/null)" ]]; then
      missing+=("$key")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    echo "secret/${INFISICAL_SYNC_SECRET} is missing required key(s): ${missing[*]}" >&2
    exit 1
  fi
}

deploy_dependencies() {
  ensure_cluster
  ensure_namespace
  kubectl apply -n "$NAMESPACE" -f "$DEPS_FILE"
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-postgres --timeout=180s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-redis --timeout=180s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-temporal --timeout=240s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-devstack --timeout=180s
}

deploy_chart() {
  ensure_cluster
  ensure_namespace
  sync_infisical_cli_secret
  helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
    --namespace "$NAMESPACE" \
    --values "$VALUES_FILE" \
    --set "image.repository=$(image_repository)" \
    --set "image.tag=$(image_tag)" \
    --wait \
    --timeout 5m
  # Helm may prune a previously chart-managed Secret during the migration to
  # existingSecret, so re-sync after upgrade before restarting pods.
  sync_infisical_cli_secret
  kubectl rollout restart -n "$NAMESPACE" deployment/rowboat-api
  if kubectl get deployment -n "$NAMESPACE" rowboat-api-worker >/dev/null 2>&1; then
    kubectl rollout restart -n "$NAMESPACE" deployment/rowboat-api-worker
  fi
  if kubectl get deployment -n "$NAMESPACE" rowboat-api-scheduler >/dev/null 2>&1; then
    kubectl rollout restart -n "$NAMESPACE" deployment/rowboat-api-scheduler
  fi
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api --timeout=180s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-worker --timeout=180s
  if kubectl get deployment -n "$NAMESPACE" rowboat-api-scheduler >/dev/null 2>&1; then
    kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-scheduler --timeout=180s
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

stop_port_forwards() {
  mkdir -p "$STATE_DIR"
  for name in api devstack; do
    local pid_file="${STATE_DIR}/${name}.pid"
    if [[ -f "$pid_file" ]]; then
      local pid
      pid="$(cat "$pid_file")"
      if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1; then
        pkill -TERM -P "$pid" >/dev/null 2>&1 || true
        kill "$pid" >/dev/null 2>&1 || true
      fi
      rm -f "$pid_file"
    fi
  done
}

start_port_forward() {
  local name="$1"
  local resource="$2"
  local local_port="$3"
  local remote_port="$4"
  local pid_file="${STATE_DIR}/${name}.pid"
  local log_file="${STATE_DIR}/${name}.log"

  mkdir -p "$STATE_DIR"
  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file")"
    if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "${name} port-forward already running on localhost:${local_port} (pid ${existing_pid})"
      return
    fi
    rm -f "$pid_file"
  fi

  if port_in_use "$local_port"; then
    echo "localhost:${local_port} is already in use; stop that process or override the port" >&2
    exit 1
  fi

  nohup sh -c '
    namespace="$1"
    resource="$2"
    local_port="$3"
    remote_port="$4"
    trap "exit 0" INT TERM
    while :; do
      tail -f /dev/null | kubectl -n "$namespace" port-forward "$resource" "${local_port}:${remote_port}"
      sleep 1
    done
  ' rowboat-port-forward "$NAMESPACE" "$resource" "$local_port" "$remote_port" >"$log_file" 2>&1 &
  echo "$!" >"$pid_file"
  sleep 2
  if ! kill -0 "$(cat "$pid_file")" >/dev/null 2>&1; then
    echo "failed to start ${name} port-forward; see ${log_file}" >&2
    exit 1
  fi
  echo "${name} port-forward: localhost:${local_port} -> ${resource}:${remote_port}"
}

start_port_forwards() {
  ensure_cluster
  kubectl -n "$NAMESPACE" port-forward svc/rowboat-api "${API_PORT}:80" &
  local api_pid=$!
  kubectl -n "$NAMESPACE" port-forward svc/rowboat-api-devstack "${DEVSTACK_PORT}:8090" &
  local devstack_pid=$!
  trap 'kill "$api_pid" "$devstack_pid" >/dev/null 2>&1 || true' INT TERM EXIT
  wait
}

json_token() {
  sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

curl_smoke() {
  local err_file
  err_file="$(mktemp)"
  local output
  if output="$(curl --fail --silent --show-error --retry 10 --retry-delay 1 --retry-all-errors "$@" 2>"$err_file")"; then
    rm -f "$err_file"
    printf "%s" "$output"
    return 0
  fi
  cat "$err_file" >&2
  rm -f "$err_file"
  return 1
}

validate_stack() {
  echo "healthz:"
  curl_smoke "http://localhost:${API_PORT}/healthz"
  echo

  echo "readyz:"
  curl_smoke "http://localhost:${API_PORT}/readyz"
  echo

  echo "config:"
  curl_smoke "http://localhost:${API_PORT}/v1/config"
  echo

  echo "openapi:"
  local openapi_json
  openapi_json="$(curl_smoke "http://localhost:${API_PORT}/openapi.json")"
  if ! grep -Eq '"openapi"[[:space:]]*:' <<<"$openapi_json" || ! grep -Eq '"title"[[:space:]]*:[[:space:]]*"Solomon AI API"' <<<"$openapi_json"; then
    echo "/openapi.json response is missing the generated Solomon AI API OpenAPI document" >&2
    exit 1
  fi
  echo "ok"

  echo "scalar docs:"
  local docs_html
  docs_html="$(curl_smoke "http://localhost:${API_PORT}/docs")"
  if [[ "$docs_html" != *'@scalar/api-reference'* || "$docs_html" != *'url: "/openapi.json"'* ]]; then
    echo "/docs response is missing the Scalar API reference configuration" >&2
    exit 1
  fi
  echo "ok"

  echo "workos broker login-url:"
  curl_smoke "http://localhost:${API_PORT}/v1/auth/workos/login-url?redirect_uri=http://localhost:8080/oauth/callback&state=kind-smoke&code_challenge=kind-smoke-challenge"
  echo

  local token
  token="$(curl_smoke "http://localhost:${DEVSTACK_PORT}/mint?workos_user_id=user_kind_smoke&email=kind%40solomon-ai.co" | json_token)"
  if [[ -z "$token" ]]; then
    echo "could not mint devstack token" >&2
    exit 1
  fi

  echo "authenticated /v1/me:"
  local me_json
  me_json="$(curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/me")"
  echo "$me_json"
  if [[ "$me_json" != *'"monthly"'* || "$me_json" != *'"daily"'* ]]; then
    echo "/v1/me response is missing billing.usage.monthly or billing.usage.daily" >&2
    exit 1
  fi

  echo "authenticated /v1/llm/models:"
  curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/llm/models"
  echo

  validate_temporal_background_task "$token"
  validate_scheduler_background_task "$token"
}

validate_temporal_background_task() {
  local token="$1"
  local slug="kind-api-worker-$(date +%s)"

  echo "authenticated api-worker background task:"
  local task_json
  task_json="$(curl_smoke \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -X POST \
    --data "{\"slug\":\"${slug}\",\"name\":\"Kind API Worker Smoke\",\"instructions\":\"Write a short status artifact for the local Temporal smoke test.\",\"executionTarget\":\"api\"}" \
    "http://localhost:${API_PORT}/v1/background-tasks")"
  echo "$task_json"

  local revision
  revision="$(sed -n 's/.*"revision"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' <<<"$task_json" | head -1)"

  local trigger_json
  trigger_json="$(curl_smoke \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -X POST \
    --data '{"context":"Run from kind validation."}' \
    "http://localhost:${API_PORT}/v1/background-tasks/${slug}/trigger")"
  echo "$trigger_json"

  local run_id
  run_id="$(sed -n 's/.*"runId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$trigger_json" | head -1)"
  if [[ -z "$run_id" ]]; then
    echo "could not parse api-worker runId" >&2
    exit 1
  fi

  local status_json=""
  for _ in $(seq 1 40); do
    status_json="$(curl_smoke \
      -H "Authorization: Bearer ${token}" \
      "http://localhost:${API_PORT}/v1/background-tasks/${slug}/runs/${run_id}/status")"
    if [[ "$status_json" == *'"status":"succeeded"'* ]]; then
      echo "$status_json"
      break
    fi
    if [[ "$status_json" == *'"status":"failed"'* ]]; then
      echo "$status_json" >&2
      echo "api-worker background task failed" >&2
      exit 1
    fi
    sleep 2
  done
  if [[ "$status_json" != *'"status":"succeeded"'* ]]; then
    echo "$status_json" >&2
    echo "api-worker background task did not complete before timeout" >&2
    exit 1
  fi

  local events_json
  events_json="$(curl_smoke \
    -H "Authorization: Bearer ${token}" \
    "http://localhost:${API_PORT}/v1/background-tasks/${slug}/runs/${run_id}/events?afterSeq=0")"
  if [[ "$events_json" != *'"events"'* ]]; then
    echo "api-worker events polling failed" >&2
    exit 1
  fi
  echo "api-worker background task: ok"

  local latest_task_json
  latest_task_json="$(curl_smoke \
    -H "Authorization: Bearer ${token}" \
    "http://localhost:${API_PORT}/v1/background-tasks/${slug}")"
  revision="$(sed -n 's/.*"revision"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' <<<"$latest_task_json" | head -1)"
  if [[ -n "$revision" ]]; then
    curl_smoke \
      -H "Authorization: Bearer ${token}" \
      -X DELETE \
      "http://localhost:${API_PORT}/v1/background-tasks/${slug}?revision=${revision}" >/dev/null || true
  fi
}

# validate_scheduler_background_task proves RFC 001: with NO HTTP /trigger call
# (the "desktop closed" scenario), the in-cluster scheduler fires an API-target
# cron task on its own and the run executes to success in the cloud.
validate_scheduler_background_task() {
  local token="$1"
  if ! kubectl get deployment -n "$NAMESPACE" rowboat-api-scheduler >/dev/null 2>&1; then
    echo "scheduler deployment not present; skipping desktop-closed scheduler check"
    return 0
  fi
  local slug="kind-scheduler-$(date +%s)"

  echo "api-owned scheduler (desktop-closed) cron task:"
  # Create an API-target task with a once-a-minute cron trigger. We deliberately
  # never call POST /trigger — a never-run cron is immediately due, so the
  # scheduler must create the run by itself within a poll interval.
  curl_smoke \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -X POST \
    --data "{\"slug\":\"${slug}\",\"name\":\"Kind Scheduler Smoke\",\"instructions\":\"Write a short status artifact for the scheduler smoke test.\",\"executionTarget\":\"api\",\"triggers\":{\"cronExpr\":\"*/1 * * * *\"}}" \
    "http://localhost:${API_PORT}/v1/background-tasks" >/dev/null

  # Wait for a scheduler-created run to appear: run id prefixed sched-cron-,
  # trigger=cron, executor=api — none of which an HTTP trigger would produce.
  local runs_json="" run_id=""
  for _ in $(seq 1 36); do # ~180s = two 2-minute grace windows + slack
    runs_json="$(curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/background-tasks/${slug}/runs")"
    run_id="$(sed -n 's/.*"runId"[[:space:]]*:[[:space:]]*"\(sched-cron-[^"]*\)".*/\1/p' <<<"$runs_json" | head -1)"
    if [[ -n "$run_id" ]]; then
      break
    fi
    sleep 5
  done
  if [[ -z "$run_id" ]]; then
    echo "$runs_json" >&2
    echo "scheduler did not fire a cron run with the desktop closed" >&2
    exit 1
  fi
  if [[ "$runs_json" != *'"trigger":"cron"'* || "$runs_json" != *'"executor":"api"'* ]]; then
    echo "$runs_json" >&2
    echo "scheduler run is not trigger=cron/executor=api" >&2
    exit 1
  fi
  echo "scheduler created ${run_id} (trigger=cron, executor=api) with no HTTP trigger"

  # The run should execute to success within two grace windows.
  local status_json=""
  for _ in $(seq 1 60); do # ~300s
    status_json="$(curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/background-tasks/${slug}/runs/${run_id}/status")"
    if [[ "$status_json" == *'"status":"succeeded"'* ]]; then
      break
    fi
    if [[ "$status_json" == *'"status":"failed"'* ]]; then
      echo "$status_json" >&2
      echo "scheduler-fired run failed" >&2
      exit 1
    fi
    sleep 3
  done
  if [[ "$status_json" != *'"status":"succeeded"'* ]]; then
    echo "$status_json" >&2
    echo "scheduler-fired run did not complete within two grace windows" >&2
    exit 1
  fi
  echo "api-owned scheduler desktop-closed run: ok"

  # Cleanup: deactivate + delete so the cron stops and the task is removed.
  local latest_task_json revision
  latest_task_json="$(curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/background-tasks/${slug}")"
  revision="$(sed -n 's/.*"revision"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' <<<"$latest_task_json" | head -1)"
  if [[ -n "$revision" ]]; then
    curl_smoke \
      -H "Authorization: Bearer ${token}" \
      -X DELETE \
      "http://localhost:${API_PORT}/v1/background-tasks/${slug}?revision=${revision}" >/dev/null || true
  fi
}

helm_validate() {
  need helm
  local rendered_dir
  rendered_dir="$(mktemp -d)"

  echo "helm lint: kind values"
  helm lint "$CHART_DIR" --values "$VALUES_FILE"
  echo

  for env in kind staging production; do
    local values
    case "$env" in
      kind) values="$VALUES_FILE" ;;
      staging) values="${CHART_DIR}/values-staging.yaml" ;;
      production) values="${CHART_DIR}/values-production.yaml" ;;
    esac

    echo "helm template: ${env} values"
    helm template "$RELEASE_NAME" "$CHART_DIR" --namespace "$NAMESPACE" --values "$values" >"${rendered_dir}/${env}.yaml"
    grep -q 'kind: Deployment' "${rendered_dir}/${env}.yaml"
    grep -q 'kind: Service' "${rendered_dir}/${env}.yaml"
    grep -q '/healthz' "${rendered_dir}/${env}.yaml"
    grep -q '/readyz' "${rendered_dir}/${env}.yaml"
    if [[ "$env" == kind ]]; then
      if grep -q '^kind: Secret$' "${rendered_dir}/${env}.yaml"; then
        echo "kind values must not render a Helm-managed Secret; Infisical should manage rowboat-api-secrets" >&2
        exit 1
      fi
      grep -q 'name: rowboat-api-secrets' "${rendered_dir}/${env}.yaml"
      # RFC 001: kind enables the scheduler, so its Deployment must render.
      if ! grep -q 'name: rowboat-api-scheduler' "${rendered_dir}/${env}.yaml"; then
        echo "kind values must render the rowboat-api-scheduler Deployment" >&2
        exit 1
      fi
    else
      # The scheduler must stay gated off outside kind until RFC 002 lands.
      if grep -q 'name: rowboat-api-scheduler' "${rendered_dir}/${env}.yaml"; then
        echo "${env} values must not render the scheduler (scheduler.enabled should be false)" >&2
        exit 1
      fi
    fi
    echo "ok"
  done
  rm -rf "$rendered_dir"
}

validate_infisical() {
  echo "infisical CLI secret:"
  sync_infisical_cli_secret
  kubectl get secret -n "$NAMESPACE" "$INFISICAL_SYNC_SECRET"
  echo "required secret keys: ok"
}

validate_kubernetes() {
  ensure_cluster
  echo "helm release:"
  helm status "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null
  echo "ok"

  echo "rollouts:"
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-postgres --timeout=180s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-redis --timeout=180s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-temporal --timeout=240s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-devstack --timeout=180s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api --timeout=180s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-worker --timeout=180s

  echo "service EndpointSlices:"
  validate_service_endpoints rowboat-api
  validate_service_endpoints rowboat-api-devstack
  validate_service_endpoints rowboat-api-temporal
}

validate_service_endpoints() {
  local service="$1"
  local selector="kubernetes.io/service-name=${service}"
  local addresses

  addresses="$(kubectl get endpointslices -n "$NAMESPACE" -l "$selector" -o jsonpath='{.items[*].endpoints[*].addresses[*]}')"
  if [[ -z "$addresses" ]]; then
    echo "no EndpointSlice addresses found for service/${service}" >&2
    exit 1
  fi

  echo "service/${service}:"
  kubectl get endpointslices -n "$NAMESPACE" -l "$selector" \
    -o custom-columns='NAME:.metadata.name,ADDRESS_TYPE:.addressType,PORTS:.ports[*].port,ENDPOINTS:.endpoints[*].addresses[*]'
}

validate_full() {
  helm_validate
  validate_infisical
  validate_kubernetes
  validate_stack
  desktop_smoke
}

show_status() {
  ensure_cluster
  kubectl get all -n "$NAMESPACE" || true
  kubectl get secret -n "$NAMESPACE" "$INFISICAL_SYNC_SECRET" || true
  if curl -fsS "http://localhost:${API_PORT}/healthz" >/dev/null 2>&1; then
    echo "api host port reachable: http://localhost:${API_PORT}"
  else
    echo "api host port not reachable: http://localhost:${API_PORT}"
  fi
  if curl -fsS "http://localhost:${DEVSTACK_PORT}/.well-known/jwks.json" >/dev/null 2>&1; then
    echo "devstack host port reachable: http://localhost:${DEVSTACK_PORT}"
  else
    echo "devstack host port not reachable: http://localhost:${DEVSTACK_PORT}"
  fi
}

run_desktop() {
  cd "${ROOT_DIR}/apps/x"
  API_URL="http://localhost:${API_PORT}" \
    ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT="${ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT:-9222}" \
    npm run dev
}

desktop_smoke() {
  "${ROOT_DIR}/scripts/rowboat-desktop-smoke.sh"
}

desktop_perf() {
  "${ROOT_DIR}/scripts/rowboat-desktop-perf.sh"
}

tail_logs() {
  ensure_cluster
  kubectl logs -n "$NAMESPACE" deployment/rowboat-api -c rowboat-api --tail=80 -f
}

down() {
  ensure_cluster
  stop_port_forwards
  helm uninstall "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1 || true
  kubectl delete secret -n "$NAMESPACE" "$INFISICAL_SYNC_SECRET" --ignore-not-found >/dev/null 2>&1 || true
  kubectl delete -n "$NAMESPACE" -f "$DEPS_FILE" --ignore-not-found
}

delete_cluster() {
  stop_port_forwards
  kind delete cluster --name "$CLUSTER_NAME"
}

cmd="${1:-up}"
case "$cmd" in
  up)
    require_infisical_project
    build_and_load_image
    deploy_dependencies
    deploy_chart
    validate_stack
    cat <<EOF

rowboat-api kind stack is ready.
API:      http://localhost:${API_PORT}
Devstack: http://localhost:${DEVSTACK_PORT}

Run the desktop against it with:
  scripts/rowboat-api-kind.sh desktop

Or manually:
  cd apps/x && API_URL=http://localhost:${API_PORT} ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT=9222 npm run dev
EOF
    ;;
  deploy)
    require_infisical_project
    deploy_dependencies
    deploy_chart
    ;;
  port-forward)
    start_port_forwards
    ;;
  helm-validate)
    helm_validate
    ;;
  infisical-validate)
    validate_infisical
    ;;
  validate)
    validate_stack
    ;;
  validate-full)
    validate_full
    ;;
  desktop)
    run_desktop
    ;;
  desktop-smoke)
    desktop_smoke
    ;;
  desktop-perf)
    desktop_perf
    ;;
  status)
    show_status
    ;;
  logs)
    tail_logs
    ;;
  down)
    down
    ;;
  delete-cluster)
    delete_cluster
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
