package agentregistry

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

func TestGoogleToolsRegistered(t *testing.T) {
	cat := DefaultCatalog()
	for _, name := range []string{"connector.read.gmail", "connector.read.calendar"} {
		c, ok := cat.Get(name)
		if !ok {
			t.Fatalf("capability %q not registered in DefaultCatalog", name)
		}
		// Read-only connector reads auto-execute (no approval).
		if c.TrustTier != TierRead {
			t.Fatalf("%q tier = %q, want read", name, c.TrustTier)
		}
		if RequiresApproval(c.TrustTier) {
			t.Fatalf("%q must not require approval", name)
		}
	}
}

func TestGmailDraftCapabilityIsApprovalTier(t *testing.T) {
	c, ok := DefaultCatalog().Get("connector.write.gmail_draft")
	if !ok {
		t.Fatal("connector.write.gmail_draft not registered")
	}
	// Drafting is an outward-facing act → approval-eligible.
	if c.TrustTier != TierAct || !RequiresApproval(c.TrustTier) {
		t.Fatalf("gmail_draft tier = %q, want act (approval-eligible)", c.TrustTier)
	}
}

func TestGoogleToolUnavailableWhenUnconfigured(t *testing.T) {
	for _, name := range []string{"connector.read.gmail", "connector.read.calendar", "connector.write.gmail_draft"} {
		cap, _ := DefaultCatalog().Get(name)
		// No Google deps and no user id → graceful "unavailable", never a panic.
		tool := cap.Build(ToolDeps{})
		if tool.Name() != name {
			t.Fatalf("unavailable tool name = %q, want %q", tool.Name(), name)
		}
		out, err := tool.Invoke(context.Background(), backgroundtaskruntime.ToolScope{}, json.RawMessage(`{"query":"x"}`))
		if err != nil {
			t.Fatalf("invoke: %v", err)
		}
		if !strings.Contains(string(out), "not configured") {
			t.Fatalf("expected unavailable observation, got %s", out)
		}
	}
}

func slackSessionToolDeps(t *testing.T) (ToolDeps, backgroundtaskruntime.ToolScope) {
	t.Helper()
	ctx := context.Background()
	d, err := db.Open(ctx, appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("u1").SaveX(ctx)
	const sessionID = "sess-slack-owner-tools"
	d.Client.AgentSession.Create().
		SetUser(u).SetSessionID(sessionID).SetAgentSlug("concierge-slack").
		SetAgentSource("builtin").SetChannel("slack").SetChannelKey("slack:T1:C1:1.1").
		SetStatus("active").SaveX(auth.WithUser(ctx, u))
	sealer, err := crypto.NewSealer("test-encryption-key-for-agentregistry")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	return ToolDeps{
		Client:  d.Client,
		Sealer:  sealer,
		Secrets: secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "gid", GoogleOAuthClientSecret: "gsec"}),
		Google:  googleapi.New(googleapi.Config{}),
		UserID:  u.ID.String(),
	}, backgroundtaskruntime.ToolScope{UserID: u.ID.String(), RunID: sessionID}
}

func TestGoogleToolsRejectSlackChannelSessions(t *testing.T) {
	deps, scope := slackSessionToolDeps(t)
	for _, tc := range []struct {
		name string
		args json.RawMessage
	}{
		{name: "connector.read.gmail", args: json.RawMessage(`{"query":"from:customer@example.com"}`)},
		{name: "connector.read.calendar", args: json.RawMessage(`{"limit":1}`)},
		{name: "connector.write.gmail_draft", args: json.RawMessage(`{"to":"customer@example.com","body":"hello"}`)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cap, _ := DefaultCatalog().Get(tc.name)
			tool := cap.Build(deps)
			out, err := tool.Invoke(auth.WithInternal(context.Background()), scope, tc.args)
			if err != nil {
				t.Fatalf("invoke returned hard error: %v", err)
			}
			if !strings.Contains(string(out), "not available from Slack") {
				t.Fatalf("expected Slack restriction observation, got %s", out)
			}
		})
	}
}
