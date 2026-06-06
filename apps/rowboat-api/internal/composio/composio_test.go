package composio_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/composio"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func TestProxySwapsAuthAndRewritesPath(t *testing.T) {
	var gotPath, gotKey, gotAuth, gotUser, gotQuery string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotKey = r.Header.Get("x-api-key")
		gotAuth = r.Header.Get("Authorization")
		gotUser = r.Header.Get("X-Solomon-User")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[]}`))
	}))
	defer upstream.Close()

	sec := secrets.NewFromConfig(appconfig.Config{ComposioAPIKey: "composio-key"})
	h := composio.New(sec, zap.NewNop())
	h.SetUpstream(upstream.URL)

	// Simulate the auth middleware having attached a user.
	u := &ent.User{ID: uuid.New()}
	ctx := auth.WithUser(context.Background(), u)

	req := httptest.NewRequest(http.MethodGet, "/v1/composio/toolkits?sort_by=usage", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer user-token")
	rec := httptest.NewRecorder()
	h.Proxy(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if gotPath != "/toolkits" {
		t.Errorf("upstream path = %q, want /toolkits", gotPath)
	}
	if gotQuery != "sort_by=usage" {
		t.Errorf("query = %q", gotQuery)
	}
	if gotKey != "composio-key" {
		t.Errorf("x-api-key = %q", gotKey)
	}
	if gotAuth != "" {
		t.Errorf("user Authorization must be stripped, got %q", gotAuth)
	}
	if gotUser != u.ID.String() {
		t.Errorf("X-Solomon-User = %q, want %q", gotUser, u.ID.String())
	}
}

func TestProxyUnconfigured(t *testing.T) {
	sec := secrets.NewFromConfig(appconfig.Config{}) // no composio key
	h := composio.New(sec, zap.NewNop())
	ctx := auth.WithUser(context.Background(), &ent.User{ID: uuid.New()})
	req := httptest.NewRequest(http.MethodGet, "/v1/composio/toolkits", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Proxy(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d", rec.Code)
	}
}
