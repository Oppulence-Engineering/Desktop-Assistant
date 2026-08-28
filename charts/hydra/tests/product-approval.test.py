#!/usr/bin/env python3
from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "charts/hydra"))

from product_approval import approval_manifest_digest, production_policy_hash, validate_production_approvals


class ProductionProductApprovalConformanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = json.loads(
            (ROOT / "apps/rowboat-api/internal/connectors/default_connectors.json").read_text()
        )

    def production_high_impact_fixture(self) -> list[dict[str, object]]:
        registry = copy.deepcopy(self.registry)
        cadence = next(connector for connector in registry if connector["name"] == "cadence")
        scope = next(scope for scope in cadence["scopes"] if scope["name"] == "cadence:payments.execute")
        scope["environments"] = ["development", "staging", "production"]
        return registry

    def test_default_registry_has_no_unapproved_production_high_impact_scope(self) -> None:
        manifest = validate_production_approvals(copy.deepcopy(self.registry))
        self.assertEqual(manifest, [])
        self.assertRegex(approval_manifest_digest(manifest), r"^sha256:[0-9a-f]{64}$")

    def test_enabling_money_moving_scope_without_evidence_fails(self) -> None:
        with self.assertRaisesRegex(ValueError, "require productionApproval evidence"):
            validate_production_approvals(self.production_high_impact_fixture())

    def test_matching_evidence_passes_and_policy_drift_fails(self) -> None:
        registry = self.production_high_impact_fixture()
        cadence = next(connector for connector in registry if connector["name"] == "cadence")
        cadence["productionApproval"] = {
            "decision": "approved",
            "evidenceId": "release-evidence://product-approval/PAY-1234",
            "approver": "production-product-review-board",
            "approvedAt": "2026-08-28T00:00:00Z",
            "policyHash": production_policy_hash(cadence),
            "approvedScopes": ["cadence:payments.execute"],
        }
        self.assertEqual(
            production_policy_hash(cadence),
            "sha256:ee0c878096047a1dfc90c3b97b63a1932a0023d6981053e7e150a357e6dab7ee",
        )
        manifest = validate_production_approvals(registry)
        self.assertEqual([item["connector"] for item in manifest], ["cadence"])

        cadence["mcpUrls"]["production"] = "https://mcp-new.cadence.solomon-ai.co/mcp"
        with self.assertRaisesRegex(ValueError, "policyHash does not match"):
            validate_production_approvals(registry)


if __name__ == "__main__":
    unittest.main()
