package connectors_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
)

func TestRegistryScopeCatalogFailsClosed(t *testing.T) {
	base := `[{"name":"pay","displayName":"Pay","mcpUrl":"https://pay.test/mcp","authType":"oauth","audience":"pay-api","scopes":[%s],"mcpTools":[{"name":"payment.execute","trustTier":"money-moving"}]}]`
	for _, tc := range []struct {
		name  string
		scope string
		want  string
	}{
		{"not_namespaced", `{"name":"payments:read","displayName":"Read","description":"Read","grantTier":"required","risk":"low"}`, "namespaced"},
		{"money_without_step_up", `{"name":"pay:payments.execute","displayName":"Pay","description":"Pay","grantTier":"required","risk":"money-moving"}`, "requires stepUpRequired"},
		{"unknown_implication", `{"name":"pay:payments.read","displayName":"Read","description":"Read","grantTier":"required","risk":"low","implies":["pay:missing.read"]}`, "implies unknown scope"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := connectors.LoadRegistry([]byte(strings.Replace(base, "%s", tc.scope, 1)))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
	if _, err := connectors.LoadRegistry([]byte(`[{"name":"x","displayName":"X","description":"X","mcpUrl":"https://x.test/mcp","authType":"api_key","audience":"x-api","mcpTools":[{"name":"x.read","trustTier":"read"}],"unexpected":true}]`)); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown registry fields must fail closed: %v", err)
	}
	if _, err := connectors.LoadRegistryForEnvironment(nil, "production", []string{"missing"}); err == nil || !strings.Contains(err.Error(), "not in the registry") {
		t.Fatalf("unknown emergency disable must fail boot: %v", err)
	}
	reg, err := connectors.LoadRegistryForEnvironment(nil, "production", []string{"canvas"})
	if err != nil || reg.Enabled("canvas") || reg.EffectiveStatus("canvas") != "disabled" {
		t.Fatalf("emergency disable not applied: reg=%v err=%v", reg, err)
	}
}

func TestStartValidatesRequiredScopesAndRedirectBeforeState(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	ctx := withParam(auth.WithUser(context.Background(), u), "name", "canvas")

	for _, body := range []string{
		`{"requestedScopes":["canvas:transactions.read"]}`,
		`{"requestedScopes":["canvas:invoices.read","canvas:customers.read"],"redirectTarget":"evil://connection-complete"}`,
	} {
		rec := httptest.NewRecorder()
		h.Start(rec, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/start", strings.NewReader(body)).WithContext(ctx))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("start body %s: got %d %s", body, rec.Code, rec.Body.String())
		}
	}
	if got := client.OAuthPending.Query().CountX(context.Background()); got != 0 {
		t.Fatalf("invalid start requests created %d pending states", got)
	}
}

func TestCallbackRejectsScopeEscalationAndReplay(t *testing.T) {
	ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"a","refresh_token":"r","expires_in":3600,"token_type":"Bearer","scope":"canvas:invoices.read canvas:customers.read canvas:admin.write"}`))
	}))
	defer ory.Close()
	client, u, h := setup(t, connectors.DefaultRegistry())
	h.SetOryBaseURL(ory.URL)
	ctx := withParam(auth.WithUser(context.Background(), u), "name", "canvas")
	start := httptest.NewRecorder()
	h.Start(start, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/start", strings.NewReader(`{"requestedScopes":["canvas:invoices.read","canvas:customers.read"]}`)).WithContext(ctx))
	var response struct {
		AuthorizeURL string `json:"authorize_url"`
	}
	_ = json.Unmarshal(start.Body.Bytes(), &response)
	u2, _ := url.Parse(response.AuthorizeURL)
	state := u2.Query().Get("state")

	callback := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.Callback(rec, httptest.NewRequest(http.MethodGet, "/v1/connections/canvas/callback?code=x&state="+state, nil).WithContext(withParam(context.Background(), "name", "canvas")))
		return rec
	}
	first := callback()
	if first.Code != http.StatusFound || !strings.Contains(first.Header().Get("Location"), "status=error") {
		t.Fatalf("escalated callback = %d %s", first.Code, first.Header().Get("Location"))
	}
	pending := client.OAuthPending.Query().OnlyX(context.Background())
	if pending.LifecycleStatus != "failed" || pending.FailureReason != "scope_escalation" {
		t.Fatalf("pending transition = %q/%q", pending.LifecycleStatus, pending.FailureReason)
	}
	second := callback()
	if second.Code != http.StatusConflict {
		t.Fatalf("callback replay status = %d, want 409", second.Code)
	}
}

func TestTokenMintValidatesAudienceScopeEntitlementAndRevocation(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	sealer, _ := crypto.NewSealer("test-key")
	sealed, _ := sealer.SealString("ghp_test")
	ctx := auth.WithUser(context.Background(), u)
	connection := client.MCPConnection.Create().SetUser(u).SetConnector("github").SetAudience("github-api").SetAPIKeyEncrypted(sealed).SaveX(ctx)

	request := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.MCPToken(rec, httptest.NewRequest(http.MethodPost, "/v1/connections/github/mcp-token", strings.NewReader(body)).WithContext(withParam(ctx, "name", "github")))
		return rec
	}
	if rec := request(`{"audience":"canvas-api"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("audience mismatch = %d %s", rec.Code, rec.Body.String())
	}
	if rec := request(`{"requestedScopes":["github:admin.write"]}`); rec.Code != http.StatusForbidden {
		t.Fatalf("scope escalation = %d %s", rec.Code, rec.Body.String())
	}
	connection.Update().SetStatus("revoked").SetRevokedAt(client.MCPConnection.GetX(ctx, connection.ID).UpdatedAt).ExecX(ctx)
	if rec := request(`{}`); rec.Code != http.StatusGone {
		t.Fatalf("revoked token mint = %d %s", rec.Code, rec.Body.String())
	}
}

func TestConsentContextAndAuditUseDurablePendingMetadata(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	start := httptest.NewRecorder()
	h.Start(start, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/start", nil).WithContext(withParam(auth.WithUser(context.Background(), u), "name", "canvas")))
	var response struct {
		AuthorizeURL string `json:"authorize_url"`
	}
	_ = json.Unmarshal(start.Body.Bytes(), &response)
	internal := auth.WithInternal(context.Background())

	contextBody := `{"version":1,"challenge":"hydra-consent-challenge","workos_user_id":"user_1","hydra_client_id":"broker","requested_audience":["mcp:canvas"],"requested_scopes":["canvas:invoices.read","canvas:customers.read"]}`
	contextRec := httptest.NewRecorder()
	h.PreConsent(contextRec, httptest.NewRequest(http.MethodPost, "/oauth-hooks/pre-consent", strings.NewReader(contextBody)).WithContext(internal))
	if contextRec.Code != http.StatusOK || !strings.Contains(contextRec.Body.String(), `"display_name":"Rowboat Desktop"`) || !strings.Contains(contextRec.Body.String(), `"tier":"low"`) {
		t.Fatalf("consent context = %d %s", contextRec.Code, contextRec.Body.String())
	}
	if strings.Contains(contextRec.Body.String(), "state") || strings.Contains(contextRec.Body.String(), "payload_encrypted") || strings.Contains(contextRec.Body.String(), "owner_org_id") {
		t.Fatalf("consent context leaked pending metadata: %s", contextRec.Body.String())
	}
	var contextResponse struct {
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(contextRec.Body.Bytes(), &contextResponse); err != nil || contextResponse.RequestID == "" {
		t.Fatalf("context request id missing: %v %s", err, contextRec.Body.String())
	}
	auditPayload, _ := json.Marshal(map[string]any{
		"version": 1, "event_id": "evt-shown-1", "event": "consent.shown",
		"occurred_at": time.Now().UTC().Format(time.RFC3339Nano), "consent_session_id": "session-1",
		"context_request_id": contextResponse.RequestID, "workos_user_id": "user_1", "client_id": "broker",
		"connector_id": "canvas", "audience": "mcp:canvas",
		"scopes": []string{"canvas:invoices.read", "canvas:customers.read"}, "result": "eligible",
	})
	auditRec := httptest.NewRecorder()
	h.AppendConsentAudit(auditRec, httptest.NewRequest(http.MethodPost, "/oauth-hooks/consent-audit", strings.NewReader(string(auditPayload))).WithContext(internal))
	if auditRec.Code != http.StatusOK || strings.TrimSpace(auditRec.Body.String()) != `{"accepted":true}` {
		t.Fatalf("consent audit = %d %s", auditRec.Code, auditRec.Body.String())
	}
	if got := client.ConnectorAuditEvent.Query().CountX(auth.WithUser(context.Background(), u)); got < 2 {
		t.Fatalf("semantic audit count = %d, want start + shown", got)
	}
}
