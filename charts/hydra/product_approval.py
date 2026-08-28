#!/usr/bin/env python3
"""Reusable production product approval conformance checks for RFC 012."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

HIGH_IMPACT_RISKS = {"high", "money-moving"}
POLICY_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


def enabled_for_environment(item: dict[str, Any], environment: str) -> bool:
    if item.get("status", "enabled") == "disabled":
        return False
    environments = item.get("environments") or []
    return not environments or environment in environments


def production_binding(connector: dict[str, Any], key: str) -> str:
    values = connector.get(key)
    if not isinstance(values, dict):
        raise ValueError(f"connector {connector.get('name')!r} requires {key}.production")
    value = values.get("production")
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"connector {connector.get('name')!r} requires {key}.production")
    return value.strip()


def high_impact_scopes(connector: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        [
            scope
            for scope in connector.get("scopes", [])
            if enabled_for_environment(scope, "production") and scope.get("risk") in HIGH_IMPACT_RISKS
        ],
        key=lambda scope: scope["name"],
    )


def production_policy(connector: dict[str, Any]) -> dict[str, Any]:
    scopes = high_impact_scopes(connector)
    scope_names = {scope["name"] for scope in scopes}
    transport = connector.get("transport", "mcp")
    tools_key = "nativeTools" if transport == "native" else "mcpTools"
    tools = []
    for tool in connector.get(tools_key, []):
        required_scopes = sorted(tool.get("requiredScopes") or [])
        if tool.get("trustTier") not in {"act", "money-moving"} and not scope_names.intersection(required_scopes):
            continue
        tools.append(
            {
                "name": tool["name"],
                "trustTier": tool.get("trustTier", ""),
                "requiredScopes": required_scopes,
            }
        )
    tools.sort(key=lambda tool: tool["name"])
    return {
        "version": 1,
        "connector": connector["name"],
        "transport": transport,
        "audience": production_binding(connector, "audiences"),
        "mcpUrl": "" if transport == "native" else production_binding(connector, "mcpUrls"),
        "scopes": [
            {
                "name": scope["name"],
                "risk": scope["risk"],
                "grantTier": scope["grantTier"],
                "stepUpRequired": bool(scope.get("stepUpRequired", False)),
                "perInvocationApproval": bool(scope.get("perInvocationApproval", False)),
            }
            for scope in scopes
        ],
        "tools": tools,
    }


def production_policy_hash(connector: dict[str, Any]) -> str:
    raw = json.dumps(production_policy(connector), separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def validate_production_approvals(registry: list[dict[str, Any]]) -> list[dict[str, Any]]:
    manifest: list[dict[str, Any]] = []
    for connector in registry:
        if not enabled_for_environment(connector, "production"):
            continue
        scopes = high_impact_scopes(connector)
        approval = connector.get("productionApproval")
        if not scopes:
            if approval is not None:
                raise ValueError(
                    f"connector {connector['name']!r} productionApproval must be absent when no production high-impact scope is enabled"
                )
            continue
        if not isinstance(approval, dict):
            raise ValueError(
                f"connector {connector['name']!r} production high-impact scopes require productionApproval evidence"
            )
        if approval.get("decision") != "approved":
            raise ValueError(f"connector {connector['name']!r} productionApproval.decision must be approved")
        for key in ("evidenceId", "approver", "approvedAt", "policyHash"):
            value = approval.get(key)
            if not isinstance(value, str) or not value.strip() or len(value) > 256:
                raise ValueError(f"connector {connector['name']!r} productionApproval.{key} is invalid")
        try:
            datetime.fromisoformat(approval["approvedAt"].replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError(
                f"connector {connector['name']!r} productionApproval.approvedAt must be RFC3339"
            ) from error
        approved_scopes = sorted(approval.get("approvedScopes") or [])
        expected_scopes = [scope["name"] for scope in scopes]
        if approved_scopes != expected_scopes:
            raise ValueError(
                f"connector {connector['name']!r} approvedScopes {approved_scopes!r} must equal {expected_scopes!r}"
            )
        expected_hash = production_policy_hash(connector)
        if not POLICY_HASH_RE.fullmatch(approval["policyHash"]) or approval["policyHash"] != expected_hash:
            raise ValueError(
                f"connector {connector['name']!r} productionApproval.policyHash does not match {expected_hash}"
            )
        manifest.append(
            {
                "connector": connector["name"],
                "decision": approval["decision"],
                "evidenceId": approval["evidenceId"],
                "approver": approval["approver"],
                "approvedAt": approval["approvedAt"],
                "policyHash": approval["policyHash"],
                "approvedScopes": approved_scopes,
            }
        )
    manifest.sort(key=lambda item: item["connector"])
    return manifest


def approval_manifest_digest(manifest: list[dict[str, Any]]) -> str:
    raw = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def validate_registry_path(path: Path) -> tuple[list[dict[str, Any]], str]:
    registry = json.loads(path.read_text())
    if not isinstance(registry, list):
        raise ValueError("connector registry must contain a JSON array")
    manifest = validate_production_approvals(registry)
    return manifest, approval_manifest_digest(manifest)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--expect-digest")
    parser.add_argument("--print-manifest", action="store_true")
    parser.add_argument("--print-policy-hash", metavar="CONNECTOR")
    args = parser.parse_args()
    if args.print_policy_hash:
        registry = json.loads(args.registry.read_text())
        connector = next(
            (item for item in registry if item.get("name") == args.print_policy_hash),
            None,
        )
        if connector is None:
            raise SystemExit(f"unknown connector: {args.print_policy_hash}")
        print(production_policy_hash(connector))
        return 0
    manifest, digest = validate_registry_path(args.registry)
    if args.expect_digest and args.expect_digest != digest:
        raise SystemExit(f"production approval manifest digest mismatch: expected {args.expect_digest}, computed {digest}")
    if args.print_manifest:
        print(json.dumps({"digest": digest, "approvals": manifest}, indent=2))
    else:
        print(digest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
