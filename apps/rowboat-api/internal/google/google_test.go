package google_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/google"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

func setup(t *testing.T) (*ent.Client, context.Context, *ent.User, *crypto.Sealer, *google.Handler) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	bg := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(bg)
	sealer, _ := crypto.NewSealer("test-key")
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csecret"})
	h := google.New(d.Client, sealer, sec, zap.NewNop())
	return d.Client, auth.WithUser(bg, u), u, sealer, h
}

func parkTicket(t *testing.T, client *ent.Client, sealer *crypto.Sealer, state string, expires time.Time, payload map[string]any) {
	t.Helper()
	// Raw state intentionally models a row minted before the hash-only writer
	// rollout. Claim must keep consuming these rows through the transition TTL.
	raw, _ := json.Marshal(payload)
	sealed, err := sealer.Seal(raw)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	client.OAuthPending.Create().
		SetState(state).
		SetProvider("google").
		SetPayloadEncrypted(sealed).
		SetExpiresAt(expires).
		SaveX(context.Background())
}

func TestClaimConsumesTicketAndPersists(t *testing.T) {
	client, ctx, _, sealer, h := setup(t)
	parkTicket(t, client, sealer, "ticket-1", time.Now().Add(5*time.Minute), map[string]any{
		"workos_user_id": "user_1",
		"access_token":   "ya29.access",
		"refresh_token":  "1//refresh",
		"expires_at":     1735689600,
		"scope":          "openid email https://www.googleapis.com/auth/gmail.readonly",
		"token_type":     "Bearer",
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/google-oauth/claim", strings.NewReader(`{"session":"ticket-1"}`)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Claim(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var bundle struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresAt    int64  `json:"expires_at"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &bundle)
	if bundle.AccessToken != "ya29.access" || bundle.RefreshToken != "1//refresh" {
		t.Fatalf("bundle = %+v", bundle)
	}
	// Ticket consumed.
	if n := client.OAuthPending.Query().CountX(context.Background()); n != 0 {
		t.Fatalf("pending should be consumed, got %d", n)
	}
	// Connection persisted for the user.
	if n := client.OAuthConnection.Query().CountX(ctx); n != 1 {
		t.Fatalf("expected 1 oauth connection, got %d", n)
	}
}

func TestClaimRejectsCrossProviderTicket(t *testing.T) {
	client, ctx, _, sealer, h := setup(t)
	raw, _ := json.Marshal(map[string]any{
		"workos_user_id": "user_1",
		"access_token":   "xoxb-slack-secret",
		"refresh_token":  "slack-refresh",
		"expires_at":     time.Now().Add(time.Hour).Unix(),
	})
	sealed, _ := sealer.Seal(raw)
	client.OAuthPending.Create().
		SetState("slack-ticket").
		SetProvider("slack").
		SetPayloadEncrypted(sealed).
		SetExpiresAt(time.Now().Add(time.Minute)).
		SaveX(context.Background())

	req := httptest.NewRequest(http.MethodPost, "/v1/google-oauth/claim", strings.NewReader(`{"session":"slack-ticket"}`)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Claim(rec, req)
	if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "xoxb-") {
		t.Fatalf("cross-provider claim = %d %s, want safe 404", rec.Code, rec.Body.String())
	}
	if client.OAuthPending.Query().CountX(context.Background()) != 1 {
		t.Fatal("google claim consumed a Slack ticket")
	}
}

func TestClaimRejectsGoogleAccountOwnedByAnotherUser(t *testing.T) {
	client, ctx, _, sealer, h := setup(t)
	other := client.User.Create().SetWorkosUserID("user_2").SaveX(context.Background())
	client.OAuthConnection.Create().
		SetUser(other).
		SetProvider("google").
		SetExternalAccountID("shared@example.com").
		SetRefreshTokenEncrypted([]byte("sealed")).
		SaveX(auth.WithUser(context.Background(), other))
	parkTicket(t, client, sealer, "owned-account", time.Now().Add(time.Minute), map[string]any{
		"workos_user_id": "user_1",
		"access_token":   "ya29.access",
		"refresh_token":  "1//refresh",
		"account_email":  "shared@example.com",
		"expires_at":     time.Now().Add(time.Hour).Unix(),
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/google-oauth/claim", strings.NewReader(`{"session":"owned-account"}`)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Claim(rec, req)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "account_already_connected") {
		t.Fatalf("claim = %d %s, want 409 account_already_connected", rec.Code, rec.Body.String())
	}
	if client.OAuthPending.Query().CountX(context.Background()) != 1 {
		t.Fatal("ownership conflict consumed the legitimate ticket")
	}
}

func TestStartBindsTicketAndWrongUserCannotClaim(t *testing.T) {
	client, ctx, u, sealer, h := setup(t)
	h.SetOAuthFlow("https://accounts.example/authorize", "https://api.example/oauth/google/callback", "rowboat", nil)
	rec := httptest.NewRecorder()
	h.Start(rec, httptest.NewRequest(http.MethodPost, "/v1/google-oauth/start", nil).WithContext(ctx))
	if rec.Code != http.StatusOK {
		t.Fatalf("start: %d: %s", rec.Code, rec.Body.String())
	}
	var start struct {
		AuthorizeURL string `json:"authorizeUrl"`
	}
	if json.Unmarshal(rec.Body.Bytes(), &start) != nil {
		t.Fatalf("invalid start response: %s", rec.Body.String())
	}
	authorize, err := url.Parse(start.AuthorizeURL)
	if err != nil || authorize.Query().Get("state") == "" {
		t.Fatalf("authorize URL missing state: %q (%v)", start.AuthorizeURL, err)
	}
	state := authorize.Query().Get("state")
	if authorize.Query().Get("code_challenge_method") != "S256" || authorize.Query().Get("code_challenge") == "" {
		t.Fatalf("authorize URL missing PKCE challenge: %q", start.AuthorizeURL)
	}
	pending := client.OAuthPending.Query().FirstX(context.Background())
	stateDigest := sha256.Sum256([]byte(state))
	wantStateHash := hex.EncodeToString(stateDigest[:])
	if pending.StateHash != wantStateHash || pending.State != "sha256:"+wantStateHash || pending.State == state {
		t.Fatalf("pending state storage = state %q hash %q, want hash-only sentinel", pending.State, pending.StateHash)
	}
	raw, err := sealer.Open(pending.PayloadEncrypted)
	if err != nil || !strings.Contains(string(raw), `"workos_user_id":"user_1"`) {
		t.Fatalf("start ticket is not user-bound: %s (%v)", raw, err)
	}
	var initial struct {
		Verifier string `json:"pkce_verifier"`
	}
	if json.Unmarshal(raw, &initial) != nil || initial.Verifier == "" {
		t.Fatalf("start ticket is not PKCE-bound: %s", raw)
	}
	digest := sha256.Sum256([]byte(initial.Verifier))
	if got, want := authorize.Query().Get("code_challenge"), base64.RawURLEncoding.EncodeToString(digest[:]); got != want {
		t.Fatalf("PKCE challenge = %q, want %q", got, want)
	}

	// Simulate a completed callback payload while preserving the starter id.
	parked, _ := json.Marshal(map[string]any{
		"workos_user_id": u.WorkosUserID,
		"access_token":   "ya29.bound",
		"refresh_token":  "1//bound",
		"expires_at":     time.Now().Add(time.Hour).Unix(),
	})
	sealed, _ := sealer.Seal(parked)
	pending.Update().SetPayloadEncrypted(sealed).ExecX(context.Background())
	other := client.User.Create().SetWorkosUserID("user_2").SaveX(context.Background())
	wrong := httptest.NewRecorder()
	h.Claim(wrong, httptest.NewRequest(http.MethodPost, "/v1/google-oauth/claim", strings.NewReader(`{"session":"`+state+`"}`)).
		WithContext(auth.WithUser(context.Background(), other)))
	if wrong.Code != http.StatusForbidden {
		t.Fatalf("wrong-user claim: %d: %s", wrong.Code, wrong.Body.String())
	}
	if client.OAuthPending.Query().CountX(context.Background()) != 1 {
		t.Fatal("wrong-user claim consumed the legitimate ticket")
	}
}

func TestClaimExpiredTicket(t *testing.T) {
	client, ctx, _, sealer, h := setup(t)
	parkTicket(t, client, sealer, "old", time.Now().Add(-time.Minute), map[string]any{"workos_user_id": "user_1", "access_token": "x", "expires_at": 1})
	req := httptest.NewRequest(http.MethodPost, "/v1/google-oauth/claim", strings.NewReader(`{"session":"old"}`)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Claim(rec, req)
	if rec.Code != http.StatusGone {
		t.Fatalf("want 410, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "ticket_expired") {
		t.Errorf("body = %s", rec.Body.String())
	}
}

// A ticket minted by start carries the PKCE verifier and the owning user but no
// tokens until the browser callback parks them. Claiming in that window must not
// look like success, and must leave the ticket alone: consuming it here kills the
// authorization the user is still completing in the browser.
func TestClaimBeforeCallbackIsNotReadyAndKeepsTicket(t *testing.T) {
	client, ctx, _, sealer, h := setup(t)
	parkTicket(t, client, sealer, "pending-1", time.Now().Add(5*time.Minute), map[string]any{
		"workos_user_id": "user_1",
		"pkce_verifier":  "verifier",
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/google-oauth/claim", strings.NewReader(`{"session":"pending-1"}`)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Claim(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "not_ready") {
		t.Errorf("body = %s", rec.Body.String())
	}
	// The bundle must not leak through as an empty-but-successful payload.
	if strings.Contains(rec.Body.String(), `"access_token"`) {
		t.Errorf("empty bundle returned to caller: %s", rec.Body.String())
	}
	// Still claimable once the callback fills it in.
	if n := client.OAuthPending.Query().CountX(context.Background()); n != 1 {
		t.Fatalf("ticket was consumed: %d remaining, want 1", n)
	}
}

func TestRefreshSuccess(t *testing.T) {
	_, ctx, _, _, h := setup(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"ya29.new","expires_in":3600,"token_type":"Bearer"}`))
	}))
	defer upstream.Close()
	h.SetTokenURL(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/google-oauth/refresh", strings.NewReader(`{"refreshToken":"1//refresh"}`)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Refresh(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var bundle struct {
		AccessToken string `json:"access_token"`
		ExpiresAt   int64  `json:"expires_at"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &bundle)
	if bundle.AccessToken != "ya29.new" {
		t.Fatalf("access token = %q", bundle.AccessToken)
	}
	if bundle.ExpiresAt <= time.Now().Unix() {
		t.Fatalf("expires_at should be in the future: %d", bundle.ExpiresAt)
	}
}

func TestRefreshInvalidGrantReturns409(t *testing.T) {
	_, ctx, _, _, h := setup(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
	}))
	defer upstream.Close()
	h.SetTokenURL(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/google-oauth/refresh", strings.NewReader(`{"refreshToken":"bad"}`)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Refresh(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d", rec.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["reconnectRequired"] != true {
		t.Fatalf("expected reconnectRequired:true, got %v", body)
	}
	if body["code"] != "reconnect_required" {
		t.Fatalf("expected code reconnect_required, got %v", body["code"])
	}
}
