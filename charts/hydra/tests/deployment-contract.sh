#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmp_dir="$(mktemp -d)"
hydra_container="connector-contract-hydra-${RANDOM}"
cleanup() {
  docker rm -f "$hydra_container" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

fail() {
  printf 'connector deployment contract failed: %s\n' "$*" >&2
  exit 1
}

command -v helm >/dev/null || fail "helm is required"
command -v python3 >/dev/null || fail "python3 is required"

python3 "$repo_root/charts/hydra/generate_clients.py" --check

# Render every chart participating in the consent-broker deployment contract.
for environment in production staging; do
  helm lint "$repo_root/charts/rowboat-api" \
    -f "$repo_root/charts/rowboat-api/values-$environment.yaml" >/dev/null
  helm template rowboat-api "$repo_root/charts/rowboat-api" \
    -f "$repo_root/charts/rowboat-api/values-$environment.yaml" \
    >"$tmp_dir/rowboat-api-$environment.yaml"

  helm lint "$repo_root/charts/oauth-consent" \
    -f "$repo_root/charts/oauth-consent/values-$environment.yaml" >/dev/null
  helm template oauth-consent "$repo_root/charts/oauth-consent" \
    -f "$repo_root/charts/oauth-consent/values-$environment.yaml" \
    >"$tmp_dir/oauth-consent-$environment.yaml"
done

helm repo add ory https://k8s.ory.sh/helm/charts --force-update >/dev/null
helm template hydra ory/hydra --version 0.55.0 \
  -f "$repo_root/charts/hydra/values-production.yaml" \
  >"$tmp_dir/hydra-production.yaml"
helm template hydra ory/hydra --version 0.55.0 \
  -f "$repo_root/charts/hydra/values-staging.yaml" \
  >"$tmp_dir/hydra-staging.yaml"

REPO_ROOT="$repo_root" TMP_DIR="$tmp_dir" python3 - <<'PY'
import json
import os
import re
from pathlib import Path

root = Path(os.environ["REPO_ROOT"])
tmp = Path(os.environ["TMP_DIR"])
registry = json.loads((root / "apps/rowboat-api/internal/connectors/default_connectors.json").read_text())
verifiers = json.loads((root / "charts/hydra/contracts/product-resource-servers.json").read_text())

def rendered_value(path, key):
    matches = re.findall(rf'^\s*{re.escape(key)}:\s*["\']?([^"\'\n]+)["\']?\s*$', path.read_text(), re.M)
    assert len(matches) == 1, (path, key, matches)
    return matches[0].strip()

def chart_value(path, key):
    matches = re.findall(rf'^\s*{re.escape(key)}:\s*([^#\n]+?)\s*$', path.read_text(), re.M)
    assert len(matches) == 1, (path, key, matches)
    return matches[0].strip().strip('"\'')

def enabled(item, environment):
    return item.get("status", "enabled") != "disabled" and (
        not item.get("environments") or environment in item["environments"]
    )

for environment in ("production", "staging"):
    values = root / f"charts/rowboat-api/values-{environment}.yaml"
    rendered = tmp / f"rowboat-api-{environment}.yaml"
    public_base = chart_value(values, "PUBLIC_BASE_URL").rstrip("/")
    client_id = chart_value(values, "ORY_BROKER_CLIENT_ID")
    assert rendered_value(rendered, "PUBLIC_BASE_URL") == public_base
    contract = verifiers["environments"][environment]
    assert contract["issuer"] == public_base
    assert contract["jwksUrl"] == public_base + "/.well-known/connector-jwks.json"
    assert contract["allowedAlgorithms"] == ["RS256"]

    expected_products = []
    expected_callbacks = []
    expected_scopes = ["openid", "offline_access"]
    expected_audiences = []
    for connector in registry:
        if connector.get("authType") != "oauth" or not enabled(connector, environment):
            continue
        scopes = [s["name"] for s in connector.get("scopes", []) if enabled(s, environment)]
        required_scopes = [
            s["name"] for s in connector.get("scopes", [])
            if enabled(s, environment) and s.get("grantTier") == "required"
        ]
        expected_products.append({
            "connector": connector["name"],
            "audience": connector["audience"],
            "scopes": scopes,
            "requiredScopes": required_scopes,
        })
        expected_callbacks.append(f"{public_base}/v1/connections/{connector['name']}/callback")
        expected_scopes.extend(scopes)
        expected_audiences.append(connector["audience"])
    assert contract["products"] == expected_products

    manifest = (root / f"charts/hydra/clients/connector-broker-{environment}.yaml").read_text()
    assert f"value: {client_id}" in manifest
    assert "hydra update oauth2-client" in manifest and '"$HYDRA_ADMIN_URL/admin/clients"' in manifest
    for callback in expected_callbacks:
        assert f'--redirect-uri "{callback}"' in manifest
    assert f"--scope {','.join(expected_scopes)}" in manifest
    assert f"--audience {','.join(expected_audiences)}" in manifest

# Keep the operator-facing verifier example tied to the checked-in generated contract.
example = {}
for line in (root / "docs/deployment-examples/product-resource-server.env.example").read_text().splitlines():
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        example[key] = value
production = verifiers["environments"]["production"]
canvas = next(product for product in production["products"] if product["connector"] == "canvas")
assert example["OAUTH_ISSUER"] == production["issuer"]
assert example["OAUTH_JWKS_URL"] == production["jwksUrl"]
assert example["OAUTH_AUDIENCE"] == canvas["audience"]
assert example["OAUTH_ALLOWED_ALGORITHMS"] == "RS256"
print("rendered charts, registry, generated clients, and verifier contract agree")
PY

if [[ "${SKIP_DESKTOP_APPROVAL_ADAPTER:-0}" != "1" ]]; then
  command -v pnpm >/dev/null || fail "pnpm is required for the packaged desktop adapter"
  pnpm --dir "$repo_root/apps/x" --filter @x/shared build >/dev/null
  pnpm --dir "$repo_root/apps/x" --filter @x/core build >/dev/null
  node "$repo_root/charts/hydra/tests/desktop-approval-headless.mjs"
fi

if [[ "${SKIP_REAL_HYDRA_FIXTURE:-0}" != "1" ]]; then
  command -v docker >/dev/null || fail "docker is required for the real Hydra v2 fixture"
  docker info >/dev/null 2>&1 || fail "docker daemon is unavailable"
  if ! docker run -d --name "$hydra_container" \
    -p 127.0.0.1:4444:4444 \
    -p 127.0.0.1:4445:4445 \
    -e DSN=memory \
    -e SECRETS_SYSTEM=deployment-contract-system-secret-32-bytes \
    -e SECRETS_COOKIE=deployment-contract-cookie-secret-32-bytes \
    -e URLS_SELF_ISSUER=http://127.0.0.1:4444 \
    -e URLS_LOGIN=http://desktop.invalid/login \
    -e URLS_CONSENT=http://desktop.invalid/consent \
    oryd/hydra:v2.2.0 serve all --dev >/dev/null; then
    fail "could not start Hydra fixture, ensure ports 4444 and 4445 are free"
  fi
  ready=0
  for _ in $(seq 1 60); do
    if curl --fail --silent http://127.0.0.1:4445/health/ready >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "$ready" != "1" ]]; then
    docker logs "$hydra_container" >&2
    fail "Hydra fixture did not become ready"
  fi

  awk '
    found { sub(/^              /, ""); print }
    /^            - \|$/ { found=1 }
  ' "$repo_root/charts/hydra/clients/connector-broker-production.yaml" \
    >"$tmp_dir/reconcile-broker.sh"

  for _ in 1 2; do
    docker exec -i \
      -e HYDRA_ADMIN_URL=http://127.0.0.1:4445 \
      -e BROKER_CLIENT_ID=solomon-connector-broker \
      -e BROKER_CLIENT_SECRET=deployment-contract-secret \
      "$hydra_container" /bin/sh <"$tmp_dir/reconcile-broker.sh"
  done
  HYDRA_PUBLIC_URL=http://127.0.0.1:4444 \
  HYDRA_ADMIN_URL=http://127.0.0.1:4445 \
  BROKER_CLIENT_SECRET=deployment-contract-secret \
    python3 "$repo_root/charts/hydra/tests/hydra_authorization.py"
fi

printf 'connector deployment contract acceptance passed\n'
