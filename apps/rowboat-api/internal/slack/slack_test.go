package slack_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthpending"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slack"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slacktoken"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

type fakeTeamTokenResolver struct {
	token  string
	userID string
	teamID string
	err    error
}

func (r *fakeTeamTokenResolver) ResolveTeam(_ context.Context, userID, teamID string) (string, error) {
	r.userID = userID
	r.teamID = teamID
	if r.err != nil {
		return "", r.err
	}
	return r.token, nil
}

type fakeThreadReader struct {
	token    string
	channel  string
	threadTS string
	limit    int
	text     string
	messages []slackclient.Message
	err      error
	postErr  error
}

func (r *fakeThreadReader) ReadThread(_ context.Context, token, channel, threadTS string, limit int) ([]slackclient.Message, error) {
	r.token = token
	r.channel = channel
	r.threadTS = threadTS
	r.limit = limit
	if r.err != nil {
		return nil, r.err
	}
	return r.messages, nil
}

func (r *fakeThreadReader) PostMessage(_ context.Context, token, channel, threadTS, text string) error {
	r.token = token
	r.channel = channel
	r.threadTS = threadTS
	r.text = text
	return r.postErr
}

func setup(t *testing.T) (*ent.Client, *ent.User, *slack.Handler) {
	client, user, handler, _ := setupWithSealer(t)
	return client, user, handler
}

func setupWithSealer(t *testing.T) (*ent.Client, *ent.User, *slack.Handler, *crypto.Sealer) {
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
	return d.Client, u, h, sealer
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

func startFlow(t *testing.T, h *slack.Handler, u *ent.User) (state string) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/slack-oauth/start", nil).
		WithContext(auth.WithUser(context.Background(), u))
	h.Start(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("start: %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var out struct {
		AuthorizeURL string `json:"authorizeUrl"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode start: %v", err)
	}
	loc, err := url.Parse(out.AuthorizeURL)
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

func listWorkspaces(t *testing.T, h *slack.Handler, u *ent.User) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/slack-oauth/workspaces", nil).
		WithContext(auth.WithUser(context.Background(), u))
	rec := httptest.NewRecorder()
	h.ListWorkspaces(rec, req)
	return rec
}

func deleteWorkspace(t *testing.T, h *slack.Handler, u *ent.User, teamID string) *httptest.ResponseRecorder {
	t.Helper()
	route := chi.NewRouteContext()
	route.URLParams.Add("teamId", teamID)
	ctx := context.WithValue(auth.WithUser(context.Background(), u), chi.RouteCtxKey, route)
	req := httptest.NewRequest(http.MethodDelete, "/v1/slack-oauth/workspaces/"+teamID, nil).
		WithContext(ctx)
	rec := httptest.NewRecorder()
	h.DeleteWorkspace(rec, req)
	return rec
}

func readThread(t *testing.T, h *slack.Handler, u *ent.User, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/slack-oauth/thread/read", strings.NewReader(body)).
		WithContext(auth.WithUser(context.Background(), u))
	rec := httptest.NewRecorder()
	h.ReadThread(rec, req)
	return rec
}

func postThread(t *testing.T, h *slack.Handler, u *ent.User, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/slack-oauth/thread/post", strings.NewReader(body)).
		WithContext(auth.WithUser(context.Background(), u))
	rec := httptest.NewRecorder()
	h.PostThread(rec, req)
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

	state := startFlow(t, h, u)
	stateDigest := sha256.Sum256([]byte(state))
	wantStateHash := hex.EncodeToString(stateDigest[:])
	pending := client.OAuthPending.Query().Where(oauthpending.ProviderEQ("slack")).OnlyX(context.Background())
	if pending.StateHash != wantStateHash || pending.State != "sha256:"+wantStateHash || pending.State == state {
		t.Fatalf("pending state storage = state %q hash %q, want hash-only sentinel", pending.State, pending.StateHash)
	}

	// Callback exchanges the code and deep-links success.
	rec := runCallback(t, h, state)
	if !strings.Contains(rec.Body.String(), "status=success") {
		t.Fatalf("callback should deep-link success, got: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "solomon-ai://oauth/slack/done") {
		t.Fatalf("callback should use the configured deep-link scheme")
	}
	other := client.User.Create().SetWorkosUserID("user_2").SaveX(context.Background())
	if wrong := claim(t, h, other, state); wrong.Code != http.StatusForbidden {
		t.Fatalf("wrong-user claim: %d (%s), want 403", wrong.Code, wrong.Body.String())
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

	listRec := listWorkspaces(t, h, u)
	if listRec.Code != http.StatusOK {
		t.Fatalf("list workspaces: %d (%s), want 200", listRec.Code, listRec.Body.String())
	}
	if strings.Contains(listRec.Body.String(), "xoxb-") {
		t.Fatal("list response must never contain the raw bot token")
	}
	var listed struct {
		Workspaces []struct {
			TeamID string `json:"teamId"`
		} `json:"workspaces"`
	}
	_ = json.Unmarshal(listRec.Body.Bytes(), &listed)
	if len(listed.Workspaces) != 1 || listed.Workspaces[0].TeamID != "T0EXAMPLE" {
		t.Fatalf("listed workspaces = %+v", listed.Workspaces)
	}

	// One-shot: a second claim of the same ticket is rejected.
	if rec := claim(t, h, u, state); rec.Code != http.StatusNotFound {
		t.Fatalf("replayed claim: %d, want 404", rec.Code)
	}
}

func TestSlackClaimConsumesLegacyRawStateTicket(t *testing.T) {
	client, user, handler, sealer := setupWithSealer(t)
	state := "legacy-slack-raw-state"
	payload, err := json.Marshal(map[string]any{
		"workos_user_id": user.WorkosUserID,
		"access_token":   "xoxb-legacy",
		"scope":          "channels:read",
		"team_id":        "TEAM_LEGACY_RAW",
		"team_name":      "Legacy Raw Team",
	})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := sealer.Seal(payload)
	if err != nil {
		t.Fatal(err)
	}
	client.OAuthPending.Create().
		SetState(state).
		SetProvider("slack").
		SetPayloadEncrypted(sealed).
		SetExpiresAt(time.Now().Add(time.Minute)).
		ExecX(context.Background())

	recorder := claim(t, handler, user, state)
	if recorder.Code != http.StatusOK {
		t.Fatalf("legacy raw-state claim: %d (%s), want 200", recorder.Code, recorder.Body.String())
	}
	if client.OAuthPending.Query().CountX(context.Background()) != 0 {
		t.Fatal("legacy raw-state ticket was not consumed")
	}
}

func TestSlackOAuthRejectsWorkspaceOwnedByAnotherUser(t *testing.T) {
	client, u, h, _ := setupWithSealer(t)
	other := client.User.Create().SetWorkosUserID("user_2").SaveX(context.Background())
	client.OAuthConnection.Create().
		SetUser(other).
		SetProvider("slack").
		SetExternalAccountID("T0OWNED").
		SetRefreshTokenEncrypted([]byte("sealed")).
		SaveX(auth.WithUser(context.Background(), other))
	token := mockSlackToken(t, func(url.Values) map[string]any {
		return map[string]any{
			"ok": true, "access_token": "xoxb-new", "scope": "chat:write",
			"team": map[string]any{"id": "T0OWNED", "name": "Owned"},
		}
	})
	h.SetOAuthFlow("https://slack.example/authorize", token.URL, "https://api.example/oauth/slack/callback", "rowboat", "")
	state := startFlow(t, h, u)
	runCallback(t, h, state)
	rec := claim(t, h, u, state)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "workspace_already_connected") {
		t.Fatalf("claim = %d %s, want 409 workspace_already_connected", rec.Code, rec.Body.String())
	}
	if client.OAuthPending.Query().CountX(context.Background()) != 1 {
		t.Fatal("ownership conflict consumed the legitimate ticket")
	}
}

func TestSlackOAuthAllowsMultipleWorkspacesForOneUser(t *testing.T) {
	client, u, h := setup(t)
	teams := []struct {
		id   string
		name string
	}{
		{id: "TEAM_A", name: "Alpha"},
		{id: "TEAM_B", name: "Beta"},
	}
	exchanges := 0
	token := mockSlackToken(t, func(form url.Values) map[string]any {
		if form.Get("code") != "code-1" || form.Get("client_secret") != "secret-1" {
			return map[string]any{"ok": false, "error": "invalid_code"}
		}
		if exchanges >= len(teams) {
			return map[string]any{"ok": false, "error": "too_many_exchanges"}
		}
		team := teams[exchanges]
		exchanges++
		return map[string]any{
			"ok":           true,
			"access_token": "xoxb-" + team.id,
			"scope":        "channels:history,channels:read",
			"bot_user_id":  "U0BOT",
			"app_id":       "A0APP",
			"team":         map[string]any{"id": team.id, "name": team.name},
		}
	})
	h.SetOAuthFlow("https://slack.example/authorize", token.URL, "https://api.example/oauth/slack/callback", "solomon-ai", "")

	for _, team := range teams {
		state := startFlow(t, h, u)
		runCallback(t, h, state)
		rec := claim(t, h, u, state)
		if rec.Code != http.StatusOK {
			t.Fatalf("claim %s: %d (%s), want 200", team.id, rec.Code, rec.Body.String())
		}
	}

	ctx := auth.WithUser(context.Background(), u)
	count := client.OAuthConnection.Query().
		Where(oauthconnection.ProviderEQ("slack")).
		CountX(ctx)
	if count != 2 {
		t.Fatalf("slack connection count = %d, want 2", count)
	}
	listRec := listWorkspaces(t, h, u)
	if listRec.Code != http.StatusOK {
		t.Fatalf("list workspaces: %d (%s), want 200", listRec.Code, listRec.Body.String())
	}
	var listed struct {
		Workspaces []struct {
			TeamID string `json:"teamId"`
		} `json:"workspaces"`
	}
	_ = json.Unmarshal(listRec.Body.Bytes(), &listed)
	got := map[string]bool{}
	for _, workspace := range listed.Workspaces {
		got[workspace.TeamID] = true
	}
	if len(listed.Workspaces) != 2 || !got["TEAM_A"] || !got["TEAM_B"] {
		t.Fatalf("listed workspaces = %+v, want TEAM_A and TEAM_B", listed.Workspaces)
	}
}

func TestSlackWorkspacesListAndDeleteAreUserScoped(t *testing.T) {
	client, userA, h := setup(t)
	userB := client.User.Create().
		SetEmail("b@x.co").
		SetWorkosUserID("user_2").
		SaveX(context.Background())
	ctx := auth.WithInternal(context.Background())
	client.OAuthConnection.Create().
		SetUser(userA).
		SetProvider("slack").
		SetRefreshTokenEncrypted([]byte("sealed-token-a")).
		SetScopes([]string{"channels:history"}).
		SetExternalAccountID("TEAM_A").
		SaveX(ctx)
	client.OAuthConnection.Create().
		SetUser(userB).
		SetProvider("slack").
		SetRefreshTokenEncrypted([]byte("sealed-token-b")).
		SetScopes([]string{"channels:history"}).
		SetExternalAccountID("TEAM_B").
		SaveX(ctx)

	rec := listWorkspaces(t, h, userA)
	if rec.Code != http.StatusOK {
		t.Fatalf("list user A: %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "sealed-token") {
		t.Fatal("list response must not leak stored credentials")
	}
	var out struct {
		Workspaces []struct {
			TeamID string `json:"teamId"`
		} `json:"workspaces"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Workspaces) != 1 || out.Workspaces[0].TeamID != "TEAM_A" {
		t.Fatalf("user A workspaces = %+v, want TEAM_A only", out.Workspaces)
	}

	if rec := deleteWorkspace(t, h, userB, "TEAM_A"); rec.Code != http.StatusNoContent {
		t.Fatalf("user B delete TEAM_A: %d, want 204", rec.Code)
	}
	if n := client.OAuthConnection.Query().
		Where(oauthconnection.ProviderEQ("slack"), oauthconnection.ExternalAccountIDEQ("TEAM_A")).
		CountX(auth.WithUser(context.Background(), userA)); n != 1 {
		t.Fatalf("TEAM_A rows for user A after user B delete = %d, want 1", n)
	}

	if rec := deleteWorkspace(t, h, userA, "TEAM_A"); rec.Code != http.StatusNoContent {
		t.Fatalf("user A delete TEAM_A: %d, want 204", rec.Code)
	}
	if n := client.OAuthConnection.Query().
		Where(oauthconnection.ProviderEQ("slack"), oauthconnection.ExternalAccountIDEQ("TEAM_A")).
		CountX(auth.WithUser(context.Background(), userA)); n != 0 {
		t.Fatalf("TEAM_A rows for user A after owner delete = %d, want 0", n)
	}
	if n := client.OAuthConnection.Query().
		Where(oauthconnection.ProviderEQ("slack"), oauthconnection.ExternalAccountIDEQ("TEAM_B")).
		CountX(auth.WithUser(context.Background(), userB)); n != 1 {
		t.Fatalf("TEAM_B rows for user B = %d, want 1", n)
	}
}

func TestSlackReadThreadUsesServerHeldToken(t *testing.T) {
	_, u, h := setup(t)
	tokens := &fakeTeamTokenResolver{token: "xoxb-secret-token"}
	reader := &fakeThreadReader{
		messages: []slackclient.Message{
			{User: "U1", Text: "first", TS: "1700000000.000100"},
			{User: "U2", Text: "second", TS: "1700000000.000200"},
		},
	}
	h.SetRuntimeClients(tokens, reader)

	rec := readThread(t, h, u, `{"teamId":"T1","channel":"C1","threadTs":"1700000000.000100","limit":25}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("read thread: %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if tokens.userID != u.ID.String() || tokens.teamID != "T1" {
		t.Fatalf("resolved token for user %q team %q", tokens.userID, tokens.teamID)
	}
	if reader.token != "xoxb-secret-token" || reader.channel != "C1" || reader.threadTS != "1700000000.000100" || reader.limit != 25 {
		t.Fatalf("reader call = %+v", reader)
	}
	if strings.Contains(rec.Body.String(), "xoxb-") {
		t.Fatal("read response must not leak the bot token")
	}
	if !strings.Contains(rec.Body.String(), `"text":"first"`) || !strings.Contains(rec.Body.String(), `"teamId":"T1"`) {
		t.Fatalf("read response = %s", rec.Body.String())
	}
}

func TestSlackReadThreadRequiresConnectedWorkspace(t *testing.T) {
	_, u, h := setup(t)
	h.SetRuntimeClients(&fakeTeamTokenResolver{err: errors.New("not connected")}, &fakeThreadReader{})

	rec := readThread(t, h, u, `{"teamId":"T-missing","channel":"C1","threadTs":"1.1"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("read missing workspace: %d (%s), want 404", rec.Code, rec.Body.String())
	}
}

func TestSlackPostThreadUsesServerHeldToken(t *testing.T) {
	_, u, h := setup(t)
	tokens := &fakeTeamTokenResolver{token: "xoxb-secret-token"}
	reader := &fakeThreadReader{}
	h.SetRuntimeClients(tokens, reader)

	rec := postThread(t, h, u, `{"teamId":"T1","channel":"C1","threadTs":"1700000000.000100","text":"Approved reply"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("post thread: %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if tokens.userID != u.ID.String() || tokens.teamID != "T1" {
		t.Fatalf("resolved token for user %q team %q", tokens.userID, tokens.teamID)
	}
	if reader.token != "xoxb-secret-token" || reader.channel != "C1" || reader.threadTS != "1700000000.000100" || reader.text != "Approved reply" {
		t.Fatalf("post call = %+v", reader)
	}
	if strings.Contains(rec.Body.String(), "xoxb-") || strings.Contains(rec.Body.String(), "Approved reply") {
		t.Fatal("post response must not echo the bot token or message text")
	}
	if !strings.Contains(rec.Body.String(), `"ok":true`) || !strings.Contains(rec.Body.String(), `"teamId":"T1"`) {
		t.Fatalf("post response = %s", rec.Body.String())
	}
}

func TestSlackPostThreadValidatesRequiredFields(t *testing.T) {
	_, u, h := setup(t)
	h.SetRuntimeClients(&fakeTeamTokenResolver{token: "xoxb-secret-token"}, &fakeThreadReader{})

	rec := postThread(t, h, u, `{"teamId":"T1","channel":"C1","threadTs":"1.1","text":"   "}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("post empty text: %d (%s), want 400", rec.Code, rec.Body.String())
	}
}

func TestSlackPostThreadRequiresConnectedWorkspace(t *testing.T) {
	_, u, h := setup(t)
	h.SetRuntimeClients(&fakeTeamTokenResolver{err: errors.New("not connected")}, &fakeThreadReader{})

	rec := postThread(t, h, u, `{"teamId":"T-missing","channel":"C1","threadTs":"1.1","text":"hello"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("post missing workspace: %d (%s), want 404", rec.Code, rec.Body.String())
	}
}

func TestSlackOAuthStoresRotatingAccessTokenBundle(t *testing.T) {
	client, u, h, sealer := setupWithSealer(t)
	token := mockSlackToken(t, func(form url.Values) map[string]any {
		if form.Get("code") != "code-1" || form.Get("client_secret") != "secret-1" {
			return map[string]any{"ok": false, "error": "invalid_code"}
		}
		return map[string]any{
			"ok":            true,
			"access_token":  "xoxb-rotating-access-token",
			"refresh_token": "xoxe-rotating-refresh-token",
			"expires_in":    43200,
			"scope":         "channels:history,channels:read",
			"bot_user_id":   "U0BOT",
			"app_id":        "A0APP",
			"team":          map[string]any{"id": "T0EXAMPLE", "name": "Acme"},
		}
	})
	h.SetOAuthFlow("https://slack.example/authorize", token.URL, "https://api.example/oauth/slack/callback", "solomon-ai", "")

	state := startFlow(t, h, u)
	runCallback(t, h, state)
	rec := claim(t, h, u, state)
	if rec.Code != http.StatusOK {
		t.Fatalf("claim: %d (%s), want 200", rec.Code, rec.Body.String())
	}

	conn := client.OAuthConnection.Query().
		Where(oauthconnection.ProviderEQ("slack")).
		OnlyX(auth.WithUser(context.Background(), u))
	plain, err := sealer.OpenString(conn.RefreshTokenEncrypted)
	if err != nil {
		t.Fatalf("open credential: %v", err)
	}
	cred, ok := slacktoken.DecodeCredential(plain)
	if !ok {
		t.Fatalf("credential = %q, want rotating token bundle", plain)
	}
	if cred.AccessToken != "xoxb-rotating-access-token" || cred.RefreshToken != "xoxe-rotating-refresh-token" {
		t.Fatalf("credential = %+v", cred)
	}
	if cred.ExpiresAt.IsZero() {
		t.Fatal("rotating credential missing expiry")
	}
}

func TestSlackCallbackRejectsExchangeFailure(t *testing.T) {
	client, u, h := setup(t)
	token := mockSlackToken(t, func(url.Values) map[string]any {
		return map[string]any{"ok": false, "error": "invalid_grant"}
	})
	h.SetOAuthFlow("", token.URL, "https://api.example/cb", "", "")

	state := startFlow(t, h, u)
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
	state := startFlow(t, h, u)

	// Claim racing ahead of the callback: 409, ticket NOT consumed.
	if rec := claim(t, h, u, state); rec.Code != http.StatusConflict {
		t.Fatalf("early claim: %d, want 409", rec.Code)
	}
	stateDigest := sha256.Sum256([]byte(state))
	if n := client.OAuthPending.Query().Where(oauthpending.StateHashEQ(hex.EncodeToString(stateDigest[:]))).CountX(context.Background()); n != 1 {
		t.Fatal("early claim must not consume the ticket")
	}

	// Callback lands; the retried claim succeeds.
	runCallback(t, h, state)
	if rec := claim(t, h, u, state); rec.Code != http.StatusOK {
		t.Fatalf("claim after callback: %d, want 200", rec.Code)
	}
}

func TestSlackStartFailsClosedWithoutCredentials(t *testing.T) {
	client, u, _ := setup(t)
	sealer, err := crypto.NewSealer("test-encryption-key-for-slack-oauth")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	empty := slack.New(client, sealer, secrets.NewFromConfig(appconfig.Config{}), zap.NewNop())
	empty.SetOAuthFlow("", "", "https://api.example/cb", "", "")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/slack-oauth/start", nil).
		WithContext(auth.WithUser(context.Background(), u))
	empty.Start(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("start without credentials: %d, want 502", rec.Code)
	}
}
