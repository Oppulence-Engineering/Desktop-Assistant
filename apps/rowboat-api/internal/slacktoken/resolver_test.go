package slacktoken

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

func setupResolverTest(t *testing.T) (*ent.Client, *ent.User, *crypto.Sealer) {
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
	sealer, err := crypto.NewSealer("test-encryption-key-for-slack-token")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	return d.Client, u, sealer
}

func TestResolverRefreshesExpiredRotatingCredential(t *testing.T) {
	client, u, sealer := setupResolverTest(t)
	now := time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC)
	raw, err := MarshalCredential(Credential{
		AccessToken:  "xoxb-old-access",
		RefreshToken: "xoxe-old-refresh",
		ExpiresAt:    now.Add(-time.Hour),
	})
	if err != nil {
		t.Fatalf("marshal credential: %v", err)
	}
	sealed, err := sealer.SealString(raw)
	if err != nil {
		t.Fatalf("seal credential: %v", err)
	}
	conn := client.OAuthConnection.Create().
		SetUser(u).
		SetProvider("slack").
		SetExternalAccountID("T1").
		SetScopes([]string{"channels:read"}).
		SetRefreshTokenEncrypted(sealed).
		SaveX(auth.WithUser(context.Background(), u))

	var gotForm url.Values
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotForm, _ = url.ParseQuery(string(body))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":            true,
			"access_token":  "xoxb-new-access",
			"refresh_token": "xoxe-new-refresh",
			"expires_in":    7200,
			"scope":         "channels:read,chat:write",
		})
	}))
	defer tokenSrv.Close()
	resolver := New(client, sealer, secrets.NewFromConfig(appconfig.Config{
		SlackClientID:     "client-1",
		SlackClientSecret: "secret-1",
	}), tokenSrv.URL, outbound.Policy{})
	resolver.SetNow(func() time.Time { return now })

	token, err := resolver.Resolve(auth.WithInternal(context.Background()), u.ID.String(), "slack")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if token != "xoxb-new-access" {
		t.Fatalf("token = %q, want refreshed access token", token)
	}
	if gotForm.Get("grant_type") != "refresh_token" || gotForm.Get("refresh_token") != "xoxe-old-refresh" {
		t.Fatalf("refresh form = %v", gotForm)
	}
	if gotForm.Get("client_id") != "client-1" || gotForm.Get("client_secret") != "secret-1" {
		t.Fatalf("refresh form missing client credentials: %v", gotForm)
	}

	updated := client.OAuthConnection.GetX(auth.WithUser(context.Background(), u), conn.ID)
	plain, err := sealer.OpenString(updated.RefreshTokenEncrypted)
	if err != nil {
		t.Fatalf("open updated credential: %v", err)
	}
	cred, ok := DecodeCredential(plain)
	if !ok {
		t.Fatalf("updated credential = %q, want token bundle", plain)
	}
	if cred.AccessToken != "xoxb-new-access" || cred.RefreshToken != "xoxe-new-refresh" {
		t.Fatalf("updated credential = %+v", cred)
	}
	if cred.ExpiresAt.Before(now.Add(7199 * time.Second)) {
		t.Fatalf("updated expiry = %v", cred.ExpiresAt)
	}
	if updated := client.OAuthConnection.GetX(auth.WithUser(context.Background(), u), conn.ID); len(updated.Scopes) != 2 {
		t.Fatalf("updated scopes = %v", updated.Scopes)
	}
}

func TestResolverReturnsLegacyAccessTokenWithoutRefresh(t *testing.T) {
	client, u, sealer := setupResolverTest(t)
	sealed, err := sealer.SealString("xoxb-legacy-access")
	if err != nil {
		t.Fatalf("seal credential: %v", err)
	}
	client.OAuthConnection.Create().
		SetUser(u).
		SetProvider("slack").
		SetExternalAccountID("T1").
		SetRefreshTokenEncrypted(sealed).
		SaveX(auth.WithUser(context.Background(), u))
	resolver := New(client, sealer, secrets.NewFromConfig(appconfig.Config{}), "", outbound.Policy{})

	token, err := resolver.Resolve(auth.WithInternal(context.Background()), u.ID.String(), "slack")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if token != "xoxb-legacy-access" {
		t.Fatalf("token = %q, want legacy access token", token)
	}
}

func TestResolverCanResolveByTeamConnection(t *testing.T) {
	client, u, sealer := setupResolverTest(t)
	raw, err := MarshalCredential(Credential{AccessToken: "xoxb-team-access"})
	if err != nil {
		t.Fatalf("marshal credential: %v", err)
	}
	sealed, err := sealer.SealString(raw)
	if err != nil {
		t.Fatalf("seal credential: %v", err)
	}
	client.OAuthConnection.Create().
		SetUser(u).
		SetProvider("slack").
		SetExternalAccountID("T1").
		SetRefreshTokenEncrypted(sealed).
		SaveX(auth.WithUser(context.Background(), u))
	resolver := New(client, sealer, secrets.NewFromConfig(appconfig.Config{}), "", outbound.Policy{})

	token, err := resolver.ResolveTeam(auth.WithInternal(context.Background()), u.ID.String(), "T1")
	if err != nil {
		t.Fatalf("resolve team: %v", err)
	}
	if token != "xoxb-team-access" {
		t.Fatalf("token = %q, want team access token", token)
	}
}
