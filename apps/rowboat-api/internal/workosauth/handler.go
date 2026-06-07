// Package workosauth brokers the desktop's sign-in against WorkOS AuthKit.
//
// WorkOS is a confidential OAuth client: the authorization-code → token
// exchange must be presented with the WorkOS API key as the client secret,
// which a desktop app cannot hold. So the desktop performs the browser
// authorize + PKCE itself, then hands the resulting code to this broker, which
// completes the exchange server-side (holding the key) and returns the token
// bundle. Refresh is brokered the same way. This folds the old Ory-Hydra +
// oauth-consent broker into rowboat-api. See apps/rowboat-api/AUTH.md.
package workosauth

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

// Handler serves the WorkOS sign-in broker endpoints. All endpoints are public
// (the caller has no bearer yet); the credential is the WorkOS code/refresh
// token plus the server-held API key.
type Handler struct {
	clientID string
	apiKey   string // WorkOS API key — presented to WorkOS as the client secret
	baseURL  string // WorkOS API base for server-side calls (https://api.workos.com)
	authBase string // base for the browser authorize URL; usually == baseURL
	http     *outbound.Client
	log      *zap.Logger
}

// New builds the broker. baseURL empty → https://api.workos.com. authorizeBaseURL
// empty → baseURL; it differs from baseURL only when the browser-reachable host
// differs from the server-reachable host (e.g. the local docker devstack split).
func New(clientID, apiKey, baseURL, authorizeBaseURL string, log *zap.Logger) *Handler {
	if baseURL == "" {
		baseURL = "https://api.workos.com"
	}
	if authorizeBaseURL == "" {
		authorizeBaseURL = baseURL
	}
	return &Handler{
		clientID: clientID,
		apiKey:   apiKey,
		baseURL:  strings.TrimRight(baseURL, "/"),
		authBase: strings.TrimRight(authorizeBaseURL, "/"),
		http: outbound.NewClient(outbound.Policy{
			Name:                  "workos",
			Timeout:               15 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxConcurrent:         64,
			MaxResponseBytes:      1 << 20,
		}),
		log: log,
	}
}

// SetOutboundPolicy applies the shared outbound vendor policy.
func (h *Handler) SetOutboundPolicy(policy outbound.Policy) {
	policy.Name = "workos"
	h.http = outbound.NewClient(policy)
}

// configured reports whether WorkOS credentials are present.
func (h *Handler) configured() bool { return h.clientID != "" && h.apiKey != "" }

// tokenBundle is the desktop-facing token shape (snake_case to match the
// desktop's stored OAuthTokens). expires_at is seconds-since-epoch.
type tokenBundle struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresAt    int64  `json:"expires_at"`
	TokenType    string `json:"token_type"`
	UserID       string `json:"user_id,omitempty"`
	Email        string `json:"email,omitempty"`
}

// LoginURL handles GET /v1/auth/workos/login-url. It returns the WorkOS AuthKit
// authorization URL for the desktop to open in the browser, keeping WorkOS's
// endpoint layout server-side. Required query params: redirect_uri, state.
// Optional: code_challenge (PKCE S256).
func (h *Handler) LoginURL(w http.ResponseWriter, r *http.Request) {
	if !h.configured() {
		httpx.Error(w, http.StatusBadGateway, "workos not configured", "provider_unconfigured")
		return
	}
	q := r.URL.Query()
	redirectURI := q.Get("redirect_uri")
	state := q.Get("state")
	if redirectURI == "" || state == "" {
		httpx.Error(w, http.StatusBadRequest, "redirect_uri and state are required", "bad_request")
		return
	}
	v := url.Values{}
	v.Set("response_type", "code")
	v.Set("client_id", h.clientID)
	v.Set("redirect_uri", redirectURI)
	v.Set("state", state)
	v.Set("provider", "authkit")
	if cc := q.Get("code_challenge"); cc != "" {
		v.Set("code_challenge", cc)
		v.Set("code_challenge_method", "S256")
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"url": h.authBase + "/user_management/authorize?" + v.Encode(),
	})
}

// Exchange handles POST /v1/auth/workos/exchange: it completes the
// authorization-code exchange with WorkOS using the server-held API key.
func (h *Handler) Exchange(w http.ResponseWriter, r *http.Request) {
	if !h.configured() {
		httpx.Error(w, http.StatusBadGateway, "workos not configured", "provider_unconfigured")
		return
	}
	var req struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"codeVerifier"`
	}
	if !httpx.DecodeJSON(w, r, 1<<16, &req) || req.Code == "" {
		httpx.Error(w, http.StatusBadRequest, "missing code", "bad_request")
		return
	}
	payload := map[string]string{
		"client_id":     h.clientID,
		"client_secret": h.apiKey,
		"grant_type":    "authorization_code",
		"code":          req.Code,
	}
	if req.CodeVerifier != "" {
		payload["code_verifier"] = req.CodeVerifier
	}
	h.authenticate(w, r, payload)
}

// Refresh handles POST /v1/auth/workos/refresh.
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	if !h.configured() {
		httpx.Error(w, http.StatusBadGateway, "workos not configured", "provider_unconfigured")
		return
	}
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	if !httpx.DecodeJSON(w, r, 1<<16, &req) || req.RefreshToken == "" {
		httpx.Error(w, http.StatusBadRequest, "missing refreshToken", "bad_request")
		return
	}
	h.authenticate(w, r, map[string]string{
		"client_id":     h.clientID,
		"client_secret": h.apiKey,
		"grant_type":    "refresh_token",
		"refresh_token": req.RefreshToken,
	})
}

// authenticate posts to WorkOS's /user_management/authenticate and translates
// the response into the desktop token bundle.
func (h *Handler) authenticate(w http.ResponseWriter, r *http.Request, payload map[string]string) {
	body, _ := json.Marshal(payload)
	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost,
		h.baseURL+"/user_management/authenticate", strings.NewReader(string(body)))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not build request", "internal_error")
		return
	}
	upReq.Header.Set("Content-Type", "application/json")

	resp, err := h.http.Do(upReq)
	if err != nil {
		h.log.Warn("workos authenticate upstream error", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "workos authenticate failed", "upstream_error")
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, h.http.MaxResponseBytes())
	if err != nil {
		h.log.Warn("workos authenticate response read failed", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "workos authenticate failed", "upstream_error")
		return
	}

	if resp.StatusCode != http.StatusOK {
		var werr struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &werr)
		if werr.Error == "invalid_grant" {
			httpx.ErrorWith(w, http.StatusConflict,
				"WorkOS reports invalid_grant; sign in again.",
				"reconnect_required",
				map[string]any{"reconnectRequired": true})
			return
		}
		h.log.Warn("workos authenticate non-200", zap.Int("status", resp.StatusCode))
		httpx.Error(w, http.StatusBadGateway, "workos authenticate failed", "upstream_error")
		return
	}

	var wr struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		User         struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"user"`
	}
	if err := json.Unmarshal(raw, &wr); err != nil || wr.AccessToken == "" {
		httpx.Error(w, http.StatusBadGateway, "malformed workos response", "upstream_error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, tokenBundle{
		AccessToken:  wr.AccessToken,
		RefreshToken: wr.RefreshToken,
		ExpiresAt:    accessTokenExpiry(wr.AccessToken),
		TokenType:    "Bearer",
		UserID:       wr.User.ID,
		Email:        wr.User.Email,
	})
}

// accessTokenExpiry reads the `exp` claim from a WorkOS access token (a JWT)
// without verifying it — verification happens on every API call via the JWKS.
// Falls back to a conservative 5 minutes if the token can't be parsed.
func accessTokenExpiry(token string) int64 {
	parser := jwt.NewParser()
	var claims jwt.RegisteredClaims
	if _, _, err := parser.ParseUnverified(token, &claims); err == nil && claims.ExpiresAt != nil {
		return claims.ExpiresAt.Unix()
	}
	return time.Now().Add(5 * time.Minute).Unix()
}
