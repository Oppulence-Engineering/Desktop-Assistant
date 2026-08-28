package connectors_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorauditevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func mockOry(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth2/token":
			_ = r.ParseForm()
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"acc-` + r.Form.Get("grant_type") + `","refresh_token":"rt-rotated","expires_in":3600,"token_type":"Bearer","scope":"canvas:invoices.read canvas:customers.read"}`))
		case "/oauth2/revoke":
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestRegistryRejectsMoneyMovingToolWithoutControlledScope(t *testing.T) {
	for name, registry := range map[string]string{
		"missing mapping":    `[{"name":"pay","displayName":"Pay","description":"x","mcpUrl":"https://pay.test/mcp","authType":"api_key","audience":"pay-api","mcpTools":[{"name":"refund.create","trustTier":"money-moving"}]}]`,
		"uncontrolled scope": `[{"name":"pay","displayName":"Pay","description":"x","mcpUrl":"https://pay.test/mcp","authType":"api_key","audience":"pay-api","scopes":[{"name":"pay:refunds.create","displayName":"Refund","description":"x","grantTier":"optional","risk":"money-moving"}],"mcpTools":[{"name":"refund.create","trustTier":"money-moving","requiredScopes":["pay:refunds.create"]}]}]`,
		"wrong tier":         `[{"name":"pay","displayName":"Pay","description":"x","mcpUrl":"https://pay.test/mcp","authType":"api_key","audience":"pay-api","scopes":[{"name":"pay:refunds.create","displayName":"Refund","description":"x","grantTier":"optional","risk":"money-moving","stepUpRequired":true,"perInvocationApproval":true}],"mcpTools":[{"name":"refund.create","trustTier":"act","requiredScopes":["pay:refunds.create"]}]}]`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := connectors.LoadRegistry([]byte(registry)); err == nil {
				t.Fatal("invalid money-moving registry was accepted")
			}
		})
	}
}

func TestStripeAPIKeyMoneyMovingAuthorizationLifecycle(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	ctx := auth.WithUser(context.Background(), u)
	setKey := func(key string) {
		rec := httptest.NewRecorder()
		h.SetAPIKey(rec, httptest.NewRequest(http.MethodPost, "/v1/connections/stripe/api-key", strings.NewReader(`{"apiKey":"`+key+`"}`)).WithContext(withParam(ctx, "name", "stripe")))
		if rec.Code != http.StatusOK {
			t.Fatalf("set key: %d %s", rec.Code, rec.Body.String())
		}
	}
	listHasRefund := func() bool {
		rec := httptest.NewRecorder()
		h.List(rec, httptest.NewRequest(http.MethodGet, "/v1/connectors", nil).WithContext(ctx))
		var body struct {
			Connectors []struct {
				Name     string `json:"name"`
				MCPTools []struct {
					Name string `json:"name"`
				} `json:"mcpTools"`
			} `json:"connectors"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		for _, c := range body.Connectors {
			if c.Name == "stripe" {
				for _, tool := range c.MCPTools {
					if tool.Name == "refund.create" {
						return true
					}
				}
			}
		}
		return false
	}
	grant := func(actor *auth.Actor) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		grantCtx := auth.WithActor(ctx, actor)
		h.AuthorizeAPIKeyGrant(rec, httptest.NewRequest(http.MethodPost, "/v1/connections/stripe/authorization-grant", strings.NewReader(`{"scopes":["stripe:refunds.create"]}`)).WithContext(withParam(grantCtx, "name", "stripe")))
		return rec
	}
	setKey("sk_test_1")
	if listHasRefund() {
		t.Fatal("refund.create advertised from key possession alone")
	}
	if rec := grant(&auth.Actor{Kind: auth.KindUser, WorkOSUserID: u.WorkosUserID}); rec.Code != http.StatusForbidden {
		t.Fatalf("grant without step-up = %d", rec.Code)
	}
	if rec := grant(&auth.Actor{Kind: auth.KindUser, WorkOSUserID: "wrong", AuthMethods: []string{"mfa"}}); rec.Code != http.StatusForbidden {
		t.Fatalf("wrong user grant = %d", rec.Code)
	}
	if rec := grant(&auth.Actor{Kind: auth.KindUser, WorkOSUserID: u.WorkosUserID, AuthMethods: []string{"mfa"}}); rec.Code != http.StatusOK {
		t.Fatalf("grant = %d %s", rec.Code, rec.Body.String())
	}
	if !listHasRefund() {
		t.Fatal("refund.create not advertised after explicit grant")
	}
	setKey("sk_test_2")
	if listHasRefund() {
		t.Fatal("generation change did not clear refund grant")
	}
	conn := client.MCPConnection.Query().Where(mcpconnection.ConnectorEQ("stripe"), mcpconnection.OrganizationIDEQ("org_1")).OnlyX(ctx)
	if slices.Contains(conn.Scopes, "stripe:refunds.create") {
		t.Fatal("grant survived key replacement")
	}
	disconnect := httptest.NewRecorder()
	h.Delete(disconnect, httptest.NewRequest(http.MethodDelete, "/v1/connections/stripe", nil).WithContext(withParam(ctx, "name", "stripe")))
	if rec := grant(&auth.Actor{Kind: auth.KindUser, WorkOSUserID: u.WorkosUserID, AuthMethods: []string{"mfa"}}); rec.Code != http.StatusNotFound {
		t.Fatalf("grant after disconnect = %d", rec.Code)
	}
}

func setup(t *testing.T, registry *connectors.Registry) (*ent.Client, *ent.User, *connectors.Handler) {
	return setupWithLegacyStateWrite(t, registry, false)
}

func setupWithLegacyStateWrite(t *testing.T, registry *connectors.Registry, legacyStateWrite bool) (*ent.Client, *ent.User, *connectors.Handler) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SetWorkosOrgID("org_1").SaveX(context.Background())
	d.Client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(auth.WithUser(context.Background(), u))
	sealer, _ := crypto.NewSealer("test-key")
	h := connectors.New(d.Client, sealer, registry, connectors.Config{
		OryPublicURL:          "https://placeholder",
		OryBrokerClientID:     "broker",
		OryBrokerClientSecret: "secret",
		PublicBaseURL:         "https://api.test",
		DeepLinkScheme:        "solomon-ai",
		OAuthLegacyStateWrite: legacyStateWrite,
	}, zap.NewNop())
	h.SetResourceTokenIssuer(newTestResourceTokenIssuer(t))
	h.SetRefreshDedup(workosauth.NewMemoryRefreshCache(), sealer)
	return d.Client, u, h
}

func newTestResourceTokenIssuer(t *testing.T) connectors.ResourceTokenIssuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate resource token key: %v", err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	issuer, err := connectors.NewRSAResourceTokenIssuer(pemBytes, "test-key", "https://broker.test", 5*time.Minute)
	if err != nil {
		t.Fatalf("resource token issuer: %v", err)
	}
	return issuer
}

// withParam injects a chi URL param.
func withParam(ctx context.Context, key, val string) context.Context {
	rc := chi.NewRouteContext()
	rc.URLParams.Add(key, val)
	return context.WithValue(ctx, chi.RouteCtxKey, rc)
}

func invalidationContext(principal string, allowedConnectors, selectors []string) context.Context {
	ctx := auth.WithInternal(context.Background())
	return auth.WithActor(ctx, &auth.Actor{
		Kind: auth.KindService, ServiceName: principal,
		Capabilities:           []string{auth.ConnectorInvalidationCapabilityProduct},
		AllowedConnectors:      allowedConnectors,
		AllowedSelectorClasses: selectors,
	})
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
	for _, want := range []string{"/oauth2/auth", "code_challenge=", "state=", "audience=mcp%3Acanvas", "offline_access"} {
		if !strings.Contains(startBody.AuthorizeURL, want) {
			t.Errorf("authorize_url missing %q: %s", want, startBody.AuthorizeURL)
		}
	}

	// Secure steady-state writes never persist the bearer state. The required
	// legacy column contains only a non-secret digest sentinel.
	pending := client.OAuthPending.Query().FirstX(context.Background())
	authorizeURL, _ := url.Parse(startBody.AuthorizeURL)
	state := authorizeURL.Query().Get("state")
	if state == "" || pending.State == state || pending.StateHash == "" || pending.State != "sha256:"+pending.StateHash {
		t.Fatalf("pending state was not hash-only: raw=%q stored=%q hash=%q", state, pending.State, pending.StateHash)
	}

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
	if !strings.Contains(listRec.Body.String(), `"templateBlocks"`) || !strings.Contains(listRec.Body.String(), `"invoice-context"`) {
		t.Fatalf("list should expose connector template blocks: %s", listRec.Body.String())
	}
	if !strings.Contains(listRec.Body.String(), `"availableScopes"`) || !strings.Contains(listRec.Body.String(), `"grantTier":"required"`) || !strings.Contains(listRec.Body.String(), `"grantedScopes"`) {
		t.Fatalf("list should expose structured available/granted scopes: %s", listRec.Body.String())
	}

	// 4. mcp-token refreshes via Ory.
	tokRec := httptest.NewRecorder()
	h.MCPToken(tokRec, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/mcp-token", nil).
		WithContext(withParam(authed, "name", "canvas")))
	if tokRec.Code != http.StatusOK {
		t.Fatalf("mcp-token: want 200, got %d: %s", tokRec.Code, tokRec.Body.String())
	}
	if strings.Contains(tokRec.Body.String(), "acc-refresh_token") || !strings.Contains(tokRec.Body.String(), `"scope":"canvas:invoices.read canvas:customers.read"`) {
		t.Errorf("mcp-token should return a scoped broker token without the upstream access token: %s", tokRec.Body.String())
	}

	// 5. Delete revokes and retains an audit tombstone without credentials.
	credentialBeforeDelete := bytes.Clone(client.MCPConnection.Query().OnlyX(authed).RefreshTokenEncrypted)
	delRec := httptest.NewRecorder()
	h.Delete(delRec, httptest.NewRequest(http.MethodDelete, "/v1/connections/canvas", nil).
		WithContext(withParam(authed, "name", "canvas")))
	if delRec.Code != http.StatusNoContent {
		t.Fatalf("delete: want 204, got %d", delRec.Code)
	}
	if n := client.MCPConnection.Query().CountX(authed); n != 1 {
		t.Fatalf("connection tombstone should be retained, got %d", n)
	}
	tombstone := client.MCPConnection.Query().OnlyX(authed)
	if tombstone.Status != "revoked" || tombstone.RevokedAt.IsZero() || len(tombstone.RefreshTokenEncrypted) != 0 {
		t.Fatalf("invalid revocation tombstone: %+v", tombstone)
	}
	if n := client.ConnectorAuditEvent.Query().CountX(authed); n == 0 {
		t.Fatal("semantic connector audit events should be retained")
	}
	assertCredentialMaterialAbsent(t, client, pending.PayloadEncrypted, credentialBeforeDelete)
}

func TestOAuthStartLegacyStateWriteIsExplicit(t *testing.T) {
	client, u, h := setupWithLegacyStateWrite(t, connectors.DefaultRegistry(), true)
	authed := auth.WithUser(context.Background(), u)

	request := httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/start", nil).
		WithContext(withParam(authed, "name", "canvas"))
	recorder := httptest.NewRecorder()
	h.Start(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("start: want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		AuthorizeURL string `json:"authorize_url"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	authorizeURL, err := url.Parse(body.AuthorizeURL)
	if err != nil {
		t.Fatalf("parse authorize URL: %v", err)
	}
	state := authorizeURL.Query().Get("state")
	pending := client.OAuthPending.Query().FirstX(context.Background())
	if state == "" || pending.State != state || pending.StateHash == "" {
		t.Fatalf("legacy rollout did not dual-write state: raw=%q stored=%q hash=%q", state, pending.State, pending.StateHash)
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
		if len(connector.TemplateBlocks) == 0 {
			t.Fatalf("%s has no onboarding template blocks", connector.Name)
		}
		blockIDs := map[string]bool{}
		tools := map[string]bool{}
		for _, tool := range connector.MCPTools {
			tools[tool.Name] = true
		}
		for _, block := range connector.TemplateBlocks {
			if block.ID == "" || block.Title == "" || block.Description == "" || block.Category == "" {
				t.Fatalf("%s has an incomplete template block: %+v", connector.Name, block)
			}
			if blockIDs[block.ID] {
				t.Fatalf("%s declares duplicate template block %q", connector.Name, block.ID)
			}
			blockIDs[block.ID] = true
			for _, tool := range block.MCPTools {
				if !tools[tool] {
					t.Fatalf("%s template block %q references unknown tool %q", connector.Name, block.ID, tool)
				}
			}
		}
	}
	for _, want := range []string{"canvas", "corinthian", "wispr", "hubspot", "github", "linear", "notion", "stripe"} {
		if !names[want] {
			t.Fatalf("default registry missing connector %q", want)
		}
	}
	hubspot, ok := reg.Get("hubspot")
	if !ok || hubspot.Transport != "native" || hubspot.MCPURL != "" || len(hubspot.NativeTools) != 3 {
		t.Fatalf("HubSpot must use SDK-native tools, got %+v", hubspot)
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
			name: "insecure-mcp-url",
			body: `[{"name":"x","displayName":"X","mcpUrl":"http://127.0.0.1/mcp","authType":"api_key","audience":"x","mcpTools":[{"name":"thing.read","trustTier":"read"}]}]`,
			want: "absolute HTTPS URL",
		},
		{
			name: "mcp-url-with-credentials",
			body: `[{"name":"x","displayName":"X","mcpUrl":"https://user:pass@mcp.test/mcp","authType":"api_key","audience":"x","mcpTools":[{"name":"thing.read","trustTier":"read"}]}]`,
			want: "without userinfo",
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
		{
			name: "template-blocks-without-url",
			body: `[{"name":"x","displayName":"X","authType":"api_key","audience":"x","templateBlocks":[{"id":"b","title":"B","description":"D","category":"c","trustTier":"read"}]}]`,
			want: "declares templateBlocks without mcpUrl",
		},
		{
			name: "native-without-tools",
			body: `[{"name":"x","displayName":"X","transport":"native","authType":"api_key","audience":"x"}]`,
			want: "native transport requires nativeTools",
		},
		{
			name: "native-with-mcp-url",
			body: `[{"name":"x","displayName":"X","transport":"native","mcpUrl":"https://mcp.test","authType":"api_key","audience":"x","nativeTools":[{"name":"thing.read","trustTier":"read"}]}]`,
			want: "cannot declare mcpUrl",
		},
		{
			name: "native-template-with-mcp-tools",
			body: `[{"name":"x","displayName":"X","transport":"native","authType":"api_key","audience":"x","nativeTools":[{"name":"thing.read","trustTier":"read"}],"templateBlocks":[{"id":"b","title":"B","description":"D","category":"c","mcpTools":["thing.read"],"trustTier":"read"}]}]`,
			want: "cannot declare mcpTools",
		},
		{
			name: "mcp-template-with-native-tools",
			body: `[{"name":"x","displayName":"X","mcpUrl":"https://mcp.test","authType":"api_key","audience":"x","mcpTools":[{"name":"thing.read","trustTier":"read"}],"templateBlocks":[{"id":"b","title":"B","description":"D","category":"c","nativeTools":["thing.read"],"trustTier":"read"}]}]`,
			want: "cannot declare nativeTools",
		},
		{
			name: "duplicate-template-block",
			body: `[{"name":"x","displayName":"X","mcpUrl":"https://mcp.test","authType":"api_key","audience":"x","mcpTools":[{"name":"thing.read","trustTier":"read"}],"templateBlocks":[{"id":"b","title":"B","description":"D","category":"c","mcpTools":["thing.read"],"trustTier":"read"},{"id":"b","title":"B","description":"D","category":"c","mcpTools":["thing.read"],"trustTier":"read"}]}]`,
			want: `duplicate template block "b"`,
		},
		{
			name: "template-unknown-tool",
			body: `[{"name":"x","displayName":"X","mcpUrl":"https://mcp.test","authType":"api_key","audience":"x","mcpTools":[{"name":"thing.read","trustTier":"read"}],"templateBlocks":[{"id":"b","title":"B","description":"D","category":"c","mcpTools":["thing.write"],"trustTier":"read"}]}]`,
			want: `references unknown MCP tool "thing.write"`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := connectors.LoadRegistry([]byte(tc.body)); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("LoadRegistry err = %v, want containing %q", err, tc.want)
			}
		})
	}
}

func TestNativeConnectorDoesNotMintMCPToken(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	authed := auth.WithUser(context.Background(), u)

	keyRec := httptest.NewRecorder()
	h.SetAPIKey(keyRec, httptest.NewRequest(http.MethodPost, "/v1/connections/hubspot/api-key", strings.NewReader(`{"apiKey":"pat-test"}`)).
		WithContext(withParam(authed, "name", "hubspot")))
	if keyRec.Code != http.StatusOK {
		t.Fatalf("save HubSpot key: %d %s", keyRec.Code, keyRec.Body.String())
	}
	if client.MCPConnection.Query().CountX(authed) != 1 {
		t.Fatal("expected native HubSpot credential to be stored")
	}

	tokenRec := httptest.NewRecorder()
	h.MCPToken(tokenRec, httptest.NewRequest(http.MethodPost, "/v1/connections/hubspot/mcp-token", nil).
		WithContext(withParam(authed, "name", "hubspot")))
	if tokenRec.Code != http.StatusBadRequest || !strings.Contains(tokenRec.Body.String(), "unsupported_transport") {
		t.Fatalf("native MCP token response: %d %s", tokenRec.Code, tokenRec.Body.String())
	}
}

func TestAPIKeyConnectorFlow(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	authed := auth.WithUser(context.Background(), u)

	rec := httptest.NewRecorder()
	h.SetAPIKey(rec, httptest.NewRequest(http.MethodPost, "/v1/connections/github/api-key", strings.NewReader(`{"apiKey":"ghp_test"}`)).
		WithContext(withParam(authed, "name", "github")))
	if rec.Code != http.StatusOK {
		t.Fatalf("set api key: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if n := client.MCPConnection.Query().CountX(authed); n != 1 {
		t.Fatalf("expected 1 mcp connection after api key save, got %d", n)
	}

	listRec := httptest.NewRecorder()
	h.List(listRec, httptest.NewRequest(http.MethodGet, "/v1/connectors", nil).WithContext(authed))
	if !strings.Contains(listRec.Body.String(), `"github"`) || !strings.Contains(listRec.Body.String(), `"connected":true`) {
		t.Fatalf("list should show api-key connector connected: %s", listRec.Body.String())
	}

	tokRec := httptest.NewRecorder()
	h.MCPToken(tokRec, httptest.NewRequest(http.MethodPost, "/v1/connections/github/mcp-token", nil).
		WithContext(withParam(authed, "name", "github")))
	if tokRec.Code != http.StatusOK {
		t.Fatalf("mcp-token: want 200, got %d: %s", tokRec.Code, tokRec.Body.String())
	}
	if strings.Contains(tokRec.Body.String(), "ghp_test") || !strings.Contains(tokRec.Body.String(), `"expires_in"`) {
		t.Fatalf("mcp-token must return a short-lived broker token without the stored API key: %s", tokRec.Body.String())
	}

	badRec := httptest.NewRecorder()
	h.SetAPIKey(badRec, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/api-key", strings.NewReader(`{"apiKey":"x"}`)).
		WithContext(withParam(authed, "name", "canvas")))
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("set api key on oauth connector: want 400, got %d: %s", badRec.Code, badRec.Body.String())
	}
}

func TestPreConsentEntitlement(t *testing.T) {
	// Canvas requires the pro plan; our user is on free → deny + upsell.
	reg, _ := connectors.LoadRegistry([]byte(`[{"name":"canvas","displayName":"Canvas","authType":"oauth","audience":"mcp:canvas","requiredPlan":"pro","scopes":[{"name":"canvas:invoices.read","displayName":"Read invoices","description":"View invoices.","grantTier":"required","risk":"low"}]}]`))
	client, u, h := setup(t, reg)
	client.OAuthPending.Create().
		SetState("sha256:test-entitlement").
		SetProvider("canvas").
		SetPayloadEncrypted([]byte("sealed")).
		SetExpiresAt(time.Now().Add(time.Minute)).
		SetLifecycleStatus("started").
		SetOwnerWorkosUserID(u.WorkosUserID).
		SetRequestedScopes([]string{"canvas:invoices.read"}).
		ExecX(context.Background())

	body := `{"version":1,"challenge":"hydra-challenge","workos_user_id":"user_1","hydra_client_id":"broker","requested_audience":["mcp:canvas"],"requested_scopes":["canvas:invoices.read"]}`
	req := httptest.NewRequest(http.MethodPost, "/oauth-hooks/pre-consent", strings.NewReader(body)).
		WithContext(auth.WithInternal(context.Background()))
	rec := httptest.NewRecorder()
	h.PreConsent(rec, req)

	var resp struct {
		Entitlement struct {
			Allowed      bool   `json:"allowed"`
			RequiredPlan string `json:"required_plan"`
		} `json:"entitlement"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Entitlement.Allowed {
		t.Fatal("free user should be denied a pro connector")
	}
	if resp.Entitlement.RequiredPlan != "pro" {
		t.Fatalf("upsell plan = %q", resp.Entitlement.RequiredPlan)
	}
}

func TestInvalidate(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	sealer, _ := crypto.NewSealer("test-key")
	_ = sealer
	// Seed a connection directly.
	client.MCPConnection.Create().SetUser(u).SetConnector("canvas").SetAudience("canvas-api").
		SetOrganizationID("org_1").
		SetAPIKeyEncrypted([]byte("x")).SaveX(auth.WithUser(context.Background(), u))

	body := `{"workos_user_id":"user_1","connector":"canvas"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate", strings.NewReader(body)).
		WithContext(invalidationContext("canvas-api", []string{"canvas"}, []string{auth.ConnectorInvalidationSelectorUser}))
	rec := httptest.NewRecorder()
	h.Invalidate(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("invalidate: want 200, got %d", rec.Code)
	}
	if n := client.MCPConnection.Query().CountX(auth.WithInternal(context.Background())); n != 1 {
		t.Fatalf("connection tombstone should be retained, got %d", n)
	}
	tombstone := client.MCPConnection.Query().OnlyX(auth.WithInternal(context.Background()))
	if tombstone.Status != "invalidated" || tombstone.RevokedAt.IsZero() || len(tombstone.APIKeyEncrypted) != 0 {
		t.Fatalf("forced invalidation did not create a safe tombstone: %+v", tombstone)
	}
	if tombstone.RevokedBy != "canvas-api" {
		t.Fatalf("revoked_by = %q, want service principal", tombstone.RevokedBy)
	}
	audit := client.ConnectorAuditEvent.Query().Where(connectorauditevent.EventTypeEQ("connection_invalidated")).OnlyX(auth.WithInternal(context.Background()))
	if audit.ActorKind != string(auth.KindService) || !strings.Contains(audit.MetadataJSON, `"servicePrincipal":"canvas-api"`) {
		t.Fatalf("invalidation audit lost service principal: %+v", audit)
	}
	assertCredentialMaterialAbsent(t, client, []byte("x"))
}

func TestInvalidateRejectsLegacyGlobalInternalPrincipal(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	connection := client.MCPConnection.Create().SetUser(u).SetConnector("canvas").SetAudience("canvas-api").
		SetOrganizationID("org_1").SetAPIKeyEncrypted([]byte("canvas-key")).SaveX(auth.WithUser(context.Background(), u))
	ctx := auth.WithInternal(context.Background())
	ctx = auth.WithActor(ctx, &auth.Actor{Kind: auth.KindInternal, ServiceName: "internal-api"})
	rec := httptest.NewRecorder()
	h.Invalidate(rec, httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate",
		strings.NewReader(`{"workos_user_id":"user_1","connector":"canvas"}`)).WithContext(ctx))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("legacy internal principal: got %d, want 403: %s", rec.Code, rec.Body.String())
	}
	fresh := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
	if fresh.Status != "active" || len(fresh.APIKeyEncrypted) == 0 {
		t.Fatalf("legacy global principal changed connector grant: %+v", fresh)
	}
}

func TestInvalidateRejectsCrossProductAndCrossTenantSelectors(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	other := client.User.Create().SetEmail("other@x.co").SetWorkosUserID("user_2").SetWorkosOrgID("org_2").SaveX(context.Background())
	canvas := client.MCPConnection.Create().SetUser(u).SetConnector("canvas").SetAudience("canvas-api").
		SetOrganizationID("org_1").SetAPIKeyEncrypted([]byte("canvas-key")).SaveX(auth.WithUser(context.Background(), u))
	github := client.MCPConnection.Create().SetUser(u).SetConnector("github").SetAudience("github-api").
		SetOrganizationID("org_1").SetAPIKeyEncrypted([]byte("github-key")).SaveX(auth.WithUser(context.Background(), u))
	otherCanvas := client.MCPConnection.Create().SetUser(other).SetConnector("canvas").SetAudience("canvas-api").
		SetOrganizationID("org_2").SetAPIKeyEncrypted([]byte("other-key")).SaveX(auth.WithUser(context.Background(), other))

	productCtx := invalidationContext("canvas-api", []string{"canvas"}, []string{
		auth.ConnectorInvalidationSelectorConnection,
		auth.ConnectorInvalidationSelectorUser,
		auth.ConnectorInvalidationSelectorOrganization,
	})
	crossProduct := httptest.NewRecorder()
	h.Invalidate(crossProduct, httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate",
		strings.NewReader(`{"connection_id":"`+github.ID.String()+`","connector":"github"}`)).WithContext(productCtx))
	if crossProduct.Code != http.StatusForbidden {
		t.Fatalf("cross-product invalidation: got %d, want 403: %s", crossProduct.Code, crossProduct.Body.String())
	}
	if got := client.MCPConnection.GetX(auth.WithInternal(context.Background()), github.ID); got.Status != "active" || len(got.APIKeyEncrypted) == 0 {
		t.Fatalf("cross-product request changed github grant: %+v", got)
	}

	crossTenant := httptest.NewRecorder()
	h.Invalidate(crossTenant, httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate",
		strings.NewReader(`{"connection_id":"`+canvas.ID.String()+`","org_id":"org_2","connector":"canvas"}`)).WithContext(productCtx))
	if crossTenant.Code != http.StatusOK || !strings.Contains(crossTenant.Body.String(), `"matched":0`) {
		t.Fatalf("cross-tenant selector should match nothing: %d %s", crossTenant.Code, crossTenant.Body.String())
	}
	if got := client.MCPConnection.GetX(auth.WithInternal(context.Background()), canvas.ID); got.Status != "active" || len(got.APIKeyEncrypted) == 0 {
		t.Fatalf("cross-tenant request changed tenant A grant: %+v", got)
	}
	if got := client.MCPConnection.GetX(auth.WithInternal(context.Background()), otherCanvas.ID); got.Status != "active" || len(got.APIKeyEncrypted) == 0 {
		t.Fatalf("cross-tenant request changed tenant B grant: %+v", got)
	}
}

func TestInvalidateOrganizationUsesImmutableConnectionOrganization(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	connection := client.MCPConnection.Create().SetUser(u).SetConnector("canvas").SetAudience("canvas-api").
		SetOrganizationID("org_original").SetAPIKeyEncrypted([]byte("canvas-key")).SaveX(auth.WithUser(context.Background(), u))
	client.User.UpdateOneID(u.ID).SetWorkosOrgID("org_current").ExecX(auth.WithInternal(context.Background()))

	rec := httptest.NewRecorder()
	h.Invalidate(rec, httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate",
		strings.NewReader(`{"org_id":"org_original","connector":"canvas"}`)).WithContext(
		invalidationContext("canvas-api", []string{"canvas"}, []string{auth.ConnectorInvalidationSelectorOrganization}),
	))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"matched":1`) {
		t.Fatalf("immutable org invalidation: %d %s", rec.Code, rec.Body.String())
	}
	tombstone := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
	if tombstone.Status != "invalidated" || tombstone.OrganizationID != "org_original" {
		t.Fatalf("mutable user org retargeted immutable credential: %+v", tombstone)
	}
}

func TestRevocationRetryMarksTombstoneSucceeded(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth2/revoke" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if fail.Load() {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(ory.Close)

	client, u, h := setup(t, connectors.DefaultRegistry())
	h.SetOryBaseURL(ory.URL)
	sealer, _ := crypto.NewSealer("test-key")
	sealed, err := sealer.Seal([]byte("provider-refresh"))
	if err != nil {
		t.Fatal(err)
	}
	connection := client.MCPConnection.Create().SetUser(u).SetConnector("canvas").SetAudience("canvas-api").
		SetOrganizationID("org_1").SetRefreshTokenEncrypted(sealed).SaveX(auth.WithUser(context.Background(), u))
	rec := httptest.NewRecorder()
	h.Invalidate(rec, httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate",
		strings.NewReader(`{"connection_id":"`+connection.ID.String()+`","connector":"canvas"}`)).WithContext(
		invalidationContext("canvas-api", []string{"canvas"}, []string{auth.ConnectorInvalidationSelectorConnection}),
	))
	if rec.Code != http.StatusOK {
		t.Fatalf("invalidate: %d %s", rec.Code, rec.Body.String())
	}
	tombstone := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
	job := client.ConnectorRevocationJob.Query().OnlyX(auth.WithInternal(context.Background()))
	if tombstone.RevocationSucceeded || job.CredentialGeneration != tombstone.CredentialGeneration {
		t.Fatalf("job generation must target pending tombstone: tombstone=%+v job=%+v", tombstone, job)
	}

	fail.Store(false)
	completed, err := h.ProcessRevocationJobs(context.Background(), 10)
	if err != nil || completed != 1 {
		t.Fatalf("process revocation jobs = %d, %v", completed, err)
	}
	tombstone = client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
	if !tombstone.RevocationSucceeded || tombstone.Status != "invalidated" || len(tombstone.RefreshTokenEncrypted) != 0 {
		t.Fatalf("provider success did not mark safe tombstone: %+v", tombstone)
	}
	if client.ConnectorRevocationJob.Query().CountX(auth.WithInternal(context.Background())) != 0 {
		t.Fatal("completed revocation job was not retired")
	}
	assertCredentialMaterialAbsent(t, client, sealed)
}

func TestRevocationRetryDoesNotClearNewerGrant(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if fail.Load() {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(ory.Close)

	client, u, h := setup(t, connectors.DefaultRegistry())
	h.SetOryBaseURL(ory.URL)
	sealer, _ := crypto.NewSealer("test-key")
	oldSealed, _ := sealer.Seal([]byte("old-provider-refresh"))
	newSealed, _ := sealer.Seal([]byte("new-provider-refresh"))
	connection := client.MCPConnection.Create().SetUser(u).SetConnector("canvas").SetAudience("canvas-api").
		SetOrganizationID("org_1").SetRefreshTokenEncrypted(oldSealed).SaveX(auth.WithUser(context.Background(), u))
	rec := httptest.NewRecorder()
	h.Invalidate(rec, httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate",
		strings.NewReader(`{"connection_id":"`+connection.ID.String()+`","connector":"canvas"}`)).WithContext(
		invalidationContext("canvas-api", []string{"canvas"}, []string{auth.ConnectorInvalidationSelectorConnection}),
	))
	if rec.Code != http.StatusOK {
		t.Fatalf("invalidate: %d %s", rec.Code, rec.Body.String())
	}
	tombstone := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
	client.MCPConnection.UpdateOneID(connection.ID).
		SetStatus("active").
		SetRefreshTokenEncrypted(newSealed).
		AddCredentialGeneration(1).
		SetRevocationSucceeded(false).
		ExecX(auth.WithUser(context.Background(), u))

	fail.Store(false)
	completed, err := h.ProcessRevocationJobs(context.Background(), 10)
	if err != nil || completed != 1 {
		t.Fatalf("process stale revocation job = %d, %v", completed, err)
	}
	fresh := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
	if fresh.CredentialGeneration != tombstone.CredentialGeneration+1 || fresh.Status != "active" ||
		!bytes.Equal(fresh.RefreshTokenEncrypted, newSealed) {
		t.Fatalf("old revocation cleared newer grant: tombstone=%+v fresh=%+v", tombstone, fresh)
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

	other := client.User.Create().SetEmail("other@x.co").SetWorkosUserID("user_2").SetWorkosOrgID("org_2").SaveX(ctx)
	otherKey, _ := sealer.SealString("wrong-user-key")
	client.MCPConnection.Create().
		SetUser(other).
		SetConnector("wispr").
		SetAudience("wispr-api").
		SetOrganizationID("org_2").
		SetAPIKeyEncrypted(otherKey).
		SaveX(ctx)

	userKey, _ := sealer.SealString("vendor-key")
	conn := client.MCPConnection.Create().
		SetUser(u).
		SetConnector("wispr").
		SetAudience("wispr-api").
		SetOrganizationID("org_1").
		SetAPIKeyEncrypted(userKey).
		SaveX(ctx)

	resolver := connectors.NewMCPRuntimeResolver(client, sealer, reg, connectors.Config{})
	resolver.SetResourceTokenIssuer(newTestResourceTokenIssuer(t))
	mcpURL, tokenType, token, err := resolver.ResolveMCP(context.Background(), u.ID.String(), "wispr")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if mcpURL != "https://mcp.test/mcp" || tokenType != "Bearer" || strings.Count(token, ".") != 2 || strings.Contains(token, "vendor-key") {
		t.Fatalf("resolved url/type/token = %q/%q/%q", mcpURL, tokenType, token)
	}
	if updated := client.MCPConnection.GetX(ctx, conn.ID); updated.LastUsedAt.IsZero() {
		t.Fatal("last_used_at should be updated")
	}
}

func TestMCPRuntimeResolverRefreshesOAuthConnector(t *testing.T) {
	ory := mockOry(t)
	defer ory.Close()
	reg, err := connectors.LoadRegistry([]byte(`[{"name":"canvas","displayName":"Canvas","mcpUrl":"https://canvas.test/mcp","authType":"oauth","audience":"canvas-api","scopes":[{"name":"canvas:invoices.read","displayName":"Read invoices","description":"Read invoices","grantTier":"required","risk":"low"}],"mcpTools":[{"name":"invoice.lookup","trustTier":"read"}]}]`))
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
		SetOrganizationID("org_1").
		SetScopes([]string{"canvas:invoices.read"}).
		SetRefreshTokenEncrypted(sealed).
		SaveX(ctx)

	resolver := connectors.NewMCPRuntimeResolver(client, sealer, reg, connectors.Config{
		OryPublicURL:          ory.URL,
		OryBrokerClientID:     "broker",
		OryBrokerClientSecret: "secret",
	})
	resolver.SetRefreshDedup(workosauth.NewMemoryRefreshCache(), sealer, zap.NewNop())
	resolver.SetResourceTokenIssuer(newTestResourceTokenIssuer(t))
	mcpURL, tokenType, token, err := resolver.ResolveMCP(context.Background(), u.ID.String(), "canvas")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if mcpURL != "https://canvas.test/mcp" || tokenType != "Bearer" || strings.Count(token, ".") != 2 || strings.Contains(token, "acc-refresh_token") {
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

func TestMCPTokenInvalidGrantTransitionsToReauthRequired(t *testing.T) {
	ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
	}))
	t.Cleanup(ory.Close)

	client, u, h := setup(t, connectors.DefaultRegistry())
	h.SetOryBaseURL(ory.URL)
	sealer, err := crypto.NewSealer("test-key")
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := sealer.SealString("expired-refresh-token")
	if err != nil {
		t.Fatal(err)
	}
	ctx := auth.WithUser(context.Background(), u)
	connection := client.MCPConnection.Create().
		SetUser(u).
		SetConnector("canvas").
		SetAudience("mcp:canvas").
		SetOrganizationID("org_1").
		SetScopes([]string{"canvas:invoices.read", "canvas:customers.read"}).
		SetRefreshTokenEncrypted(sealed).
		SaveX(ctx)

	rec := httptest.NewRecorder()
	h.MCPToken(rec, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/mcp-token", strings.NewReader(`{"audience":"mcp:canvas","requestedScopes":["canvas:invoices.read","canvas:customers.read"]}`)).
		WithContext(withParam(ctx, "name", "canvas")))
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"code":"reauth_required"`) {
		t.Fatalf("invalid_grant response = %d %s", rec.Code, rec.Body.String())
	}
	if got := client.MCPConnection.GetX(ctx, connection.ID).Status; got != "reauth_required" {
		t.Fatalf("connection status = %q, want reauth_required", got)
	}
}

func TestMCPTokenCollapsesConcurrentRotatingRefreshes(t *testing.T) {
	var hits atomic.Int64
	var mu sync.Mutex
	consumed := false
	ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("grant_type") != "refresh_token" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		hits.Add(1)
		mu.Lock()
		if consumed {
			mu.Unlock()
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		consumed = true
		mu.Unlock()
		time.Sleep(50 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"acc-one","refresh_token":"rt-next","expires_in":3600,"token_type":"Bearer"}`))
	}))
	t.Cleanup(ory.Close)

	client, u, h := setup(t, connectors.DefaultRegistry())
	h.SetOryBaseURL(ory.URL)
	sealer, _ := crypto.NewSealer("test-key")
	sealed, _ := sealer.SealString("rt-once")
	ctx := auth.WithUser(context.Background(), u)
	client.MCPConnection.Create().
		SetUser(u).
		SetConnector("canvas").
		SetAudience("mcp:canvas").
		SetOrganizationID("org_1").
		SetScopes([]string{"canvas:invoices.read", "canvas:customers.read"}).
		SetRefreshTokenEncrypted(sealed).
		SaveX(ctx)

	const callers = 8
	var wg sync.WaitGroup
	codes := make([]int, callers)
	for i := range callers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/mcp-token", nil).
				WithContext(withParam(auth.WithUser(context.Background(), u), "name", "canvas"))
			h.MCPToken(rec, req)
			codes[i] = rec.Code
		}(i)
	}
	wg.Wait()
	for i, code := range codes {
		if code != http.StatusOK {
			t.Fatalf("caller %d status = %d, want 200", i, code)
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("rotating token endpoint hits = %d, want 1", hits.Load())
	}
	if got := client.ConnectorAuditEvent.Query().Where(connectorauditevent.EventTypeEQ("token.refreshed")).CountX(auth.WithInternal(context.Background())); got != 1 {
		t.Fatalf("token.refreshed audit count = %d, want 1", got)
	}
	if got := client.ConnectorAuditEvent.Query().Where(connectorauditevent.EventTypeEQ("token.minted")).CountX(auth.WithInternal(context.Background())); got != callers {
		t.Fatalf("token.minted audit count = %d, want %d", got, callers)
	}
}

func TestExpiredCallbackLeaseForcesBoundedRestart(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	ctx := auth.WithUser(context.Background(), u)
	start := httptest.NewRecorder()
	h.Start(start, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/start", nil).WithContext(withParam(ctx, "name", "canvas")))
	var body struct {
		AuthorizeURL string `json:"authorize_url"`
	}
	_ = json.Unmarshal(start.Body.Bytes(), &body)
	parsed, _ := url.Parse(body.AuthorizeURL)
	state := parsed.Query().Get("state")
	pending := client.OAuthPending.Query().OnlyX(auth.WithInternal(context.Background()))
	pending.Update().SetLifecycleStatus("callback_processing").SetCallbackClaimID(uuid.New()).SetCallbackClaimedUntil(time.Now().Add(-time.Minute)).SaveX(auth.WithInternal(context.Background()))
	rec := httptest.NewRecorder()
	h.Callback(rec, httptest.NewRequest(http.MethodGet, "/v1/connections/canvas/callback?code=one-use&state="+state, nil).WithContext(withParam(context.Background(), "name", "canvas")))
	if rec.Code != http.StatusFound || !strings.Contains(rec.Header().Get("Location"), "status=restart_required") {
		t.Fatalf("expired callback lease response = %d %q", rec.Code, rec.Header().Get("Location"))
	}
	if got := client.OAuthPending.GetX(auth.WithInternal(context.Background()), pending.ID).LifecycleStatus; got != "restart_required" {
		t.Fatalf("pending lifecycle = %q, want restart_required", got)
	}
}

func TestDeleteFencesInFlightRefreshAndRevokesRotatedCredential(t *testing.T) {
	refreshStarted := make(chan struct{})
	revoked := make(chan string, 4)
	ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.URL.Path == "/oauth2/revoke" {
			revoked <- r.Form.Get("token")
			w.WriteHeader(http.StatusOK)
			return
		}
		close(refreshStarted)
		time.Sleep(250 * time.Millisecond)
		_, _ = w.Write([]byte(`{"access_token":"access-new","refresh_token":"refresh-new","expires_in":3600,"token_type":"Bearer"}`))
	}))
	t.Cleanup(ory.Close)
	client, u, h := setup(t, connectors.DefaultRegistry())
	h.SetOryBaseURL(ory.URL)
	sealer, _ := crypto.NewSealer("test-key")
	sealed, _ := sealer.SealString("refresh-old")
	ctx := auth.WithUser(context.Background(), u)
	connection := client.MCPConnection.Create().SetUser(u).SetConnector("canvas").SetOrganizationID("org_1").SetAudience("mcp:canvas").SetScopes([]string{"canvas:invoices.read", "canvas:customers.read"}).SetRefreshTokenEncrypted(sealed).SaveX(ctx)
	tokenDone := make(chan int, 1)
	go func() {
		rec := httptest.NewRecorder()
		h.MCPToken(rec, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/mcp-token", nil).WithContext(withParam(auth.WithUser(context.Background(), u), "name", "canvas")))
		tokenDone <- rec.Code
	}()
	<-refreshStarted
	deleteDone := make(chan int, 1)
	go func() {
		del := httptest.NewRecorder()
		h.Delete(del, httptest.NewRequest(http.MethodDelete, "/v1/connections/canvas", nil).WithContext(withParam(auth.WithUser(context.Background(), u), "name", "canvas")))
		deleteDone <- del.Code
	}()
	tokenCode := <-tokenDone
	if code := <-deleteDone; code != http.StatusNoContent {
		t.Fatalf("delete = %d", code)
	}
	row := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
	if row.Status != "revoked" || len(row.RefreshTokenEncrypted) != 0 {
		t.Fatalf("unsafe tombstone: %+v", row)
	}
	seen := map[string]bool{}
	for len(revoked) > 0 {
		seen[<-revoked] = true
	}
	if tokenCode != http.StatusOK && !seen["refresh-new"] {
		t.Fatalf("superseded rotated credential was not revoked: %#v", seen)
	}
	if !seen["refresh-old"] && !seen["refresh-new"] {
		t.Fatalf("revoked credentials = %#v", seen)
	}
}

func TestConnectorOwnershipAllowsSameSubjectAcrossOrganizations(t *testing.T) {
	reg, _ := connectors.LoadRegistry([]byte(`[{"name":"github","displayName":"GitHub","authType":"api_key","audience":"github-api"}]`))
	client, u, h := setup(t, reg)
	ctxA := auth.WithUser(context.Background(), u)
	connect := func(ctx context.Context, key string) int {
		rec := httptest.NewRecorder()
		h.SetAPIKey(rec, httptest.NewRequest(http.MethodPost, "/v1/connections/github/api-key", strings.NewReader(`{"apiKey":"`+key+`"}`)).WithContext(withParam(ctx, "name", "github")))
		return rec.Code
	}
	if code := connect(ctxA, "key-a"); code != http.StatusOK {
		t.Fatalf("org A connect = %d", code)
	}
	u = u.Update().SetWorkosOrgID("org_2").SaveX(auth.WithInternal(context.Background()))
	ctxB := auth.WithUser(context.Background(), u)
	list := httptest.NewRecorder()
	h.List(list, httptest.NewRequest(http.MethodGet, "/v1/connectors", nil).WithContext(ctxB))
	if strings.Contains(list.Body.String(), `"connected":true`) {
		t.Fatal("org B observed org A connection")
	}
	if code := connect(ctxB, "key-b"); code != http.StatusOK {
		t.Fatalf("org B connect = %d", code)
	}
	rows := client.MCPConnection.Query().AllX(auth.WithInternal(context.Background()))
	if len(rows) != 2 || rows[0].OrganizationID == rows[1].OrganizationID {
		t.Fatalf("org-scoped rows = %+v", rows)
	}
}
