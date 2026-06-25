package composio_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/composio"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func setup(t *testing.T) (*ent.Client, *secrets.Store) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d.Client, secrets.NewFromConfig(appconfig.Config{ComposioAPIKey: "composio-key"})
}

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

	client, sec := setup(t)
	h := composio.New(client, sec, zap.NewNop())
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
	client, _ := setup(t)
	sec := secrets.NewFromConfig(appconfig.Config{}) // no composio key
	h := composio.New(client, sec, zap.NewNop())
	ctx := auth.WithUser(context.Background(), &ent.User{ID: uuid.New()})
	req := httptest.NewRequest(http.MethodGet, "/v1/composio/toolkits", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Proxy(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d", rec.Code)
	}
}

func TestConnectedAccountMappingBlocksCrossTenantAccess(t *testing.T) {
	client, sec := setup(t)
	userA := client.User.Create().SetEmail("a@example.com").SetWorkosUserID("user_a").SaveX(context.Background())
	userB := client.User.Create().SetEmail("b@example.com").SetWorkosUserID("user_b").SaveX(context.Background())

	var directHits int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/connected_accounts":
			_, _ = w.Write([]byte(`{"id":"ca_user_a","status":"active"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/connected_accounts/ca_user_a":
			directHits++
			_, _ = w.Write([]byte(`{"id":"ca_user_a","secret":"owner-only"}`))
		default:
			t.Fatalf("unexpected upstream call %s %s", r.Method, r.URL.Path)
		}
	}))
	defer upstream.Close()

	h := composio.New(client, sec, zap.NewNop())
	h.SetUpstream(upstream.URL)

	createRec := httptest.NewRecorder()
	h.Proxy(createRec, httptest.NewRequest(http.MethodPost, "/v1/composio/connected_accounts", strings.NewReader(`{"toolkit":"gmail"}`)).
		WithContext(auth.WithUser(context.Background(), userA)))
	if createRec.Code != http.StatusOK {
		t.Fatalf("create account: want 200, got %d: %s", createRec.Code, createRec.Body.String())
	}

	otherRec := httptest.NewRecorder()
	h.Proxy(otherRec, httptest.NewRequest(http.MethodGet, "/v1/composio/connected_accounts/ca_user_a", nil).
		WithContext(auth.WithUser(context.Background(), userB)))
	if otherRec.Code != http.StatusNotFound {
		t.Fatalf("other user direct access: want 404, got %d: %s", otherRec.Code, otherRec.Body.String())
	}
	if directHits != 0 {
		t.Fatalf("cross-tenant request reached upstream %d time(s)", directHits)
	}

	ownerRec := httptest.NewRecorder()
	h.Proxy(ownerRec, httptest.NewRequest(http.MethodGet, "/v1/composio/connected_accounts/ca_user_a", nil).
		WithContext(auth.WithUser(context.Background(), userA)))
	if ownerRec.Code != http.StatusOK {
		t.Fatalf("owner direct access: want 200, got %d: %s", ownerRec.Code, ownerRec.Body.String())
	}
	if directHits != 1 {
		t.Fatalf("owner request should reach upstream once, got %d", directHits)
	}
}

func TestConnectedAccountListAndJSONBodyAreTenantScoped(t *testing.T) {
	client, sec := setup(t)
	userA := client.User.Create().SetEmail("a@example.com").SetWorkosUserID("user_a").SaveX(context.Background())
	userB := client.User.Create().SetEmail("b@example.com").SetWorkosUserID("user_b").SaveX(context.Background())

	var executeHits int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/connected_accounts":
			body, _ := io.ReadAll(r.Body)
			if strings.Contains(string(body), "gmail") {
				_, _ = w.Write([]byte(`{"id":"ca_user_a","toolkit":"gmail"}`))
				return
			}
			_, _ = w.Write([]byte(`{"id":"ca_user_b","toolkit":"slack"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/connected_accounts":
			_, _ = w.Write([]byte(`{"items":[{"id":"ca_user_a","toolkit":"gmail"},{"id":"ca_user_b","toolkit":"slack"}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/tools/execute":
			executeHits++
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			t.Fatalf("unexpected upstream call %s %s", r.Method, r.URL.Path)
		}
	}))
	defer upstream.Close()

	h := composio.New(client, sec, zap.NewNop())
	h.SetUpstream(upstream.URL)
	for _, tc := range []struct {
		user *ent.User
		body string
	}{
		{userA, `{"toolkit":"gmail"}`},
		{userB, `{"toolkit":"slack"}`},
	} {
		rec := httptest.NewRecorder()
		h.Proxy(rec, httptest.NewRequest(http.MethodPost, "/v1/composio/connected_accounts", strings.NewReader(tc.body)).
			WithContext(auth.WithUser(context.Background(), tc.user)))
		if rec.Code != http.StatusOK {
			t.Fatalf("seed connected account: want 200, got %d: %s", rec.Code, rec.Body.String())
		}
	}

	listRec := httptest.NewRecorder()
	h.Proxy(listRec, httptest.NewRequest(http.MethodGet, "/v1/composio/connected_accounts", nil).
		WithContext(auth.WithUser(context.Background(), userA)))
	if listRec.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d: %s", listRec.Code, listRec.Body.String())
	}
	var list struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &list); err != nil {
		t.Fatalf("list JSON: %v", err)
	}
	if len(list.Items) != 1 || list.Items[0]["id"] != "ca_user_a" {
		t.Fatalf("filtered list = %s, want only ca_user_a", listRec.Body.String())
	}

	crossRec := httptest.NewRecorder()
	h.Proxy(crossRec, httptest.NewRequest(http.MethodPost, "/v1/composio/tools/execute", strings.NewReader(`{"connected_account_id":"ca_user_b","arguments":{}}`)).
		WithContext(auth.WithUser(context.Background(), userA)))
	if crossRec.Code != http.StatusNotFound {
		t.Fatalf("cross-account execute: want 404, got %d: %s", crossRec.Code, crossRec.Body.String())
	}
	if executeHits != 0 {
		t.Fatalf("cross-account execute reached upstream %d time(s)", executeHits)
	}

	ownerRec := httptest.NewRecorder()
	h.Proxy(ownerRec, httptest.NewRequest(http.MethodPost, "/v1/composio/tools/execute", strings.NewReader(`{"connected_account_id":"ca_user_a","arguments":{}}`)).
		WithContext(auth.WithUser(context.Background(), userA)))
	if ownerRec.Code != http.StatusOK {
		t.Fatalf("owner execute: want 200, got %d: %s", ownerRec.Code, ownerRec.Body.String())
	}
	if executeHits != 1 {
		t.Fatalf("owner execute should reach upstream once, got %d", executeHits)
	}
}
