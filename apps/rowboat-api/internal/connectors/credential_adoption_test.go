package connectors

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func connectorRouteContext(ctx context.Context, name string) context.Context {
	route := chi.NewRouteContext()
	route.URLParams.Add("name", name)
	return context.WithValue(ctx, chi.RouteCtxKey, route)
}

func TestCallbackAndClaimAmbiguousCommitsReconcileWithoutRevocation(t *testing.T) {
	database, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	runAmbiguousCommitScenario(t, database)
}

func runAmbiguousCommitScenario(t *testing.T, database *db.DB) {
	t.Helper()
	client := database.Client
	suffix := strings.ReplaceAll(t.Name(), "/", "-") + "-" + time.Now().UTC().Format("150405.000000000")
	owner := client.User.Create().SetEmail("ambiguous-" + suffix + "@example.invalid").SetWorkosUserID("ambiguous-user-" + suffix).SetWorkosOrgID("ambiguous-org-" + suffix).SaveX(context.Background())
	client.Subscription.Create().SetUser(owner).SetSanctionedCredits(10000).SaveX(auth.WithUser(context.Background(), owner))
	sealer, err := crypto.NewSealer("connector-ambiguous-commit-test")
	if err != nil {
		t.Fatal(err)
	}
	var revokeCalls atomic.Int64
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth2/token":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"access","refresh_token":"refresh-ambiguous","expires_in":3600,"token_type":"Bearer","scope":"canvas:invoices.read canvas:customers.read"}`))
		case "/oauth2/revoke":
			revokeCalls.Add(1)
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(provider.Close)
	h := New(client, sealer, DefaultRegistry(), Config{
		OryPublicURL: provider.URL, OryBrokerClientID: "broker", OryBrokerClientSecret: "secret",
		PublicBaseURL: "https://api.test", DeepLinkScheme: "solomon-ai",
	}, zap.NewNop())
	h.SetRefreshDedup(workosauth.NewMemoryRefreshCache(), sealer)
	authed := auth.WithUser(context.Background(), owner)

	startRecorder := httptest.NewRecorder()
	h.Start(startRecorder, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/start", nil).WithContext(connectorRouteContext(authed, "canvas")))
	if startRecorder.Code != http.StatusOK {
		t.Fatalf("start = %d: %s", startRecorder.Code, startRecorder.Body.String())
	}
	var startBody struct {
		AuthorizeURL string `json:"authorize_url"`
	}
	if err := json.Unmarshal(startRecorder.Body.Bytes(), &startBody); err != nil {
		t.Fatal(err)
	}
	authorizeURL, err := url.Parse(startBody.AuthorizeURL)
	if err != nil {
		t.Fatal(err)
	}
	state := authorizeURL.Query().Get("state")

	h.commitCallbackForTest = func(tx *ent.Tx) error {
		if err := tx.Commit(); err != nil {
			return err
		}
		return errors.New("injected callback commit acknowledgement loss")
	}
	callbackRecorder := httptest.NewRecorder()
	h.Callback(callbackRecorder, httptest.NewRequest(http.MethodGet, "/v1/connections/canvas/callback?code=abc&state="+state, nil).WithContext(connectorRouteContext(context.Background(), "canvas")))
	if callbackRecorder.Code != http.StatusFound || !strings.Contains(callbackRecorder.Header().Get("Location"), "status=success") {
		t.Fatalf("callback = %d %q", callbackRecorder.Code, callbackRecorder.Header().Get("Location"))
	}
	if revokeCalls.Load() != 0 {
		t.Fatalf("callback ambiguous commit revoked adopted grant %d times", revokeCalls.Load())
	}
	pending := client.OAuthPending.Query().OnlyX(auth.WithInternal(t.Context()))
	if pending.LifecycleStatus != "callback_completed" {
		t.Fatalf("callback lifecycle = %q", pending.LifecycleStatus)
	}
	if count := client.ConnectorCredentialRecovery.Query().CountX(auth.WithInternal(t.Context())); count != 1 {
		t.Fatalf("callback recovery rows = %d, want 1", count)
	}

	h.commitCallbackForTest = nil
	h.commitClaimForTest = func(tx *ent.Tx) error {
		if err := tx.Commit(); err != nil {
			return err
		}
		return errors.New("injected claim commit acknowledgement loss")
	}
	claim := func() *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		h.Claim(recorder, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/claim", strings.NewReader(`{"state":"`+state+`"}`)).WithContext(connectorRouteContext(authed, "canvas")))
		return recorder
	}
	claimRecorder := claim()
	if claimRecorder.Code != http.StatusOK {
		t.Fatalf("claim = %d: %s", claimRecorder.Code, claimRecorder.Body.String())
	}
	if revokeCalls.Load() != 0 {
		t.Fatalf("claim ambiguous commit revoked current grant %d times", revokeCalls.Load())
	}
	connection := client.MCPConnection.Query().OnlyX(authed)
	plainRefresh, err := sealer.OpenString(connection.RefreshTokenEncrypted)
	if err != nil || plainRefresh != "refresh-ambiguous" {
		t.Fatalf("active credential = %q, %v", plainRefresh, err)
	}
	if count := client.ConnectorCredentialRecovery.Query().CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("recovery rows after committed adoption = %d, want 0", count)
	}
	pending = client.OAuthPending.Query().OnlyX(auth.WithInternal(t.Context()))
	plainPending, err := sealer.Open(pending.PayloadEncrypted)
	if err != nil {
		t.Fatal(err)
	}
	var claimed connectPending
	if err := json.Unmarshal(plainPending, &claimed); err != nil {
		t.Fatal(err)
	}
	if pending.LifecycleStatus != "claimed" || claimed.RefreshToken != "" || claimed.ClaimedConnectionID != connection.ID.String() {
		t.Fatalf("claimed ticket was not scrubbed/reconciled: status=%q payload=%+v", pending.LifecycleStatus, claimed)
	}

	// The same state converges idempotently after the ambiguous acknowledgement.
	h.commitClaimForTest = nil
	retryRecorder := claim()
	if retryRecorder.Code != http.StatusOK {
		t.Fatalf("claim retry = %d: %s", retryRecorder.Code, retryRecorder.Body.String())
	}
	if revokeCalls.Load() != 0 {
		t.Fatalf("idempotent claim retry revoked current grant %d times", revokeCalls.Load())
	}
}
