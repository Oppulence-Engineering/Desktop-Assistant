package agents

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func setupHandler(t *testing.T) (*Handler, *ent.User) {
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
	return New(d.Client, loader, appconfig.Config{AgentRuntimeModel: "test"}, zap.NewNop()), u
}

// TestCreateAgentRejectsUnknownTool is the Layer-2 deny-by-default boundary: a
// definition referencing a tool absent from the capability registry is a 400.
func TestCreateAgentRejectsUnknownTool(t *testing.T) {
	h, u := setupHandler(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/agents", strings.NewReader(`{"slug":"x","name":"X","enabledTools":["shell"]}`)).
		WithContext(auth.WithUser(context.Background(), u))
	h.CreateAgent(rec, req)
	if rec.Code != 400 {
		t.Fatalf("CreateAgent(unknown tool) = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// TestCreateAgentAcceptsKnownTools confirms a valid allowlist is accepted.
func TestCreateAgentAcceptsKnownTools(t *testing.T) {
	h, u := setupHandler(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/agents", strings.NewReader(`{"slug":"helper","name":"Helper","enabledTools":["echo","current_time"]}`)).
		WithContext(auth.WithUser(context.Background(), u))
	h.CreateAgent(rec, req)
	if rec.Code != 201 {
		t.Fatalf("CreateAgent(valid) = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
}

// TestListAgentsIncludesBuiltins confirms the embedded built-ins surface in the
// catalog listing.
func TestListAgentsIncludesBuiltins(t *testing.T) {
	h, u := setupHandler(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/v1/agents", nil).WithContext(auth.WithUser(context.Background(), u))
	h.ListAgents(rec, req)
	if rec.Code != 200 {
		t.Fatalf("ListAgents = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "assistant") {
		t.Fatalf("ListAgents body missing built-in 'assistant': %s", rec.Body.String())
	}
}

// TestContinuationTokenResolvesSession is the continuation-token gate: a valid
// signed token resolves the session (overriding the path id), and a forged token
// is rejected.
func TestContinuationTokenResolvesSession(t *testing.T) {
	h, u := setupHandler(t)
	ctx := auth.WithUser(context.Background(), u)
	wf := agentWorkflowID(u.ID.String(), "s-cont")
	h.client.AgentSession.Create().
		SetUser(u).SetSessionID("s-cont").SetAgentSlug("assistant").SetChannel("http").
		SetStatus("active").SetTemporalWorkflowID(wf).SaveX(ctx)

	token := h.continuationToken(wf, "s-cont", u.ID.String())
	if token == "" {
		t.Fatal("expected a signed continuation token")
	}

	// Valid token resolves the session even though the path id is wrong.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/v1/agent-sessions/WRONG?continuationToken="+token, nil).WithContext(ctx)
	req = withURLParam(req, "id", "WRONG")
	h.GetSession(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "s-cont") {
		t.Fatalf("valid continuation token did not resolve session: code=%d body=%s", rec.Code, rec.Body.String())
	}

	// A forged token is rejected.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/v1/agent-sessions/s-cont?continuationToken=agt_forged.deadbeef", nil).WithContext(ctx)
	req = withURLParam(req, "id", "s-cont")
	h.GetSession(rec, req)
	if rec.Code != 401 {
		t.Fatalf("forged continuation token = %d, want 401", rec.Code)
	}
}

// agentWorkflowID mirrors agentworkflow.WorkflowID without importing it here.
func agentWorkflowID(userID, sessionID string) string {
	return "agent-session/" + userID + "/" + sessionID
}

// withURLParam attaches a chi route param to the request, preserving the
// existing context (the auth user).
func withURLParam(r *http.Request, key, val string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, val)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// TestCreateSessionWithoutTemporalReturns503 confirms the create path degrades
// to 503 (not a panic) before SetStarter wires Temporal.
func TestCreateSessionWithoutTemporalReturns503(t *testing.T) {
	h, u := setupHandler(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/agent-sessions", strings.NewReader(`{"agent":"assistant","input":"hi"}`)).
		WithContext(auth.WithUser(context.Background(), u))
	h.CreateSession(rec, req)
	if rec.Code != 503 {
		t.Fatalf("CreateSession(no temporal) = %d, want 503; body=%s", rec.Code, rec.Body.String())
	}
}
