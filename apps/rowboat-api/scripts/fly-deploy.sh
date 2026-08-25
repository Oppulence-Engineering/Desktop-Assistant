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
  --buildkit \
  --ha=false \
  --remote-only \
  --yes

# Preserve the Kubernetes production floor, with capacity on both coasts.
flyctl scale count 3 \
  --app "${FLY_APP}" \
  --process-group app \
  --region iad,sjc \
  --max-per-region 2 \
  --yes

# Keep each two-Machine background group split east and west.
flyctl scale count 2 --app "${FLY_APP}" --process-group worker --region iad,sjc --max-per-region 1 --yes
flyctl scale count 2 --app "${FLY_APP}" --process-group scheduler --region iad,sjc --max-per-region 1 --yes

flyctl machines list --app "${FLY_APP}" --json | jq -e '
  [.[] | select(.state != "destroyed")] as $machines |
  def regions($group):
    [$machines[] | select(.config.metadata.fly_process_group == $group) | .region];
  (regions("app") | length == 3 and index("iad") != null and index("sjc") != null) and
  (regions("worker") | sort == ["iad", "sjc"]) and
  (regions("scheduler") | sort == ["iad", "sjc"])
' >/dev/null

flyctl scale show --app "${FLY_APP}"
flyctl status --app "${FLY_APP}"
flyctl checks list --app "${FLY_APP}"
