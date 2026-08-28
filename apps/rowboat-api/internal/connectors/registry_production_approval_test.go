package connectors

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProductionHighImpactScopesRequireBoundApprovalEvidence(t *testing.T) {
	connector := approvalFixtureConnector()

	t.Run("missing approval fails closed", func(t *testing.T) {
		_, err := loadApprovalFixture(t, connector)
		if err == nil || !strings.Contains(err.Error(), "require productionApproval evidence") {
			t.Fatalf("error = %v, want missing production approval", err)
		}
	})

	resolved := connector
	resolved.MCPURL = connector.MCPURLs["production"]
	resolved.Audience = connector.Audiences["production"]
	resolved.MCPURLs = nil
	resolved.Audiences = nil
	policyHash, err := productionApprovalPolicyHash(resolved)
	if err != nil {
		t.Fatal(err)
	}
	const canonicalPolicyHash = "sha256:5b1cd9b61b5ddf141371c859441d8f4aae016fce3d58d6cd2a820e17306f811e"
	if policyHash != canonicalPolicyHash {
		t.Fatalf("production policy hash = %q, want cross-language fixture %q", policyHash, canonicalPolicyHash)
	}
	connector.ProductionApproval = &ProductionProductApproval{
		Decision:       "approved",
		EvidenceID:     "release-evidence://product-approval/PAY-1234",
		Approver:       "production-product-review-board",
		ApprovedAt:     "2026-08-28T00:00:00Z",
		PolicyHash:     policyHash,
		ApprovedScopes: []string{"product:payments.execute"},
	}

	t.Run("policy drift invalidates approval", func(t *testing.T) {
		drifted := connector
		drifted.ProductionApproval = &ProductionProductApproval{
			Decision:       connector.ProductionApproval.Decision,
			EvidenceID:     connector.ProductionApproval.EvidenceID,
			Approver:       connector.ProductionApproval.Approver,
			ApprovedAt:     connector.ProductionApproval.ApprovedAt,
			PolicyHash:     "sha256:" + strings.Repeat("0", 64),
			ApprovedScopes: append([]string(nil), connector.ProductionApproval.ApprovedScopes...),
		}
		_, err := loadApprovalFixture(t, drifted)
		if err == nil || !strings.Contains(err.Error(), "does not match current production policy") {
			t.Fatalf("error = %v, want policy hash mismatch", err)
		}
	})

	t.Run("matching evidence enables scope without leaking approval", func(t *testing.T) {
		registry, err := loadApprovalFixture(t, connector)
		if err != nil {
			t.Fatal(err)
		}
		got, ok := registry.Get("product")
		if !ok {
			t.Fatal("approved product missing")
		}
		if got.ProductionApproval != nil {
			t.Fatal("deployment approval evidence leaked into runtime/public registry")
		}
		if !approvalContainsString(got.Scopes, "product:payments.execute") {
			t.Fatalf("approved high-impact scope not enabled: %v", got.Scopes)
		}
	})
}

func TestDefaultProductionRegistryHasNoUnapprovedHighImpactScopes(t *testing.T) {
	registry, err := LoadRegistryForEnvironment(nil, "production", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, connector := range registry.List() {
		for _, scope := range registry.AvailableScopes(connector.Name) {
			if scope.Risk == "high" || scope.Risk == "money-moving" {
				t.Fatalf("default production connector %q enabled unapproved high-impact scope %q", connector.Name, scope.Name)
			}
		}
	}
}

func TestProductionApprovalPolicyHashMatchesDeploymentConformanceFixture(t *testing.T) {
	var connectors []Connector
	if err := json.Unmarshal(defaultConnectorsJSON, &connectors); err != nil {
		t.Fatal(err)
	}
	var cadence Connector
	for _, connector := range connectors {
		if connector.Name == "cadence" {
			cadence = connector
			break
		}
	}
	if cadence.Name == "" {
		t.Fatal("cadence fixture missing")
	}
	for i := range cadence.ScopeCatalog {
		if cadence.ScopeCatalog[i].Name == "cadence:payments.execute" {
			cadence.ScopeCatalog[i].Environments = []string{"development", "staging", "production"}
		}
	}
	cadence.Transport = "mcp"
	cadence.MCPURL = cadence.MCPURLs["production"]
	cadence.Audience = cadence.Audiences["production"]
	cadence.MCPURLs = nil
	cadence.Audiences = nil
	want := "sha256:ee0c878096047a1dfc90c3b97b63a1932a0023d6981053e7e150a357e6dab7ee"
	got, err := productionApprovalPolicyHash(cadence)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("Cadence production policy hash = %q, want deployment conformance fixture %q", got, want)
	}
}

func approvalFixtureConnector() Connector {
	return Connector{
		Name:        "product",
		DisplayName: "Product",
		Description: "Production approval fixture",
		MCPURLs: map[string]string{
			"development": "https://product.dev.example/mcp",
			"staging":     "https://product.staging.example/mcp",
			"production":  "https://product.example/mcp",
		},
		Transport: "mcp",
		AuthType:  "oauth",
		Audiences: map[string]string{
			"development": "mcp:product-dev",
			"staging":     "mcp:product-staging",
			"production":  "mcp:product",
		},
		Environments: []string{"development", "staging", "production"},
		ScopeCatalog: []ScopeDefinition{
			{
				Name: "product:records.read", DisplayName: "Read records", Description: "Read records.",
				GrantTier: "required", Risk: "low", Environments: []string{"development", "staging", "production"},
			},
			{
				Name: "product:payments.execute", DisplayName: "Execute payment", Description: "Execute an approved payment.",
				GrantTier: "optional", Risk: "money-moving", StepUpRequired: true, PerInvocationApproval: true,
				Environments: []string{"development", "staging", "production"},
			},
		},
		MCPTools: []MCPToolPolicy{
			{Name: "records.read", TrustTier: "read", RequiredScopes: []string{"product:records.read"}},
			{Name: "payments.execute", TrustTier: "money-moving", RequiredScopes: []string{"product:payments.execute"}},
		},
	}
}

func loadApprovalFixture(t *testing.T, connector Connector) (*Registry, error) {
	t.Helper()
	raw, err := json.Marshal([]Connector{connector})
	if err != nil {
		t.Fatal(err)
	}
	return LoadRegistryForEnvironment(raw, "production", nil)
}

func approvalContainsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
