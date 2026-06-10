package googleapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

func testConn(t *testing.T, sealer *crypto.Sealer) *ent.OAuthConnection {
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
	sealed, err := sealer.SealString("1//refresh")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	return d.Client.OAuthConnection.Create().
		SetUser(u).
		SetProvider("google").
		SetRefreshTokenEncrypted(sealed).
		SetExternalAccountID("me@gmail.com").
		SaveX(context.Background())
}

func TestAccessTokenForConnection(t *testing.T) {
	sealer, err := crypto.NewSealer("test-encryption-key-for-googleapi")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	conn := testConn(t, sealer)
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})

	t.Run("happy path", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if err := r.ParseForm(); err != nil || r.Form.Get("refresh_token") != "1//refresh" || r.Form.Get("client_secret") != "csec" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "ya29.ok"})
		}))
		defer srv.Close()
		c := New(Config{TokenURL: srv.URL})
		tok, err := c.AccessTokenForConnection(context.Background(), sealer, sec, conn)
		if err != nil || tok != "ya29.ok" {
			t.Fatalf("token = %q err = %v", tok, err)
		}
	})

	t.Run("invalid_grant maps to ErrReconnectRequired", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
		}))
		defer srv.Close()
		c := New(Config{TokenURL: srv.URL})
		_, err := c.AccessTokenForConnection(context.Background(), sealer, sec, conn)
		if !errors.Is(err, ErrReconnectRequired) {
			t.Fatalf("err = %v, want ErrReconnectRequired", err)
		}
	})

	t.Run("missing client credentials fails closed", func(t *testing.T) {
		c := New(Config{TokenURL: "http://unused"})
		_, err := c.AccessTokenForConnection(context.Background(), sealer, secrets.NewFromConfig(appconfig.Config{}), conn)
		if err == nil {
			t.Fatal("want error without oauth client credentials")
		}
	})
}
