package agentregistry

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/faculties"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

func TestFacultyToolsRegistered(t *testing.T) {
	cat := DefaultCatalog()
	for _, name := range []string{"conduit.read", "eigen.simulate"} {
		c, ok := cat.Get(name)
		if !ok {
			t.Fatalf("capability %q not registered", name)
		}
		// Both are read-only (Eigen simulates; money-moving is a separate seam).
		if c.TrustTier != TierRead {
			t.Fatalf("%q tier = %q, want read", name, c.TrustTier)
		}
	}
}

func TestFacultyToolsUnavailableWhenUnconfigured(t *testing.T) {
	for _, name := range []string{"conduit.read", "eigen.simulate"} {
		capability, _ := DefaultCatalog().Get(name)
		tool := capability.Build(ToolDeps{}) // no faculty clients
		out, err := tool.Invoke(context.Background(), backgroundtaskruntime.ToolScope{}, json.RawMessage(`{"operation":"x","scenario":"y"}`))
		if err != nil {
			t.Fatalf("invoke: %v", err)
		}
		if !strings.Contains(string(out), "not configured") {
			t.Fatalf("%q expected unavailable, got %s", name, out)
		}
	}
}

func TestConduitToolForwardsRequest(t *testing.T) {
	var gotUser, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser = r.Header.Get("X-Rowboat-User")
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(`{"disputes":[{"id":"d1"}]}`))
	}))
	defer srv.Close()
	conduit := faculties.New("conduit", srv.URL, "rowboat-internal", "signing-secret", outbound.Policy{})

	capability, _ := DefaultCatalog().Get("conduit.read")
	tool := capability.Build(ToolDeps{Conduit: conduit})
	out, err := tool.Invoke(context.Background(), backgroundtaskruntime.ToolScope{UserID: "user-1"}, json.RawMessage(`{"operation":"disputes_open"}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if gotPath != "/v1/query" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotUser != "user-1" {
		t.Fatalf("on-behalf-of = %q", gotUser)
	}
	audit := tool.(backgroundtaskruntime.ToolAuditProvider).AuditInfo(nil)
	if audit.TrustTier != backgroundtaskruntime.TierRead || audit.Connector != "conduit" || audit.Operation != "read" {
		t.Fatalf("audit = %+v, want conduit/read/read-tier", audit)
	}
	if !strings.Contains(string(out), `"disputes"`) {
		t.Fatalf("passthrough = %s", out)
	}
}

func TestFacultyToolsRejectSlackChannelSessions(t *testing.T) {
	var called bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	deps, scope := slackSessionToolDeps(t)
	deps.Conduit = faculties.New("conduit", srv.URL, "rowboat-internal", "signing-secret", outbound.Policy{})

	capability, _ := DefaultCatalog().Get("conduit.read")
	tool := capability.Build(deps)
	out, err := tool.Invoke(context.Background(), scope, json.RawMessage(`{"operation":"disputes_open"}`))
	if err != nil {
		t.Fatalf("invoke returned hard error: %v", err)
	}
	if called {
		t.Fatal("faculty API was called for a Slack-triggered session")
	}
	if !strings.Contains(string(out), "not available from Slack") {
		t.Fatalf("expected Slack restriction observation, got %s", out)
	}
}
