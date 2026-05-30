package google

// Browser-facing Google OAuth broker. The desktop (signed in) opens
// /oauth/google/start in the system browser; this service runs the Google
// consent dance (it holds the client secret) and parks the resulting token
// bundle in OAuthPending keyed by a state ticket. It then deep-links back to the
// desktop, which redeems the ticket with its bearer via /v1/google-oauth/claim.
// This replaces the rowboat web-dashboard's /oauth/google/start front door.

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthpending"
	"go.uber.org/zap"
)

// Start handles GET /oauth/google/start. Unauthenticated (the browser has no
// bearer); the signed-in desktop binds the result to its user at claim time.
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	if h.secrets.GoogleOAuthClientID() == "" || h.secrets.GoogleOAuthClientSecret() == "" {
		h.errorPage(w, http.StatusBadGateway, "Google sign-in isn't configured on the server yet.")
		return
	}
	if h.redirectURI == "" {
		h.errorPage(w, http.StatusInternalServerError, "Google redirect URI not configured.")
		return
	}

	state := randomState()
	// Park the issued state (empty payload) so the callback can validate it and
	// so an abandoned flow is swept by the row's TTL.
	sealed, err := h.sealer.Seal([]byte("{}"))
	if err != nil {
		h.errorPage(w, http.StatusInternalServerError, "Could not start sign-in.")
		return
	}
	if err := h.client.OAuthPending.Create().
		SetState(state).
		SetProvider("google").
		SetPayloadEncrypted(sealed).
		SetExpiresAt(time.Now().Add(10 * time.Minute)).
		Exec(r.Context()); err != nil {
		h.log.Error("google start: persist pending", zap.Error(err))
		h.errorPage(w, http.StatusInternalServerError, "Could not start sign-in.")
		return
	}

	q := url.Values{}
	q.Set("client_id", h.secrets.GoogleOAuthClientID())
	q.Set("redirect_uri", h.redirectURI)
	q.Set("response_type", "code")
	q.Set("scope", strings.Join(h.scopes, " "))
	q.Set("access_type", "offline") // request a refresh_token
	q.Set("prompt", "consent")      // force refresh_token issuance on re-consent
	// NOTE: deliberately NOT setting include_granted_scopes — it unions in every
	// scope this client was ever granted for the account, which can drag in
	// gmail.metadata. The metadata scope is the most-restrictive in a token and
	// forbids both `q=` search and format=FULL body fetches, breaking the Gmail
	// sync. Requesting only h.scopes keeps the token's grant minimal and clean.
	q.Set("state", state)
	http.Redirect(w, r, h.authorizeURL+"?"+q.Encode(), http.StatusFound)
}

// Callback handles GET /oauth/google/callback (Google's redirect target). It
// exchanges the code server-side, parks the token bundle under the state, and
// deep-links back to the desktop.
func (h *Handler) Callback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	state := q.Get("state")
	if oauthErr := q.Get("error"); oauthErr != "" {
		h.deepLink(w, state, "error")
		return
	}
	code := q.Get("code")
	if state == "" || code == "" {
		h.errorPage(w, http.StatusBadRequest, "Missing code or state.")
		return
	}

	pending, err := h.client.OAuthPending.Query().Where(oauthpending.StateEQ(state)).Only(ctx)
	if err != nil {
		h.errorPage(w, http.StatusBadRequest, "Sign-in session expired or invalid. Please try again.")
		return
	}
	if time.Now().After(pending.ExpiresAt) {
		_ = h.client.OAuthPending.DeleteOne(pending).Exec(context.WithoutCancel(ctx))
		h.errorPage(w, http.StatusBadRequest, "Sign-in session expired. Please try again.")
		return
	}

	// Exchange the code for tokens at Google (server holds the client secret).
	form := url.Values{}
	form.Set("client_id", h.secrets.GoogleOAuthClientID())
	form.Set("client_secret", h.secrets.GoogleOAuthClientSecret())
	form.Set("code", code)
	form.Set("redirect_uri", h.redirectURI)
	form.Set("grant_type", "authorization_code")

	upReq, err := http.NewRequestWithContext(ctx, http.MethodPost, h.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		h.deepLink(w, state, "error")
		return
	}
	upReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := h.http.Do(upReq)
	if err != nil {
		h.log.Warn("google callback: token exchange", zap.Error(err))
		h.deepLink(w, state, "error")
		return
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		h.log.Warn("google callback: token exchange non-200", zap.Int("status", resp.StatusCode))
		h.deepLink(w, state, "error")
		return
	}

	var gtok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		Scope        string `json:"scope"`
		TokenType    string `json:"token_type"`
	}
	if err := json.Unmarshal(body, &gtok); err != nil || gtok.AccessToken == "" {
		h.deepLink(w, state, "error")
		return
	}

	payload := parkedPayload{tokenBundle: tokenBundle{
		AccessToken:  gtok.AccessToken,
		RefreshToken: gtok.RefreshToken,
		ExpiresAt:    time.Now().Add(time.Duration(gtok.ExpiresIn) * time.Second).Unix(),
		Scope:        gtok.Scope,
		TokenType:    defaultStr(gtok.TokenType, "Bearer"),
	}}
	raw, _ := json.Marshal(payload)
	sealed, err := h.sealer.Seal(raw)
	if err != nil {
		h.deepLink(w, state, "error")
		return
	}
	if err := pending.Update().SetPayloadEncrypted(sealed).Exec(ctx); err != nil {
		h.log.Error("google callback: park tokens", zap.Error(err))
		h.deepLink(w, state, "error")
		return
	}
	h.deepLink(w, state, "success")
}

// deepLink bounces the browser back to the desktop via the rowboat:// scheme;
// the desktop claims the parked tokens with its bearer. An HTML page is used
// because a bare 302 to a custom scheme is unreliable across browsers.
func (h *Handler) deepLink(w http.ResponseWriter, state, status string) {
	target := h.deepLinkScheme + "://oauth/google/done?session=" + url.QueryEscape(state) + "&status=" + status
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, "<!doctype html><meta charset=utf-8><title>Rowboat</title>"+
		"<script>location.href="+jsString(target)+"</script>"+
		"<p style=\"font:14px system-ui;margin:3rem\">Returning to Rowboat… "+
		"<a href="+jsString(target)+">Click here</a> if it doesn't open automatically.</p>")
}

func (h *Handler) errorPage(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(code)
	_, _ = io.WriteString(w, "<!doctype html><meta charset=utf-8><title>Rowboat</title>"+
		"<p style=\"font:14px system-ui;margin:3rem\">"+htmlEscape(msg)+"</p>")
}

func randomState() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func jsString(s string) string { b, _ := json.Marshal(s); return string(b) }

func htmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}
