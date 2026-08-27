package main

import (
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
)

const workerAuthoritativeRegistry = `[{
  "name":"canvas",
  "displayName":"Canvas",
  "description":"Canvas",
  "mcpUrls":{"development":"https://canvas.dev.example/mcp","staging":"https://canvas.staging.example/mcp","production":"https://canvas.example/mcp"},
  "authType":"api_key",
  "audiences":{"development":"canvas-dev-api","staging":"canvas-staging-api","production":"canvas-api"},
  "authoritativeEntitlementRequired":true,
  "environments":["development","staging","production"],
  "scopes":[{"name":"canvas:invoices.read","displayName":"Read invoices","description":"Read invoices","grantTier":"required","risk":"low"}],
  "mcpTools":[{"name":"invoice.lookup","trustTier":"read"}]
}]`

func TestLoadWorkerConnectorRegistryFailsClosedWithoutAuthoritativeTransport(t *testing.T) {
	for _, environment := range []string{"staging", "production"} {
		t.Run(environment, func(t *testing.T) {
			_, err := loadWorkerConnectorRegistry(appconfig.Config{
				Environment:    environment,
				ConnectorsJSON: workerAuthoritativeRegistry,
			})
			if err == nil || !strings.Contains(err.Error(), "requires authoritative product entitlement URL and signing key") {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestLoadWorkerConnectorRegistryAppliesEmergencyDisableBeforeEntitlementRequirement(t *testing.T) {
	registry, err := loadWorkerConnectorRegistry(appconfig.Config{
		Environment:                "production",
		ConnectorsJSON:             workerAuthoritativeRegistry,
		ConnectorEmergencyDisabled: []string{"canvas"},
	})
	if err != nil {
		t.Fatalf("load registry: %v", err)
	}
	if registry.Enabled("canvas") || registry.EffectiveStatus("canvas") != "disabled" {
		t.Fatal("worker registry did not apply the emergency disable")
	}
}

func TestLoadWorkerConnectorRegistryConfiguresAuthoritativeTransport(t *testing.T) {
	registry, err := loadWorkerConnectorRegistry(appconfig.Config{
		Environment:                      "production",
		ConnectorsJSON:                   workerAuthoritativeRegistry,
		ConnectorEntitlementURLsJSON:     `{"canvas":"https://product.example/v1/entitlements/canvas"}`,
		ConnectorEntitlementHMACKeysJSON: `{"canvas":"01234567890123456789012345678901"}`,
	})
	if err != nil {
		t.Fatalf("load registry: %v", err)
	}
	if !registry.Enabled("canvas") {
		t.Fatal("configured authoritative connector is not enabled")
	}
}
