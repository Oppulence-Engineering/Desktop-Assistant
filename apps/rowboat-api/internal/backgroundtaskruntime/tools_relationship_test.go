package backgroundtaskruntime

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

func TestRelationshipReadToolIsTenantScoped(t *testing.T) {
	client, owner, ctx := setupDB(t)
	other := client.User.Create().
		SetEmail("other@x.co").
		SetWorkosUserID("user_other").
		SaveX(auth.WithInternal(ctx))
	ownerWorkspace := client.RevenueWorkspace.Create().SetUser(owner).SaveX(ctx)
	otherWorkspace := client.RevenueWorkspace.Create().SetUser(other).SaveX(ctx)
	client.Relationship.Create().
		SetWorkspace(ownerWorkspace).
		SetUser(owner).
		SetKind("company").
		SetDisplayName("Owner Account").
		SaveX(ctx)
	client.Relationship.Create().
		SetWorkspace(otherWorkspace).
		SetUser(other).
		SetKind("company").
		SetDisplayName("Other Tenant Secret").
		SaveX(ctx)

	tool := NewRelationshipReadTool(client, owner.ID)
	out, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"portfolio","limit":100}`))
	if err != nil {
		t.Fatalf("relationship.read: %v", err)
	}
	if !strings.Contains(string(out), "Owner Account") {
		t.Fatalf("owner relationship missing: %s", out)
	}
	if strings.Contains(string(out), "Other Tenant Secret") {
		t.Fatalf("cross-tenant relationship leaked: %s", out)
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: other.ID.String()}, json.RawMessage(`{"view":"portfolio"}`)); err == nil {
		t.Fatal("mismatched workflow scope must be rejected")
	}
}
