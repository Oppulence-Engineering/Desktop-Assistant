#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER_NAME="${KIND_CLUSTER_NAME:-rowboat-api}"
NAMESPACE="${ROWBOAT_API_NAMESPACE:-rowboat-api}"
RELEASE_NAME="${ROWBOAT_API_RELEASE:-rowboat-api}"
IMAGE="${ROWBOAT_API_IMAGE:-rowboat-api:kind}"
API_PORT="${ROWBOAT_API_PORT:-18080}"
DEVSTACK_PORT="${ROWBOAT_DEVSTACK_PORT:-18090}"
API_PORT_ENV_SET="${ROWBOAT_API_PORT+x}"
DEVSTACK_PORT_ENV_SET="${ROWBOAT_DEVSTACK_PORT+x}"
FALLBACK_API_PORT="${ROWBOAT_API_FALLBACK_PORT:-18081}"
FALLBACK_DEVSTACK_PORT="${ROWBOAT_DEVSTACK_FALLBACK_PORT:-18091}"
COREDNS_MEMORY_LIMIT="${ROWBOAT_KIND_COREDNS_MEMORY_LIMIT:-512Mi}"
STATE_DIR="${ROWBOAT_KIND_STATE_DIR:-${ROOT_DIR}/.rowboat-kind}"
DEPS_FILE="${ROOT_DIR}/deploy/kind/rowboat-api/dependencies.yaml"
KIND_CONFIG_FILE="${ROOT_DIR}/deploy/kind/rowboat-api/kind-config.yaml"
VALUES_FILE="${ROOT_DIR}/charts/rowboat-api/values-kind.yaml"
CHART_DIR="${ROOT_DIR}/charts/rowboat-api"
WWW_CHART_DIR="${ROOT_DIR}/charts/rowboat-www"
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
  SLACK_SIGNING_SECRET
  GOOGLE_WEBHOOK_TOKEN
  WEBHOOK_SIGNING_SECRET
)

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  up              Create/update kind, build/load the image, deploy deps + chart, smoke test.
  deploy          Apply deps and helm upgrade using the already-loaded image.
  port-forward    Start/restart persistent port-forwards for API and devstack.
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
  ROWBOAT_API_FALLBACK_PORT       default: 18081
  ROWBOAT_DEVSTACK_FALLBACK_PORT  default: 18091
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
  ensure_coredns_capacity
  wait_for_cluster_dns
}

ensure_coredns_capacity() {
  if ! kubectl -n kube-system get deployment/coredns >/dev/null 2>&1; then
    return
  fi
  local current_limit
  current_limit="$(kubectl -n kube-system get deployment/coredns -o jsonpath='{.spec.template.spec.containers[?(@.name=="coredns")].resources.limits.memory}' 2>/dev/null || true)"
  if [[ "$current_limit" == "$COREDNS_MEMORY_LIMIT" ]]; then
    return
  fi
  echo "setting CoreDNS memory limit to ${COREDNS_MEMORY_LIMIT} for local kind stability"
  kubectl -n kube-system set resources deployment/coredns \
    --requests=cpu=100m,memory=70Mi \
    --limits=memory="$COREDNS_MEMORY_LIMIT" >/dev/null
  kubectl -n kube-system rollout status deployment/coredns --timeout=180s
}

wait_for_cluster_dns() {
  kubectl wait -n kube-system --for=condition=Ready pod -l k8s-app=kube-dns --timeout=180s >/dev/null
  kubectl --request-timeout=15s get --raw=/readyz >/dev/null
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

pod_uid_for_label() {
  local selector="$1"
  kubectl get pod -n "$NAMESPACE" -l "$selector" \
    -o jsonpath='{.items[0].metadata.uid}' 2>/dev/null || true
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
  local postgres_pod_before
  postgres_pod_before="$(pod_uid_for_label app.kubernetes.io/name=rowboat-api-postgres)"
  kubectl apply -n "$NAMESPACE" -f "$DEPS_FILE"
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-postgres --timeout=180s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-redis --timeout=180s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-temporal --timeout=240s
  kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-devstack --timeout=180s
  local postgres_pod_after
  postgres_pod_after="$(pod_uid_for_label app.kubernetes.io/name=rowboat-api-postgres)"
  if [[ -n "$postgres_pod_before" && -n "$postgres_pod_after" && "$postgres_pod_before" != "$postgres_pod_after" ]]; then
    echo "postgres pod changed; restarting Temporal to refresh database connections"
    kubectl rollout restart -n "$NAMESPACE" deployment/rowboat-api-temporal
    kubectl rollout status -n "$NAMESPACE" deployment/rowboat-api-temporal --timeout=300s
  fi
}

deploy_chart() {
  ensure_cluster
  ensure_namespace
  select_host_ports
  sync_infisical_cli_secret
  local api_origin="http://localhost:${API_PORT}"
  local devstack_origin="http://localhost:${DEVSTACK_PORT}"
  local cors_origins="http://localhost:3000\\,http://localhost:5173\\,${api_origin}"
  helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
    --namespace "$NAMESPACE" \
    --values "$VALUES_FILE" \
    --set "image.repository=$(image_repository)" \
    --set "image.tag=$(image_tag)" \
    --set-string "config.APP_URL=${api_origin}" \
    --set-string "config.PUBLIC_BASE_URL=${api_origin}" \
    --set-string "config.CORS_ALLOWED_ORIGINS=${cors_origins}" \
    --set-string "config.GOOGLE_REDIRECT_URI=${api_origin}/oauth/google/callback" \
    --set-string "config.OIDC_ISSUER_URL=${devstack_origin}" \
    --set-string "config.TOKEN_ISSUER=${devstack_origin}" \
    --set-string "config.WORKOS_AUTHORIZE_BASE_URL=${devstack_origin}" \
    --set-string "config.ORY_PUBLIC_URL=${devstack_origin}" \
    --set-string "config.GOOGLE_AUTHORIZE_URL=${devstack_origin}/o/oauth2/v2/auth" \
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

listener_pids_for_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u
  fi
}

http_ready() {
  local url="$1"
  curl --fail --silent --show-error --connect-timeout 2 --max-time 3 "$url" >/dev/null 2>&1
}

child_pids_for() {
  local pid="$1"
  pgrep -P "$pid" 2>/dev/null || true
}

process_group_for() {
  local pid="$1"
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true
}

process_command_for() {
  local pid="$1"
  ps -o command= -p "$pid" 2>/dev/null || true
}

process_parent_for() {
  local pid="$1"
  ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true
}

send_signal_to_pid_tree() {
  local signal="$1"
  local pid="$2"
  local child
  for child in $(child_pids_for "$pid"); do
    send_signal_to_pid_tree "$signal" "$child"
  done
  kill "-${signal}" "$pid" >/dev/null 2>&1 || true
}

wait_for_pid_exit() {
  local pid="$1"
  for _ in $(seq 1 40); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

wait_for_port_release() {
  local port="$1"
  for _ in $(seq 1 40); do
    if ! port_in_use "$port"; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

stop_pid_tree() {
  local pid="$1"
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" >/dev/null 2>&1; then
    return
  fi

  local pgid
  pgid="$(process_group_for "$pid")"
  if [[ "$pgid" == "$pid" ]]; then
    kill -TERM "-${pid}" >/dev/null 2>&1 || true
  else
    send_signal_to_pid_tree TERM "$pid"
  fi

  if wait_for_pid_exit "$pid"; then
    return
  fi

  if [[ "$pgid" == "$pid" ]]; then
    kill -KILL "-${pid}" >/dev/null 2>&1 || true
  else
    send_signal_to_pid_tree KILL "$pid"
  fi
  wait_for_pid_exit "$pid" >/dev/null 2>&1 || true
}

command_matches_port_forward() {
  local command="$1"
  local resource="$2"
  local local_port="$3"
  local remote_port="$4"
  [[ "$command" == *"port-forward"* && "$command" == *"$resource"* && "$command" == *"${local_port}:${remote_port}"* ]]
}

stop_matching_port_forward_listeners() {
  local resource="$1"
  local local_port="$2"
  local remote_port="$3"
  local stopped=1
  local pid
  for pid in $(listener_pids_for_port "$local_port"); do
    local command
    command="$(process_command_for "$pid")"
    if ! command_matches_port_forward "$command" "$resource" "$local_port" "$remote_port"; then
      continue
    fi

    local parent
    local parent_command
    parent="$(process_parent_for "$pid")"
    parent_command="$(process_command_for "$parent")"
    if [[ "$parent" =~ ^[0-9]+$ && "$parent_command" == *"rowboat-port-forward"* ]]; then
      stop_pid_tree "$parent"
    else
      stop_pid_tree "$pid"
    fi
    stopped=0
  done
  return "$stopped"
}

stop_port_forwards() {
  mkdir -p "$STATE_DIR"
  for name in api devstack; do
    local pid_file="${STATE_DIR}/${name}.pid"
    if [[ -f "$pid_file" ]]; then
      local pid
      pid="$(cat "$pid_file")"
      stop_pid_tree "$pid"
      rm -f "$pid_file"
    fi

    if [[ "$name" == api ]]; then
      stop_matching_port_forward_listeners svc/rowboat-api "$API_PORT" 80 >/dev/null 2>&1 || true
      wait_for_port_release "$API_PORT" >/dev/null 2>&1 || true
    elif [[ "$name" == devstack ]]; then
      stop_matching_port_forward_listeners svc/rowboat-api-devstack "$DEVSTACK_PORT" 8090 >/dev/null 2>&1 || true
      wait_for_port_release "$DEVSTACK_PORT" >/dev/null 2>&1 || true
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
      if port_in_use "$local_port"; then
        echo "${name} port-forward already running on localhost:${local_port} (pid ${existing_pid})"
        return
      fi
      echo "${name} port-forward pid ${existing_pid} is alive but localhost:${local_port} is not listening; restarting"
      stop_pid_tree "$existing_pid"
      wait_for_port_release "$local_port" >/dev/null 2>&1 || true
    fi
    rm -f "$pid_file"
  fi

  if port_in_use "$local_port"; then
    stop_matching_port_forward_listeners "$resource" "$local_port" "$remote_port" >/dev/null 2>&1 || true
    wait_for_port_release "$local_port" >/dev/null 2>&1 || true
  fi

  if port_in_use "$local_port"; then
    echo "localhost:${local_port} is already in use; stop that process or override the port" >&2
    exit 1
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$pid_file" "$log_file" "$NAMESPACE" "$resource" "$local_port" "$remote_port" <<'PY'
import subprocess
import sys

pid_file, log_file, namespace, resource, local_port, remote_port = sys.argv[1:]
script = """
trap "" INT
trap "exit 0" TERM
while :; do
  kubectl -n "$1" port-forward "$2" "${3}:${4}" </dev/null
  sleep 1
done
"""
log = open(log_file, "ab", buffering=0)
proc = subprocess.Popen(
    ["/bin/sh", "-c", script, "rowboat-port-forward", namespace, resource, local_port, remote_port],
    stdin=subprocess.DEVNULL,
    stdout=log,
    stderr=subprocess.STDOUT,
    start_new_session=True,
    close_fds=True,
)
with open(pid_file, "w", encoding="utf-8") as pid:
    pid.write(f"{proc.pid}\n")
PY
  else
    nohup sh -c '
      namespace="$1"
      resource="$2"
      local_port="$3"
      remote_port="$4"
      trap "" INT
      trap "exit 0" TERM
      while :; do
        kubectl -n "$namespace" port-forward "$resource" "${local_port}:${remote_port}" </dev/null
        sleep 1
      done
    ' rowboat-port-forward "$NAMESPACE" "$resource" "$local_port" "$remote_port" >"$log_file" 2>&1 </dev/null &
    echo "$!" >"$pid_file"
    disown "$(cat "$pid_file")" 2>/dev/null || true
  fi
  sleep 2
  if ! kill -0 "$(cat "$pid_file")" >/dev/null 2>&1; then
    echo "failed to start ${name} port-forward; see ${log_file}" >&2
    exit 1
  fi
  echo "${name} port-forward: localhost:${local_port} -> ${resource}:${remote_port}"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  for _ in $(seq 1 30); do
    if http_ready "$url"; then
      return 0
    fi
    sleep 1
  done
  echo "timed out waiting for ${name}: ${url}" >&2
  return 1
}

wait_for_existing_http() {
  local url="$1"
  local port="$2"
  for _ in $(seq 1 10); do
    if http_ready "$url"; then
      return 0
    fi
    if ! port_in_use "$port"; then
      return 1
    fi
    sleep 1
  done
  return 1
}

select_host_port() {
  local name="$1"
  local resource="$2"
  local remote_port="$3"
  local path="$4"
  local port_var="$5"
  local fallback_port="$6"
  local env_set="$7"
  local port="${!port_var}"

  if http_ready "http://localhost:${port}${path}"; then
    return
  fi

  if port_in_use "$port"; then
    if wait_for_existing_http "http://localhost:${port}${path}" "$port"; then
      return
    fi
    if stop_matching_port_forward_listeners "$resource" "$port" "$remote_port" >/dev/null 2>&1; then
      wait_for_port_release "$port" >/dev/null 2>&1 || true
      start_port_forward "$name" "$resource" "$port" "$remote_port"
      wait_for_http "$name" "http://localhost:${port}${path}"
      return
    fi
    if [[ -n "$env_set" ]]; then
      echo "localhost:${port} is in use but ${name} is not healthy; choose a different ${port_var}" >&2
      exit 1
    fi
    echo "localhost:${port} is occupied but ${name} is not healthy; falling back to localhost:${fallback_port}"
    printf -v "$port_var" "%s" "$fallback_port"
  fi
}

select_host_ports() {
  select_host_port api svc/rowboat-api 80 /healthz API_PORT "$FALLBACK_API_PORT" "$API_PORT_ENV_SET"
  select_host_port devstack svc/rowboat-api-devstack 8090 /.well-known/jwks.json DEVSTACK_PORT "$FALLBACK_DEVSTACK_PORT" "$DEVSTACK_PORT_ENV_SET"
}

ensure_local_http() {
  local name="$1"
  local resource="$2"
  local remote_port="$3"
  local path="$4"
  local port_var="$5"
  local fallback_port="$6"
  local env_set="$7"
  local port="${!port_var}"

  if http_ready "http://localhost:${port}${path}"; then
    return
  fi

  if port_in_use "$port"; then
    if wait_for_existing_http "http://localhost:${port}${path}" "$port"; then
      return
    fi
    if [[ -n "$env_set" ]]; then
      echo "localhost:${port} is in use but ${name} is not healthy; choose a different ${port_var}" >&2
      exit 1
    fi
    echo "localhost:${port} is occupied but ${name} is not healthy; falling back to localhost:${fallback_port}"
    printf -v "$port_var" "%s" "$fallback_port"
    port="$fallback_port"
  fi

  start_port_forward "$name" "$resource" "$port" "$remote_port"
  wait_for_http "$name" "http://localhost:${port}${path}"
}

ensure_host_access() {
  ensure_cluster
  ensure_local_http api svc/rowboat-api 80 /healthz API_PORT "$FALLBACK_API_PORT" "$API_PORT_ENV_SET"
  ensure_local_http devstack svc/rowboat-api-devstack 8090 /.well-known/jwks.json DEVSTACK_PORT "$FALLBACK_DEVSTACK_PORT" "$DEVSTACK_PORT_ENV_SET"
}

start_port_forwards() {
  ensure_host_access
  echo "api host port reachable: http://localhost:${API_PORT}"
  echo "devstack host port reachable: http://localhost:${DEVSTACK_PORT}"
}

json_token() {
  sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

json_me_user_id() {
  sed -n 's/.*"user"[[:space:]]*:[[:space:]]*{[^}]*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

base64_decode() {
  if printf "" | base64 --decode >/dev/null 2>&1; then
    base64 --decode
  else
    base64 -D
  fi
}

secret_value() {
  local key="$1"
  kubectl get secret -n "$NAMESPACE" "$INFISICAL_SYNC_SECRET" \
    -o "jsonpath={.data.${key}}" | base64_decode
}

webhook_signature() {
  local secret="$1" timestamp="$2" body="$3"
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to sign webhook smoke requests" >&2
    return 1
  fi
  WEBHOOK_SECRET="$secret" WEBHOOK_TIMESTAMP="$timestamp" WEBHOOK_BODY="$body" python3 - <<'PY'
import hashlib
import hmac
import os

secret = os.environ["WEBHOOK_SECRET"].encode()
message = (os.environ["WEBHOOK_TIMESTAMP"] + "." + os.environ["WEBHOOK_BODY"]).encode()
print("sha256=" + hmac.new(secret, message, hashlib.sha256).hexdigest())
PY
}

curl_smoke() {
  local err_file
  err_file="$(mktemp)"
  local output
  if output="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 20 --retry 10 --retry-delay 1 --retry-all-errors "$@" 2>"$err_file")"; then
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

  local smoke_workos_id smoke_email smoke_email_q token
  smoke_workos_id="${ROWBOAT_KIND_SMOKE_WORKOS_ID:-user_kind_smoke_$(date +%s)}"
  smoke_email="${ROWBOAT_KIND_SMOKE_EMAIL:-kind-${smoke_workos_id}@solomon-ai.co}"
  smoke_email_q="${smoke_email/@/%40}"
  token="$(curl_smoke "http://localhost:${DEVSTACK_PORT}/mint?workos_user_id=${smoke_workos_id}&email=${smoke_email_q}" | json_token)"
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
  local user_id
  user_id="$(json_me_user_id <<<"$me_json" | head -1)"
  if [[ -z "$user_id" ]]; then
    echo "could not parse user id from /v1/me" >&2
    exit 1
  fi

  echo "authenticated /v1/llm/models:"
  curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/llm/models"
  echo

  validate_temporal_background_task "$token"
  validate_event_webhook_task "$token" "$user_id"
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

delete_background_task() {
  local token="$1" slug="$2" task_json revision
  task_json="$(curl --fail --silent "http://localhost:${API_PORT}/v1/background-tasks/${slug}" -H "Authorization: Bearer ${token}" 2>/dev/null)" || return 0
  revision="$(sed -n 's/.*"revision"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' <<<"$task_json" | head -1)"
  [[ -n "$revision" ]] || return 0
  curl --fail --silent -X DELETE \
    "http://localhost:${API_PORT}/v1/background-tasks/${slug}?revision=${revision}" \
    -H "Authorization: Bearer ${token}" >/dev/null 2>&1 || true
}

delete_scheduler_task() {
  delete_background_task "$@"
}

validate_event_webhook_task() {
  local token="$1" user_id="$2"
  local slug="kind-event-webhook-$(date +%s)"
  local source_event_id="kind-webhook-$(date +%s)"
  local fail="" task_json="" body="" timestamp="" sig="" ingest_json="" runs_json="" run_id="" status_json="" run_json=""

  echo "signed external webhook event-triggered task:"

  if ! task_json="$(curl_smoke \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -X POST \
    --data "{\"slug\":\"${slug}\",\"name\":\"Kind Webhook Event Smoke\",\"instructions\":\"Write a short status artifact for an externally delivered invoice dispute event.\",\"executionTarget\":\"api\",\"triggers\":{\"eventMatchCriteria\":\"webhook invoice dispute for Acme invoice 4821\"}}" \
    "http://localhost:${API_PORT}/v1/background-tasks")"; then
    fail="could not create event webhook smoke task"
  fi

  if [[ -z "$fail" ]]; then
    local webhook_secret
    if ! webhook_secret="$(secret_value WEBHOOK_SIGNING_SECRET)"; then
      fail="could not read WEBHOOK_SIGNING_SECRET from secret/${INFISICAL_SYNC_SECRET}"
    elif [[ -z "$webhook_secret" ]]; then
      fail="WEBHOOK_SIGNING_SECRET is missing from secret/${INFISICAL_SYNC_SECRET}"
    elif ! body="$(USER_ID="$user_id" SOURCE_EVENT_ID="$source_event_id" python3 - <<'PY'
import json
import os

print(json.dumps({
    "userId": os.environ["USER_ID"],
    "sourceEventId": os.environ["SOURCE_EVENT_ID"],
    "sourceAccountId": "kind-smoke",
    "eventType": "invoice.disputed",
    "payload": {
        "customer": "Acme",
        "invoice": "4821",
        "reason": "kind external webhook smoke",
    },
}, separators=(",", ":")))
PY
)"; then
      fail="could not build webhook smoke body"
    elif ! timestamp="$(date +%s)"; then
      fail="could not timestamp webhook smoke body"
    elif ! sig="$(webhook_signature "$webhook_secret" "$timestamp" "$body")"; then
      fail="could not sign webhook smoke body"
    elif ! ingest_json="$(curl_smoke \
      -H "Content-Type: application/json" \
      -H "X-Webhook-Timestamp: ${timestamp}" \
      -H "X-Webhook-Signature: ${sig}" \
      -X POST \
      --data "$body" \
      "http://localhost:${API_PORT}/v1/webhooks/events")"; then
      fail="signed generic webhook was rejected"
    elif [[ "$ingest_json" != *'"routingStatus":"pending"'* && "$ingest_json" != *'"routingStatus":"routed"'* ]]; then
      fail="webhook ingest did not enqueue routing"
    fi
  fi

  if [[ -z "$fail" ]]; then
    for _ in $(seq 1 60); do
      runs_json="$(curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/background-tasks/${slug}/runs")" || { fail="event run list query failed"; break; }
      run_id="$(sed -n 's/.*"runId"[[:space:]]*:[[:space:]]*"\(event-[^"]*\)".*/\1/p' <<<"$runs_json" | head -1)"
      if [[ -n "$run_id" ]]; then
        break
      fi
      sleep 2
    done
  fi
  if [[ -z "$fail" && -z "$run_id" ]]; then
    fail="cloud event router did not create an event-prefixed run"
  elif [[ -z "$fail" && ("$runs_json" != *'"trigger":"event"'* || "$runs_json" != *'"executor":"api"'*) ]]; then
    fail="cloud event run is not trigger=event/executor=api"
  fi

  if [[ -z "$fail" ]]; then
    echo "cloud event router created ${run_id} (trigger=event, executor=api)"
    for _ in $(seq 1 100); do
      status_json="$(curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/background-tasks/${slug}/runs/${run_id}/status")" || { fail="event run status query failed"; break; }
      if [[ "$status_json" == *'"status":"succeeded"'* ]]; then
        break
      fi
      if [[ "$status_json" == *'"status":"failed"'* ]]; then
        fail="event-triggered run failed"
        break
      fi
      sleep 3
    done
    if [[ -z "$fail" && "$status_json" != *'"status":"succeeded"'* ]]; then
      fail="event-triggered run did not complete before timeout"
    fi
  fi

  if [[ -z "$fail" ]]; then
    run_json="$(curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/background-tasks/${slug}/runs/${run_id}")" || fail="event run detail query failed"
    if [[ -z "$fail" && ("$run_json" != *'"sourceEvent"'* || "$run_json" != *'"source":"webhook"'* || "$run_json" != *'"eventType":"invoice.disputed"'*) ]]; then
      fail="event run detail is missing webhook sourceEvent linkage"
    fi
  fi

  delete_background_task "$token" "$slug"

  if [[ -n "$fail" ]]; then
    echo "${ingest_json}" >&2
    echo "${runs_json}" >&2
    echo "${status_json}" >&2
    echo "${run_json}" >&2
    echo "$fail" >&2
    return 1
  fi
  echo "signed external webhook event-triggered run: ok"
}

# validate_scheduler_background_task proves RFC 001: with NO HTTP /trigger call
# (the "desktop closed" scenario), the in-cluster scheduler fires an API-target
# cron task on its own and the run executes to success in the cloud.
# Deletes the scheduler smoke task by slug, best-effort. The caller routes every
# path (success, assertion failure, guarded curl failure) to a single call of
# this, so the `*/1` cron is always removed — without it, a leftover task would
# fire a new run every minute for the life of the cluster.
validate_scheduler_background_task() {
  local token="$1"
  if ! kubectl get deployment -n "$NAMESPACE" rowboat-api-scheduler >/dev/null 2>&1; then
    echo "scheduler deployment not present; skipping desktop-closed scheduler check"
    return 0
  fi
  local slug="kind-scheduler-$(date +%s)"
  local fail="" runs_json="" run_id="" status_json=""

  echo "api-owned scheduler (desktop-closed) cron task:"
  # Create an API-target task with a once-a-minute cron trigger. We deliberately
  # never call POST /trigger — a never-run cron is immediately due, so the
  # scheduler must create the run by itself within a poll interval.
  #
  # Every curl_smoke is guarded with `|| fail=...` so a hard failure routes to
  # the single cleanup+exit at the end of the function instead of tripping
  # `set -e` (which would skip cleanup and leak the */1 cron task — a RETURN
  # trap does NOT fire on a set -e abort).
  if ! curl_smoke \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -X POST \
    --data "{\"slug\":\"${slug}\",\"name\":\"Kind Scheduler Smoke\",\"instructions\":\"Write a short status artifact for the scheduler smoke test.\",\"executionTarget\":\"api\",\"triggers\":{\"cronExpr\":\"*/1 * * * *\"}}" \
    "http://localhost:${API_PORT}/v1/background-tasks" >/dev/null; then
    fail="could not create scheduler smoke task"
  fi

  # Wait for a scheduler-created run to appear: run id prefixed sched-,
  # trigger=cron, executor=api — none of which an HTTP trigger would produce.
  if [[ -z "$fail" ]]; then
    for _ in $(seq 1 36); do # ~180s = two 2-minute grace windows + slack
      runs_json="$(curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/background-tasks/${slug}/runs")" || { fail="run list query failed"; break; }
      run_id="$(sed -n 's/.*"runId"[[:space:]]*:[[:space:]]*"\(sched-[^"]*\)".*/\1/p' <<<"$runs_json" | head -1)"
      if [[ -n "$run_id" ]]; then
        break
      fi
      sleep 5
    done
  fi
  if [[ -z "$fail" && -z "$run_id" ]]; then
    fail="scheduler did not fire a cron run with the desktop closed"
  elif [[ -z "$fail" && ("$runs_json" != *'"trigger":"cron"'* || "$runs_json" != *'"executor":"api"'*) ]]; then
    fail="scheduler run is not trigger=cron/executor=api"
  fi

  if [[ -z "$fail" ]]; then
    echo "scheduler created ${run_id} (trigger=cron, executor=api) with no HTTP trigger"
    # The run should execute to success within two grace windows (~300s budget
    # for a real LLM run on a cold cluster).
    for _ in $(seq 1 100); do # 100 * 3s = ~300s
      status_json="$(curl_smoke -H "Authorization: Bearer ${token}" "http://localhost:${API_PORT}/v1/background-tasks/${slug}/runs/${run_id}/status")" || { fail="status query failed"; break; }
      if [[ "$status_json" == *'"status":"succeeded"'* ]]; then
        break
      fi
      if [[ "$status_json" == *'"status":"failed"'* ]]; then
        fail="scheduler-fired run failed"
        break
      fi
      sleep 3
    done
    if [[ -z "$fail" && "$status_json" != *'"status":"succeeded"'* ]]; then
      fail="scheduler-fired run did not complete within two grace windows"
    fi
  fi

  # Single cleanup point reached by every path (success, assertion failure, or a
  # guarded curl failure), so the */1 cron task is always removed.
  delete_scheduler_task "$token" "$slug"

  if [[ -n "$fail" ]]; then
    echo "${runs_json}" >&2
    echo "${status_json}" >&2
    echo "$fail" >&2
    return 1
  fi
  echo "api-owned scheduler desktop-closed run: ok"
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
      # Staging and production intentionally run the same durable workflow
      # topology. A candidate must soak with both worker and scheduler active
      # before it can be promoted.
      if ! grep -q 'name: rowboat-api-scheduler' "${rendered_dir}/${env}.yaml"; then
        echo "${env} values must render the rowboat-api-scheduler Deployment" >&2
        exit 1
      fi
      if ! grep -q 'name: rowboat-api-worker' "${rendered_dir}/${env}.yaml"; then
        echo "${env} values must render the rowboat-api worker Deployment" >&2
        exit 1
      fi
      if [[ "$(grep -c '^kind: ServiceMonitor$' "${rendered_dir}/${env}.yaml")" -lt 3 ]]; then
        echo "${env} values must render API, worker, and scheduler ServiceMonitors" >&2
        exit 1
      fi
      if ! grep -q '^kind: PrometheusRule$' "${rendered_dir}/${env}.yaml" ||
        ! grep -q 'alert: RowboatAttentionMonitorStale' "${rendered_dir}/${env}.yaml" ||
        ! grep -q 'alert: RowboatSourceBackfillStale' "${rendered_dir}/${env}.yaml"; then
        echo "${env} values must render relationship workflow alert rules" >&2
        exit 1
      fi
      if ! grep -q 'name: .*workflow-dashboard' "${rendered_dir}/${env}.yaml" ||
        ! grep -q 'uid.*oppulence-cloud-workflows' "${rendered_dir}/${env}.yaml"; then
        echo "${env} values must render the governed workflow Grafana dashboard" >&2
        exit 1
      fi
      if ! grep -q 'TEMPORAL_ENABLED: "true"' "${rendered_dir}/${env}.yaml"; then
        echo "${env} values must enable Temporal" >&2
        exit 1
      fi
    fi
    echo "ok"
  done

  echo
  echo "helm lint: rowboat-www values"
  helm lint "$WWW_CHART_DIR" --values "${WWW_CHART_DIR}/values.yaml"
  echo

  for env in default staging production; do
    local values
    local expected_api_base
    local expected_host
    local expected_issuer
    local expected_tls_secret
    case "$env" in
      default)
        values="${WWW_CHART_DIR}/values.yaml"
        expected_api_base="https://api.oppulence.io"
        expected_host="oppulence.io"
        expected_issuer="letsencrypt-prod"
        expected_tls_secret="rowboat-www-tls"
        ;;
      staging)
        values="${WWW_CHART_DIR}/values-staging.yaml"
        expected_api_base="https://api.x.staging.oppulence.io"
        expected_host="x.staging.oppulence.io"
        expected_issuer="letsencrypt-staging"
        expected_tls_secret="rowboat-www-staging-tls"
        ;;
      production)
        values="${WWW_CHART_DIR}/values-production.yaml"
        expected_api_base="https://api.oppulence.io"
        expected_host="oppulence.io"
        expected_issuer="letsencrypt"
        expected_tls_secret="rowboat-www-tls"
        ;;
    esac

    echo "helm template: rowboat-www ${env} values"
    helm template rowboat-www "$WWW_CHART_DIR" --namespace "$NAMESPACE" --values "$values" >"${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q 'kind: Deployment' "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q 'kind: Service' "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q 'kind: HorizontalPodAutoscaler' "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q 'minReplicas: 2' "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q 'maxReplicas: 4' "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q 'averageUtilization: 70' "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q '/healthz' "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q '/readyz' "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q "host: \"${expected_host}\"" "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q "cert-manager.io/cluster-issuer: ${expected_issuer}" "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q "secretName: ${expected_tls_secret}" "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q "ROWBOAT_WWW_PUBLIC_API_BASE_URL: \"${expected_api_base}\"" "${rendered_dir}/rowboat-www-${env}.yaml"
    grep -q "ROWBOAT_WWW_API_PROXY_URL: \"${expected_api_base}\"" "${rendered_dir}/rowboat-www-${env}.yaml"
    if grep -q 'kind: PodDisruptionBudget' "${rendered_dir}/rowboat-www-${env}.yaml"; then
      echo "rowboat-www ${env} values must not render a PDB" >&2
      exit 1
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
  ensure_host_access
  validate_stack
  desktop_smoke
}

show_status() {
  ensure_cluster
  select_host_ports
  kubectl get all -n "$NAMESPACE" || true
  kubectl get secret -n "$NAMESPACE" "$INFISICAL_SYNC_SECRET" || true
  if http_ready "http://localhost:${API_PORT}/healthz"; then
    echo "api host port reachable: http://localhost:${API_PORT}"
  else
    echo "api host port not reachable: http://localhost:${API_PORT}"
  fi
  if http_ready "http://localhost:${DEVSTACK_PORT}/.well-known/jwks.json"; then
    echo "devstack host port reachable: http://localhost:${DEVSTACK_PORT}"
  else
    echo "devstack host port not reachable: http://localhost:${DEVSTACK_PORT}"
  fi
}

run_desktop() {
  ensure_host_access
  cd "${ROOT_DIR}/apps/x"
  API_URL="http://localhost:${API_PORT}" \
    ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT="${ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT:-9222}" \
    npm run dev
}

desktop_smoke() {
  ensure_host_access
  ROWBOAT_API_PORT="$API_PORT" ROWBOAT_DEVSTACK_PORT="$DEVSTACK_PORT" \
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
    ensure_host_access
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
    ensure_host_access
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
