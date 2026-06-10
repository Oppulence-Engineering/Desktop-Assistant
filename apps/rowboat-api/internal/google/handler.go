// Package google brokers the Google OAuth handoff. The webapp completes the
// OAuth dance (it holds the client secret) and parks the token bundle in
// OAuthPending keyed by a state ticket; the desktop redeems it via /claim. The
// /refresh endpoint exchanges a refresh token for a fresh access token, again
// using the server-held client secret.
package google

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthpending"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

// Handler serves the Google OAuth broker endpoints.
type Handler struct {
	client   *ent.Client
	sealer   *crypto.Sealer
	secrets  *secrets.Store
	http     *outbound.Client
	log      *zap.Logger
	tokenURL string

	// Browser-facing OAuth (/oauth/google/start + /oauth/google/callback).
	authorizeURL   string
	redirectURI    string // must exactly match a redirect URI registered in Google Cloud
	deepLinkScheme string // desktop custom scheme (rowboat)
	scopes         []string
}

// New builds the Google handler.
func New(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, log *zap.Logger) *Handler {
	return &Handler{
		client:  client,
		sealer:  sealer,
		secrets: sec,
		http: outbound.NewClient(outbound.Policy{
			Name:                  "google-oauth",
			Timeout:               15 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxConcurrent:         64,
			MaxResponseBytes:      1 << 20,
		}),
		log:      log,
		tokenURL: "https://oauth2.googleapis.com/token",

		authorizeURL:   "https://accounts.google.com/o/oauth2/v2/auth",
		deepLinkScheme: "rowboat",
		scopes: []string{
			"openid", "email", "profile",
			"https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/calendar.events.readonly",
			"https://www.googleapis.com/auth/drive.readonly",
		},
	}
}

// SetOutboundPolicy applies the shared outbound vendor policy.
func (h *Handler) SetOutboundPolicy(policy outbound.Policy) {
	policy.Name = "google-oauth"
	h.http = outbound.NewClient(policy)
}

// SetOAuthFlow configures the browser-facing Google OAuth (start + callback).
// redirectURI must exactly match a redirect URI registered in Google Cloud.
// Empty args keep the defaults; authorizeURL can be pointed at a dev mock.
func (h *Handler) SetOAuthFlow(authorizeURL, redirectURI, deepLinkScheme string, scopes []string) {
	if authorizeURL != "" {
		h.authorizeURL = authorizeURL
	}
	if redirectURI != "" {
		h.redirectURI = redirectURI
	}
	if deepLinkScheme != "" {
		h.deepLinkScheme = deepLinkScheme
	}
	if len(scopes) > 0 {
		h.scopes = scopes
	}
}

// SetTokenURL overrides the Google token endpoint (tests).
func (h *Handler) SetTokenURL(u string) {
	if u != "" {
		h.tokenURL = u
	}
}

// tokenBundle is the shape consumed by the desktop's google-backend-oauth.ts.
// expires_at is seconds-since-epoch; scope is space-delimited.
type tokenBundle struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresAt    int64  `json:"expires_at"`
	Scope        string `json:"scope,omitempty"`
	TokenType    string `json:"token_type,omitempty"`
}

// parkedPayload is what the webapp seals into OAuthPending.payload_encrypted.
type parkedPayload struct {
	tokenBundle
	WorkOSUserID string `json:"workos_user_id,omitempty"`
	// AccountEmail is the Google account's email from the token exchange's
	// id_token; persisted as the connection's external_account_id so provider
	// webhooks can resolve the owning user (RFC 003).
	AccountEmail string `json:"account_email,omitempty"`
}

// Claim handles POST /v1/google-oauth/claim. Reads and consumes the parked
// ticket, persists the connection, and returns the token bundle.
func (h *Handler) Claim(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	var req struct {
		Session string `json:"session"`
	}
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return // DecodeJSON already wrote the error response
	}
	if req.Session == "" {
		httpx.Error(w, http.StatusBadRequest, "missing session", "bad_request")
		return
	}

	ctx := r.Context()
	pending, err := h.client.OAuthPending.Query().
		Where(oauthpending.StateEQ(req.Session)).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			httpx.Error(w, http.StatusNotFound, "ticket not found or already used", "ticket_expired")
			return
		}
		h.log.Error("claim: load pending", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load ticket", "internal_error")
		return
	}

	// Consume the ticket ONLY on success and on terminal-invalid outcomes
	// (expired / corrupt / malformed). We must NOT consume it on the 403
	// ownership-mismatch branch below: an attacker who learns a valid state
	// could otherwise burn a victim's still-valid ticket (DoS).
	deleteTicket := func() {
		// Detached from the request context so a client disconnect can't abort
		// cleanup, but bounded with a short timeout so a stalled DB can't block
		// the handler forever.
		dctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if delErr := h.client.OAuthPending.DeleteOne(pending).Exec(dctx); delErr != nil {
			h.log.Warn("claim: delete pending", zap.Error(delErr))
		}
	}

	if time.Now().After(pending.ExpiresAt) {
		deleteTicket()
		httpx.Error(w, http.StatusGone, "ticket expired", "ticket_expired")
		return
	}

	plain, err := h.sealer.Open(pending.PayloadEncrypted)
	if err != nil {
		deleteTicket()
		h.log.Error("claim: decrypt payload", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not read ticket", "internal_error")
		return
	}
	var payload parkedPayload
	if err := json.Unmarshal(plain, &payload); err != nil {
		deleteTicket()
		httpx.Error(w, http.StatusInternalServerError, "malformed ticket", "internal_error")
		return
	}
	// If a producer bound the ticket to a user, enforce it matches the caller.
	// NOTE: the browser-facing Callback in this service cannot set this field
	// (the browser flow carries no bearer), so for tickets it parks the claim is
	// first-authenticated-claimer-wins; the atomic consume below at least
	// guarantees exactly ONE claimer ever receives the bundle. True start-time
	// binding needs the desktop to mint the start ticket via an authenticated
	// call — tracked as a protocol change.
	// Deliberately do NOT consume the ticket here (see deleteTicket comment).
	if payload.WorkOSUserID != "" && payload.WorkOSUserID != u.WorkosUserID {
		httpx.Error(w, http.StatusForbidden, "ticket does not belong to this user", "forbidden")
		return
	}

	// Consume the ticket ATOMICALLY before releasing the token bundle: two
	// concurrent claims (e.g. an attacker racing the victim with a leaked state)
	// must not both receive the tokens. Exactly one DELETE wins.
	dctx, dcancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	n, err := h.client.OAuthPending.Delete().
		Where(oauthpending.IDEQ(pending.ID)).
		Exec(dctx)
	dcancel()
	if err != nil {
		h.log.Error("claim: consume pending", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not consume ticket", "internal_error")
		return
	}
	if n == 0 {
		httpx.Error(w, http.StatusNotFound, "ticket not found or already used", "ticket_expired")
		return
	}

	if payload.RefreshToken != "" {
		if err := h.persistConnection(ctx, u, payload.RefreshToken, splitScope(payload.Scope), payload.AccountEmail); err != nil {
			h.log.Warn("claim: persist connection", zap.Error(err))
		}
	}

	httpx.WriteJSON(w, http.StatusOK, payload.tokenBundle)
}

// Refresh handles POST /v1/google-oauth/refresh.
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return // DecodeJSON already wrote the error response
	}
	if req.RefreshToken == "" {
		httpx.Error(w, http.StatusBadRequest, "missing refreshToken", "bad_request")
		return
	}

	clientID := h.secrets.GoogleOAuthClientID()
	clientSecret := h.secrets.GoogleOAuthClientSecret()
	if clientID == "" || clientSecret == "" {
		httpx.Error(w, http.StatusBadGateway, "google oauth not configured", "provider_unconfigured")
		return
	}

	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("refresh_token", req.RefreshToken)
	form.Set("grant_type", "refresh_token")

	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not build request", "internal_error")
		return
	}
	upReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := h.http.Do(upReq)
	if err != nil {
		h.log.Warn("google refresh upstream error", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "google token endpoint failed", "upstream_error")
		return
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := outbound.ReadAll(resp.Body, h.http.MaxResponseBytes())
	if err != nil {
		h.log.Warn("google refresh response read failed", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "google token endpoint failed", "upstream_error")
		return
	}

	if resp.StatusCode != http.StatusOK {
		var gerr struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &gerr)
		if gerr.Error == "invalid_grant" {
			httpx.ErrorWith(w, http.StatusConflict,
				"Google reports invalid_grant; user must reconnect.",
				"reconnect_required",
				map[string]any{"reconnectRequired": true})
			return
		}
		httpx.Error(w, http.StatusBadGateway, "google refresh failed", "upstream_error")
		return
	}

	var gtok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
		Scope       string `json:"scope"`
		TokenType   string `json:"token_type"`
	}
	if err := json.Unmarshal(body, &gtok); err != nil {
		httpx.Error(w, http.StatusBadGateway, "malformed google response", "upstream_error")
		return
	}

	// Google omits refresh_token (and often scope) on refresh; the caller
	// preserves the prior values.
	httpx.WriteJSON(w, http.StatusOK, tokenBundle{
		AccessToken: gtok.AccessToken,
		ExpiresAt:   time.Now().Add(time.Duration(gtok.ExpiresIn) * time.Second).Unix(),
		Scope:       gtok.Scope,
		TokenType:   defaultStr(gtok.TokenType, "Bearer"),
	})
}

// persistConnection upserts the user's Google OAuthConnection with a sealed
// refresh token and the provider-side account email (webhook user resolution).
func (h *Handler) persistConnection(ctx context.Context, u *ent.User, refreshToken string, scopes []string, accountEmail string) error {
	sealed, err := h.sealer.SealString(refreshToken)
	if err != nil {
		return err
	}
	existing, err := h.client.OAuthConnection.Query().
		Where(oauthconnection.ProviderEQ("google")).
		Only(ctx)
	switch {
	case err == nil:
		update := existing.Update().SetRefreshTokenEncrypted(sealed).SetScopes(scopes)
		if accountEmail != "" {
			update = update.SetExternalAccountID(accountEmail)
		}
		return update.Exec(ctx)
	case ent.IsNotFound(err):
		create := h.client.OAuthConnection.Create().
			SetUser(u).
			SetProvider("google").
			SetRefreshTokenEncrypted(sealed).
			SetScopes(scopes)
		if accountEmail != "" {
			create = create.SetExternalAccountID(accountEmail)
		}
		return create.Exec(ctx)
	default:
		return err
	}
}

func splitScope(scope string) []string {
	if scope == "" {
		return nil
	}
	return strings.Fields(scope)
}

func defaultStr(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
