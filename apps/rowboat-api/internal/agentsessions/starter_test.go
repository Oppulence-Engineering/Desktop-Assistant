package agentsessions_test

import (
	"context"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentsessions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

// fakeController stands in for the Temporal SDK without importing it.
type fakeController struct {
	started  []agentworkflow.SessionState
	startErr error
}

func (f *fakeController) StartSession(_ context.Context, st agentworkflow.SessionState) (agentworkflow.StartResult, error) {
	f.started = append(f.started, st)
	if f.startErr != nil {
		return agentworkflow.StartResult{}, f.startErr
	}
	return agentworkflow.StartResult{
		WorkflowID: agentworkflow.WorkflowID(st.Start.UserID, st.Start.SessionID),
		RunID:      "run-" + st.Start.SessionID,
	}, nil
}
func (f *fakeController) SubmitTurn(context.Context, string, agentworkflow.TurnInput) (agentworkflow.TurnAck, error) {
	return agentworkflow.TurnAck{Accepted: true, TurnSeq: 1}, nil
}
func (f *fakeController) ApproveAction(context.Context, string, agentworkflow.ApproveAction) (agentworkflow.TurnAck, error) {
	return agentworkflow.TurnAck{Accepted: true}, nil
}
func (f *fakeController) SignalControl(context.Context, string, string, map[string]any) error {
	return nil
}
func (f *fakeController) CancelSession(context.Context, string) error { return nil }

func setup(t *testing.T) (*ent.Client, *ent.User, *agentregistry.Loader) {
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
	loader, err := agentregistry.NewLoader(d.Client, agentregistry.DefaultCatalog())
	if err != nil {
		t.Fatalf("loader: %v", err)
	}
	return d.Client, u, loader
}

func testCfg() appconfig.Config {
	return appconfig.Config{
		AgentRuntimeModel: "test-model", AgentMaxLLMCallsPerTurn: 12, AgentMaxToolCallsPerTurn: 24,
		AgentMaxWallclockPerTurn: 4 * time.Minute, AgentMaxTurnsPerSession: 100, AgentMaxLLMCallsPerSession: 500,
		AgentMaxCostUnitsPerSession: 1_000_000, AgentSessionIdleTimeout: time.Hour, AgentContinueAsNewEveryTurns: 20,
		AgentMaxSubagentDepth: 3, AgentMaxSubagentFanout: 8,
	}
}

// TestCreateSessionBuiltinAgent runs the canonical create path against a
// built-in agent: it resolves the spec, validates its tools, creates the
// projection row, starts the workflow (seeding the first turn), and persists the
// Temporal ids.
func TestCreateSessionBuiltinAgent(t *testing.T) {
	client, u, loader := setup(t)
	ctrl := &fakeController{}
	starter := agentsessions.New(client, loader, ctrl, testCfg(), zap.NewNop())

	ctx := auth.WithUser(context.Background(), u)
	sess, err := starter.CreateSession(ctx, agentsessions.CreateParams{User: u, AgentSlug: "assistant", FirstInput: "hello"})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if sess.Row.Status != "active" || sess.Row.AgentSlug != "assistant" {
		t.Fatalf("session row = %+v", sess.Row)
	}
	if sess.Row.TemporalWorkflowID == "" || sess.Row.TemporalRunID == "" {
		t.Fatalf("temporal ids not persisted: %+v", sess.Row)
	}
	if len(ctrl.started) != 1 {
		t.Fatalf("expected 1 workflow start, got %d", len(ctrl.started))
	}
	st := ctrl.started[0].Start
	if st.Model != "test-model" {
		t.Fatalf("model fallback not applied: %q", st.Model)
	}
	if len(ctrl.started[0].Pending) != 1 || ctrl.started[0].Pending[0].Input != "hello" {
		t.Fatalf("first turn not seeded: %+v", ctrl.started[0].Pending)
	}
}

// TestCreateSessionUnknownAgent returns a 400-class InvalidParamsError.
func TestCreateSessionUnknownAgent(t *testing.T) {
	client, u, loader := setup(t)
	starter := agentsessions.New(client, loader, &fakeController{}, testCfg(), zap.NewNop())

	ctx := auth.WithUser(context.Background(), u)
	_, err := starter.CreateSession(ctx, agentsessions.CreateParams{User: u, AgentSlug: "does-not-exist"})
	var invalid *agentsessions.InvalidParamsError
	if err == nil || !asInvalid(err, &invalid) {
		t.Fatalf("expected InvalidParamsError for unknown agent, got %v", err)
	}
}

// TestCreateSessionTenantOverridesBuiltin confirms a tenant AgentDefinition row
// shadows a built-in of the same slug, and its capped limits are applied.
func TestCreateSessionTenantOverridesBuiltin(t *testing.T) {
	client, u, loader := setup(t)
	ctx := auth.WithUser(context.Background(), u)
	client.AgentDefinition.Create().
		SetUser(u).SetSlug("assistant").SetName("My Assistant").
		SetInstructions("tenant instructions").SetEnabledTools([]string{"echo"}).
		SetLimitsJSON(`{"maxLlmCallsPerTurn":3}`).SetSource("tenant").
		SaveX(ctx)

	ctrl := &fakeController{}
	starter := agentsessions.New(client, loader, ctrl, testCfg(), zap.NewNop())
	if _, err := starter.CreateSession(ctx, agentsessions.CreateParams{User: u, AgentSlug: "assistant"}); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	st := ctrl.started[0].Start
	if st.Instructions != "tenant instructions" {
		t.Fatalf("tenant row did not shadow built-in: %q", st.Instructions)
	}
	// The per-agent override (3) is tighter than the config default (12), so it
	// applies; overrides can only tighten.
	if st.Limits.MaxLLMCallsPerTurn != 3 {
		t.Fatalf("per-agent limit override not applied: %d", st.Limits.MaxLLMCallsPerTurn)
	}
}

// TestTenantScopingIsolatesSessions confirms the db interceptor scopes
// agent_sessions per user: one tenant cannot read another's session.
func TestTenantScopingIsolatesSessions(t *testing.T) {
	client, u, loader := setup(t)
	other := client.User.Create().SetEmail("b@x.co").SetWorkosUserID("user_2").SaveX(context.Background())

	ctrl := &fakeController{}
	starter := agentsessions.New(client, loader, ctrl, testCfg(), zap.NewNop())
	sess, err := starter.CreateSession(auth.WithUser(context.Background(), u), agentsessions.CreateParams{User: u, AgentSlug: "assistant"})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// The owner sees it.
	n, err := client.AgentSession.Query().All(auth.WithUser(context.Background(), u))
	if err != nil || len(n) != 1 {
		t.Fatalf("owner query: n=%d err=%v", len(n), err)
	}
	// A different tenant must not (interceptor scopes by user edge).
	m, err := client.AgentSession.Query().All(auth.WithUser(context.Background(), other))
	if err != nil {
		t.Fatalf("other query err: %v", err)
	}
	if len(m) != 0 {
		t.Fatalf("tenant isolation breached: other user saw %d sessions (%q)", len(m), sess.Row.SessionID)
	}
}

// TestStartScheduledSession is the schedule-fire entry: with no user in context
// (the scheduler's internal context), it loads the owner by id and creates a
// session through the canonical path.
func TestStartScheduledSession(t *testing.T) {
	client, u, loader := setup(t)
	ctrl := &fakeController{}
	starter := agentsessions.New(client, loader, ctrl, testCfg(), zap.NewNop())

	// No user in context — exactly how a Temporal Schedule fire arrives.
	sid, err := starter.StartScheduledSession(context.Background(), agentworkflow.ScheduledSessionInput{
		UserID: u.ID.String(), AgentSlug: "assistant", Input: "daily run",
	})
	if err != nil {
		t.Fatalf("StartScheduledSession: %v", err)
	}
	if sid == "" || len(ctrl.started) != 1 {
		t.Fatalf("scheduled session not started: sid=%q starts=%d", sid, len(ctrl.started))
	}
	if ctrl.started[0].Start.Channel != "schedule" {
		t.Fatalf("scheduled session channel = %q, want schedule", ctrl.started[0].Start.Channel)
	}
}

func asInvalid(err error, target **agentsessions.InvalidParamsError) bool {
	if e, ok := err.(*agentsessions.InvalidParamsError); ok {
		*target = e
		return true
	}
	return false
}
