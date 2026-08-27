#!/usr/bin/env python3
"""Generate Hydra connector-broker clients and product verifier contracts.

Authoritative inputs:
  * apps/rowboat-api/internal/connectors/default_connectors.json
  * charts/rowboat-api/values-{production,staging}.yaml

The generated Kubernetes Jobs reconcile the confidential Hydra client with
update-or-create semantics. Do not hand-edit generated outputs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = REPO_ROOT / "apps/rowboat-api/internal/connectors/default_connectors.json"
ROWBOAT_VALUES = REPO_ROOT / "charts/rowboat-api"
OUTPUT_DIR = REPO_ROOT / "charts/hydra/clients"
VERIFIER_OUTPUT = REPO_ROOT / "charts/hydra/contracts/product-resource-servers.json"

ENVIRONMENTS = {
    "production": {
        "admin_url": "http://hydra-admin.ory.svc.cluster.local:4445",
        "job_name": "connector-broker-client",
        "secret_name": "rowboat-api-secrets",
    },
    "staging": {
        "admin_url": "http://hydra-admin.ory-staging.svc.cluster.local:4445",
        "job_name": "connector-broker-client-staging",
        "secret_name": "rowboat-api-secrets",
    },
}


def scalar_from_values(path: Path, key: str) -> str:
    pattern = re.compile(rf"^\s*{re.escape(key)}:\s*([^#\n]+?)\s*$")
    matches = []
    for line in path.read_text().splitlines():
        match = pattern.match(line)
        if match:
            matches.append(match.group(1).strip().strip('"\''))
    if len(matches) != 1:
        raise ValueError(f"expected exactly one {key} in {path}, found {len(matches)}")
    return matches[0]


def enabled_for_environment(item: dict[str, Any], environment: str) -> bool:
    if item.get("status", "enabled") == "disabled":
        return False
    environments = item.get("environments") or []
    return not environments or environment in environments


def broker_contract(environment: str, registry: list[dict[str, Any]]) -> dict[str, Any]:
    values_path = ROWBOAT_VALUES / f"values-{environment}.yaml"
    public_base_url = scalar_from_values(values_path, "PUBLIC_BASE_URL").rstrip("/")
    client_id = scalar_from_values(values_path, "ORY_BROKER_CLIENT_ID")

    connectors = []
    scopes = ["openid", "offline_access"]
    audiences = []
    redirect_uris = []
    for connector in registry:
        if connector.get("authType") != "oauth" or not enabled_for_environment(connector, environment):
            continue
        connector_scopes = [
            scope["name"]
            for scope in connector.get("scopes", [])
            if enabled_for_environment(scope, environment)
        ]
        required_scopes = [
            scope["name"]
            for scope in connector.get("scopes", [])
            if enabled_for_environment(scope, environment) and scope.get("grantTier") == "required"
        ]
        name = connector["name"]
        audience = connector["audience"]
        callback = f"{public_base_url}/v1/connections/{name}/callback"
        connectors.append(
            {
                "name": name,
                "audience": audience,
                "scopes": connector_scopes,
                "requiredScopes": required_scopes,
                "callbackUrl": callback,
            }
        )
        scopes.extend(connector_scopes)
        audiences.append(audience)
        redirect_uris.append(callback)

    if not connectors:
        raise ValueError(f"no OAuth connectors enabled for {environment}")
    if len(set(scopes)) != len(scopes):
        raise ValueError(f"duplicate OAuth scope in {environment} connector registry")
    if len(set(audiences)) != len(audiences):
        raise ValueError(f"duplicate OAuth audience in {environment} connector registry")

    return {
        "environment": environment,
        "publicBaseUrl": public_base_url,
        "issuer": public_base_url,
        "jwksUrl": f"{public_base_url}/.well-known/connector-jwks.json",
        "clientId": client_id,
        "scopes": scopes,
        "audiences": audiences,
        "redirectUris": redirect_uris,
        "connectors": connectors,
    }


def update_command(contract: dict[str, Any]) -> str:
    lines = [
        'hydra update oauth2-client "$BROKER_CLIENT_ID" \\',
        '  --endpoint "$HYDRA_ADMIN_URL" \\',
        '  --name "Oppulence Connector Broker" \\',
        "  --grant-type authorization_code,refresh_token \\",
        "  --response-type code \\",
        "  --token-endpoint-auth-method client_secret_basic \\",
        '  --secret "$BROKER_CLIENT_SECRET" \\',
        f"  --scope {','.join(contract['scopes'])} \\",
    ]
    for uri in contract["redirectUris"]:
        lines.append(f'  --redirect-uri "{uri}" \\')
    lines.append(f"  --audience {','.join(contract['audiences'])} >/dev/null")
    return "\n".join(lines)


def create_command(contract: dict[str, Any]) -> str:
    client = {
        "client_id": "$BROKER_CLIENT_ID",
        "client_name": "Oppulence Connector Broker",
        "client_secret": "$BROKER_CLIENT_SECRET",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "client_secret_basic",
        "scope": " ".join(contract["scopes"]),
        "redirect_uris": contract["redirectUris"],
        "audience": contract["audiences"],
        "skip_consent": False,
    }
    payload = json.dumps(client, indent=2)
    return "\n".join(
        [
            'cat > /tmp/connector-broker-client.json <<JSON',
            payload,
            "JSON",
            "wget -qO- \\",
            '  --header "Content-Type: application/json" \\',
            "  --post-file /tmp/connector-broker-client.json \\",
            '  "$HYDRA_ADMIN_URL/admin/clients" >/dev/null',
        ]
    )


def job_manifest(contract: dict[str, Any]) -> str:
    environment = contract["environment"]
    settings = ENVIRONMENTS[environment]
    digest = hashlib.sha256(
        json.dumps(contract, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    script = "\n".join(
        [
            "set -eu",
            'if hydra get oauth2-client "$BROKER_CLIENT_ID" --endpoint "$HYDRA_ADMIN_URL" >/dev/null 2>&1; then',
            '  echo "Updating $BROKER_CLIENT_ID"',
            "  " + update_command(contract).replace("\n", "\n  "),
            "else",
            '  echo "Creating $BROKER_CLIENT_ID"',
            create_command(contract),
            "fi",
            'hydra get oauth2-client "$BROKER_CLIENT_ID" --endpoint "$HYDRA_ADMIN_URL" --format json >/dev/null',
        ]
    )
    indented_script = "\n".join(f"              {line}" for line in script.splitlines())
    environment_label = (
        "\n    app.kubernetes.io/environment: staging" if environment == "staging" else ""
    )
    return f"""# Code generated by charts/hydra/generate_clients.py. DO NOT EDIT.
# Contract SHA-256: {digest}
apiVersion: batch/v1
kind: Job
metadata:
  name: {settings['job_name']}
  labels:
    app.kubernetes.io/name: connector-broker-client
    app.kubernetes.io/part-of: rowboat{environment_label}
  annotations:
    connector-contract.oppulence.dev/sha256: \"{digest}\"
spec:
  backoffLimit: 5
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels:
        app.kubernetes.io/name: connector-broker-client
    spec:
      restartPolicy: OnFailure
      automountServiceAccountToken: false
      containers:
        - name: reconcile-client
          image: oryd/hydra:v2.2.0
          imagePullPolicy: IfNotPresent
          env:
            - name: HYDRA_ADMIN_URL
              value: {settings['admin_url']}
            - name: BROKER_CLIENT_ID
              value: {contract['clientId']}
            - name: BROKER_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: {settings['secret_name']}
                  key: ORY_BROKER_CLIENT_SECRET
          command: [/bin/sh, -c]
          args:
            - |
{indented_script}
"""


def generated_outputs() -> dict[Path, str]:
    registry = json.loads(REGISTRY_PATH.read_text())
    contracts = {
        environment: broker_contract(environment, registry)
        for environment in ENVIRONMENTS
    }
    outputs = {
        OUTPUT_DIR / f"connector-broker-{environment}.yaml": job_manifest(contract)
        for environment, contract in contracts.items()
    }
    verifier = {
        "generatedBy": "charts/hydra/generate_clients.py",
        "registry": str(REGISTRY_PATH.relative_to(REPO_ROOT)),
        "environments": {
            environment: {
                "issuer": contract["issuer"],
                "jwksUrl": contract["jwksUrl"],
                "allowedAlgorithms": ["RS256"],
                "products": [
                    {
                        "connector": connector["name"],
                        "audience": connector["audience"],
                        "scopes": connector["scopes"],
                        "requiredScopes": connector["requiredScopes"],
                    }
                    for connector in contract["connectors"]
                ],
            }
            for environment, contract in contracts.items()
        },
    }
    outputs[VERIFIER_OUTPUT] = json.dumps(verifier, indent=2) + "\n"
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when generated files drift")
    args = parser.parse_args()

    drift = []
    for path, content in generated_outputs().items():
        if args.check:
            if not path.exists() or path.read_text() != content:
                drift.append(str(path.relative_to(REPO_ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            print(path.relative_to(REPO_ROOT))
    if drift:
        print("generated Hydra contract drift:", file=sys.stderr)
        for path in drift:
            print(f"  {path}", file=sys.stderr)
        print("run: python3 charts/hydra/generate_clients.py", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
