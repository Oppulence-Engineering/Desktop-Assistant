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
		cap, _ := DefaultCatalog().Get(name)
		tool := cap.Build(ToolDeps{}) // no faculty clients
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
	conduit := faculties.New("conduit", srv.URL, "k", outbound.Policy{})

	cap, _ := DefaultCatalog().Get("conduit.read")
	tool := cap.Build(ToolDeps{Conduit: conduit})
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
	if !strings.Contains(string(out), `"disputes"`) {
		t.Fatalf("passthrough = %s", out)
	}
}
