#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
chart="$repo_root/charts/rowboat-api"
verifier_example="$repo_root/docs/deployment-examples/product-resource-server.env.example"
verifier_contract="$repo_root/charts/hydra/contracts/product-resource-servers.json"
registry="$repo_root/apps/rowboat-api/internal/connectors/default_connectors.json"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
  printf 'deployment contract test failed: %s\n' "$*" >&2
  exit 1
}

config_value() {
  local manifest="$1"
  local key="$2"
  awk -v key="$key" '$1 == key ":" { value=$2; gsub(/^"|"$/, "", value); print value; exit }' "$manifest"
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  [[ "$actual" == "$expected" ]] || fail "$label: expected $expected, got $actual"
}

render_environment() {
  local environment="$1"
  local manifest="$tmp_dir/$environment.yaml"
  helm template rowboat-api "$chart" -f "$chart/values-$environment.yaml" >"$manifest"

  local public_origin broker_issuer
  public_origin="$(config_value "$manifest" PUBLIC_BASE_URL)"
  broker_issuer="$(config_value "$manifest" BROKER_TOKEN_ISSUER)"
  [[ -n "$public_origin" ]] || fail "$environment PUBLIC_BASE_URL is absent from the rendered ConfigMap"
  [[ -n "$broker_issuer" ]] || fail "$environment BROKER_TOKEN_ISSUER is absent from the rendered ConfigMap"
  assert_equal "$broker_issuer" "$public_origin" "$environment broker issuer"
	assert_equal \
	  "$(config_value "$manifest" CONNECTOR_OAUTH_LEGACY_STATE_WRITE)" \
	  "false" \
	  "$environment hash-only OAuth state closure switch"
}

helm lint "$chart" -f "$chart/values-production.yaml" >/dev/null
python3 "$repo_root/charts/hydra/tests/product-approval.test.py"
approval_digest="$(python3 "$repo_root/charts/hydra/product_approval.py" --registry "$registry")"
configured_approval_digest="$(awk '$1 == "productionApprovalManifestDigest:" {print $2; exit}' "$chart/values-production.yaml")"
assert_equal "$configured_approval_digest" "$approval_digest" "production approval manifest digest"
render_environment production
render_environment staging

if helm template rowboat-api "$chart" \
  -f "$chart/values-production.yaml" \
  --set-string connectorBroker.productionApprovalManifestDigest= \
  >"$tmp_dir/missing-approval.yaml" 2>"$tmp_dir/missing-approval.err"; then
  fail "production render accepted a missing product approval manifest digest"
fi
grep -q 'production connectorBroker.productionApprovalManifestDigest is required' "$tmp_dir/missing-approval.err" ||
  fail "missing product approval digest did not report the deployment-contract error"

if helm template rowboat-api "$chart" \
  -f "$chart/values-production.yaml" \
  --set-string connectorBroker.productionApprovalManifestDigest=sha256:not-approved \
  >"$tmp_dir/invalid-approval.yaml" 2>"$tmp_dir/invalid-approval.err"; then
  fail "production render accepted a malformed product approval manifest digest"
fi
grep -q 'production connectorBroker.productionApprovalManifestDigest must be a sha256 digest' "$tmp_dir/invalid-approval.err" ||
  fail "malformed product approval digest did not report the deployment-contract error"

if helm template rowboat-api "$chart" \
  -f "$chart/values-production.yaml" \
  --set-string config.BROKER_TOKEN_ISSUER=https://issuer.example.com \
  >"$tmp_dir/mismatch.yaml" 2>"$tmp_dir/mismatch.err"; then
  fail "production render accepted a broker issuer different from PUBLIC_BASE_URL"
fi
grep -q 'BROKER_TOKEN_ISSUER.*must equal config.PUBLIC_BASE_URL' "$tmp_dir/mismatch.err" ||
  fail "production issuer mismatch did not report the deployment-contract error"

helm template rowboat-api "$chart" \
  -f "$chart/values-production.yaml" \
  --set-string config.BROKER_TOKEN_ISSUER=https://issuer.example.com \
  --set connectorBroker.allowSeparateIssuer=true \
  >"$tmp_dir/separate-issuer.yaml"
assert_equal \
  "$(config_value "$tmp_dir/separate-issuer.yaml" BROKER_TOKEN_ISSUER)" \
  "https://issuer.example.com" \
  "explicit separate broker issuer"

if helm template rowboat-api "$chart" \
  -f "$chart/values-production.yaml" \
  --set-string config.PUBLIC_BASE_URL=https://api-drift.oppulence.io \
  --set-string config.BROKER_TOKEN_ISSUER=https://api-drift.oppulence.io \
  >"$tmp_dir/ingress-mismatch.yaml" 2>"$tmp_dir/ingress-mismatch.err"; then
  fail "production render accepted PUBLIC_BASE_URL different from the TLS ingress origin"
fi
grep -q 'PUBLIC_BASE_URL.*must equal the externally reachable ingress origin' "$tmp_dir/ingress-mismatch.err" ||
  fail "production ingress mismatch did not report the deployment-contract error"

# Probe the documented product verifier inputs without making a network request.
# The issuer must match the rendered production broker issuer, and the direct JWKS
# URL must be the connector key set on the externally reachable rowboat-api origin.
# shellcheck disable=SC1090
source "$verifier_example"
production_manifest="$tmp_dir/production.yaml"
production_origin="$(config_value "$production_manifest" PUBLIC_BASE_URL)"
production_issuer="$(config_value "$production_manifest" BROKER_TOKEN_ISSUER)"
assert_equal "$OAUTH_ISSUER" "$production_issuer" "product verifier issuer"
assert_equal "$OAUTH_JWKS_URL" "$production_origin/.well-known/connector-jwks.json" "product verifier JWKS URL"
assert_equal "$OAUTH_ALLOWED_ALGORITHMS" "RS256" "product verifier algorithm policy"
assert_equal "$OAUTH_CONNECTION_VALIDATION_MODE" "live" "product verifier connection validation mode"
assert_equal "$OAUTH_REVOCATION_CHECK_URL" "$production_origin/v1/internal/connections/status" "product verifier connection status URL"
assert_equal "$OAUTH_CONNECTION_STATUS_CHECK" "every-request" "product verifier connection status timing"
assert_equal "$OAUTH_CONNECTION_STATUS_FAILURE_POLICY" "deny" "product verifier connection status failure policy"
assert_equal "$OAUTH_DISCONNECT_ENFORCEMENT" "immediate" "product verifier disconnect enforcement"

staging_documented_issuer="$(sed -n 's/^# OAUTH_ISSUER=//p' "$verifier_example")"
staging_documented_jwks="$(sed -n 's/^# OAUTH_JWKS_URL=//p' "$verifier_example")"
staging_documented_audience="$(sed -n 's/^# OAUTH_AUDIENCE=//p' "$verifier_example")"
staging_manifest="$tmp_dir/staging.yaml"
staging_origin="$(config_value "$staging_manifest" PUBLIC_BASE_URL)"
staging_issuer="$(config_value "$staging_manifest" BROKER_TOKEN_ISSUER)"
assert_equal "$staging_documented_issuer" "$staging_issuer" "staging product verifier issuer"
assert_equal "$staging_documented_jwks" "$staging_origin/.well-known/connector-jwks.json" "staging product verifier JWKS URL"

PRODUCTION_ISSUER="$OAUTH_ISSUER" \
PRODUCTION_JWKS_URL="$OAUTH_JWKS_URL" \
PRODUCTION_AUDIENCE="$OAUTH_AUDIENCE" \
STAGING_ISSUER="$staging_documented_issuer" \
STAGING_JWKS_URL="$staging_documented_jwks" \
STAGING_AUDIENCE="$staging_documented_audience" \
REGISTRY_PATH="$registry" \
VERIFIER_CONTRACT_PATH="$verifier_contract" \
python3 - <<'PY'
import json
import os
from pathlib import Path
from urllib.parse import urlparse

for environment in ("PRODUCTION", "STAGING"):
    issuer = urlparse(os.environ[f"{environment}_ISSUER"])
    jwks = urlparse(os.environ[f"{environment}_JWKS_URL"])
    assert issuer.scheme == "https" and issuer.netloc and issuer.path in ("", "/")
    assert (jwks.scheme, jwks.netloc) == (issuer.scheme, issuer.netloc)
    assert jwks.path == "/.well-known/connector-jwks.json"
    assert not issuer.params and not issuer.query and not issuer.fragment
    assert not jwks.params and not jwks.query and not jwks.fragment

registry = json.loads(Path(os.environ["REGISTRY_PATH"]).read_text())
verifiers = json.loads(Path(os.environ["VERIFIER_CONTRACT_PATH"]).read_text())["environments"]
production_products = {item["connector"]: item for item in verifiers["production"]["products"]}
staging_products = {item["connector"]: item for item in verifiers["staging"]["products"]}
assert production_products.keys() == staging_products.keys()
assert production_products["canvas"]["audience"] == os.environ["PRODUCTION_AUDIENCE"]
assert staging_products["canvas"]["audience"] == os.environ["STAGING_AUDIENCE"]

for connector in registry:
    if connector.get("authType") != "oauth" or connector.get("status", "enabled") == "disabled":
        continue
    name = connector["name"]
    production = production_products[name]
    staging = staging_products[name]
    assert production["audience"] == connector["audiences"]["production"]
    assert staging["audience"] == connector["audiences"]["staging"]
    assert production["audience"] != staging["audience"]
    assert production["mcpUrl"] == connector["mcpUrls"]["production"]
    assert staging["mcpUrl"] == connector["mcpUrls"]["staging"]
    assert "staging" not in urlparse(production["mcpUrl"]).hostname.split(".")
    assert "staging" in urlparse(staging["mcpUrl"]).hostname.split(".")
    for environment, product in (("production", production), ("staging", staging)):
        connection = product["connectionStatusValidation"]
        expected_issuer = verifiers[environment]["issuer"]
        assert connection == {
            "mode": "live",
            "endpoint": expected_issuer + "/v1/internal/connections/status",
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
        }
PY

printf 'rowboat-api deployment contract and token verifier configuration probe passed\n'
