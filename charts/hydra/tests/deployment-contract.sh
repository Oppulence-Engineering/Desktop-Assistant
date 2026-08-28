#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmp_dir="$(mktemp -d)"
hydra_container="connector-contract-hydra-${RANDOM}"
hydra_started=0
cleanup() {
  if [[ "$hydra_started" == "1" ]]; then
    docker rm -f "$hydra_container" >/dev/null 2>&1 || true
  fi
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

assert_render_fails() {
  local description=$1
  shift
  if "$@" >"$tmp_dir/unexpected-render.out" 2>"$tmp_dir/expected-render-error.out"; then
    fail "$description unexpectedly rendered"
  fi
}

# Environment overlays deliberately omit database CIDRs. A deployer-owned values
# file must supply them, and the former example /32 must never render.
assert_render_fails "oauth-consent production without PostgreSQL CIDR" \
  helm template oauth-consent "$repo_root/charts/oauth-consent" \
    -f "$repo_root/charts/oauth-consent/values-production.yaml"
assert_render_fails "oauth-consent production with placeholder PostgreSQL CIDR" \
  helm template oauth-consent "$repo_root/charts/oauth-consent" \
    -f "$repo_root/charts/oauth-consent/values-production.yaml" \
    --set-string 'networkPolicy.postgresql.cidrs[0]=10.0.0.10/32'
assert_render_fails "Hydra policy production without PostgreSQL CIDR" \
  helm template hydra-policy "$repo_root/charts/hydra/network-policy" \
    -f "$repo_root/charts/hydra/network-policy/values-production.yaml"

# Render every chart participating in the consent-broker deployment contract.
for environment in production staging; do
  consent_postgres_cidr="192.0.2.25/32"
  hydra_postgres_cidr="192.0.2.30/32"
  if [[ "$environment" == "production" ]]; then
    consent_namespace="rowboat"
    hydra_namespace="ory"
  else
    consent_namespace="rowboat-staging"
    hydra_namespace="ory-staging"
  fi
  helm lint "$repo_root/charts/rowboat-api" \
    -f "$repo_root/charts/rowboat-api/values-$environment.yaml" >/dev/null
  helm template rowboat-api "$repo_root/charts/rowboat-api" \
    -f "$repo_root/charts/rowboat-api/values-$environment.yaml" \
    >"$tmp_dir/rowboat-api-$environment.yaml"

  helm lint "$repo_root/charts/oauth-consent" \
    -f "$repo_root/charts/oauth-consent/values-$environment.yaml" \
    --set-string "networkPolicy.postgresql.cidrs[0]=$consent_postgres_cidr" >/dev/null
  helm template oauth-consent "$repo_root/charts/oauth-consent" \
    --namespace "$consent_namespace" \
    -f "$repo_root/charts/oauth-consent/values-$environment.yaml" \
    --set-string "networkPolicy.postgresql.cidrs[0]=$consent_postgres_cidr" \
    >"$tmp_dir/oauth-consent-$environment.yaml"

  helm lint "$repo_root/charts/hydra/network-policy" \
    -f "$repo_root/charts/hydra/network-policy/values-$environment.yaml" \
    --set-string "egress.postgresql.cidrs[0]=$hydra_postgres_cidr" >/dev/null
  helm template hydra-policy "$repo_root/charts/hydra/network-policy" \
    --namespace "$hydra_namespace" \
    -f "$repo_root/charts/hydra/network-policy/values-$environment.yaml" \
    --set-string "egress.postgresql.cidrs[0]=$hydra_postgres_cidr" \
    >"$tmp_dir/hydra-policy-$environment.yaml"
done

helm repo add ory https://k8s.ory.sh/helm/charts --force-update >/dev/null
helm template hydra ory/hydra --version 0.55.0 \
  --namespace ory \
  -f "$repo_root/charts/hydra/values-production.yaml" \
  >"$tmp_dir/hydra-production.yaml"
helm template hydra ory/hydra --version 0.55.0 \
  --namespace ory-staging \
  -f "$repo_root/charts/hydra/values-staging.yaml" \
  >"$tmp_dir/hydra-staging.yaml"

REPO_ROOT="$repo_root" TMP_DIR="$tmp_dir" python3 - <<'PY'
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse

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

def binding(item, field, environment):
    values = item.get(field)
    assert isinstance(values, dict), (item.get("name"), field, values)
    value = values.get(environment)
    assert isinstance(value, str) and value, (item.get("name"), field, environment)
    return value

for environment in ("production", "staging"):
    values = root / f"charts/rowboat-api/values-{environment}.yaml"
    rendered = tmp / f"rowboat-api-{environment}.yaml"
    public_base = chart_value(values, "PUBLIC_BASE_URL").rstrip("/")
    client_id = chart_value(values, "ORY_BROKER_CLIENT_ID")
    assert rendered_value(rendered, "PUBLIC_BASE_URL") == public_base
    assert rendered_value(rendered, "CONNECTOR_OAUTH_LEGACY_STATE_WRITE") == "false"
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
            "mcpUrl": binding(connector, "mcpUrls", environment),
            "audience": binding(connector, "audiences", environment),
            "scopes": scopes,
            "requiredScopes": required_scopes,
            "connectionStatusValidation": {
                "mode": "live",
                "endpoint": public_base + "/v1/internal/connections/status",
                "checkTiming": "every-request",
                "failurePolicy": "deny",
                "disconnectEnforcement": "immediate",
            },
        })
        expected_callbacks.append(f"{public_base}/v1/connections/{connector['name']}/callback")
        expected_scopes.extend(scopes)
        expected_audiences.append(binding(connector, "audiences", environment))
    assert contract["products"] == expected_products

    manifest = (root / f"charts/hydra/clients/connector-broker-{environment}.yaml").read_text()
    assert f"value: {client_id}" in manifest
    assert "hydra update oauth2-client" in manifest and '"$HYDRA_ADMIN_URL/admin/clients"' in manifest
    for callback in expected_callbacks:
        assert f'--redirect-uri "{callback}"' in manifest
    assert f"--scope {','.join(expected_scopes)}" in manifest
    assert f"--audience {','.join(expected_audiences)}" in manifest
    assert "app.kubernetes.io/component: hydra-client-reconciler" in manifest
    assert 'networking.rowboat.dev/hydra-admin-access: "true"' in manifest

    consent = (tmp / f"oauth-consent-{environment}.yaml").read_text()
    hydra_policy = (tmp / f"hydra-policy-{environment}.yaml").read_text()
    hydra = (tmp / f"hydra-{environment}.yaml").read_text()
    consent_namespace = "rowboat" if environment == "production" else "rowboat-staging"
    hydra_namespace = "ory" if environment == "production" else "ory-staging"

    # DATABASE_URL is an explicit required Secret key for migration and runtime.
    assert consent.count("key: DATABASE_URL") == 2
    assert consent.count('networking.rowboat.dev/hydra-admin-access: "true"') == 1

    # oauth-consent reaches Hydra Admin only through namespace AND pod selectors.
    assert consent.count("port: 4445") == 1
    assert f"kubernetes.io/metadata.name: {hydra_namespace}" in consent
    assert "app.kubernetes.io/name: hydra" in consent
    assert "app.kubernetes.io/instance: hydra" in consent
    assert "192.0.2.25/32" in consent

    # Hydra is default-deny. Admin 4445 has one allow rule with exactly the two
    # labeled peer classes: oauth-consent and same-namespace reconcilers.
    assert hydra_policy.count("kind: NetworkPolicy") == 4
    assert "-default-deny" in hydra_policy
    assert hydra_policy.count("port: 4445") == 1
    assert f"kubernetes.io/metadata.name: {consent_namespace}" in hydra_policy
    assert f"kubernetes.io/metadata.name: {hydra_namespace}" in hydra_policy
    assert "app.kubernetes.io/component: oauth-consent" in hydra_policy
    assert "app.kubernetes.io/component: hydra-client-reconciler" in hydra_policy
    assert hydra_policy.count('networking.rowboat.dev/hydra-admin-access: "true"') == 2
    assert "192.0.2.30/32" in hydra_policy
    assert "0.0.0.0/0" not in hydra_policy

    # Upstream Hydra labels match the policy selector. Admin metrics are disabled
    # because the default-deny contract intentionally excludes monitoring pods.
    assert "app.kubernetes.io/name: hydra" in hydra
    assert "app.kubernetes.io/instance: hydra" in hydra
    assert "kind: ServiceMonitor" not in hydra

# Keep the operator-facing verifier example tied to the checked-in generated contract.
example = {}
for line in (root / "docs/deployment-examples/product-resource-server.env.example").read_text().splitlines():
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        example[key] = value
production = verifiers["environments"]["production"]
staging = verifiers["environments"]["staging"]
canvas = next(product for product in production["products"] if product["connector"] == "canvas")
staging_canvas = next(product for product in staging["products"] if product["connector"] == "canvas")
assert example["OAUTH_ISSUER"] == production["issuer"]
assert example["OAUTH_JWKS_URL"] == production["jwksUrl"]
assert example["OAUTH_AUDIENCE"] == canvas["audience"]
assert example["OAUTH_ALLOWED_ALGORITHMS"] == "RS256"

commented_example = {}
for line in (root / "docs/deployment-examples/product-resource-server.env.example").read_text().splitlines():
    if line.startswith("# ") and "=" in line:
        key, value = line[2:].split("=", 1)
        commented_example[key] = value
assert commented_example["OAUTH_ISSUER"] == staging["issuer"]
assert commented_example["OAUTH_JWKS_URL"] == staging["jwksUrl"]
assert commented_example["OAUTH_AUDIENCE"] == staging_canvas["audience"]

production_products = {product["connector"]: product for product in production["products"]}
staging_products = {product["connector"]: product for product in staging["products"]}
assert production_products.keys() == staging_products.keys()
for connector, production_product in production_products.items():
    staging_product = staging_products[connector]
    assert production_product["audience"] != staging_product["audience"], connector
    production_host = urlparse(production_product["mcpUrl"]).hostname.split(".")
    staging_host = urlparse(staging_product["mcpUrl"]).hostname.split(".")
    assert "staging" not in production_host, (connector, production_host)
    assert "staging" in staging_host, (connector, staging_host)
    assert production_host != staging_host, connector
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
  hydra_started=1
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
