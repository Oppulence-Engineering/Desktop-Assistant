package backgroundtaskruntime

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
)

func TestWorkspaceReadToolIsTenantScoped(t *testing.T) {
	client, owner, ctx := setupDB(t)
	internal := auth.WithInternal(ctx)
	workspace := client.RevenueWorkspace.Create().SetUser(owner).SetWorkosOrgID("org_owner").SaveX(internal)
	member := client.User.Create().SetEmail("member@owner.co").SetWorkosUserID("user_member").SaveX(internal)
	client.RevenueWorkspaceMember.Create().SetWorkspace(workspace).SetUser(member).SetRole("viewer").SetStatus("active").SaveX(internal)
	client.WorkspaceFeatureControl.Create().SetWorkspace(workspace).SetUser(owner).
		SetCapability("source_google").SetEnabled(true).SetRolloutStage("beta").SetReasonCode("owner_enabled").SaveX(internal)
	secondWorkspace := client.RevenueWorkspace.Create().SetUser(member).SetWorkosOrgID("org_second").SaveX(internal)
	client.RevenueWorkspaceMember.Create().SetWorkspace(secondWorkspace).SetUser(owner).SetRole("member").SetStatus("active").SaveX(internal)
	other := client.User.Create().SetEmail("other@secret.co").SetWorkosUserID("user_other_workspace").SaveX(internal)
	otherWorkspace := client.RevenueWorkspace.Create().SetUser(other).SetWorkosOrgID("org_other").SaveX(internal)
	client.RevenueWorkspaceMember.Create().SetWorkspace(otherWorkspace).SetUser(other).SetRole("owner").SetStatus("active").SaveX(internal)
	client.WorkspaceFeatureControl.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetCapability("action_gmail").SetEnabled(true).SetRolloutStage("beta").SaveX(internal)
	membershipCount := client.RevenueWorkspaceMember.Query().CountX(internal)

	tool := NewWorkspaceReadTool(client, owner.ID)
	out, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"workspaces"}`))
	if err != nil || !strings.Contains(string(out), "org_owner") || !strings.Contains(string(out), "org_second") || strings.Contains(string(out), "org_other") {
		t.Fatalf("workspace.read workspaces = %s err=%v", out, err)
	}
	if got := client.RevenueWorkspaceMember.Query().CountX(internal); got != membershipCount {
		t.Fatalf("workspace.read backfilled membership: %d -> %d", membershipCount, got)
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"summary"}`)); err == nil {
		t.Fatal("workspace.read selected a default from multiple workspaces")
	}
	out, err = tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"summary","workspaceId":"`+secondWorkspace.ID.String()+`"}`))
	if err != nil || !strings.Contains(string(out), `"organizationId":"org_second"`) || !strings.Contains(string(out), `"role":"member"`) {
		t.Fatalf("workspace.read explicit summary = %s err=%v", out, err)
	}
	for _, check := range []struct {
		view, want string
	}{
		{"summary", `"organizationId":"org_owner"`},
		{"members", `"email":"member@owner.co"`},
		{"features", `"capability":"source_google"`},
	} {
		out, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"`+check.view+`","workspaceId":"`+workspace.ID.String()+`"}`))
		if err != nil || !strings.Contains(string(out), check.want) {
			t.Fatalf("workspace.read %s = %s err=%v", check.view, out, err)
		}
		if strings.Contains(string(out), "other@secret.co") || strings.Contains(string(out), "action_gmail") {
			t.Fatalf("workspace.read %s leaked another tenant: %s", check.view, out)
		}
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: other.ID.String()}, json.RawMessage(`{"view":"summary"}`)); err == nil {
		t.Fatal("workspace.read accepted another workflow owner")
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"summary","workspaceId":"`+otherWorkspace.ID.String()+`"}`)); err == nil {
		t.Fatal("workspace.read accepted another tenant's workspace")
	}
}

func TestWorkspaceReadBillingIsAccountScopedAndReadOnly(t *testing.T) {
	client, owner, ctx := setupDB(t)
	internal := auth.WithInternal(ctx)
	client.Subscription.Create().SetUser(owner).SetSanctionedCredits(100).SaveX(internal)
	client.CreditLedger.Create().SetUser(owner).SetDelta(-30).SetReason("llm_call.final").SetRequestID(uuid.New()).SaveX(internal)
	other := client.User.Create().SetEmail("other@secret.co").SetWorkosUserID("user_other_billing").SaveX(internal)
	client.Subscription.Create().SetUser(other).SetSanctionedCredits(999).SaveX(internal)
	client.CreditLedger.Create().SetUser(other).SetDelta(-500).SetReason("llm_call.final").SetRequestID(uuid.New()).SaveX(internal)
	subscriptionsBefore := client.Subscription.Query().CountX(internal)
	ledgerBefore := client.CreditLedger.Query().CountX(internal)

	tool := NewWorkspaceReadTool(client, owner.ID)
	out, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"billing"}`))
	if err != nil || !strings.Contains(string(out), `"scope":"account"`) || !strings.Contains(string(out), `"availableCredits":70`) || !strings.Contains(string(out), `"usedCredits":30`) || strings.Contains(string(out), "999") {
		t.Fatalf("workspace.read billing = %s err=%v", out, err)
	}
	if client.Subscription.Query().CountX(internal) != subscriptionsBefore || client.CreditLedger.Query().CountX(internal) != ledgerBefore {
		t.Fatal("workspace.read billing mutated billing state")
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: other.ID.String()}, json.RawMessage(`{"view":"billing"}`)); err == nil {
		t.Fatal("workspace.read billing accepted another workflow owner")
	}
	withoutSubscription := client.User.Create().SetEmail("new@owner.co").SetWorkosUserID("user_without_billing").SaveX(internal)
	if _, err := NewWorkspaceReadTool(client, withoutSubscription.ID).Invoke(ctx, ToolScope{UserID: withoutSubscription.ID.String()}, json.RawMessage(`{"view":"billing"}`)); err == nil {
		t.Fatal("workspace.read billing created a missing subscription")
	}
	if client.Subscription.Query().CountX(internal) != subscriptionsBefore {
		t.Fatal("workspace.read billing backfilled a missing subscription")
	}
}
