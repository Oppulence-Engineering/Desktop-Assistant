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
python3 "$repo_root/charts/hydra/tests/product-approval.test.py"
approval_digest="$(python3 "$repo_root/charts/hydra/product_approval.py" \
  --registry "$repo_root/apps/rowboat-api/internal/connectors/default_connectors.json")"
configured_approval_digest="$(awk '$1 == "productionApprovalManifestDigest:" {print $2; exit}' \
  "$repo_root/charts/rowboat-api/values-production.yaml")"
[[ "$configured_approval_digest" == "$approval_digest" ]] ||
  fail "production approval manifest digest drift: configured $configured_approval_digest, computed $approval_digest"

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
assert_render_fails "rowboat-api production without approval evidence digest" \
  helm template rowboat-api "$repo_root/charts/rowboat-api" \
    -f "$repo_root/charts/rowboat-api/values-production.yaml" \
    --set-string connectorBroker.productionApprovalManifestDigest=
assert_render_fails "rowboat-api production with malformed approval evidence digest" \
  helm template rowboat-api "$repo_root/charts/rowboat-api" \
    -f "$repo_root/charts/rowboat-api/values-production.yaml" \
    --set-string connectorBroker.productionApprovalManifestDigest=sha256:not-approved

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

  helm lint "$repo_root/charts/rowboat-www" \
    -f "$repo_root/charts/rowboat-www/values-$environment.yaml" >/dev/null
  helm template rowboat-www "$repo_root/charts/rowboat-www" \
    -f "$repo_root/charts/rowboat-www/values-$environment.yaml" \
    >"$tmp_dir/rowboat-www-$environment.yaml"

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

REPO_ROOT="$repo_root" TMP_DIR="$tmp_dir" APPROVAL_DIGEST="$approval_digest" python3 - <<'PY'
import json
import os
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

root = Path(os.environ["REPO_ROOT"])
tmp = Path(os.environ["TMP_DIR"])
registry = json.loads((root / "apps/rowboat-api/internal/connectors/default_connectors.json").read_text())
verifiers = json.loads((root / "charts/hydra/contracts/product-resource-servers.json").read_text())
assert verifiers["productionApprovalManifestDigest"] == os.environ["APPROVAL_DIGEST"]

def rendered_value(path, key):
    matches = re.findall(rf'^\s*{re.escape(key)}:\s*["\']?([^"\'\n]+)["\']?\s*$', path.read_text(), re.M)
    assert len(matches) == 1, (path, key, matches)
    return matches[0].strip()

def rendered_consistent_value(path, key):
    matches = [
        match.strip()
        for match in re.findall(
            rf'^\s*{re.escape(key)}:\s*["\']?([^"\'\n]+)["\']?\s*$',
            path.read_text(),
            re.M,
        )
        if match.strip().startswith("https://")
    ]
    assert matches and len(set(matches)) == 1, (path, key, matches)
    return matches[0]

def chart_value(path, key):
    matches = re.findall(rf'^\s*{re.escape(key)}:\s*([^#\n]+?)\s*$', path.read_text(), re.M)
    assert len(matches) == 1, (path, key, matches)
    return matches[0].strip().strip('"\'')

def rendered_hosts(path):
    hosts = {
        match.strip()
        for match in re.findall(r'^\s*(?:-\s*)?host:\s*["\']?([^"\'\s]+)', path.read_text(), re.M)
    }
    assert hosts, path
    return hosts

def rendered_ingress_origin(path):
    hosts = rendered_hosts(path)
    assert len(hosts) == 1, (path, hosts)
    return "https://" + next(iter(hosts))

def source_constant(path, name):
    match = re.search(
        rf'^export const {re.escape(name)}\s*=\s*["\']([^"\']+)["\'];$',
        path.read_text(),
        re.M,
    )
    assert match, (path, name)
    return match.group(1)

def origin_host(origin):
    parsed = urlparse(origin)
    assert parsed.scheme == "https" and parsed.hostname and not parsed.path.rstrip("/"), origin
    return parsed.hostname

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

hosted_oauth_source = root / "apps/rowboat-www/lib/connectors/hosted-oauth.ts"
hosted_start_route = root / "apps/rowboat-www/app/api/connectors/[name]/start/route.ts"
hosted_callback_path = source_constant(hosted_oauth_source, "HOSTED_CONNECTOR_CALLBACK_PATH")
assert "new URL(HOSTED_CONNECTOR_CALLBACK_PATH, origin).toString()" in hosted_start_route.read_text()
expected_hydra_image = "oryd/hydra:v2.3.0"

for environment in ("production", "staging"):
    values = root / f"charts/rowboat-api/values-{environment}.yaml"
    rendered = tmp / f"rowboat-api-{environment}.yaml"
    web_rendered = tmp / f"rowboat-www-{environment}.yaml"
    consent_rendered = tmp / f"oauth-consent-{environment}.yaml"
    hydra_rendered = tmp / f"hydra-{environment}.yaml"
    public_base = chart_value(values, "PUBLIC_BASE_URL").rstrip("/")
    app_url = chart_value(values, "APP_URL").rstrip("/")
    client_id = chart_value(values, "ORY_BROKER_CLIENT_ID")
    assert rendered_value(rendered, "PUBLIC_BASE_URL") == public_base
    assert rendered_value(rendered, "BROKER_TOKEN_ISSUER") == public_base
    assert rendered_value(rendered, "CONNECTOR_OAUTH_LEGACY_STATE_WRITE") == "false"

    web_origin = rendered_value(web_rendered, "ROWBOAT_WWW_PUBLIC_APP_URL").rstrip("/")
    web_api_base = rendered_value(web_rendered, "ROWBOAT_WWW_PUBLIC_API_BASE_URL").rstrip("/")
    web_api_proxy = rendered_value(web_rendered, "ROWBOAT_WWW_API_PROXY_URL").rstrip("/")
    api_ingress_origin = rendered_ingress_origin(rendered)
    web_ingress_origin = rendered_ingress_origin(web_rendered)
    assert web_origin == web_ingress_origin
    assert app_url == web_origin
    assert web_api_base == public_base
    assert web_api_proxy == api_ingress_origin == public_base

    # Mirror the start route's `new URL(HOSTED_CONNECTOR_CALLBACK_PATH, origin)`
    # construction using the rendered canonical web origin and the checked-in
    # callback-path constant. The broker must allow exactly this hosted callback.
    hosted_callback = urljoin(web_origin + "/", hosted_callback_path)
    redirect_allowlist = rendered_value(rendered, "CONNECTOR_REDIRECT_ALLOWLIST").split(",")
    assert redirect_allowlist == [
        "solomon-ai://connection-complete",
        hosted_callback,
    ], redirect_allowlist
    assert web_origin + "/settings/connectors" not in redirect_allowlist

    consent_origin = rendered_ingress_origin(consent_rendered)
    assert rendered_value(consent_rendered, "WORKOS_REDIRECT_URI") == consent_origin + "/callback"
    assert rendered_value(consent_rendered, "WORKOS_STEP_UP_REDIRECT_URI") == consent_origin + "/step-up/callback"
    assert rendered_value(consent_rendered, "ROWBOAT_API_URL").rstrip("/") == public_base

    hydra_origin = rendered_consistent_value(hydra_rendered, "issuer").rstrip("/")
    assert rendered_consistent_value(hydra_rendered, "public").rstrip("/") == hydra_origin
    assert rendered_hosts(hydra_rendered) == {origin_host(hydra_origin)}
    assert rendered_value(rendered, "ORY_PUBLIC_URL").rstrip("/") == hydra_origin
    assert rendered_consistent_value(hydra_rendered, "login") == consent_origin + "/login"
    assert rendered_consistent_value(hydra_rendered, "consent") == consent_origin + "/consent"
    assert rendered_consistent_value(hydra_rendered, "logout") == consent_origin + "/logout"

    if environment == "staging":
        assert rendered_value(rendered, "OIDC_ISSUER_URL").rstrip("/") == hydra_origin
        assert rendered_value(rendered, "TOKEN_ISSUER").rstrip("/") == hydra_origin
        assert rendered_value(rendered, "JWKS_URL") == hydra_origin + "/.well-known/jwks.json"
        canonical_suffix = ".staging.oppulence.io"
        public_origins = [
            web_origin,
            web_api_base,
            web_api_proxy,
            api_ingress_origin,
            public_base,
            hydra_origin,
            consent_origin,
            rendered_value(consent_rendered, "WORKOS_ISSUER").rstrip("/"),
        ]
        assert all(origin_host(origin).endswith(canonical_suffix) for origin in public_origins), public_origins

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
                "authentication": {
                    "methods": ["scoped-service-jwt", "signed-hmac-request"],
                    "requiredJwtScope": "connector:status",
                    "principalConnectorBound": True,
                },
                "requiredBindings": [
                    "jti", "connection_id", "workos_user_id", "organization_id",
                    "connector", "credential_generation", "audience",
                ],
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

    consent = consent_rendered.read_text()
    hydra_policy = (tmp / f"hydra-policy-{environment}.yaml").read_text()
    hydra = hydra_rendered.read_text()
    consent_namespace = "rowboat" if environment == "production" else "rowboat-staging"
    hydra_namespace = "ory" if environment == "production" else "ory-staging"

    # DATABASE_URL is an explicit required Secret key for migration and runtime.
    assert consent.count("key: DATABASE_URL") == 2
    assert consent.count('networking.rowboat.dev/hydra-admin-access: "true"') == 1

    # oauth-consent reaches Hydra Admin only through namespace AND pod selectors.
    assert consent.count("port: 4445") == 1
    assert "kubernetes.io/metadata.name: ingress-nginx" in consent
    assert "app.kubernetes.io/name: ingress-nginx" in consent
    assert "kubernetes.io/metadata.name: kube-system" in consent
    assert "k8s-app: kube-dns" in consent
    assert "kubernetes.io/metadata.name: egress-system" in consent
    assert "app.kubernetes.io/name: rowboat-egress-gateway" in consent
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
    hydra_images = re.findall(r'^\s*image:\s*["\']?(oryd/hydra:[^"\'\s]+)', hydra, re.M)
    assert len(hydra_images) >= 2, hydra_images
    assert set(hydra_images) == {expected_hydra_image}, hydra_images

    rowboat = rendered.read_text()
    if environment == "production":
        assert "kubernetes.io/metadata.name: ingress-nginx" in rowboat
        assert "app.kubernetes.io/name: ingress-nginx" in rowboat
        assert "kubernetes.io/metadata.name: egress-system" in rowboat
        assert "app.kubernetes.io/name: rowboat-egress-gateway" in rowboat
        assert "kubernetes.io/metadata.name: ory" in rowboat
        assert "port: 4445" in rowboat
        assert "port: 5432" in rowboat
        assert "port: 6379" in rowboat
        assert "0.0.0.0/0" not in rowboat

for client_manifest in (
    root / "charts/hydra/clients/connector-broker-production.yaml",
    root / "charts/hydra/clients/connector-broker-staging.yaml",
    root / "charts/hydra/clients/rowboat-desktop.yaml",
    root / "charts/hydra/clients/rowboat-desktop-staging.yaml",
):
    images = re.findall(r'^\s*image:\s*([^\s]+)', client_manifest.read_text(), re.M)
    assert images == [expected_hydra_image], (client_manifest, images)

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
  reconciler_image="$(awk '$1 == "image:" && $2 ~ /^oryd\/hydra:/ { print $2; exit }' \
    "$repo_root/charts/hydra/clients/connector-broker-production.yaml")"
  [[ -n "$reconciler_image" ]] || fail "rendered connector reconciler image is missing"
  if ! docker run -d --name "$hydra_container" \
    -p 127.0.0.1:4444:4444 \
    -p 127.0.0.1:4445:4445 \
    -e DSN=memory \
    -e SECRETS_SYSTEM=deployment-contract-system-secret-32-bytes \
    -e SECRETS_COOKIE=deployment-contract-cookie-secret-32-bytes \
    -e URLS_SELF_ISSUER=http://127.0.0.1:4444 \
    -e URLS_LOGIN=http://desktop.invalid/login \
    -e URLS_CONSENT=http://desktop.invalid/consent \
    "$reconciler_image" serve all --dev >/dev/null; then
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
