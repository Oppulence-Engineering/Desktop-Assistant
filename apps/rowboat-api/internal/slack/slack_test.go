package slack_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthpending"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slack"
	"go.uber.org/zap"
)

func setup(t *testing.T) (*ent.Client, *ent.User, *slack.Handler) {
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

	sealer, err := crypto.NewSealer("test-encryption-key-for-slack-oauth")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	sec := secrets.NewFromConfig(appconfig.Config{SlackClientID: "client-1", SlackClientSecret: "secret-1"})
	h := slack.New(d.Client, sealer, sec, zap.NewNop())
	return d.Client, u, h
}

// mockSlackToken serves oauth.v2.access. Slack returns 200 with ok:false on
// failure, so the mock mirrors that shape.
func mockSlackToken(t *testing.T, respond func(form url.Values) map[string]any) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(body))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(respond(form))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func startFlow(t *testing.T, h *slack.Handler) (state string) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.Start(rec, httptest.NewRequest(http.MethodGet, "/oauth/slack/start", nil))
	if rec.Code != http.StatusFound {
		t.Fatalf("start: %d, want 302 (%s)", rec.Code, rec.Body.String())
	}
	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatalf("location: %v", err)
	}
	if got := loc.Query().Get("client_id"); got != "client-1" {
		t.Fatalf("client_id = %q", got)
	}
	if got := loc.Query().Get("scope"); got == "" {
		t.Fatal("authorize URL missing bot scopes")
	}
	state = loc.Query().Get("state")
	if state == "" {
		t.Fatal("authorize URL missing state")
	}
	return state
}

func runCallback(t *testing.T, h *slack.Handler, state string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.Callback(rec, httptest.NewRequest(http.MethodGet, "/oauth/slack/callback?state="+url.QueryEscape(state)+"&code=code-1", nil))
	return rec
}

func claim(t *testing.T, h *slack.Handler, u *ent.User, state string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"session":` + string(mustJSON(t, state)) + `}`
	req := httptest.NewRequest(http.MethodPost, "/v1/slack-oauth/claim", strings.NewReader(body)).
		WithContext(auth.WithUser(context.Background(), u))
	rec := httptest.NewRecorder()
	h.Claim(rec, req)
	return rec
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func TestSlackOAuthFullFlow(t *testing.T) {
	client, u, h := setup(t)
	token := mockSlackToken(t, func(form url.Values) map[string]any {
		if form.Get("code") != "code-1" || form.Get("client_secret") != "secret-1" {
			return map[string]any{"ok": false, "error": "invalid_code"}
		}
		return map[string]any{
			"ok":           true,
			"access_token": "xoxb-secret-bot-token",
			"scope":        "channels:history,channels:read",
			"bot_user_id":  "U0BOT",
			"app_id":       "A0APP",
			"team":         map[string]any{"id": "T0EXAMPLE", "name": "Acme"},
		}
	})
	h.SetOAuthFlow("https://slack.example/authorize", token.URL, "https://api.example/oauth/slack/callback", "solomon-ai", "")

	state := startFlow(t, h)

	// Callback exchanges the code and deep-links success.
	rec := runCallback(t, h, state)
	if !strings.Contains(rec.Body.String(), "status=success") {
		t.Fatalf("callback should deep-link success, got: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "solomon-ai://oauth/slack/done") {
		t.Fatalf("callback should use the configured deep-link scheme")
	}

	// Claim persists the workspace mapping and returns metadata only.
	rec = claim(t, h, u, state)
	if rec.Code != http.StatusOK {
		t.Fatalf("claim: %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "xoxb-") {
		t.Fatal("claim response must never contain the raw bot token")
	}
	var out struct {
		Connected bool   `json:"connected"`
		TeamID    string `json:"teamId"`
		TeamName  string `json:"teamName"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Connected || out.TeamID != "T0EXAMPLE" || out.TeamName != "Acme" {
		t.Fatalf("claim response = %+v", out)
	}

	// The connection row is exactly what /v1/webhooks/slack resolves against.
	conn := client.OAuthConnection.Query().
		Where(oauthconnection.ProviderEQ("slack")).
		OnlyX(auth.WithUser(context.Background(), u))
	if conn.ExternalAccountID != "T0EXAMPLE" {
		t.Fatalf("external_account_id = %q, want T0EXAMPLE", conn.ExternalAccountID)
	}
	if len(conn.Scopes) != 2 {
		t.Fatalf("scopes = %v", conn.Scopes)
	}
	if string(conn.RefreshTokenEncrypted) == "xoxb-secret-bot-token" {
		t.Fatal("credential must be sealed, not plaintext")
	}

	// One-shot: a second claim of the same ticket is rejected.
	if rec := claim(t, h, u, state); rec.Code != http.StatusNotFound {
		t.Fatalf("replayed claim: %d, want 404", rec.Code)
	}
}

func TestSlackCallbackRejectsExchangeFailure(t *testing.T) {
	client, _, h := setup(t)
	token := mockSlackToken(t, func(url.Values) map[string]any {
		return map[string]any{"ok": false, "error": "invalid_grant"}
	})
	h.SetOAuthFlow("", token.URL, "https://api.example/cb", "", "")

	state := startFlow(t, h)
	rec := runCallback(t, h, state)
	if !strings.Contains(rec.Body.String(), "status=error") {
		t.Fatalf("failed exchange must deep-link error, got: %s", rec.Body.String())
	}
	// The pending row still holds the empty placeholder; no connection exists.
	if n := client.OAuthConnection.Query().CountX(auth.WithInternal(context.Background())); n != 0 {
		t.Fatalf("connections = %d, want 0", n)
	}
}

func TestSlackClaimBeforeCallbackIsRetryable(t *testing.T) {
	client, u, h := setup(t)
	token := mockSlackToken(t, func(url.Values) map[string]any {
		return map[string]any{
			"ok": true, "access_token": "xoxb-1", "scope": "channels:read",
			"team": map[string]any{"id": "T1", "name": "N"},
		}
	})
	h.SetOAuthFlow("", token.URL, "https://api.example/cb", "", "")
	state := startFlow(t, h)

	// Claim racing ahead of the callback: 409, ticket NOT consumed.
	if rec := claim(t, h, u, state); rec.Code != http.StatusConflict {
		t.Fatalf("early claim: %d, want 409", rec.Code)
	}
	if n := client.OAuthPending.Query().Where(oauthpending.StateEQ(state)).CountX(context.Background()); n != 1 {
		t.Fatal("early claim must not consume the ticket")
	}

	// Callback lands; the retried claim succeeds.
	runCallback(t, h, state)
	if rec := claim(t, h, u, state); rec.Code != http.StatusOK {
		t.Fatalf("claim after callback: %d, want 200", rec.Code)
	}
}

func TestSlackStartFailsClosedWithoutCredentials(t *testing.T) {
	client, _, _ := setup(t)
	sealer, err := crypto.NewSealer("test-encryption-key-for-slack-oauth")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	empty := slack.New(client, sealer, secrets.NewFromConfig(appconfig.Config{}), zap.NewNop())
	empty.SetOAuthFlow("", "", "https://api.example/cb", "", "")

	rec := httptest.NewRecorder()
	empty.Start(rec, httptest.NewRequest(http.MethodGet, "/oauth/slack/start", nil))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("start without credentials: %d, want 502", rec.Code)
	}
}
