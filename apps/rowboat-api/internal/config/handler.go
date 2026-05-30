// Package config serves GET /v1/config — the public bootstrap document the
// desktop fetches before sign-in.
package config

import (
	"net/http"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// Handler serves the public config endpoint.
type Handler struct {
	cfg appconfig.Config
}

// New builds the config handler.
func New(cfg appconfig.Config) *Handler { return &Handler{cfg: cfg} }

type configResponse struct {
	AppURL        string `json:"appUrl"`
	OIDCIssuerURL string `json:"oidcIssuerUrl"`
	// supabaseUrl is the field the desktop currently reads (pre-patch). We emit
	// it as an alias of oidcIssuerUrl so the desktop keeps working across the
	// Milestone-1 patch that switches it to read oidcIssuerUrl. Remove once all
	// desktop clients are updated.
	SupabaseURL     string `json:"supabaseUrl"`
	WebsocketAPIURL string `json:"websocketApiUrl"`
	// oauthClientId lets the desktop use a static, pre-registered OIDC client
	// instead of dynamic client registration. Empty → desktop falls back to DCR.
	OAuthClientID string `json:"oauthClientId"`
}

// Config handles GET /v1/config. Public (no auth). Cached for 5 minutes.
func (h *Handler) Config(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=300")
	httpx.WriteJSON(w, http.StatusOK, configResponse{
		AppURL:          h.cfg.AppURL,
		OIDCIssuerURL:   h.cfg.OIDCIssuerURL,
		SupabaseURL:     h.cfg.OIDCIssuerURL,
		WebsocketAPIURL: h.cfg.WebsocketAPIURL,
		OAuthClientID:   h.cfg.OAuthClientID,
	})
}
