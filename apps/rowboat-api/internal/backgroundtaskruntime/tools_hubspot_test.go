package backgroundtaskruntime

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestHubSpotWriteAuditUsesEngagementScopes(t *testing.T) {
	tests := []struct {
		name string
		tool Tool
		want []string
	}{
		{
			name: "note",
			tool: NewHubSpotNoteTool(nil, uuid.New()),
			want: []string{"crm.objects.notes.write", "crm.objects.contacts.read"},
		},
		{
			name: "task",
			tool: NewHubSpotTaskTool(nil, uuid.New()),
			want: []string{"crm.objects.tasks.write", "crm.objects.contacts.read"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider, ok := tt.tool.(ToolAuditProvider)
			if !ok {
				t.Fatal("HubSpot tool does not expose audit metadata")
			}
			audit := provider.AuditInfo(json.RawMessage(`{"objectType":"contact"}`))
			if audit.TrustTier != TierAct {
				t.Fatalf("trust tier = %q, want act", audit.TrustTier)
			}
			if len(audit.RequiredScopes) != len(tt.want) {
				t.Fatalf("required scopes = %v, want %v", audit.RequiredScopes, tt.want)
			}
			for i := range tt.want {
				if audit.RequiredScopes[i] != tt.want[i] {
					t.Fatalf("required scopes = %v, want %v", audit.RequiredScopes, tt.want)
				}
			}
		})
	}
}
