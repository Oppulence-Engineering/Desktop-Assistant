package agentregistry

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/websearch"
)

func TestWebSearchRegistered(t *testing.T) {
	c, ok := DefaultCatalog().Get("web.search")
	if !ok {
		t.Fatal("web.search not registered")
	}
	if c.TrustTier != TierRead || RequiresApproval(c.TrustTier) {
		t.Fatalf("web.search tier = %q, want read (no approval)", c.TrustTier)
	}
}

func TestWebSearchUnavailableWhenUnconfigured(t *testing.T) {
	capability, _ := DefaultCatalog().Get("web.search")
	tool := capability.Build(ToolDeps{}) // no Web client
	out, err := tool.Invoke(context.Background(), backgroundtaskruntime.ToolScope{}, json.RawMessage(`{"query":"x"}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if !strings.Contains(string(out), "not configured") {
		t.Fatalf("expected unavailable, got %s", out)
	}
}

func TestWebSearchEmptyArgsGraceful(t *testing.T) {
	web := websearch.New("https://x", "k", outbound.Policy{})
	capability, _ := DefaultCatalog().Get("web.search")
	tool := capability.Build(ToolDeps{Web: web})
	// Empty args must yield a graceful "query is required" observation, not a
	// cryptic JSON-unmarshal error.
	out, err := tool.Invoke(context.Background(), backgroundtaskruntime.ToolScope{}, nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if !strings.Contains(string(out), "query is required") {
		t.Fatalf("expected graceful observation, got %s", out)
	}
}

func TestWebSearchToolReturnsResults(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"results":[{"title":"Rowboat","url":"https://r","content":"docs"}]}`))
	}))
	defer srv.Close()
	web := websearch.New(srv.URL, "k", outbound.Policy{})

	capability, _ := DefaultCatalog().Get("web.search")
	tool := capability.Build(ToolDeps{Web: web})
	out, err := tool.Invoke(context.Background(), backgroundtaskruntime.ToolScope{}, json.RawMessage(`{"query":"rowboat","max_results":1}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if !strings.Contains(string(out), `"title":"Rowboat"`) || !strings.Contains(string(out), "https://r") {
		t.Fatalf("results = %s", out)
	}
}
