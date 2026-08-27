package connectors

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDefaultRegistryResolvesEnvironmentSpecificBindings(t *testing.T) {
	expected := map[string]struct {
		productionURL      string
		stagingURL         string
		productionAudience string
		stagingAudience    string
	}{
		"canvas":     {"https://api.canvas.solomon-ai.co/v1/mcp", "https://api.canvas.staging.solomon-ai.co/v1/mcp", "mcp:canvas", "mcp:canvas-staging"},
		"corinthian": {"https://mcp.corinthian.solomon-ai.co/mcp", "https://mcp.corinthian.staging.solomon-ai.co/mcp", "mcp:corinthian", "mcp:corinthian-staging"},
		"cadence":    {"https://mcp.cadence.solomon-ai.co/mcp", "https://mcp.cadence.staging.solomon-ai.co/mcp", "mcp:cadence", "mcp:cadence-staging"},
		"conduit":    {"https://mcp.conduit.solomon-ai.co/mcp", "https://mcp.conduit.staging.solomon-ai.co/mcp", "mcp:conduit", "mcp:conduit-staging"},
		"eigen":      {"https://mcp.eigen.solomon-ai.co/mcp", "https://mcp.eigen.staging.solomon-ai.co/mcp", "mcp:eigen", "mcp:eigen-staging"},
		"wispr":      {"https://mcp.wispr.solomon-ai.co/mcp", "https://mcp.wispr.staging.solomon-ai.co/mcp", "wispr-api", "wispr-api-staging"},
		"hubspot":    {"", "", "hubspot-api", "hubspot-api-staging"},
		"github":     {"https://mcp.github.solomon-ai.co/mcp", "https://mcp.github.staging.solomon-ai.co/mcp", "github-api", "github-api-staging"},
		"linear":     {"https://mcp.linear.solomon-ai.co/mcp", "https://mcp.linear.staging.solomon-ai.co/mcp", "linear-api", "linear-api-staging"},
		"notion":     {"https://mcp.notion.solomon-ai.co/mcp", "https://mcp.notion.staging.solomon-ai.co/mcp", "notion-api", "notion-api-staging"},
		"stripe":     {"https://mcp.stripe.solomon-ai.co/mcp", "https://mcp.stripe.staging.solomon-ai.co/mcp", "stripe-api", "stripe-api-staging"},
	}

	for _, environment := range []string{"production", "staging"} {
		t.Run(environment, func(t *testing.T) {
			registry, err := LoadRegistryForEnvironment(nil, environment, nil)
			if err != nil {
				t.Fatal(err)
			}
			if len(registry.List()) != len(expected) {
				t.Fatalf("connector count = %d, want %d", len(registry.List()), len(expected))
			}
			for name, want := range expected {
				connector, ok := registry.Get(name)
				if !ok {
					t.Fatalf("missing connector %q", name)
				}
				wantURL, wantAudience := want.productionURL, want.productionAudience
				if environment == "staging" {
					wantURL, wantAudience = want.stagingURL, want.stagingAudience
				}
				if connector.MCPURL != wantURL || connector.Audience != wantAudience {
					t.Fatalf("%s binding = (%q, %q), want (%q, %q)", name, connector.MCPURL, connector.Audience, wantURL, wantAudience)
				}
			}

			rendered, err := json.Marshal(registry.List())
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(rendered), `"mcpUrls"`) || strings.Contains(string(rendered), `"audiences"`) {
				t.Fatalf("public registry leaked unresolved environment maps: %s", rendered)
			}
		})
	}
}

func TestDevelopmentRegistryPreservesLegacyFlatFixtures(t *testing.T) {
	const fixture = `[{"name":"dev","displayName":"Dev","description":"Development fixture","mcpUrl":"https://dev.example/mcp","authType":"api_key","audience":"dev-api","mcpTools":[{"name":"dev.read","trustTier":"read"}]}]`
	registry, err := LoadRegistry([]byte(fixture))
	if err != nil {
		t.Fatal(err)
	}
	connector, ok := registry.Get("dev")
	if !ok || connector.MCPURL != "https://dev.example/mcp" || connector.Audience != "dev-api" {
		t.Fatalf("development fixture changed: %+v", connector)
	}
	if _, err := LoadRegistryForEnvironment([]byte(fixture), "staging", nil); err == nil || !strings.Contains(err.Error(), "explicit environment-specific") {
		t.Fatalf("staging accepted flat development fixture: %v", err)
	}
}

func TestRegistryRejectsCrossEnvironmentBindings(t *testing.T) {
	const valid = `[{"name":"product","displayName":"Product","description":"Product","mcpUrls":{"development":"https://product.example/mcp","staging":"https://product.staging.example/mcp","production":"https://product.example/mcp"},"authType":"oauth","audiences":{"development":"mcp:product","staging":"mcp:product-staging","production":"mcp:product"},"scopes":[{"name":"product:records.read","displayName":"Read","description":"Read","grantTier":"required","risk":"low"}],"mcpTools":[{"name":"record.list","trustTier":"read"}]}]`

	tests := []struct {
		name        string
		registry    string
		environment string
		want        string
	}{
		{
			name:        "production host in staging",
			registry:    strings.Replace(valid, "https://product.staging.example/mcp", "https://product.example/mcp", 1),
			environment: "staging",
			want:        "must be staging-qualified",
		},
		{
			name:        "staging host in production",
			registry:    strings.Replace(valid, `"production":"https://product.example/mcp"`, `"production":"https://product.staging.example/mcp"`, 1),
			environment: "production",
			want:        "must not be staging-qualified",
		},
		{
			name:        "equal production and staging audiences",
			registry:    strings.Replace(valid, `"staging":"mcp:product-staging"`, `"staging":"mcp:product"`, 1),
			environment: "staging",
			want:        "audiences must be distinct",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := LoadRegistryForEnvironment([]byte(test.registry), test.environment, nil)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
		})
	}
}
