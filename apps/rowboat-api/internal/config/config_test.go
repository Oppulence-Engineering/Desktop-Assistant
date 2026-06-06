package config_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/config"
)

func TestConfigEndpointShape(t *testing.T) {
	h := config.New(appconfig.Config{
		AppURL:          "https://app.solomon-ai.co",
		OIDCIssuerURL:   "https://oauth.solomon-ai.co",
		WebsocketAPIURL: "wss://realtime.solomon-ai.co",
		OAuthClientID:   "solomon-desktop",
	})

	rec := httptest.NewRecorder()
	h.Config(rec, httptest.NewRequest(http.MethodGet, "/v1/config", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=300" {
		t.Errorf("Cache-Control = %q", cc)
	}

	var body struct {
		AppURL          string `json:"appUrl"`
		OIDCIssuerURL   string `json:"oidcIssuerUrl"`
		SupabaseURL     string `json:"supabaseUrl"`
		WebsocketAPIURL string `json:"websocketApiUrl"`
		OAuthClientID   string `json:"oauthClientId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.AppURL != "https://app.solomon-ai.co" {
		t.Errorf("appUrl = %q", body.AppURL)
	}
	// supabaseUrl is emitted as an alias of oidcIssuerUrl for the transition.
	if body.OIDCIssuerURL != "https://oauth.solomon-ai.co" || body.SupabaseURL != body.OIDCIssuerURL {
		t.Errorf("issuer fields = %q / %q", body.OIDCIssuerURL, body.SupabaseURL)
	}
	if body.WebsocketAPIURL != "wss://realtime.solomon-ai.co" {
		t.Errorf("websocketApiUrl = %q", body.WebsocketAPIURL)
	}
	if body.OAuthClientID != "solomon-desktop" {
		t.Errorf("oauthClientId = %q", body.OAuthClientID)
	}
}
