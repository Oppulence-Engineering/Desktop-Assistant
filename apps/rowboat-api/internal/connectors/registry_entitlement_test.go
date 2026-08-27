package connectors

import (
	"strings"
	"testing"
)

const authoritativeRegistryFixture = `[
  {
    "name":"product",
    "displayName":"Product",
    "description":"Product connector",
    "mcpUrls":{
      "development":"https://product.example/mcp",
      "staging":"https://product.staging.example/mcp",
      "production":"https://product.example/mcp"
    },
    "authType":"oauth",
    "audiences":{
      "development":"mcp:product",
      "staging":"mcp:product-staging",
      "production":"mcp:product"
    },
    "authoritativeEntitlementRequired":true,
    "scopes":[{"name":"product:records.read","displayName":"Read","description":"Read records","grantTier":"required","risk":"low"}],
    "mcpTools":[{"name":"record.list","trustTier":"read"}],
    "templateBlocks":[{"id":"records","title":"Records","description":"Read records","category":"data","requiredScopes":["product:records.read"],"mcpTools":["record.list"],"trustTier":"read"}]
  }
]`

func TestAuthoritativeEntitlementMetadataFailsClosedOutsideExplicitDevelopmentOverride(t *testing.T) {
	for _, environment := range []string{"staging", "production"} {
		t.Run(environment, func(t *testing.T) {
			registry, err := LoadRegistryForEnvironment([]byte(authoritativeRegistryFixture), environment, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := registry.ConfigureProductEntitlementsJSON("", ""); err == nil || !strings.Contains(err.Error(), "requires authoritative") {
				t.Fatalf("missing authoritative config error = %v", err)
			}
			if err := registry.ConfigureProductEntitlementsJSONWithOptions("", "", ProductEntitlementOptions{AllowLocalDevelopment: true}); err == nil || !strings.Contains(err.Error(), "development-only") {
				t.Fatalf("non-development override error = %v", err)
			}
		})
	}

	development, err := LoadRegistryForEnvironment([]byte(authoritativeRegistryFixture), "development", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := development.ConfigureProductEntitlementsJSON("", ""); err == nil {
		t.Fatal("implicit development fallback was accepted")
	}
	if err := development.ConfigureProductEntitlementsJSONWithOptions("", "", ProductEntitlementOptions{AllowLocalDevelopment: true}); err != nil {
		t.Fatalf("explicit development fallback rejected: %v", err)
	}
}

func TestAuthoritativeEntitlementConfigurationSucceedsWithURLAndKey(t *testing.T) {
	registry, err := LoadRegistryForEnvironment([]byte(authoritativeRegistryFixture), "production", nil)
	if err != nil {
		t.Fatal(err)
	}
	err = registry.ConfigureProductEntitlementsJSON(
		`{"product":"https://product.example/v1/entitlements"}`,
		`{"product":"0123456789abcdef0123456789abcdef"}`,
	)
	if err != nil {
		t.Fatal(err)
	}
	connector, ok := registry.Get("product")
	if !ok || !connector.AuthoritativeEntitlementRequired || connector.EntitlementURL == "" || len(connector.entitlementKey) != 32 || connector.allowPrivateEntitlement {
		t.Fatalf("authoritative product config not enforced: %+v", connector)
	}
}
