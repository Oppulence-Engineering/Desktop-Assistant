package connectors_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func mockOry(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth2/token":
			_ = r.ParseForm()
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"acc-` + r.Form.Get("grant_type") + `","refresh_token":"rt-rotated","expires_in":3600,"token_type":"Bearer","scope":"invoices:read"}`))
		case "/oauth2/revoke":
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func setup(t *testing.T, registry *connectors.Registry) (*ent.Client, *ent.User, *connectors.Handler) {
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
	d.Client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(context.Background())
	sealer, _ := crypto.NewSealer("test-key")
	h := connectors.New(d.Client, sealer, registry, connectors.Config{
		OryPublicURL:          "https://placeholder",
		OryBrokerClientID:     "broker",
		OryBrokerClientSecret: "secret",
		PublicBaseURL:         "https://api.test",
		DeepLinkScheme:        "solomon-ai",
	}, zap.NewNop())
	return d.Client, u, h
}

// withParam injects a chi URL param.
func withParam(ctx context.Context, key, val string) context.Context {
	rc := chi.NewRouteContext()
	rc.URLParams.Add(key, val)
	return context.WithValue(ctx, chi.RouteCtxKey, rc)
}

func TestOAuthConnectorFlow(t *testing.T) {
	ory := mockOry(t)
	defer ory.Close()
	client, u, h := setup(t, connectors.DefaultRegistry())
	h.SetOryBaseURL(ory.URL)
	authed := auth.WithUser(context.Background(), u)

	// 1. Start canvas.
	startReq := httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/start", nil).
		WithContext(withParam(authed, "name", "canvas"))
	startRec := httptest.NewRecorder()
	h.Start(startRec, startReq)
	if startRec.Code != http.StatusOK {
		t.Fatalf("start: want 200, got %d: %s", startRec.Code, startRec.Body.String())
	}
	var startBody struct {
		AuthorizeURL string `json:"authorize_url"`
	}
	_ = json.Unmarshal(startRec.Body.Bytes(), &startBody)
	for _, want := range []string{"/oauth2/auth", "code_challenge=", "state=", "audience=canvas-api", "offline_access"} {
		if !strings.Contains(startBody.AuthorizeURL, want) {
			t.Errorf("authorize_url missing %q: %s", want, startBody.AuthorizeURL)
		}
	}

	// Grab the state that Start parked.
	pending := client.OAuthPending.Query().FirstX(context.Background())
	state := pending.State

	// 2. Callback (browser redirect — no user in context). It parks the grant and
	// deep-links back with the session; it must NOT persist the connection itself.
	cbReq := httptest.NewRequest(http.MethodGet, "/v1/connections/canvas/callback?code=abc&state="+state, nil).
		WithContext(withParam(context.Background(), "name", "canvas"))
	cbRec := httptest.NewRecorder()
	h.Callback(cbRec, cbReq)
	if cbRec.Code != http.StatusFound {
		t.Fatalf("callback: want 302, got %d: %s", cbRec.Code, cbRec.Body.String())
	}
	loc := cbRec.Header().Get("Location")
	if !strings.Contains(loc, "solomon-ai://connection-complete") || !strings.Contains(loc, "status=success") || !strings.Contains(loc, "session=") {
		t.Fatalf("callback redirect = %q", loc)
	}
	// Not persisted yet — persistence happens only at the authenticated Claim.
	if n := client.MCPConnection.Query().CountX(authed); n != 0 {
		t.Fatalf("expected 0 mcp connections before claim, got %d", n)
	}

	// 2b. A DIFFERENT user must not be able to claim this ticket (the core
	// authorization-code-injection guard).
	otherU := client.User.Create().SetEmail("b@x.co").SetWorkosUserID("user_2").SaveX(context.Background())
	badClaim := httptest.NewRecorder()
	h.Claim(badClaim, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/claim", strings.NewReader(`{"state":"`+state+`"}`)).
		WithContext(withParam(auth.WithUser(context.Background(), otherU), "name", "canvas")))
	if badClaim.Code != http.StatusForbidden {
		t.Fatalf("claim by wrong user: want 403, got %d: %s", badClaim.Code, badClaim.Body.String())
	}
	if n := client.MCPConnection.Query().CountX(authed); n != 0 {
		t.Fatalf("wrong-user claim must not persist, got %d", n)
	}

	// 2c. The initiating user claims it → connection persisted.
	claimRec := httptest.NewRecorder()
	h.Claim(claimRec, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/claim", strings.NewReader(`{"state":"`+state+`"}`)).
		WithContext(withParam(authed, "name", "canvas")))
	if claimRec.Code != http.StatusOK {
		t.Fatalf("claim: want 200, got %d: %s", claimRec.Code, claimRec.Body.String())
	}
	if n := client.MCPConnection.Query().CountX(authed); n != 1 {
		t.Fatalf("expected 1 mcp connection after claim, got %d", n)
	}

	// 3. List shows connected.
	listRec := httptest.NewRecorder()
	h.List(listRec, httptest.NewRequest(http.MethodGet, "/v1/connectors", nil).WithContext(authed))
	if !strings.Contains(listRec.Body.String(), `"connected":true`) {
		t.Fatalf("list should show connected: %s", listRec.Body.String())
	}
	if !strings.Contains(listRec.Body.String(), `"mcpTools"`) || !strings.Contains(listRec.Body.String(), `"customer.lookup"`) {
		t.Fatalf("list should expose connector MCP allowlists: %s", listRec.Body.String())
	}

	// 4. mcp-token refreshes via Ory.
	tokRec := httptest.NewRecorder()
	h.MCPToken(tokRec, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/mcp-token", nil).
		WithContext(withParam(authed, "name", "canvas")))
	if tokRec.Code != http.StatusOK {
		t.Fatalf("mcp-token: want 200, got %d: %s", tokRec.Code, tokRec.Body.String())
	}
	if !strings.Contains(tokRec.Body.String(), "acc-refresh_token") {
		t.Errorf("mcp-token should return refreshed access token: %s", tokRec.Body.String())
	}

	// 5. Delete revokes + removes.
	delRec := httptest.NewRecorder()
	h.Delete(delRec, httptest.NewRequest(http.MethodDelete, "/v1/connections/canvas", nil).
		WithContext(withParam(authed, "name", "canvas")))
	if delRec.Code != http.StatusNoContent {
		t.Fatalf("delete: want 204, got %d", delRec.Code)
	}
	if n := client.MCPConnection.Query().CountX(authed); n != 0 {
		t.Fatalf("connection should be removed, got %d", n)
	}
}

func TestDefaultRegistryDeclaresMCPToolAllowlists(t *testing.T) {
	reg := connectors.DefaultRegistry()
	names := map[string]bool{}
	for _, connector := range reg.List() {
		names[connector.Name] = true
		if connector.MCPURL == "" {
			continue
		}
		if len(connector.MCPTools) == 0 {
			t.Fatalf("%s has an MCP URL but no upstream tool allowlist", connector.Name)
		}
		seen := map[string]bool{}
		for _, tool := range connector.MCPTools {
			if tool.Name == "" {
				t.Fatalf("%s has an empty MCP tool name", connector.Name)
			}
			if seen[tool.Name] {
				t.Fatalf("%s declares duplicate MCP tool %q", connector.Name, tool.Name)
			}
			seen[tool.Name] = true
			switch tool.TrustTier {
			case "read", "write", "act", "money-moving":
			default:
				t.Fatalf("%s/%s has invalid trust tier %q", connector.Name, tool.Name, tool.TrustTier)
			}
		}
	}
	for _, want := range []string{"canvas", "corinthian", "wispr", "hubspot", "github", "linear", "notion", "stripe"} {
		if !names[want] {
			t.Fatalf("default registry missing connector %q", want)
		}
	}
	stripe, ok := reg.Get("stripe")
	if !ok {
		t.Fatal("missing stripe connector")
	}
	foundMoneyMoving := false
	for _, tool := range stripe.MCPTools {
		if tool.Name == "refund.create" && tool.TrustTier == "money-moving" {
			foundMoneyMoving = true
		}
	}
	if !foundMoneyMoving {
		t.Fatalf("stripe refund.create must be explicitly money-moving: %+v", stripe.MCPTools)
	}
}

func TestLoadRegistryRejectsInvalidMCPPolicies(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{
			name: "mcp-url-without-allowlist",
			body: `[{"name":"x","displayName":"X","mcpUrl":"https://mcp.test","authType":"api_key","audience":"x"}]`,
			want: "has mcpUrl but no mcpTools allowlist",
		},
		{
			name: "missing-trust-tier",
			body: `[{"name":"x","displayName":"X","mcpUrl":"https://mcp.test","authType":"api_key","audience":"x","mcpTools":[{"name":"thing.read"}]}]`,
			want: `invalid trustTier ""`,
		},
		{
			name: "duplicate-tool",
			body: `[{"name":"x","displayName":"X","mcpUrl":"https://mcp.test","authType":"api_key","audience":"x","mcpTools":[{"name":"thing.read","trustTier":"read"},{"name":"thing.read","trustTier":"read"}]}]`,
			want: `duplicate MCP tool "thing.read"`,
		},
		{
			name: "tools-without-url",
			body: `[{"name":"x","displayName":"X","authType":"api_key","audience":"x","mcpTools":[{"name":"thing.read","trustTier":"read"}]}]`,
			want: "declares mcpTools without mcpUrl",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := connectors.LoadRegistry([]byte(tc.body)); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("LoadRegistry err = %v, want containing %q", err, tc.want)
			}
		})
	}
}

func TestPreConsentEntitlement(t *testing.T) {
	// Canvas requires the pro plan; our user is on free → deny + upsell.
	reg, _ := connectors.LoadRegistry([]byte(`[{"name":"canvas","displayName":"Canvas","authType":"oauth","audience":"canvas-api","requiredPlan":"pro"}]`))
	_, _, h := setup(t, reg)

	body := `{"workos_user_id":"user_1","connector":"canvas"}`
	req := httptest.NewRequest(http.MethodPost, "/oauth-hooks/pre-consent", strings.NewReader(body)).
		WithContext(auth.WithInternal(context.Background()))
	rec := httptest.NewRecorder()
	h.PreConsent(rec, req)

	var resp struct {
		Allow  bool `json:"allow"`
		Upsell struct {
			RequiredPlan string `json:"requiredPlan"`
		} `json:"upsell"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Allow {
		t.Fatal("free user should be denied a pro connector")
	}
	if resp.Upsell.RequiredPlan != "pro" {
		t.Fatalf("upsell plan = %q", resp.Upsell.RequiredPlan)
	}
}

func TestInvalidate(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	sealer, _ := crypto.NewSealer("test-key")
	_ = sealer
	// Seed a connection directly.
	client.MCPConnection.Create().SetUser(u).SetConnector("canvas").SetAudience("canvas-api").
		SetRefreshTokenEncrypted([]byte("x")).SaveX(context.Background())

	body := `{"workos_user_id":"user_1","connector":"canvas"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate", strings.NewReader(body)).
		WithContext(auth.WithInternal(context.Background()))
	rec := httptest.NewRecorder()
	h.Invalidate(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("invalidate: want 200, got %d", rec.Code)
	}
	if n := client.MCPConnection.Query().CountX(auth.WithInternal(context.Background())); n != 0 {
		t.Fatalf("connection should be invalidated, got %d", n)
	}
}

func TestMCPRuntimeResolverResolvesAPIKeyForExplicitUser(t *testing.T) {
	reg, err := connectors.LoadRegistry([]byte(`[{"name":"wispr","displayName":"Wispr","mcpUrl":"https://mcp.test/mcp","authType":"api_key","audience":"wispr-api","mcpTools":[{"name":"transcript.get","trustTier":"read"}]}]`))
	if err != nil {
		t.Fatalf("registry: %v", err)
	}
	client, u, _ := setup(t, reg)
	sealer, err := crypto.NewSealer("test-key")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	ctx := auth.WithInternal(context.Background())

	other := client.User.Create().SetEmail("other@x.co").SetWorkosUserID("user_2").SaveX(ctx)
	otherKey, _ := sealer.SealString("wrong-user-key")
	client.MCPConnection.Create().
		SetUser(other).
		SetConnector("wispr").
		SetAudience("wispr-api").
		SetAPIKeyEncrypted(otherKey).
		SaveX(ctx)

	userKey, _ := sealer.SealString("vendor-key")
	conn := client.MCPConnection.Create().
		SetUser(u).
		SetConnector("wispr").
		SetAudience("wispr-api").
		SetAPIKeyEncrypted(userKey).
		SaveX(ctx)

	resolver := connectors.NewMCPRuntimeResolver(client, sealer, reg, connectors.Config{})
	mcpURL, tokenType, token, err := resolver.ResolveMCP(context.Background(), u.ID.String(), "wispr")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if mcpURL != "https://mcp.test/mcp" || tokenType != "Bearer" || token != "vendor-key" {
		t.Fatalf("resolved url/type/token = %q/%q/%q", mcpURL, tokenType, token)
	}
	if updated := client.MCPConnection.GetX(ctx, conn.ID); updated.LastUsedAt.IsZero() {
		t.Fatal("last_used_at should be updated")
	}
}

func TestMCPRuntimeResolverRefreshesOAuthConnector(t *testing.T) {
	ory := mockOry(t)
	defer ory.Close()
	reg, err := connectors.LoadRegistry([]byte(`[{"name":"canvas","displayName":"Canvas","mcpUrl":"https://canvas.test/mcp","authType":"oauth","audience":"canvas-api","scopes":["invoices:read"],"mcpTools":[{"name":"invoice.lookup","trustTier":"read"}]}]`))
	if err != nil {
		t.Fatalf("registry: %v", err)
	}
	client, u, _ := setup(t, reg)
	sealer, err := crypto.NewSealer("test-key")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	sealed, _ := sealer.SealString("rt-old")
	conn := client.MCPConnection.Create().
		SetUser(u).
		SetConnector("canvas").
		SetAudience("canvas-api").
		SetRefreshTokenEncrypted(sealed).
		SaveX(ctx)

	resolver := connectors.NewMCPRuntimeResolver(client, sealer, reg, connectors.Config{
		OryPublicURL:          ory.URL,
		OryBrokerClientID:     "broker",
		OryBrokerClientSecret: "secret",
	})
	mcpURL, tokenType, token, err := resolver.ResolveMCP(context.Background(), u.ID.String(), "canvas")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if mcpURL != "https://canvas.test/mcp" || tokenType != "Bearer" || token != "acc-refresh_token" {
		t.Fatalf("resolved url/type/token = %q/%q/%q", mcpURL, tokenType, token)
	}
	updated := client.MCPConnection.GetX(ctx, conn.ID)
	rotated, err := sealer.OpenString(updated.RefreshTokenEncrypted)
	if err != nil {
		t.Fatalf("open rotated token: %v", err)
	}
	if rotated != "rt-rotated" || updated.LastUsedAt.IsZero() {
		t.Fatalf("rotated/lastUsed = %q/%v", rotated, updated.LastUsedAt)
	}
}
