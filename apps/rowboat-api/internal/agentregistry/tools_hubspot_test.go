package agentregistry

import (
	"context"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

func TestHubSpotCapabilitiesRegisteredWithApprovalTiers(t *testing.T) {
	catalog := DefaultCatalog()
	tests := []struct {
		name string
		tier string
	}{
		{name: "connector.read.hubspot_search", tier: TierRead},
		{name: "connector.write.hubspot_note", tier: TierAct},
		{name: "connector.write.hubspot_task", tier: TierAct},
	}
	for _, tt := range tests {
		capability, ok := catalog.Get(tt.name)
		if !ok {
			t.Fatalf("missing capability %q", tt.name)
		}
		if capability.TrustTier != tt.tier {
			t.Fatalf("%s tier = %q, want %q", tt.name, capability.TrustTier, tt.tier)
		}
		tool := capability.Build(ToolDeps{})
		result, err := tool.Invoke(context.Background(), backgroundtaskruntime.ToolScope{}, nil)
		if err != nil || !strings.Contains(string(result), "not configured") {
			t.Fatalf("%s unavailable result=%s err=%v", tt.name, result, err)
		}
	}
}
