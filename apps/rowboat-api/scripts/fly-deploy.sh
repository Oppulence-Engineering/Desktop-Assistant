#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
FLY_CONFIG="${SCRIPT_DIR}/../fly.toml"
FLY_APP="${1:-${ROWBOAT_FLY_APP:-}}"

if [[ -z "${FLY_APP}" ]]; then
  echo "usage: $(basename "$0") <fly-app-name>" >&2
  echo "or set ROWBOAT_FLY_APP" >&2
  exit 2
fi
if ! command -v flyctl >/dev/null 2>&1; then
  echo "flyctl is required: https://fly.io/docs/flyctl/install/" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

flyctl config validate \
  --strict \
  --app "${FLY_APP}" \
  --config "${FLY_CONFIG}"

# --ha=false avoids Fly's first-deploy standby Machines. The explicit scale
# commands below establish the complete, inexpensive topology and are safe to
# rerun after a partial failure.
flyctl deploy "${REPO_ROOT}" \
  --app "${FLY_APP}" \
  --config "${FLY_CONFIG}" \
  --ha=false \
  --local-only \
  --wait-timeout 2m \
  --yes

# One request-serving Machine per coast. max-per-region prevents both from
# being placed together when capacity is constrained.
flyctl scale count 2 \
  --app "${FLY_APP}" \
  --process-group app \
  --region iad,sjc \
  --max-per-region 1 \
  --yes

# Background work does not benefit from edge placement. Keep a single worker
# and scheduler in the primary region, close to the primary database. Fly
# counts stopped Machines when scaling, so remove misplaced Machines and
# explicitly start the desired ones after every deploy.
extra_background_machine_ids=()
while IFS= read -r machine_id; do
  extra_background_machine_ids+=("${machine_id}")
done < <(
  flyctl machines list --app "${FLY_APP}" --json |
    jq -r '.[] | select(.region != "iad" and (.config.metadata.fly_process_group == "worker" or .config.metadata.fly_process_group == "scheduler")) | .id'
)
if (( ${#extra_background_machine_ids[@]} > 0 )); then
  flyctl machine destroy --app "${FLY_APP}" --force "${extra_background_machine_ids[@]}"
fi

flyctl scale count 1 --app "${FLY_APP}" --process-group worker --region iad --yes
flyctl scale count 1 --app "${FLY_APP}" --process-group scheduler --region iad --yes

background_machine_ids=()
while IFS= read -r machine_id; do
  background_machine_ids+=("${machine_id}")
done < <(
  flyctl machines list --app "${FLY_APP}" --json |
    jq -r '.[] | select(.region == "iad" and (.config.metadata.fly_process_group == "worker" or .config.metadata.fly_process_group == "scheduler")) | .id'
)
if (( ${#background_machine_ids[@]} != 2 )); then
  echo "expected one worker and one scheduler in iad" >&2
  exit 1
fi
flyctl machine start --app "${FLY_APP}" "${background_machine_ids[@]}"

for machine_id in "${background_machine_ids[@]}"; do
  for attempt in {1..24}; do
    if flyctl checks list --app "${FLY_APP}" --json |
      jq -e --arg id "${machine_id}" '.[$id] | arrays | length > 0 and all(.[]; .status == "passing")' >/dev/null; then
      break
    fi
    if (( attempt == 24 )); then
      echo "background Machine ${machine_id} did not become healthy" >&2
      flyctl machine status "${machine_id}" --app "${FLY_APP}"
      exit 1
    fi
    sleep 5
  done
done

flyctl scale show --app "${FLY_APP}"
flyctl status --app "${FLY_APP}"
flyctl checks list --app "${FLY_APP}"
