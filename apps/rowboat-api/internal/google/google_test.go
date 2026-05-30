package google_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
		"access_token":  "ya29.access",
		"refresh_token": "1//refresh",
		"expires_at":    1735689600,
		"scope":         "openid email https://www.googleapis.com/auth/gmail.readonly",
		"token_type":    "Bearer",
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

func TestClaimExpiredTicket(t *testing.T) {
	client, ctx, _, sealer, h := setup(t)
	parkTicket(t, client, sealer, "old", time.Now().Add(-time.Minute), map[string]any{"access_token": "x", "expires_at": 1})
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
