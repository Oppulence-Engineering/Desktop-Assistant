package agentregistry

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"go.uber.org/zap"
)

func TestSourceRetrySyncCapabilityQueuesExistingConnectionWithoutOAuth(t *testing.T) {
	ctx, database, owner, _ := newWriteToolFixture(t)
	service := revenue.NewService(database.Client, nil, nil, zap.NewNop())
	authorized, err := service.ReportSourceAuthorization(auth.WithUser(ctx, owner), owner, "google", revenue.SourceAuthorizationInput{
		SourceAccountID: "owner@example.com", State: "completed",
		GrantedScopes: []string{
			"https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/calendar.events.readonly",
		},
	})
	if err != nil {
		t.Fatalf("authorize source: %v", err)
	}

	capability, ok := DefaultCatalog().Get("source.retry_sync")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("source.retry_sync capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-source-retry", TurnSeq: 2, ToolCallIndex: 1}
	args := json.RawMessage(`{"source":"google","sourceAccountId":"OWNER@example.com"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("source.retry_sync: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("source.retry_sync retry: %v", err)
	}
	if !strings.Contains(string(out), `"alreadyQueued":false`) || !strings.Contains(string(retry), `"alreadyQueued":true`) {
		t.Fatalf("unexpected source.retry_sync outputs: first=%s retry=%s", out, retry)
	}
	stored := database.Client.RelationshipSourceStatus.GetX(auth.WithInternal(ctx), authorized.ID)
	if stored.Status != "backfilling" || stored.BackfillPhase != "queued" || stored.Completeness != "rebuilding" || stored.AuthorizedAt == nil || !stored.AuthorizedAt.Equal(*authorized.AuthorizedAt) {
		t.Fatalf("queued source state = %+v", stored)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"source":"google","sourceAccountId":"missing@example.com"}`)); err == nil {
		t.Fatal("source.retry_sync accepted an unknown source account")
	}
	if got := database.Client.RelationshipSourceStatus.Query().CountX(auth.WithInternal(ctx)); got != 1 {
		t.Fatalf("source status count = %d, want 1", got)
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("source.retry_sync accepted a mismatched workflow owner")
	}
}
