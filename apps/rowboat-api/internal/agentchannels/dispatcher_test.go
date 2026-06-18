package agentchannels

import (
	"context"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentsessions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

type fakeController struct{ submits int }

func (f *fakeController) StartSession(_ context.Context, st agentworkflow.SessionState) (agentworkflow.StartResult, error) {
	return agentworkflow.StartResult{WorkflowID: agentworkflow.WorkflowID(st.Start.UserID, st.Start.SessionID), RunID: "run"}, nil
}
func (f *fakeController) SubmitTurn(context.Context, string, agentworkflow.TurnInput) (agentworkflow.TurnAck, error) {
	f.submits++
	return agentworkflow.TurnAck{Accepted: true, TurnSeq: f.submits}, nil
}
func (f *fakeController) ApproveAction(context.Context, string, agentworkflow.ApproveAction) (agentworkflow.TurnAck, error) {
	return agentworkflow.TurnAck{}, nil
}
func (f *fakeController) SignalControl(context.Context, string, string, map[string]any) error {
	return nil
}
func (f *fakeController) CancelSession(context.Context, string) error { return nil }

func setup(t *testing.T) (*ent.Client, *ent.User, *agentsessions.Starter, *fakeController) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(context.Background())
	loader, _ := agentregistry.NewLoader(d.Client, agentregistry.DefaultCatalog())
	ctrl := &fakeController{}
	cfg := appconfig.Config{AgentRuntimeModel: "test", AgentMaxLLMCallsPerTurn: 4, AgentMaxToolCallsPerTurn: 4,
		AgentMaxWallclockPerTurn: time.Minute, AgentMaxTurnsPerSession: 10, AgentMaxLLMCallsPerSession: 50,
		AgentMaxCostUnitsPerSession: 1000, AgentSessionIdleTimeout: time.Hour, AgentContinueAsNewEveryTurns: 10,
		AgentMaxSubagentDepth: 2, AgentMaxSubagentFanout: 4}
	return d.Client, u, agentsessions.New(d.Client, loader, ctrl, cfg, zap.NewNop()), ctrl
}

// TestDispatchThreadsOneSession is the channel gate: the first message creates a
// session keyed by (channel, channelKey); a second message on the same key
// continues that session (a turn submit) rather than creating a new one.
func TestDispatchThreadsOneSession(t *testing.T) {
	client, u, starter, ctrl := setup(t)
	d := New(client, starter, "assistant", zap.NewNop())
	ctx := auth.WithUser(context.Background(), u)

	first, created, err := d.Dispatch(ctx, ChannelMessage{Channel: "slack", ChannelKey: "slack:T:C:1", User: u, Text: "hello"})
	if err != nil || !created {
		t.Fatalf("first dispatch: created=%v err=%v", created, err)
	}
	second, created2, err := d.Dispatch(ctx, ChannelMessage{Channel: "slack", ChannelKey: "slack:T:C:1", User: u, Text: "follow up"})
	if err != nil {
		t.Fatalf("second dispatch: %v", err)
	}
	if created2 {
		t.Fatal("second message on the same channel key must continue, not create")
	}
	if first.Row.SessionID != second.Row.SessionID {
		t.Fatalf("channel thread split sessions: %q vs %q", first.Row.SessionID, second.Row.SessionID)
	}
	if ctrl.submits != 1 {
		t.Fatalf("expected exactly one turn submit on continue, got %d", ctrl.submits)
	}
	n := client.AgentSession.Query().Where(agentsession.ChannelKeyEQ("slack:T:C:1")).CountX(auth.WithUser(context.Background(), u))
	if n != 1 {
		t.Fatalf("expected exactly one session for the channel key, got %d", n)
	}
}

// TestDispatchResolvesAgentBinding confirms the dispatcher routes to the tenant
// agent bound to the channel via channel_bindings, else the default.
func TestDispatchResolvesAgentBinding(t *testing.T) {
	client, u, starter, _ := setup(t)
	ctx := auth.WithUser(context.Background(), u)
	client.AgentDefinition.Create().
		SetUser(u).SetSlug("slackbot").SetName("Slack Bot").SetEnabledTools([]string{"echo"}).
		SetChannelBindings(`["slack"]`).SetSource("tenant").SaveX(ctx)

	d := New(client, starter, "assistant", zap.NewNop())
	if got := d.resolveAgentForChannel(ctx, u, "slack"); got != "slackbot" {
		t.Fatalf("channel binding not resolved: got %q, want slackbot", got)
	}
	if got := d.resolveAgentForChannel(ctx, u, "discord"); got != "assistant" {
		t.Fatalf("unbound channel should fall back to default, got %q", got)
	}
}
